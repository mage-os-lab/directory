# Decision log

Short ADR-style records of the architecture decisions, in rough order of
significance. Full design context lives in [architecture.md](architecture.md).

## 1. Static pipeline + static site, no running server

**Decision:** a GitHub Actions pipeline emits versioned JSON artifacts, published
with a prerendered Astro site on Cloudflare Pages. The JSON feed is the public API.

**Why:** the catalog changes at most daily; nothing requires request-time computation.
A static system has effectively zero ops burden, zero hosting cost, no auth/scaling/
uptime concerns, and the artifact contract (`/api/v1/feed.json`) serves every future
consumer (admin module, CLI, CI checks) just as well as a live API would.

**Rejected:** hosted Node/PHP service with REST/GraphQL (ops burden unjustified at this
scale); serverless functions (still more moving parts than static files).

## 2. PackageMaven as the sole structural data source

**Decision:** PackageMaven's API is the only structural source. Its index *is* the
directory's universe. Packagist is not fetched.

**Why:** PM already aggregates the Packagist metadata we'd otherwise fetch ourselves, and
adds what Packagist can't provide: real install/compile/PHPStan/PHPCS test results
against actual Magento versions. Consuming tested compatibility eliminates the most
error-prone component of a dual-source design — deriving compatibility by parsing
Composer version constraints — and halves the number of external systems the pipeline
depends on. One source, one failure mode, one data shape.

**Consequences:** getting listed in the directory means getting indexed by PackageMaven;
reliable access to PM data is a hard dependency (the API, its field mapping, and the
terms of use are documented under [PackageMaven](architecture.md#packagemaven-structural-backbone)
in architecture.md).

**Rejected:** Packagist as backbone + PM as enrichment (two sources to join, constraint
parsing required, more failure modes); all of Packagist as the universe (unvetted
packages would swamp quality signals); a per-package Packagist lookup as a
supplementary source for fields PM lacks (PM carries license, abandoned status, and a
SemVer verdict, and its spec grants redistribution with attribution — there is nothing
left to backfill).

## 3. Curated universe with a PR-based trust overlay

**Decision:** the directory lists exactly what PackageMaven indexes. Mage-OS trust data
(trusted vendors, partner tiers, editorial picks, warnings) lives as per-vendor JSON
files in `data/vendors/`, edited by pull request, schema-validated in CI, guarded by
CODEOWNERS.

**Why:** Git gives the trust data version history, a review workflow, and accountability
for free. Per-vendor files keep diffs small and merge conflicts rare. Warnings with
`info`/`derank`/`hide` severities let curators correct the record without silently
deleting pages.

**Rejected:** a trust database/CMS (ops burden, loses PR review); trust files extending
the universe beyond PM's index (would need a second structural source for those
packages — contradicts decision 2).

## 4. TypeScript everywhere; Astro + Preact island + MiniSearch

**Decision:** one language for pipeline, schemas, and UI. Astro renders static
SEO-friendly pages; the browse/search experience is a Preact island doing client-side
search over the feed with MiniSearch.

**Why:** shared Zod schemas mean the pipeline, the site, and CI validate the same
contract from one definition. Astro is built for exactly this shape (static content,
small interactive islands). Client-side search over a ~200 KB gzipped feed needs no
search server. Preact + MiniSearch keep the embeddable bundle small.

**Rejected:** PHP pipeline (community-familiar, but splits the codebase across two
languages and the schema across two definitions); Fuse.js (no real index; MiniSearch is
faster at this corpus size); server-side search (requires a server — decision 1).

## 5. Single npm package, no monorepo tooling

**Decision:** one `package.json`; the Astro site (`src/site/`), the pipeline
(`src/pipeline/`), and the shared schemas (`src/schema/`) live in the same package. The
embeddable UI bundle is a second build target (Vite library mode), not a second package.

**Why:** keep it simple. `git clone && npm install && npm run build` must be the entire
onboarding for a contributor base that is mostly PHP developers. Workspaces, pnpm, or
turborepo solve problems this repo doesn't have.

**Rejected:** npm workspaces with separate schema/pipeline/ui/site packages (more
boundaries than the codebase needs at this size).

## 6. Embeddable UI bundle from day one

**Decision:** the search/browse island is built standalone as `directory-ui.js/.css`
with a `mountDirectory(el, options)` contract, prefixed CSS classes, and CSS
custom-property theming.

**Why:** the planned Magento admin module embeds this exact bundle later
(`linkMode: 'event'`), so the public site and the admin experience share one codebase.

**Amended after review:** class prefixes only stop our styles leaking *out*; they don't
stop a host page's global element selectors (the Magento admin has plenty) leaking
*in*. The bundle therefore renders inside an open Shadow DOM by default
(`shadow: true`), with theming via CSS custom properties, which pierce the boundary.
Plain prefixed CSS (no Tailwind) remains the styling approach for simplicity and a low
contributor barrier — but Shadow DOM, not prefixing, is the isolation mechanism. The
`mosd:select`/`mosd:error` event contract is specified in architecture.md so the admin
module isn't designed against a moving target.

## 7. Slim feed + per-package detail files

**Decision:** `/api/v1/feed.json` carries only what search/browse needs; READMEs and full
metadata live in `/api/v1/packages/<vendor>/<name>.json`.

**Why:** READMEs would push a single feed to tens of MB; splitting keeps the island's
one fetch at ~200 KB gzipped while detail pages and future consumers get full data
per package.

## 8. Transparent, config-tunable ranking

**Decision:** default ordering is a weighted score over editorial/partner/trust/quality/
freshness/popularity signals, with weights in `data/ranking.json` and the
per-component breakdown published in the feed.

**Why:** curators can tune ranking via a reviewable one-file PR, and "why is this
package ranked here?" is always answerable from the published data. Deranking and
hiding are explicit, auditable acts recorded in the trust files — never silent.

## 9. Cloudflare Pages, deployed from GitHub Actions

**Decision:** host on Cloudflare Pages, with the GitHub Actions pipeline doing a
wrangler direct upload of the built site + JSON artifacts, served from
`directory.mage-os.org` — a custom domain on the Pages project, and the only host named
in the Astro config, the module's `Config::BASE_URL`, and its CSP whitelist.

**Why:** Mage-OS already runs on Cloudflare, so this matches existing infrastructure
and ops knowledge. Direct upload keeps the build in Actions, where the cron schedule
and external data fetches live; Cloudflare's git-integration builds can't do that. Free
tier and global CDN. Serving under the Mage-OS domain rather than the `*.pages.dev`
origin keeps one public host in the feed contract, the module constant, and CSP.

**Rejected:** GitHub Pages (used briefly as a bootstrap fallback before the Cloudflare
secrets existed, since removed: a second hosting platform to operate when the rest of
the infrastructure is on Cloudflare).

## 10. Trust actions are governed, evidenced, and disputable

**Decision:** trust-file powers (trusted-vendor badges, partner tiers, editorial picks,
warnings) operate under a published [trust policy](trust-policy.md): vendor identity is
verified before a trust file merges, `derank`/`hide` warnings require linked public
evidence (schema-enforced via `evidenceUrl`) and vendor notification with a response
window, editorial picks are firewalled from partner status, partner-tier ranking
influence is disclosed on-site, and there is a public reporting channel plus an
expedited hide path for malicious packages.

**Why:** warnings are public claims about vendors' software, and ranking boosts imply
endorsement — both are reputational (and potentially legal) surface. A PR + CODEOWNERS
mechanism says *how* changes merge but not *what's legitimate*; without published
criteria, the first contested derank or namespace-squatting attempt would be handled ad
hoc in public. Cheap to write down now, expensive to improvise later.

**Rejected:** pure maintainer discretion (opaque, indefensible under dispute);
requiring evidence for `info`-severity notes too (friction disproportionate to a badge
that carries no penalty).

## 11. One repository for the service and the admin module

**Decision:** the Magento admin module lives in this repository: `src/` holds the
module (the Composer package `mage-os/module-extension-directory` is packaged from the
repository root, with PSR-4 mapped to `src/`), `service/` holds the pipeline, site, and
embeddable bundle. `.gitattributes` `export-ignore` strips everything except
`composer.json`, `LICENSE`, `README.md`, and `src/` from dist archives, and module CI
enforces two guards: the archive's top-level entries against an allowlist, and the
vendored UI bundle in `src/view/adminhtml/web/js/` byte-identical to what `service/`
builds.

**Why:** the module vendors the embeddable bundle and codes against the
`mountDirectory` contract. With separate repositories, every contract change took two
coordinated PRs, and the vendored bundle could only drift — its freshness rested on a
documented copy ritual. One repository makes contract changes atomic (schema, bundle,
module, and both test suites in a single reviewable change) and turns bundle sync into
a CI invariant. Ownership of both halves is unified today, which is the condition that
makes this cheap.

**Amends:** decision 6's assumption that the module
would live in a separate repository. The decoupling that actually matters — the bundle
staying framework-agnostic behind the `mountDirectory` contract — is unchanged; it is a
property of the code boundary, not the repository boundary.

**Escape hatch:** if governance later splits (association-owned module, separately
maintained), `git subtree split` extracts `src/` with full history — the
`magento/magento2` monorepo-with-splits pattern.

**Rejected:** staying split with an automated cross-repo bundle-sync PR bot (more
machinery to run than the problem deserves while one group maintains both); a
`composer.json` inside `src/` with a Packagist path hack (Packagist has no
subdirectory-package support).

## 12. The browse card answers eight questions and defers the rest

**Decision:** the card in `src/ui/` carries name, package path, one sentence, one quality
verdict, fit, installs, time since the last release, and any risk — plus, where the host
knows the shop, where the reader stands with it. PHPStan level, SemVer compliance, build
status, GitHub stars, the raw version and release date, and the per-card `composer
require` bar are gone from browse listings; they remain on detail pages. Quality tiers
carry merchant-facing names (`src/shared/quality.ts`), shared by the island and the
prerendered pages. Where the host passes `magentoVersion` or `installed`, the fit answer
leads the card as a colour-coded strip; on the public site it is a neutral tested-version
range in the footer. Installed / update-available / at-risk are each carried by a rail, a
surface tint and a word at once, risk outranking install state; marking draws an accent
ring, which composes on top of any rail.

**Why:** the previous card rendered up to seven badges and five metrics, and repeated the
same fact several times over — the version string in four places, the vendor in three,
quality in four (tier, PHPStan level, SemVer percentage, needs-help strip), popularity in
two. It also spoke to contributors: PHPStan levels and a "contribute on the repository"
nudge are for the person who would fix a module, not the person deciding whether to run
it. A browse card is the shortlist test — open this one, or scroll past — and anything
that doesn't move that decision costs scanning time on every card in the list. Meanwhile
the facts that *do* decide it were buried: compatibility with the shop's own Magento sat
seventh in a badge row, "N warnings" was a count instead of the warning, and freshness —
which the "recently released" sort orders on — was not shown at all.

**Rejected:** a dense row/ledger listing and a compatibility-matrix row (both better for
comparing many results, but wrong for the public site's discovery grid, and a second
layout to maintain); tile and editorial-row variants (too little and too much room
respectively); status by badge alone (an install state ranked level with "Editors' pick"
is the problem being fixed, and colour-only encoding fails for the same reason);
per-card composer commands (the admin's tray already builds one from the install list,
and detail pages carry the single-package form).

## 13. One list, a few filters that matter, and a page at a time

**Decision:** browsing by category is a filter on the single directory list, not a
second listing: the home page's category grid and the prerendered `/categories/<slug>/`
pages are gone, the old URLs redirect to `/?category=<slug>`, and the island mirrors its
whole filter state into the URL (`q`, `category`, `only`, `sort`) so a narrowed view is a
link. Categories are alphabetical. The quality-tier checkboxes are replaced by one-click
chips that each answer a shortlisting question — Trusted vendor, Editors' picks, Tested
with &lt;version&gt;, Recently updated, High quality, Popular, and on host-aware
surfaces Installed / Update available — combined with AND. Results render a page of 24
with a "Show more" button rather than the whole catalog. The component's ground is
transparent and its font inherits from the host; it ships a light and a dark palette,
follows `prefers-color-scheme` by default, and lets a host pin one (`colorScheme`). The
Magento admin pins light, since both admin themes are light-only, and passes
`?embed=1&scheme=light` to the detail pages it frames — no site header inside the modal,
and the admin's palette kept.

**Why:** two ways to browse by category (a grid of links to prerendered pages, and a
select inside the island) meant two experiences that looked alike and behaved
differently; clicking a category should narrow what is already on screen. Filtering by
"Known issues" or "Not assessed yet" narrows toward what nobody is looking for, while
the questions people actually ask before shortlisting — who is behind it, does it fit my
version, is it maintained, is it any good, does anyone use it — had no control at all.
Rendering ~1,100 cards on load is slow to paint and hides that the ordering is the
recommendation; a page plus "Show more" keeps the top of the list the answer and works
without pagination state in the URL. A transparent ground is what lets one bundle sit on
the legacy admin's grey, M137's neutral grey and the site's white without a per-host
background token, and inheriting the font is what makes it read as native under both
admin themes without detecting which one is active. The chip vocabulary, the filter
panel as one surface with a result count and "Clear filters", the URL-as-state, and the
dark palette are borrowed from the Mage-OS Lab catalogue ([mage-os-org#92](https://github.com/mage-os/mage-os-org/pull/92)).

**Rejected:** numbered pagination (meaningless once the sort or filter changes, and a
second URL contract); infinite scroll (loses the footer and the sense of how far the
list goes); keeping prerendered category landing pages for SEO (the detail pages carry
the search value; a category page whose list differs from the home page's is the
confusion being removed); favourites in localStorage as on the Lab page (the admin's
install list already plays that role, and on the public site a shareable filtered URL
is the more useful bookmark); a fixed install threshold for "Popular" (brittle as the
corpus shifts — a percentile is self-adjusting); auto-dark in the admin (the admin chrome
does not follow the OS, so the panel must not either).

## 14. The admin learns the directory exists from its dashboard, and can say no once

**Decision:** the module adds one panel above the admin dashboard — a title, one
sentence, a "Browse the directory" button and a "Hide this tip" button — rendered only
for accounts whose role holds the ACL root resource (`Magento_Backend::all`, the
"Allow everything" grant). One config flag, **Show Extension Directory Tip** under
Advanced → Admin → Dashboard (on by default), gates it for the whole installation; the
panel's own button flips that same flag through a form-key-checked POST action that
needs the Admin configuration section's permission, then reloads config and sends the
admin back to the dashboard with a message naming where to turn it back on. Nothing
else in the admin chrome advertises the directory beyond the existing System menu
entry. The module's other setting, the direct/proxy mode, moves into the same core
section as a small "Extension Directory" group: two fields do not earn a tab and a
section of their own, and a merchant looks for admin behaviour under Advanced → Admin.

**Why:** a merchant who installs the module (or gets it with a distribution) has no
reason to open System → Extensions → Extension Directory unless something tells them it is
there, and the dashboard is the one page every admin session starts on. Restricting it
to unrestricted roles is a proxy for "the person who decides what gets installed": a
catalogue manager with a narrow role gains nothing from a prompt to go shopping for
modules, and a distribution's default admin is always unrestricted. One global flag,
rather than a per-user dismissal, is what "opt-out in admin settings" asks for and needs
no storage of its own; the button exists so the opt-out is one click from where the
panel is, not a trip through configuration. The ACL root resource is read from
`Magento\Framework\Acl\RootResource` rather than hard-coded, because that is where
Magento_Backend declares it.

**Rejected:** a system message in the header (that channel is for things that are wrong —
invalidated caches, indexers — and a permanent marketing line there would teach admins to
ignore it); an admin-notification inbox entry (global, not role-gated, and read state is
shared across users); a per-user dismissal (needs somewhere to keep it, and the ask was a
setting); showing the panel to anyone who can open the directory page (the ACL for
viewing the catalogue is deliberately broad, the decision to install is not).

## 15. Trend joins the default ranking, from stateless Packagist counters

**Decision:** the pipeline fetches Packagist's documented per-package stats endpoint
(lifetime, trailing-30-day and daily downloads plus the date Packagist first saw the
package) and publishes the result as `api/v1/sources/packagist.json`. Two signals join
the default score: **recentInstalls** (0.13), the trailing-30-day count log-normalized
against the corpus like lifetime installs, and **momentum** (0.06), the package's last
30 days against its own lifetime monthly average, normalized so the corpus median scores
0.5 and `momentumCeiling` (4) times the median scores 1. Every package carries an
additive `activity: { monthlyDownloads, momentum, stale } | null` block, and the browse
UI gains a gated **Trending** chip, badge and sort. Lifetime `installs` drops to 0.06,
`trustedVendor` to 0.05 and `editorialPick` to 0.15.

**Why:** total ÷ age is a lifetime average, so the stats endpoint alone makes "is this
growing?" computable with no history store, no database and no scheduled scraping of our
own — the same stateless-artifact discipline as decision 1. The ratio is taken against
the corpus median rather than against 1 because the whole ecosystem's download counts
grow: a ratio near 1.8 is the tide, not a story, and only the deviation from typical is
signal. recentInstalls takes half of installs' old weight so that a module with real
adoption *today* can stand beside a veteran whose lifetime total is fifty times larger —
which is the point of the feature, and is what `rank.test.ts` pins. Momentum itself
stays small (0.06) because it is the most volatile and most gameable number here: a
nightly CI job installing a package looks exactly like adoption. The Trending mark is
gated for the same reason — momentum above 0.75, monthly downloads at or above the
catalog median, and not abandoned, deranked or hidden — because a directory whose
premise is trust must not badge something it is simultaneously warning readers away
from. Trimming trusted vendor and editors' pick keeps the marks from dominating a score
that now has more to say. Politeness is part of the decision, not an implementation
detail: 4 requests a second, concurrency 3, a `mailto:` User-Agent, one Retry-After-
honouring retry, a breaker on the second throttle, request and time budgets, and
carry-forward of any package the run did not reach from the previously published
snapshot — which is why the snapshot is an artifact rather than a database.

**Rejected:** the undocumented chart-history endpoint (`stats/all.json`) — a richer
series, but unpublished, unversioned and a heavier request per package, and building a
default ranking signal on something Packagist never promised is how a directory breaks
quietly; a time series persisted by the pipeline (state to store, migrate and trust,
for a number two published counters already imply); GitHub commit velocity (a better
maintenance signal than downloads and worth adding later, but it measures the
maintainer's activity, not the market's, and the GitHub budget is already spent on
READMEs and stars); keeping trend as a separate "what's rising" view only (a view
nobody sorts by changes nothing about which modules a reader actually sees first).

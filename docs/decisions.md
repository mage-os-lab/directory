# Decision log

Short ADR-style records of the architecture decisions for v1, in rough order of
significance. Full design context lives in [architecture.md](architecture.md).

## 1. Static pipeline + static site, no running server

**Decision:** v1 is a GitHub Actions pipeline emitting versioned JSON artifacts, published
with a prerendered Astro site on Cloudflare Pages. The JSON feed is the public API.

**Why:** the catalog changes at most daily; nothing requires request-time computation.
A static system has effectively zero ops burden, zero hosting cost, no auth/scaling/
uptime concerns, and the artifact contract (`/api/v1/feed.json`) serves every future
consumer (admin module, CLI, CI checks) just as well as a live API would.

**Rejected:** hosted Node/PHP service with REST/GraphQL (ops burden unjustified at this
scale); serverless functions (still more moving parts than static files).

## 2. PackageMaven as the sole structural data source

**Decision:** PackageMaven's export is the only structural source in v1. Its index *is*
the directory's universe. Packagist is not fetched.

**Why:** PM already aggregates the Packagist metadata we'd otherwise fetch ourselves, and
adds what Packagist can't provide: real install/compile/PHPStan/PHPCS test results
against actual Magento versions. Consuming tested compatibility eliminates the most
error-prone component of a dual-source design — deriving compatibility by parsing
Composer version constraints — and halves the number of external systems the pipeline
depends on. One source, one failure mode, one data shape.

**Consequences:** getting listed in the directory means getting indexed by PackageMaven;
securing reliable access to PM data (see [packagemaven-data-contract.md](packagemaven-data-contract.md))
is the launch gate; outreach to PM's author is the day-one critical path.

**Contingency:** if PM's export lacks specific fields (license, downloads, abandoned
flag) or access falls through, a per-package Packagist lookup can be added behind the
same source interface — deliberately excluded from v1 for simplicity.

**Rejected:** Packagist as backbone + PM as enrichment (two sources to join, constraint
parsing required, more failure modes); all of Packagist as the universe (unvetted
packages would swamp quality signals).

**Amended 2026-08-19:** the contingency above is moot — PM added `license` and
`abandoned` (with suggested replacement) to the API at our request, plus an
unrequested SemVer-compliance verdict, and wrote
redistribution-with-attribution terms into the API spec itself (attribution to
package-maven.com plus each package's Packagist page). See
[packagemaven-api-evaluation.md](packagemaven-api-evaluation.md). The
per-Packagist-lookup fallback stays rejected.

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

## 9. Launch gated on PackageMaven *data*, not PackageMaven's API

**Decision:** the public launch waits until real PM data is in the feed (milestone
M4a) — but "PM data" means *any machine-readable delivery*, including a manually
regenerated export at whatever cadence PM's author finds convenient. Automated
integration against a PM API (M4b) deliberately happens *after* launch.

**Why:** quality signals are the directory's core value proposition; launching with
"quality: pending" on every package would undercut it. But gating on PM's API would
tie the launch to PM's engineering timeline — and as of 2026-07 that timeline is
months out, while PM's author is already willing to collaborate (contract sent, he
asked for specifics). The pipeline normalizes any delivery mechanism into the same
internal snapshot (`origin: live | manual | fixture`), and the site discloses the
refresh cadence with a "data as of" notice, so a manual export is an honest launch
basis rather than a compromise.

**Amended after review:** originally "launch gated on M4 (live PM integration)" as a
single monolithic milestone; split into M4a/M4b when PM's positive-but-slow timeline
made API-or-nothing gating needlessly expensive.

**Amended 2026-07-10:** PM shipped a real API months early (see
[packagemaven-api-evaluation.md](packagemaven-api-evaluation.md)), so M4a and M4b
collapsed back into one milestone: the pipeline's live path fetches the API directly
and the manual-export machinery was never needed. The principle stands — launch gates
on real PM data in the feed — but the delivery mechanism question is settled.

## 10. Cloudflare Pages, deployed from GitHub Actions

**Decision:** host on Cloudflare Pages, with the GitHub Actions pipeline doing a
wrangler direct upload of the built site + JSON artifacts. Ship under `*.pages.dev`;
move to a `mage-os.org` subdomain when infrastructure/branding is settled (custom-domain
attachment + one config change).

**Why:** Mage-OS already runs on Cloudflare, so this matches existing infrastructure
and ops knowledge. Direct upload keeps the build in Actions, where the cron schedule
and external data fetches live; Cloudflare's git-integration builds can't do that. Free
tier, global CDN, and the later domain move is trivial with the feed contract unaffected.

**Rejected:** GitHub Pages (works, but adds a second hosting platform to operate when
the rest of the infrastructure is on Cloudflare).

## 11. Trust actions are governed, evidenced, and disputable

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

## 12. One repository for the service and the admin module

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

**Amends:** decision 6's assumption (and the handoff's open decision 3) that the module
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

## 13. The browse card answers eight questions and defers the rest

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

## 14. One list, a few filters that matter, and a page at a time

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
`?scheme=light` to the detail pages it frames.

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


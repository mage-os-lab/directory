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
Plain prefixed CSS (no Tailwind) is what makes embedding into the Magento admin safe —
no global resets to fight — and keeps the contributor barrier low.

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

## 9. Launch gated on PackageMaven data

**Decision:** the public launch waits until live PM data is integrated (milestone M4).
All other milestones build and preview against fixture data.

**Why:** quality signals are the directory's core value proposition; launching with
"quality: pending" on every package would undercut it. Project decision, accepted
trade-off: PM outreach sits on the critical path.

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

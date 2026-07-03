# Architecture

The Mage-OS Extension Directory is a **static data pipeline plus a static catalog site**.
There is no running backend service. A scheduled GitHub Actions job aggregates package
data into versioned JSON artifacts, and those artifacts are published together with a
prerendered website on Cloudflare Pages. The JSON feed *is* the public API.

This document is the implementation reference for v1. The reasoning behind the major
choices is recorded in [decisions.md](decisions.md).

## Data flow

```
PackageMaven export ─┐
                     ├─→ pipeline (GitHub Actions, daily + on data merge)
GitHub API ──────────┤      fetch → merge trust data → rank → validate → emit
                     │
data/vendors/*.json ─┘
                            │
                            ▼
              /api/v1/feed.json  +  /api/v1/packages/<vendor>/<name>.json
                            │
                            ▼
              Astro build (prerendered pages + search island) → Cloudflare Pages
```

## Data sources

### PackageMaven (structural backbone)

[PackageMaven](https://package-maven.com/) is the sole structural source for v1. It
already indexes ~750 Magento 2 modules, aggregates their Packagist metadata, and —
critically — **tests each module against real Magento versions**, producing quality tiers,
PHPStan levels, and build status. Consuming its results means compatibility comes from
actual test outcomes rather than from parsing Composer version constraints.

The directory's universe is exactly PackageMaven's index. Getting listed in the directory
means publishing on Packagist and submitting to PackageMaven (via the "Submit a Module"
form on its site); a contributor-facing `how-to-get-listed` guide is part of milestone M3.

The fields the pipeline needs from PM are specified in
[packagemaven-data-contract.md](packagemaven-data-contract.md).

**Status (2026-07):** PM's author responded positively to collaborating and asked for
specifics; the data contract has been sent as the starting point. PM's timeline for a
real API is **months out**, so the near-term ask is the cheapest thing that works: a
manually regenerated JSON export (or even a one-off dump we normalize), refreshed at
whatever cadence is convenient. The PM fetcher treats delivery mechanism as an
implementation detail — stable URL, repo drop, or hand-shared file all normalize into
the same internal snapshot shape (`origin: 'live' | 'manual' | 'fixture'`), so launch
rides on *any* machine-readable delivery, not on PM's API timeline (see milestones
M4a/M4b). Everything else is built and previewed against fixture data.

When running on a manually refreshed export, staleness is a *steady state*, not a
transient failure: the site shows a "quality data as of &lt;date&gt;" notice sourced from the
snapshot's `fetchedAt` rather than the transient-failure warning path described under
[Pipeline](#pipeline).

**Contingency:** if PM's export turns out to lack specific fields (license, monthly
downloads, abandoned flag), a thin per-package Packagist lookup can be added as a
supplementary source. It is deliberately *not* part of v1 — one structural source keeps
the pipeline simple and reliable.

### GitHub (presentation extras, failure-tolerant)

- **READMEs** for package detail pages, fetched at build time via the REST API with
  ETag-conditional requests (steady-state daily runs are almost all 304s).
- **Stars** as a popularity signal, fetched in batched GraphQL queries.

Both are nullable. A GitHub failure never fails the build; affected packages simply
render without a README or star count. Non-GitHub repositories get no README/stars in v1.

Because Actions runners are ephemeral, the ETag cache (a `{repo → etag, body}` map) is
persisted between runs with `actions/cache` (keyed with restore-keys so any prior cache
seeds the next run). Cache eviction just means one cold run. A `GITHUB_TOKEN`/PAT is
**required** in CI — 750 repos doesn't fit in the unauthenticated 60 req/hr limit; rate
limit exhaustion mid-run degrades to null READMEs/stars for the remainder, never a
retry loop or build failure. READMEs are republished under the package's own
open-source license with a link back to the source; takedown requests are honored via
the repo's issue tracker.

### Mage-OS vendor trust files (trust layer)

Human-curated trust data lives in this repository as `data/vendors/<vendor>.json` —
one file per vendor, edited by pull request. See [Vendor trust files](#vendor-trust-files).

## Pipeline

A TypeScript script under `src/pipeline/`, run by GitHub Actions:

- **Triggers:** daily cron, push to `main` touching `data/**`, and manual
  `workflow_dispatch`.
- **Stages:**
  1. Fetch the PackageMaven export and normalize it into the internal snapshot shape.
  2. Load and validate `data/vendors/*.json`. *Malformed* trust data fails the build —
     it is our own data and CI on the PR should have caught it. A trust entry that
     references a package *absent from the current PM snapshot* is a warning, not a
     failure: the entry is skipped and reported. (PM's index moves between our runs, so
     an entry that validated at PR time can legitimately dangle later — a scheduled
     build must not hard-fail on that.)
  3. Fetch GitHub READMEs (sanitized to HTML with a strict allowlist; relative links and
     images rewritten to absolute raw URLs) and stars.
  4. Merge into canonical package records. Precedence: trust-file overrides → PackageMaven.
     PM's raw category labels map to canonical slugs via `data/categories.json`
     (unmapped labels land in the fallback category); a trust-file `categories` override
     wins outright.
  5. Compute the ranking score (see [Ranking](#ranking)).
  6. Validate the assembled output against the schema (the pipeline validates its own
     output before publishing).
  7. Emit deterministic, sorted JSON to `public/api/v1/` (gitignored; `astro dev`
     serves it and `astro build` copies it into `dist/`), then build the site and
     deploy everything to Cloudflare Pages.
- **Full rebuild every run.** At this corpus size a run takes minutes, and full rebuilds
  eliminate cache-invalidation bugs. The HTTP ETag cache is the only incrementalism.
- **Failure semantics:** the pipeline publishes its latest *raw normalized PM snapshot*
  at `/api/v1/sources/packagemaven.json`. If a PM fetch fails, the pipeline downloads
  that snapshot and carries it forward marked `stale: true`, emits a GitHub Actions
  warning, and completes — trust merge and ranking always re-run against source data,
  never against previously merged output (re-merging merged output would double-apply
  overrides and lose the original PM values). If the fetch fails and *no* published
  snapshot exists yet (first-ever run), the build fails with an explicit message; a
  manual `workflow_dispatch` against the fixture is the bootstrap path. The build never
  hard-fails because an external source is down; it only fails on our own data or code
  being invalid.

## Published artifacts

| Path | Contents |
|---|---|
| `/api/v1/manifest.json` | `{ schemaVersion, generatedAt, feedHash, packageCount }` — cheap freshness check |
| `/api/v1/feed.json` | Everything the search/browse UI needs: all packages (slim records), vendors, categories, source status |
| `/api/v1/packages/<vendor>/<name>.json` | Full detail per package, including sanitized README HTML |
| `/api/v1/sources/packagemaven.json` | The latest raw normalized PM snapshot — carry-forward source for failed fetches, and an audit trail of what PM provided vs. what we derived |

Versioning: the `/api/v1/` path prefix plus a `schemaVersion` field inside each payload.
A breaking schema change publishes `/api/v2/` alongside v1 for a deprecation window.
(Vendor trust files are deliberately *not* versioned this way — they live in this repo,
so a breaking format change is one migration PR across `data/vendors/`.) READMEs live
only in the per-package detail files so the feed stays small (roughly 1 MB raw /
~200 KB gzipped at 750 packages).

## Feed schema (sketch)

Authoritative schemas are Zod definitions in `src/schema/`, shared by the pipeline, the
site, and CI validation. Field-level sketch:

```ts
interface Feed {
  schemaVersion: 1;
  generatedAt: string;            // ISO 8601
  sources: SourceStatus[];        // { id, ok, stale, fetchedAt } per source
  rankingConfigVersion: string;
  categories: Category[];         // { slug, name, packageCount }
  vendors: VendorSummary[];       // { slug, name, trustedVendor, partnerTier, packageCount }
  packages: PackageSummary[];
}

interface PackageSummary {
  name: string;                   // "acme/module-widget" (Packagist name)
  vendor: string;
  displayName: string;            // trust-file override → PM friendly name
  description: string;
  categories: string[];           // canonical slugs; trust-file override wins
  repositoryUrl: string | null;
  latestVersion: string | null;
  latestReleasedAt: string | null;
  supportedMagento: string[];     // Magento versions PM verified, e.g. ["2.4.7", "2.4.6"]
  abandoned: boolean | null;      // null when PM's export doesn't carry the flag
  quality: {
    tier: 'strict-compliant' | 'no-errors' | 'ready-to-install' | 'needs-help';
    phpstanLevel: number | null;
    buildStatus: 'passing' | 'failing' | 'unknown';
    stale: boolean;               // mirrors the packagemaven entry in Feed.sources:
  };                              // true when this run reused a carried-forward snapshot
  trust: {
    trustedVendor: boolean;
    partnerTier: 'platinum' | 'gold' | 'silver' | 'bronze' | null;
    editorialPick: boolean;
    warnings: Array<{ code: string; message: string;
                      severity: 'info' | 'derank' | 'hide'; date: string }>;
    deranked: boolean;            // derived from warnings
    hidden: boolean;              // derived from warnings
  };
  popularity: {
    installs: number | null;      // PackageMaven install count
    githubStars: number | null;
  };
  ranking: {
    score: number;                // 0..1
    components: Record<string, number>;  // per-signal breakdown, for transparency;
  };                              // signals with unavailable data are omitted (see Ranking)
}

// /api/v1/packages/<vendor>/<name>.json
interface PackageDetail extends PackageSummary {
  schemaVersion: 1;
  generatedAt: string;
  readmeHtml: string | null;      // sanitized at build time
  license: string[] | null;
  links: { packagist: string; packagemaven: string;
           repository: string | null; issues: string | null; docs: string | null };
}
```

Packages with a `hide`-severity warning keep their detail page (rendered with a prominent
warning banner — no link rot) but are excluded from the default search results.

## Vendor trust files

`data/vendors/<vendor>.json`, one file per vendor:

```json
{
  "$schema": "../vendor.schema.json",
  "vendor": "acme",
  "vendorName": "Acme Commerce",
  "url": "https://acme.example",
  "trustedVendor": true,
  "partnerTier": "gold",
  "packages": {
    "acme/module-widget": {
      "displayName": "Acme Widget Manager",
      "categories": ["catalog"],
      "editorialPick": true
    },
    "acme/module-legacy": {
      "warnings": [
        {
          "code": "unmaintained",
          "severity": "derank",
          "message": "No release since 2022; author confirmed inactive.",
          "date": "2026-05-01"
        }
      ]
    }
  }
}
```

Rules, enforced by schema validation in CI:

- Filename must equal the `vendor` field; all package keys must start with `<vendor>/`.
- Referenced packages should exist in the PackageMaven index (trust files decorate the
  universe; they do not extend it). CI checks this against the latest published PM
  snapshot and *fails the PR*; scheduled pipeline runs only *warn and skip* dangling
  entries, because PM's index moves between our runs and a scheduled build must not
  hard-fail on external drift.
- Categories must exist in `data/categories.json`.
- Warning severity is one of `info` (badge only), `derank` (ranking penalty), `hide`
  (excluded from default results). `derank` and `hide` warnings must carry an
  `evidenceUrl` linking the public evidence.

Who may hold `trustedVendor`/`partnerTier`, the evidence and notification bar for
warnings, dispute handling, and the expedited path for malicious packages are governed
by the [trust policy](trust-policy.md).

A formatter (`npm run format:vendors`) normalizes key order and sorting for clean
diffs; CI runs it in `--check` mode and tells contributors the exact command to fix
failures. `CODEOWNERS` on `data/vendors/**` requires maintainer review, which is how
partner-tier changes are guarded.

## Ranking

The default ordering is a transparent weighted score computed at build time. Weights
live in `data/ranking.json` so curators can tune ranking with a one-file PR:

```json
{
  "weights": {
    "editorialPick": 0.20,
    "partnerTier": 0.10,
    "trustedVendor": 0.10,
    "qualityTier": 0.25,
    "freshness": 0.15,
    "installs": 0.12,
    "stars": 0.08
  },
  "qualityTierValues": { "strict-compliant": 1.0, "no-errors": 0.8,
                         "ready-to-install": 0.5, "needs-help": 0.15 },
  "partnerTierValues": { "platinum": 1.0, "gold": 0.8, "silver": 0.6, "bronze": 0.4 },
  "freshnessHalfLifeDays": 180,
  "penalties": { "deranked": 0.3, "abandoned": 0.1 }
}
```

- Every component is normalized and clamped to 0–1: booleans directly, tiers via the
  lookup tables, freshness as `0.5 ^ (daysSinceLastRelease / halfLifeDays)` (clamped, so
  a future-dated release can't exceed 1), installs and stars log-normalized against the
  corpus 95th percentile (so giant vendors don't flatten the scale; a degenerate
  percentile of 0 makes the whole signal unavailable rather than dividing by zero).
- **Missing data is not a zero score.** When a signal's underlying data is unavailable
  (null installs, null stars — e.g. non-GitHub repos — or no release date), that
  component is *omitted* and the remaining weights are renormalized to sum to 1. This
  avoids systematically punishing packages for data we couldn't fetch; the omission is
  visible because the component is absent from `ranking.components`.
- `score = Σ weightᵢ × componentᵢ`, then multiplied by `0.3` if deranked and `0.1` if
  abandoned — deliberately compounding (`0.03`) when both apply. A null `abandoned`
  flag (PM doesn't carry it) is treated as `false`. Weights must sum to 1.0 (asserted
  by the pipeline).
- The per-component breakdown ships in the feed (`ranking.components`), so "why is this
  ranked here?" is always answerable and weight changes can be audited by diffing feeds.
  One caveat: installs/stars normalization is corpus-relative, so a package's score can
  drift when *other* packages change — acceptable at daily cadence, and diagnosable from
  the published components.
- Known gaming vector, accepted for v1: no-op releases refresh the freshness signal
  (15% weight, and quality tier still dominates). Revisit if abused.

## Site and embeddable UI

Astro static site (TypeScript, `output: 'static'`), with the interactive browse/search
experience as a Preact island using MiniSearch for client-side search over the feed.

| Route | Contents |
|---|---|
| `/` | Hero, editorial picks (prerendered), category grid, search island |
| `/packages/<vendor>/<name>/` | Prerendered detail page: README, badges, stats, supported Magento versions, copyable `composer require`, JSON-LD |
| `/vendors/<vendor>/` | Vendor trust badges + ranked package list |
| `/categories/<category>/` | Prerendered category list, island preset to that filter |
| `/how-to-get-listed/` | Rendered from docs |
| `/api/v1/**` | The pipeline's static JSON output |
| `/embed/*` | The embeddable bundle (`directory-ui.iife.js`, `directory-ui.js`, `directory-ui.css`), served CORS-open from the directory's own origin |

Per-package and vendor pages are prerendered for SEO; search and filtering happen
client-side against `feed.json`.

The browse/search component itself is a pure Preact component in `src/ui/` with no
Astro or Node dependencies (types-only imports from `src/schema/` — Zod never ships to
the browser). Two thin entry points consume it: an Astro island wrapper in `src/site/`
and the standalone library entry below. This boundary is what makes the dual build
mechanical rather than clever.

**Embeddable bundle:** the component is also built standalone (Vite library mode) as
`directory-ui.js` (ES) / `directory-ui.iife.js` (classic script, global
`MageOSDirectory`) + `directory-ui.css` (only needed for `shadow: false` embedders —
shadow mounts inline the styles). The build lands in `public/embed/`, so every deploy
publishes it at `/embed/*` on the directory's own origin — that URL is what the future
admin module loads. It exposes:

```ts
mountDirectory(el: HTMLElement, options: {
  feedUrl?: string;                // default "/api/v1/feed.json" — embedders pass the
                                   // absolute directory URL (CORS is open on /api/v1/*)
  linkMode?: 'href' | 'event';     // default 'href'
  initialFilters?: { category?: string; quality?: string[]; query?: string };
  baseUrl?: string;                // href prefix for linkMode 'href'; default ""
  shadow?: boolean;                // default true: render inside an open Shadow DOM
}): () => void;                    // returns unmount
```

Contract details the admin module depends on:

- `linkMode: 'event'` — selecting a package dispatches a bubbling, composed
  `CustomEvent('mosd:select', { detail: { name, vendor, packageUrl } })` on the mount
  element instead of navigating; `packageUrl` is the canonical detail-page URL.
- Feed fetch failure renders a retryable error state inside the component and
  dispatches `CustomEvent('mosd:error', { detail: { message } })`; it never throws out
  of `mountDirectory`.
- Class prefixes (`.mosd-*`) keep our styles from leaking out, but only Shadow DOM
  keeps host-page styles (like the Magento admin's global element resets) from leaking
  *in* — hence `shadow: true` by default for embeds. Theming still works because CSS
  custom properties pierce the shadow boundary. The Astro site mounts with
  `shadow: false` since it owns the page.

**UI features (v1):** text search, category browse, quality/badge filters, popularity
sort (installs, stars, recency), default "recommended" sort by ranking score, stats on
cards, README on detail pages, vendor pages. When the feed reports a stale or manually
refreshed source, the UI shows a visible "quality data as of &lt;date&gt;" notice — stale
data must never present as live. A Magento-version compatibility *filter* is deferred;
supported versions are displayed as a field. Also deferred, cheap to add later: a
"recently added" page / RSS feed diffed from consecutive snapshots.

**Analytics:** Cloudflare Web Analytics (free, privacy-respecting, no cookies) on the
public site. It covers the metrics that matter early — page views per package/vendor,
referrers — and gives PM's author concrete referral numbers, which is part of the
pitch. Copy-to-clipboard and outbound-click counters can be layered on later if needed.

## Repository layout (planned)

One npm package — no workspaces, no monorepo tooling:

```
package.json              # single package; scripts: pipeline, build, test, format:vendors
astro.config.mjs          # srcDir set to src/site
vite.ui.config.ts         # library-mode build for the embeddable bundle
tsconfig.json             # one tsconfig; pipeline runs under tsx, site under astro check —
                          # a deliberate simplicity trade-off over per-target configs
src/
  site/                   # Astro site (pages incl. 404.astro, layouts, island wrapper)
  ui/                     # pure Preact browse/search component + mountDirectory entry
  pipeline/               # pipeline entry + source fetchers + merge/rank/emit + dev tools
  schema/                 # Zod schemas shared by pipeline, site, and CI
data/                     # everything contributors edit by PR
  vendors/<vendor>.json   # vendor trust files (the trust overlay)
  vendor.schema.json      # generated from src/schema, committed so editors validate trust files
  categories.json         # canonical category taxonomy + PM label mapping
  ranking.json            # tunable ranking weights
  fixtures/               # fixture PM snapshot for dev/preview builds
public/
  _headers                # Cloudflare Pages headers: CORS + cache-control for /api/v1/*
.github/workflows/
  build-deploy.yml        # cron + data pushes + manual → build, deploy to Cloudflare Pages
  ci.yml                  # PRs: typecheck, tests, trust-file validate + format check, build smoke
docs/
```

The category taxonomy (`data/categories.json`) is owned by the maintainers: it maps
PM's raw category labels onto a small canonical slug set, defines the fallback
category for unmapped labels, and changes by ordinary PR. Renaming a slug is a
breaking change for trust files that reference it, so CI validates those references —
a rename PR must update every affected vendor file to pass.

## Hosting

Cloudflare Pages, matching the Cloudflare infrastructure Mage-OS already uses. The
GitHub Actions pipeline builds everything, then deploys with a wrangler direct upload
(`cloudflare/wrangler-action`, `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`
secrets). Cloudflare's own git-integration builds are deliberately not used: the build
is cron-triggered and fetches external data, so it has to run in Actions.

A `public/_headers` file configures response headers Pages doesn't set by default:

```
/api/v1/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=300, must-revalidate
```

CORS-open `/api/v1/*` is what lets the embeddable bundle fetch the feed from a
merchant's admin-panel origin; the short max-age keeps `manifest.json`'s freshness
check honest instead of pinned at the edge. File-count headroom is not a concern:
Pages' direct-upload limit is 20,000 files, and 750 packages (a detail JSON + a
prerendered page each, plus site chrome) lands well under 2,500.

Ships under the project's `*.pages.dev` URL initially; moving to a `mage-os.org`
subdomain later is a custom-domain attachment in Cloudflare plus the Astro `site`
config change.

## Milestones

PackageMaven outreach has landed positively (contract sent; their API is months out),
so the integration milestone is split: launch gates on *data*, not on PM's API.

- **M0 — Scaffold:** package setup, Zod schemas, generated vendor-file JSON Schema, seed
  data files (categories, ranking weights), CI skeleton. *Done when:* `npm test` is green.
- **M1 — Pipeline on fixture data:** full pipeline running against a committed fixture
  snapshot. *Done when:* a valid, deterministic `/api/v1/` output is produced and
  snapshot-tested.
- **M2 — Site + island:** all routes, prerendered detail pages, embeddable bundle,
  Cloudflare Pages deploy live. *Done when:* search/filter/sort works on the fixture feed
  and the bundle mounts on a bare HTML demo page.
- **M3 — Trust-file CI:** trust-file loading, formatter, CI jobs, CODEOWNERS, contributor
  docs, 3–5 real vendor files. *Done when:* a malformed vendor-file PR fails with a
  readable error and a valid merge auto-redeploys.
- **M4a — PackageMaven data, any delivery** *(gated on PM providing a first export)*:
  normalize whatever PM shares — manual dump, stable URL, repo drop — into the snapshot
  shape; universe switches from fixture to real data; "data as of" notice wired up.
  *Done when:* the live site serves PM-derived quality tiers with correct attribution.
- **M5 — Launch** *(gated on M4a)*: ranking tuning with curators, custom-domain prep,
  polish, announce — with the data-refresh cadence disclosed on-site.
- **M4b — Automated PM integration** *(gated on PM's API/export automation, months
  out)*: swap the manual drop for a fetch at pipeline cadence; delete the "manual
  refresh" caveats. Deliberately *after* launch.

## Risks

1. **PM data doesn't materialize** — still the launch-gating risk, though smaller now:
   PM's author is on board and the ask has been reduced to "any machine-readable
   export, manually refreshed" (M4a). Mitigation: the source interface is pluggable, so
   the worst case admits a Packagist-based fallback (losing quality tiers) or a
   self-hosted analyzer later.
2. **Manual-refresh staleness** — until M4b, data is only as fresh as PM's last export.
   Mitigated by the on-site "data as of" notice and a disclosed cadence; the trap to
   avoid is presenting months-old quality tiers as live.
3. **GitHub rate limits** on cold-cache README fetches — mitigated by the
   `actions/cache`-persisted ETag cache, GraphQL batching for stars, and a required
   token in CI; exhaustion degrades to null READMEs rather than failing.
4. **README content is third-party HTML** — strict sanitization allowlist at build time;
   the `hide` warning severity is the kill switch for abusive packages, with an
   expedited process defined in the [trust policy](trust-policy.md).
5. **Trust data as reputational surface** — warnings are public claims about vendors'
   software. Mitigated by the evidence requirement, vendor notification window, and
   dispute process in the trust policy.
6. **Stale detail URLs** when packages leave the index — accepted in v1 (daily rebuild
   prunes files; the site ships a custom 404 page).

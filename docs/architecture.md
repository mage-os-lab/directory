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
[packagemaven-data-contract.md](packagemaven-data-contract.md). Securing this access (a
daily JSON export or a simple API, agreed with PM's author Jiří Brada) is the launch
gate; everything else can be built and previewed against fixture data (the archived
[jbrada/package-maven-contribution](https://github.com/jbrada/package-maven-contribution)
module list serves as the bootstrap fixture).

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

### Mage-OS vendor trust files (trust layer)

Human-curated trust data lives in this repository as `data/vendors/<vendor>.json` —
one file per vendor, edited by pull request. See [Vendor trust files](#vendor-trust-files).

## Pipeline

A TypeScript script under `src/pipeline/`, run by GitHub Actions:

- **Triggers:** daily cron, push to `main` touching `data/**`, and manual
  `workflow_dispatch`.
- **Stages:**
  1. Fetch the PackageMaven export.
  2. Load and validate `data/vendors/*.json` (invalid trust data fails the build —
     it is our own data and CI on the PR should have caught it).
  3. Fetch GitHub READMEs (sanitized to HTML with a strict allowlist; relative links and
     images rewritten to absolute raw URLs) and stars.
  4. Merge into canonical package records. Precedence: trust-file overrides → PackageMaven.
  5. Compute the ranking score (see [Ranking](#ranking)).
  6. Validate the assembled output against the schema (the pipeline validates its own
     output before publishing).
  7. Emit deterministic, sorted JSON to `dist/api/v1/`, then build the site and deploy
     everything to Cloudflare Pages.
- **Full rebuild every run.** At this corpus size a run takes minutes, and full rebuilds
  eliminate cache-invalidation bugs. The HTTP ETag cache is the only incrementalism.
- **Failure semantics:** if the PackageMaven fetch fails, the pipeline downloads the
  currently published `feed.json` and carries its data forward marked `stale: true`,
  emits a GitHub Actions warning, and completes. The build never hard-fails because an
  external source is down; it only fails on our own data or code being invalid.

## Published artifacts

| Path | Contents |
|---|---|
| `/api/v1/manifest.json` | `{ schemaVersion, generatedAt, feedHash }` — cheap freshness check |
| `/api/v1/feed.json` | Everything the search/browse UI needs: all packages (slim records), vendors, categories, source status |
| `/api/v1/packages/<vendor>/<name>.json` | Full detail per package, including sanitized README HTML and recent versions |

Versioning: the `/api/v1/` path prefix plus a `schemaVersion` field inside each payload.
A breaking schema change publishes `/api/v2/` alongside v1 for a deprecation window.
READMEs live only in the per-package detail files so the feed stays small (roughly
1 MB raw / ~200 KB gzipped at 750 packages).

## Feed schema (sketch)

Authoritative schemas will be Zod definitions in `src/schema/`, shared by the pipeline, the
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
  quality: {
    tier: 'strict-compliant' | 'no-errors' | 'ready-to-install' | 'needs-help';
    phpstanLevel: number | null;
    buildStatus: 'passing' | 'failing' | 'unknown';
    stale: boolean;               // true when carried forward from a previous build
  };
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
    components: Record<string, number>;  // per-signal breakdown, for transparency
  };
}

// /api/v1/packages/<vendor>/<name>.json
interface PackageDetail extends PackageSummary {
  schemaVersion: 1;
  generatedAt: string;
  readmeHtml: string | null;      // sanitized at build time
  license: string[] | null;
  authors: Array<{ name: string; homepage?: string }>;
  links: { packagist: string; packagemaven: string; issues?: string; docs?: string };
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
- Referenced packages must exist in the PackageMaven index (trust files decorate the
  universe; they do not extend it).
- Categories must exist in `data/categories.json`.
- Warning severity is one of `info` (badge only), `derank` (ranking penalty), `hide`
  (excluded from default results).

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

- Every component is normalized to 0–1: booleans directly, tiers via the lookup tables,
  freshness as `0.5 ^ (daysSinceLastRelease / halfLifeDays)`, installs and stars
  log-normalized against the corpus 95th percentile (so giant vendors don't flatten the
  scale).
- `score = Σ weightᵢ × componentᵢ`, then multiplied by `0.3` if deranked and `0.1` if
  abandoned. Weights must sum to 1.0 (asserted by the pipeline).
- The per-component breakdown ships in the feed (`ranking.components`), so "why is this
  ranked here?" is always answerable and weight changes can be audited by diffing feeds.

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

Per-package and vendor pages are prerendered for SEO; search and filtering happen
client-side against `feed.json`.

**Embeddable bundle:** the island is also built standalone (Vite library mode) as
`directory-ui.js` + `directory-ui.css`, exposing:

```ts
mountDirectory(el: HTMLElement, options: {
  feedUrl: string;                 // default "/api/v1/feed.json"
  linkMode: 'href' | 'event';      // site uses hrefs; embedders get a CustomEvent on select
  initialFilters?: { category?: string; quality?: string[]; query?: string };
  baseUrl?: string;
}): () => void;                    // returns unmount
```

This is the contract the future Magento admin module will consume (`linkMode: 'event'`).
All island CSS is prefixed (`.mosd-*`) and themed via CSS custom properties so it embeds
into the Magento admin without style conflicts — which is also why the project uses plain
CSS rather than a framework.

**UI features (v1):** text search, category browse, quality/badge filters, popularity
sort (installs, stars, recency), default "recommended" sort by ranking score, stats on
cards, README on detail pages, vendor pages. A Magento-version compatibility *filter* is
deferred; supported versions are displayed as a field.

## Repository layout (planned)

One npm package — no workspaces, no monorepo tooling:

```
package.json              # single package; scripts: pipeline, build, test, format:vendors
astro.config.mjs          # srcDir set to src/site
src/
  site/                   # Astro site (pages, components, the search island)
  pipeline/               # pipeline entry + source fetchers + merge/rank/emit + dev tools
  schema/                 # Zod schemas shared by pipeline, site, and CI
data/                     # everything contributors edit by PR
  vendors/<vendor>.json   # vendor trust files (the trust overlay)
  vendor.schema.json      # generated from src/schema, committed so editors validate trust files
  categories.json         # canonical category taxonomy
  ranking.json            # tunable ranking weights
.github/workflows/
  build-deploy.yml        # cron + data pushes + manual → build, deploy to Cloudflare Pages
  ci.yml                  # PRs: typecheck, tests, trust-file validate + format check, build smoke
docs/
```

## Hosting

Cloudflare Pages, matching the Cloudflare infrastructure Mage-OS already uses. The
GitHub Actions pipeline builds everything, then deploys with a wrangler direct upload
(`cloudflare/wrangler-action`, `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`
secrets). Cloudflare's own git-integration builds are deliberately not used: the build
is cron-triggered and fetches external data, so it has to run in Actions.

Ships under the project's `*.pages.dev` URL initially; moving to a `mage-os.org`
subdomain later is a custom-domain attachment in Cloudflare plus the Astro `site`
config change.

## Milestones

PackageMaven outreach starts immediately and runs in parallel; it gates only M4/M5.

- **M0 — Scaffold:** package setup, Zod schemas, generated vendor-file JSON Schema, seed
  data files (categories, ranking weights), CI skeleton. *Done when:* `npm test` is green.
- **M1 — Pipeline on fixture data:** full pipeline running against a committed fixture
  feed (seeded from the archived PM contribution list). *Done when:* a valid, deterministic
  `/api/v1/` output is produced and snapshot-tested.
- **M2 — Site + island:** all routes, prerendered detail pages, embeddable bundle,
  Cloudflare Pages deploy live. *Done when:* search/filter/sort works on the fixture feed
  and the bundle mounts on a bare HTML demo page.
- **M3 — Trust-file CI:** trust-file loading, formatter, CI jobs, CODEOWNERS, contributor
  docs, 3–5 real vendor files. *Done when:* a malformed vendor-file PR fails with a
  readable error and a valid merge auto-redeploys.
- **M4 — PackageMaven integration** *(gated on data access)*: real PM fetcher, quality
  tiers live in feed/UI/ranking, universe switches from fixture to live index.
- **M5 — Launch** *(gated on M4, per project decision)*: ranking tuning with curators,
  custom-domain prep, polish, announce.

## Risks

1. **PM access doesn't materialize** — the launch-gating risk. Mitigation: outreach is
   the day-one critical path; the source interface is pluggable, so the worst case admits
   a Packagist-based fallback (losing quality tiers) or a self-hosted analyzer later.
2. **GitHub rate limits** on cold-cache README fetches — mitigated by ETag caching,
   GraphQL batching for stars, and an optional PAT secret.
3. **README content is third-party HTML** — strict sanitization allowlist at build time;
   the `hide` warning severity is the kill switch for abusive packages.
4. **Stale detail URLs** when packages leave the index — accepted in v1 (daily rebuild
   prunes files; Cloudflare Pages serves the 404 page).

# Architecture

The Mage-OS Extension Directory is a **static data pipeline plus a static catalog site**.
There is no running backend service. A scheduled GitHub Actions job aggregates package
data into versioned JSON artifacts, and those artifacts are published together with a
prerendered website on Cloudflare Pages. The JSON feed *is* the public API.

This document is the implementation reference for the service (`service/`) and the
contract the admin module (`src/`) builds against. The reasoning behind the major
choices is recorded in [decisions.md](decisions.md).

## Data flow

```
PackageMaven API ────┐
                     ├─→ pipeline (GitHub Actions, daily + on push to service/)
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

[PackageMaven](https://package-maven.com/) is the sole structural source. It indexes
~1,100 Magento 2 modules, aggregates their Packagist metadata, and — critically —
**tests each module against real Magento versions**, producing quality tiers, PHPStan
levels, and build status. Consuming its results means compatibility comes from actual
test outcomes rather than from parsing Composer version constraints.

The directory's universe is exactly PackageMaven's index. Getting listed in the directory
means publishing on Packagist and submitting to PackageMaven (via the "Submit a Module"
form on its site); the site's `/how-to-get-listed/` page walks vendors through it.

**The API.** PM exposes a read-only REST API at `https://package-maven.com/api/v1`
(spec: [`/api/v1/openapi.json`](https://package-maven.com/api/v1/openapi.json), the only
unauthenticated endpoint). Everything else needs a bearer token issued by the PM team,
held as the `PACKAGE_MAVEN_TOKEN` repository secret (`PM_API_URL` overrides the base URL
for testing). The fetcher (`src/pipeline/packagemaven.ts`) sweeps `GET /packages` at
`per_page=100` — about 11 requests per run against a limit of 60 requests/minute, with
`429`/`Retry-After` honoured — plus `GET /categories`, and normalizes the result into the
internal snapshot shape (`src/schema/source.ts`, `origin: 'live' | 'fixture'`).
Only publicly visible packages are returned; hidden packages 404.

Field mapping, PM → snapshot:

| Snapshot field | PM field | Notes |
|---|---|---|
| `name` | `composer_name` | join key |
| `displayName` | `name` | nullable; falls back to `composer_name`, then prefix-cleaned (below) |
| `description`, `repositoryUrl` | `description`, `repository_url` | nullable |
| `rawCategories` | `categories[].slug` | stable slugs; mapped to canonical slugs via `data/categories.json`, unmapped slugs raise a pipeline warning |
| `latestVersion`, `latestReleasedAt` | `latest_release.{version,date}` | |
| `quality.tier` | `quality.{strict_compliant,no_errors,build_works,needs_help}` | tiered flags: first true wins in that order; all false → `null` (not yet tested) |
| `quality.phpstanLevel` | `test_results.phpstan_level` | `-1..9`; `-1` = fails at level 0; `null` = untested |
| `quality.buildStatus` | derived | `build_works` → passing, `needs_help` → failing, else unknown |
| `quality.semver` | `semver.{status, compliance_percent}` | SemVer compliance of released versions; display-only, not a ranking signal |
| `releases[]` | `test_results.{package_version, magento_version}` | one `(release, Magento version)` pair per package — see below |
| `abandoned`, `abandonedReplacement` | `abandoned.{is_abandoned, replacement}` | |
| `license` | `license` | SPDX, comma-separated when dual-licensed; split into an array |
| `popularity.installs`, `popularity.githubStars` | `stats.installs`, `stats.stars` | PM's stars fill in when the GitHub fetch is off or rate-limited |
| `links.packagemaven`, `links.packagist` | `links.web`, `links.packagist` | PM pages live at `package-maven.com/<vendor>/<package>` — always use the reported URL |

Two properties of PM's data shape the rest of the system:

- **Untested is a state.** PM lists packages it has not tested yet (no quality flags,
  null test results). They carry `quality.tier: null`, ranking omits the quality
  signal for them rather than punishing them, the UI shows "Not yet tested", and hero
  counters exclude them.
- **One tested pair per package, and it may lag the latest release.**
  `test_results.package_version` can differ from `latest_release.version`, so quality
  and compatibility describe the *tested* release. The normalizer emits the tested pair
  as a single `releases[]` row rather than stamping it onto the latest release; a full
  per-release matrix from PM would slot into the same field without schema changes.
  Absence of a test result is never presented as incompatibility.

**Display names.** The normalizer cleans PM's human name for `displayName`, stripping
redundant leading words (`Magento2`, `Magento 2`, `Module`, with an optional `-`/`:`
separator) and the phrase "for Magento 2" wherever it appears, so a card title reads
"Google Tag Manager" rather than "Magento2 Google Tag Manager for Magento 2". A name
that is *nothing but* those words (e.g. `quickpay/magento2` → "Magento2") is titled
with the vendor's name instead.

**Terms.** PM's API spec carries its data-ownership and attribution terms: any use,
redistribution, or display of the data must attribute package-maven.com as the source
and, when displaying a package, link its original Packagist page. The directory
republishes only the fields above, as an open feed with the attribution carried in the
feed's `sources` metadata and on every package view; it never scrapes the PM site, and
fetches once per pipeline run with a descriptive User-Agent. The arrangement is
revocable in either direction — if PM withdraws access, the pipeline carries forward
the last snapshot as stale (see [Pipeline](#pipeline)) until a replacement source exists.

### GitHub (presentation extras, failure-tolerant)

- **READMEs** for package detail pages, fetched at build time via the REST readme
  endpoint with the `html` media type — GitHub renders GFM, so the pipeline never
  parses Markdown — using ETag-conditional requests (steady-state daily runs are
  almost all 304s, which don't count against the rate limit). One request per
  *repository*, so a monorepo's packages share it.
- **Stars** as a popularity signal, fetched in batched GraphQL queries. PackageMaven
  reports its own star counts too, and they fill in wherever the GitHub fetch is off,
  rate-limited, or fails.

Both are nullable. A GitHub failure never fails the build; affected packages simply
render without a README or star count. Non-GitHub repositories get no README.

Because Actions runners are ephemeral, the ETag cache (a `{repo → etag, body}` map) is
persisted between runs with `actions/cache` (keyed with restore-keys so any prior cache
seeds the next run). Cache eviction just means one cold run. A `GITHUB_TOKEN`/PAT is
**required** in CI — ~1,100 repos doesn't fit in the unauthenticated 60 req/hr limit; rate
limit exhaustion mid-run degrades to null READMEs/stars for the remainder, never a
retry loop or build failure. READMEs are republished under the package's own
open-source license with a link back to the source; takedown requests are honored via
the repo's issue tracker.

### Mage-OS vendor trust files (trust layer)

Human-curated trust data lives in this repository as `data/vendors/<vendor>.json` —
one file per vendor, edited by pull request. See [Vendor trust files](#vendor-trust-files).
The overlay is universe-scoped: `data/vendors/` decorates the live PM index, and the
invented vendors that match the fixture snapshot live separately in
`data/fixtures/vendors/`, so example trust data can never reach a live build.

## Pipeline

A TypeScript script under `src/pipeline/`, run by GitHub Actions:

- **Triggers:** daily cron, push to `main` touching anything under `service/` (data,
  pipeline, site, or UI source — the site and the embeddable bundle are built from all of
  it), and manual `workflow_dispatch`.
- **Stages:**
  1. Fetch the PackageMaven API and normalize it into the internal snapshot shape.
  2. Load and validate the trust overlay for the universe being built —
     `data/vendors/*.json` live, `data/fixtures/vendors/*.json` on a fixture run. *Malformed* trust data fails the build —
     it is our own data and CI on the PR should have caught it. A trust entry that
     references a package *absent from the current PM snapshot* is a warning, not a
     failure: the entry is skipped and reported. (PM's index moves between our runs, so
     an entry that validated at PR time can legitimately dangle later — a scheduled
     build must not hard-fail on that.)
  3. Fetch GitHub READMEs and stars (`src/pipeline/{github,readme,http-cache}.ts`).
     READMEs pass a strict tag/attribute allowlist, get their relative links and
     images rewritten to absolute github.com/raw URLs, their ids and in-page
     anchors namespaced under `readme-` (so a README's own table of contents works
     without colliding with the page), and their headings demoted one level (the
     page owns the h1). Live runs only: a fixture build stays hermetic and
     publishes the disabled state.
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
only in the per-package detail files so the feed stays small (roughly 1.5 MB raw /
~300 KB gzipped at ~1,100 packages).

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
  displayName: string;            // trust-file override → PM friendly name (prefix-cleaned)
  description: string;
  categories: string[];           // canonical slugs; trust-file override wins
  repositoryUrl: string | null;
  latestVersion: string | null;
  latestReleasedAt: string | null;
  supportedMagento: string[];     // Magento versions PM verified the *latest* release
                                  // against, e.g. ["2.4.7", "2.4.6"]
  compatibility: Record<string, string>;
                                  // Magento version → newest release verified against it,
                                  // derived from PM's per-release test matrix; lets a
                                  // client on 2.4.6 pin the newest release known to work
                                  // there when the latest is 2.4.7-only. Empty without
                                  // per-release data from PM.
  abandoned: boolean | null;      // null when PM's export doesn't carry the flag
  quality: {
    tier: 'strict-compliant' | 'no-errors' | 'ready-to-install' | 'needs-help' | null;
                                  // null = PM hasn't tested the package yet
    phpstanLevel: number | null;  // PM scale 0–9; -1 = fails at level 0; null = untested
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
  readmeSourceUrl: string | null; // where it was reproduced from (attribution);
                                  // null whenever readmeHtml is
  releases: Array<{               // PM's per-release test matrix, newest first
    version: string;              // (latest release folded in); empty when PM
    releasedAt: string | null;    // supplies no per-release data
    supportedMagento: string[];
  }>;
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
  snapshot (`PUBLISHED_BASE_URL`) and *fails the PR*; where no published snapshot is
  reachable yet, package references are reported *unverified* rather than failing —
  a vendor file carrying only a tier or badge names no packages and validates either way; scheduled pipeline runs only *warn and skip* dangling
  entries, because PM's index moves between our runs and a scheduled build must not
  hard-fail on external drift.
- Categories must exist in `data/categories.json`.
- Warning severity is one of `info` (shown on the card, no ranking effect), `derank`
  (ranking penalty), `hide` (excluded from default results). `derank` and `hide`
  warnings must carry an `evidenceUrl` linking the public evidence.

Who may hold `trustedVendor`/`partnerTier`, the evidence and notification bar for
warnings, dispute handling, and the expedited path for malicious packages are governed
by the [trust policy](trust-policy.md).

A formatter (`npm run format:vendors`) normalizes key order and sorting for clean
diffs; CI runs it in `--check` mode and tells contributors the exact command to fix
failures. `CODEOWNERS` on `/service/data/vendors/` requires maintainer review, which is
how partner-tier changes are guarded. (CODEOWNERS patterns are repo-root anchored, and
the data lives under `service/` — a root-relative `/data/...` entry silently matches
nothing and gates no review.)

`partnerTier` and `trustedVendor` are independent fields granted on independent
criteria: a partnership never confers the trusted badge, and neither field is a
prerequisite for the other. See the [trust policy](trust-policy.md#trusted-vendor).

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
- Known gaming vector, accepted: no-op releases refresh the freshness signal
  (15% weight, and quality tier still dominates). Revisit if abused.

## Site and embeddable UI

Astro static site (TypeScript, `output: 'static'`), with the interactive browse/search
experience as a Preact island using MiniSearch for client-side search over the feed.

| Route | Contents |
|---|---|
| `/` | Hero, editorial picks (prerendered), and the browse island — search, category chips, one-click filters, sort, paged results; filter state mirrors into `?q=`, `?category=`, `?only=`, `?sort=` |
| `/packages/<vendor>/<name>/` | Prerendered detail page: README, badges, stats, supported Magento versions, copyable `composer require`, JSON-LD |
| `/vendors/<vendor>/` | Vendor trust badges + ranked package list |
| `/categories/<category>/` | Redirect (meta refresh + canonical) to `/?category=<category>` — browsing by category is a filter on the one list, not a second listing |
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
publishes it at `/embed/*` on the directory's own origin — that URL is what the admin
module loads in Direct mode (Proxy mode serves the copy vendored in `src/`). It exposes:

```ts
mountDirectory(el: HTMLElement, options: {
  feedUrl?: string;                // default "/api/v1/feed.json" — embedders pass the
                                   // absolute directory URL (CORS is open on /api/v1/*)
  linkMode?: 'href' | 'event';     // default 'href'
  initialFilters?: {                // seeds the controls; sort and flags are the same
    category?: string; query?: string; sort?: SortKey;
    flags?: FilterFlag[];            // 'trusted' | 'picks' | 'tested' | 'recent' |
                                     // 'quality' | 'popular' | 'installed' | 'update'
    quality?: string[];              // tier allowlist; honoured, no control of its own
  };
  baseUrl?: string;                // href prefix for linkMode 'href'; default ""
  shadow?: boolean;                // default true: render inside an open Shadow DOM
  installed?: Record<string, string>; // composer name → installed version, read by the
                                   // host from composer.lock; adds Installed /
                                   // "update available" badges + an installed-state filter
  selectable?: boolean;            // default false: mark-for-install toggles + a tray
                                   // with the copyable composer require command; the
                                   // list lives in sessionStorage, so it survives a
                                   // reload of the tab and ends with the tab
  magentoVersion?: string;         // the host shop's Magento/Mage-OS version; adds
                                   // tested-with badges, points the "tested with" chip
                                   // at it, and the install list pins the newest release
                                   // verified against it (via PackageSummary.compatibility)
  distribution?: { name: string; version: string }; // the host's own distribution when it
                                   // isn't Magento (e.g. Mage-OS 3.5.0); relabels every
                                   // "tested with" with it. Ignored without magentoVersion
  colorScheme?: 'auto' | 'light' | 'dark'; // default 'auto' follows prefers-color-scheme;
                                   // pin it for hosts whose chrome has one palette
  pageSize?: number;               // cards per page (default 24); the next page loads as the
                                   // reader nears the end, with "Show more" as the fallback
}): () => void;                    // returns unmount
```

Contract details the admin module depends on:

- `linkMode: 'event'` — selecting a package dispatches a bubbling, composed
  `CustomEvent('mosd:select', { detail: { name, vendor, packageUrl, installState,
  markable, marked } })` on the mount element instead of navigating; `packageUrl` is
  the canonical detail-page URL, and the last three describe the package's place on
  the install list so the host can offer the same mark toggle wherever it shows the
  package (the admin's detail modal puts one in its header).
- Feed fetch failure renders a retryable error state inside the component and
  dispatches `CustomEvent('mosd:error', { detail: { message } })`; it never throws out
  of `mountDirectory`.
- With `selectable: true`, every change to the install list dispatches a bubbling,
  composed `CustomEvent('mosd:selection', { detail: { packages: [{ name, version }],
  command } })` — `command` is the ready-to-paste
  `composer require vendor/a:^1.2 vendor/b` string (empty when the list is empty). The
  list is kept in `sessionStorage` (key `mosd:install-list`, package names only) so a
  reload, or a detour through a detail page, does not lose it; a mount that restores a
  non-empty list dispatches `mosd:selection` once on mount, since the host never saw
  that list being built. Names the current feed no longer carries are dropped, and
  versions are pinned afresh against the feed in hand. The host can change the list
  from outside the bundle by dispatching `CustomEvent('mosd:mark', { detail: { name,
  marked? } })` on the mount element — a toggle when `marked` is omitted, a set
  otherwise — under the same rules as the card's toggle (selectable mount, package in
  the catalog, not already installed); the result is announced as `mosd:selection`. The
  directory never installs anything itself: version detection stays client-side
  (`installed` comes from the host reading composer.lock) and the output is a command
  the merchant runs manually — consistent with the copy-the-command model on detail
  pages.
- With `magentoVersion`, compatibility is a lookup, never a solver: the fit line at the
  top of each card reads "tested with X" (latest release verified), "vN tested with X"
  (only an older release verified — the install list pins `^N`), or "not tested with X".
  Because this is PM's *empirical* test matrix, absence of a test result is never
  presented as incompatibility, and full conflict resolution is deliberately left to
  `composer require --dry-run` on the merchant's machine. Matching is by release line:
  PM tests base releases and a patch release does not change compatibility, so a shop on
  `2.4.9-p1` matches PM's `2.4.9` results. Where the host also passes `distribution`, X is
  the distribution's own version ("Tested with Mage-OS 3.5.0") — the number its admin
  recognises — and the Magento release behind it appears only in the chip's tooltip.
- The component's ground is transparent and its typography inherits from the host, so
  it sits on whichever page background and font the host has (the two Magento admin
  themes differ in both). Cards, the filter panel and the floating install tray are the
  opaque surfaces. Two palettes ship in the stylesheet — light by default, dark when the
  OS asks and `colorScheme` is `'auto'`, or when it is pinned `'dark'` — and the host's
  `--mosd-theme-*` custom properties override either.
- Class prefixes (`.mosd-*`) keep our styles from leaking out, but only Shadow DOM
  keeps host-page styles (like the Magento admin's global element resets) from leaking
  *in* — hence `shadow: true` by default for embeds. Theming still works because CSS
  custom properties pierce the shadow boundary. The Astro site mounts with
  `shadow: false` since it owns the page.

**UI features:** text search; category chips (alphabetical, with counts — one at a
time, and the chips on each card are the same control); "show only" chips that each
answer one shortlisting question and combine with AND — Trusted vendor, Editors' picks,
Tested with &lt;version&gt;, Recently updated (a release in the last 12 months), High
quality (PackageMaven's top two tiers), Popular (top 15% of the catalog by installs),
plus Installed and Update available where the host supplied `installed`; sort
(recommended by ranking score, installs, stars, recency, name); pages of 24 cards that
load as the reader nears the end, with "Show more" as the fallback; README on detail
pages; vendor pages. Quality tier is not a filter of its
own — "Known issues" is not something anyone narrows *to* — and a card names only the
tiers that change a shortlist: the top two as a High quality badge, `needs-help` as a
"Known issues" note; the full tier lives on the detail page. "Tested with" targets the
shop's own version where an embed passes
`magentoVersion`, and otherwise the newest Magento version anything in the catalog has
been verified against. When the feed reports a stale source, the UI shows a visible
"quality data as of &lt;date&gt;" notice — stale data must never present as live.

**What a browse card carries.** A card is the shortlist test — open this one, or scroll
past — so it answers eight questions and leaves the rest to the detail page: name, package
path, one sentence, the marks it has earned, fit, installs, time since the last release,
and any risk (a trust warning or abandonment, with the maintainer's suggested
replacement). Host-aware surfaces add a ninth, where the reader stands with it. The earned
marks — Trusted vendor, Editors' pick, High quality, Popular — sit as badges in the card's
bottom-left corner, with the install toggle at the bottom-right, and are the same four facts the "show only" chips ask about, in the same
words, so what a chip narrows to is what a card shows. PHPStan level, SemVer compliance,
build status, stars, the release date, the licence and the `composer require` string are
detail-page facts: each either restates the quality tier, restates a number already on
the card, or decides nothing at browse time. Where a tier is named, it is in the words a
person choosing a module would use (`strict-compliant` reads as "Strict checks pass",
`needs-help` as "Known issues") from `src/shared/quality.ts`, which the island and the
prerendered pages share so one vocabulary reaches the reader everywhere; on the card the
top two tiers are folded into "High quality", and the tier's own name is that badge's
tooltip.

**How state reaches the reader.** Installed, update-available and at-risk are each carried
three ways at once — a 3px rail on the card's left edge, a tint on the card surface, and
the state in words — so nothing depends on colour alone. Risk outranks install state: an
abandoned module the shop already runs shows the risk rail and still names the installed
version. Marking a module for the install list is the reader's own choice rather than a
fact about the package, so it draws an accent ring around the whole card instead of a
fourth rail, and composes with whatever rail is already there.

**Analytics:** Cloudflare Web Analytics (free, privacy-respecting, no cookies) on the
public site. It covers the metrics that matter early — page views per package/vendor,
referrers — and gives PM's author concrete referral numbers, which is part of the
pitch. Copy-to-clipboard and outbound-click counters can be layered on later if needed.

## Repository layout

The repository root is the Composer package for the admin module; the service is a
single npm package under `service/` — no workspaces, no monorepo tooling:

```
composer.json             # mage-os/module-extension-directory, PSR-4 → src/
src/                      # the Magento admin module (MageOS_ExtensionDirectory)
  view/adminhtml/web/js/  #   incl. the vendored copy of directory-ui.iife.js
dev/tests/unit/           # hermetic PHPUnit suite against committed framework stubs
service/
  package.json            # scripts: pipeline, build, build:ui, test, format:vendors
  astro.config.mjs        # srcDir set to src/site
  vite.ui.config.ts       # library-mode build for the embeddable bundle
  tsconfig.json           # one tsconfig; pipeline runs under tsx, site under astro check
  src/
    site/                 # Astro site (pages incl. 404.astro, layouts, island wrapper)
    ui/                   # pure Preact browse/search component + mountDirectory entry
    pipeline/             # pipeline entry + source fetchers + merge/rank/emit + dev tools
    schema/               # Zod schemas shared by pipeline, site, and CI
    shared/               # vocabulary shared by the island and prerendered pages
  data/                   # everything contributors edit by PR
    vendors/<vendor>.json #   vendor trust files (the trust overlay)
    vendor.schema.json    #   generated from src/schema, committed so editors validate trust files
    categories.json       #   canonical category taxonomy + PM slug mapping
    ranking.json          #   tunable ranking weights
    fixtures/             #   fixture PM snapshot + its matching trust overlay, for
                          #     dev/preview builds (never loaded by a live run)
  public/
    _headers              # Cloudflare Pages headers: CORS + cache-control for /api/v1/*
.github/workflows/
  build-deploy.yml        # cron + service pushes + manual → build, deploy to Cloudflare Pages
  service-ci.yml          # PRs: typecheck, tests, trust-file validate + format check, build smoke
  module-ci.yml           # PRs: PHP unit suite, dist-archive allowlist, bundle-sync guard
docs/
```

Paths elsewhere in this document (`src/pipeline/…`, `data/vendors/…`) are relative to
`service/` unless they name the module.

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
Pages' direct-upload limit is 20,000 files, and ~1,100 packages (a detail JSON + a
prerendered page each, plus site chrome) lands well under 3,500.

The canonical host is `directory.mage-os.org`, a custom domain attached to the
Cloudflare Pages project (`mage-os-directory`). It is the one origin admin browsers and
the module's proxy talk to: the Astro `site` config, the module's `Config::BASE_URL`,
and `src/etc/csp_whitelist.xml` all name it and nothing else.

## Standing risks

1. **PackageMaven dependency** — quality tiers and compatibility come from one external
   source. Mitigations: the pipeline carries the last snapshot forward as `stale` when a
   fetch fails, the site discloses staleness, and the source interface is pluggable,
   so a loss of access admits a Packagist-based fallback (losing quality tiers) or a
   self-hosted analyzer.
2. **GitHub rate limits** on cold-cache README fetches — mitigated by the
   `actions/cache`-persisted ETag cache, GraphQL batching for stars, PM's own star
   counts as the fallback, and a required token in CI; exhaustion degrades to null
   READMEs rather than failing.
3. **README content is third-party HTML** — strict sanitization allowlist at build time;
   the `hide` warning severity is the kill switch for abusive packages, with an
   expedited process defined in the [trust policy](trust-policy.md).
4. **Trust data as reputational surface** — warnings are public claims about vendors'
   software. Mitigated by the evidence requirement, vendor notification window, and
   dispute process in the trust policy.
5. **Stale detail URLs** when packages leave the index — accepted (daily rebuild prunes
   files; the site ships a custom 404 page).

## Open questions

- Whether PM's SemVer verdict should contribute to ranking — a curator decision; it is
  display-only today.
- Whether PM can expose per-release / multi-Magento test results, which would fill
  `releases[]` and `compatibility` and make version pinning in the admin module more
  than a one-entry lookup.

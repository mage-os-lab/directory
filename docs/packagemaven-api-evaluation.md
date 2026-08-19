# PackageMaven API — evaluation against the data contract

**Status (2026-08-19):** Jiří extended the API with the fields we asked for on
2026-07-09 — `license`, `abandoned` (including the suggested replacement), and a
new `semver` compliance verdict — and the spec now carries explicit
redistribution-with-attribution terms. All of them are integrated into the
pipeline. The original evaluation below is updated in place; superseded gaps are
struck through.

**Status (2026-07-10):** PM shipped a real read-only API — months ahead of the timeline
assumed in [decisions.md](decisions.md#9-launch-gated-on-packagemaven-data-not-packagemavens-api)
— and issued us a bearer token (stored as the `PACKAGE_MAVEN_TOKEN` repo secret).
This document evaluates the API at <https://package-maven.com/api/docs> against
[packagemaven-data-contract.md](packagemaven-data-contract.md) and the pipeline's
internal snapshot shape (`src/schema/source.ts`).

**How this was verified:** the temporary `pm-api-probe` workflow (`.github/workflows/pm-api-probe.yml`)
fetched the OpenAPI spec and live responses from an Actions runner using the token.
A copy of the spec is committed at [packagemaven-openapi.json](packagemaven-openapi.json)
(`info` + `components.schemas` as refetched 2026-08-19, endpoint/parameter
definitions as fetched 2026-07-10; the auth snippet in `info.description` is
reconstructed where GitHub's log masking redacted it). The token authenticates
successfully; the responses match the spec.

## What PM shipped

Base URL `https://package-maven.com/api/v1`, bearer-token auth on everything except
the spec itself (`/api/v1/openapi.json`, public, `Cache-Control: max-age=3600`).

| Endpoint | Contents |
|---|---|
| `GET /packages` | Paginated package list (`per_page` 1–100, default 25). Filters: `quality` (`top`/`noerrors`/`works`/`help`), `category` (slug), `search` (free text); `sort` incl. `-latest_release` (default), `stars`, `installs`, `open_issues`, `name` |
| `GET /packages/{vendor}/{package}` | Single package by composer name |
| `GET /categories` | 20 categories: `id`, `name`, `slug`, `description`, `packages_count` |

Operational facts (verified live):

- **1090 packages** in the index (`meta.total`) — the architecture docs assumed ~750;
  PM's index has grown. A full sweep at `per_page=100` is **11 requests**.
- **Rate limit 60 requests/minute** (`X-RateLimit-*` headers confirmed; `429` +
  `Retry-After` on excess). A daily full fetch uses ~18% of one minute's allowance —
  no throttling logic needed beyond basic 429 handling.
- **ETags** are sent (`W/"…"`), but per the spec a `304` still counts against the rate
  limit and saves transfer only. At 11 requests/day, conditional requests are optional.
- Responses are `Cache-Control: private, max-age=60`, CORS-open, served via Cloudflare.
- Only *publicly visible* packages are returned; hidden packages 404.

## Field mapping vs the contract

| Contract field | API field | Verdict |
|---|---|---|
| Packagist name (join key) | `composer_name` | ✅ |
| Display name | `name` (**nullable**) | ✅ fetcher must fall back to `composer_name` (our `displayName` requires non-empty) |
| Description | `description` (nullable) | ✅ |
| Category | `categories[].slug` + `/categories` endpoint | ✅ better than asked — stable slugs with descriptions |
| Source repository URL | `repository_url` (nullable) | ✅ |
| Latest version + release date | `latest_release.{version,date}` | ✅ |
| Quality tier | `quality.{strict_compliant,no_errors,build_works,needs_help}` booleans | ✅ mapping needed (see below) |
| PHPStan level | `test_results.phpstan_level` | ⚠️ range is `-1..9` (`-1` = fails at level 0, `null` = untested); our schema allows `0..10` — needs a small schema/mapping change |
| Build status | derive: `build_works` → passing, `needs_help` → failing, else unknown | ✅ |
| Supported Magento versions | `test_results.magento_version` — **a single version** (currently `2.4.9` across the samples) | ⚠️ partial: contract asked for a list; API reports one tested version per package |
| Install count | `stats.installs` (nullable) | ✅ |
| License (nice-to-have) | `license` — SPDX id(s), comma-separated when dual-licensed, nullable | ✅ **added 2026-08-19**; fetcher splits into our `license: string[]` |
| Abandoned flag (nice-to-have) | `abandoned.{is_abandoned, replacement}` | ✅ **added 2026-08-19**, richer than asked — the maintainer-suggested replacement comes too |
| Per-release test matrix (nice-to-have) | — | ❌ absent: `test_results` covers one `(package_version, magento_version)` pair |
| `schemaVersion` | none in payloads; versioning via `/api/v1` path + spec `info.version` | ➖ acceptable |

**Beyond the contract, PM also provides:** `stats.stars` and `stats.open_issues`
(GitHub-derived), `links.web` (the PM package page — exactly what our attribution
links need; note pages live at `package-maven.com/<vendor>/<package>`, no
`/packages/` segment), `created_at`/`updated_at` per package, and server-side
`search`/filter/sort we don't need (our search is client-side over the feed).

**Added 2026-08-19 beyond the contract:**

- **`semver.{status, compliance_percent}`** — semantic-versioning compliance of
  released versions, checked with semverdict. `status` ∈ `pending` (not yet
  checked) / `compliant` / `violations` / `unknown` (check failed);
  `compliance_percent` (0–100, null until checked) is the share of checked
  release pairs without violations. Published verbatim as `quality.semver` in
  the feed; detail pages badge it, cards show the percent. Jiří plans to present
  this data at MMCZ as evidence of the ecosystem's SemVer reliability gap.
  Ranking deliberately ignores it for now — whether/how it should contribute is
  a curator decision (see follow-ups).
- **`test_results` raw step outcomes** — `composer_install`, `di_compile`,
  `template_compile`, `phpcs_passed`, `phpcs_no_errors`. Not consumed: the
  quality tier already encodes them (the flags are derived from these steps);
  available if we ever want a per-step breakdown on detail pages.
- **`links.packagist`** — the package's original Packagist page, which the new
  spec terms ask us to attribute when displaying a package (we already link it
  on every detail page and in the feed's `links.packagist`).

## Gaps and their impact

1. **No per-release test matrix** — the high-value nice-to-have didn't make v1.
   `PackageSummary.compatibility` degrades to at most one entry and the
   "v4.9.0 is verified on your 2.4.6" pinning story (embed `magentoVersion` option,
   per-release matrix on detail pages) stays mostly empty. The design anticipated
   this: absence of a test result is never shown as incompatibility, so nothing
   breaks — the feature just waits for PM data. Worth asking Jiří whether historical
   results exist internally and could be exposed later (`/packages/{v}/{p}/releases`?).
2. **One tested Magento version, and it may lag the latest release.**
   `test_results.package_version` can differ from `latest_release.version`, so quality
   and compatibility describe the *tested* release, not necessarily the latest. The
   honest normalization: emit the `test_results` pair as a single `releases[]` row
   (version = `package_version`), rather than stamping `supportedMagento` onto the
   latest release unconditionally — `buildReleases()`/`buildCompatibility()` then do
   the right thing without changes.
3. **Untested packages exist as a state.** All four `quality` booleans can be false
   with `test_results` nulls. Our `qualityTier` enum (4 values) has no "unknown";
   either extend the enum/schema or agree the mapping (untested → `needs-help` would
   be unfair; a fifth `untested`/`pending` tier is more honest). This needs a decision
   before the fetcher lands.
4. **Tier mapping** (flags → our canonical enum): `strict_compliant` → `strict-compliant`,
   else `no_errors` → `no-errors`, else `build_works` → `ready-to-install`, else
   `needs_help` → `needs-help`, else *untested* (gap 3). The API's `quality` filter
   values (`top`/`noerrors`/`works`/`help`) confirm the flags are tiered, not independent.
5. ~~**No license / abandoned flag**~~ — **closed 2026-08-19:** both shipped (see the
   field-mapping table); the Packagist-backfill contingency was never needed.
6. ~~**Redistribution terms are not part of the API.**~~ — **largely closed
   2026-08-19:** the spec's `info.description` now carries a "Data ownership,
   attribution & disclaimer" section: any use, redistribution, or display of the
   data must attribute package-maven.com as the source and, when displaying a
   package, the package's original Packagist page (`links.packagist`). Our feed
   and UI already satisfy both (attribution block in the feed, "quality data by
   PackageMaven" linkbacks, Packagist link on every detail page). Worth one
   confirming sentence to Jiří that these written terms cover our open
   `/api/v1/feed.json` republication — the 2026-07-09 email question is
   otherwise answered by the spec itself.

## Impact on the plan

- **M4a/M4b collapse into one milestone.** The "manual export first, API later"
  sequencing (decision 9) is obsolete in the best way: we can integrate directly
  against the API. The launch gate (real PM data in the feed) is now unblocked by
  us, not by PM.
- **Categories:** PM's 20 slugs are stable API values — `data/categories.json`'s
  `packageMavenLabels` mapping can now be filled with real slugs instead of guessed
  labels (map API `slug`, not display name). Packages carry multiple categories;
  our `rawCategories: string[]` already fits.
- **GitHub stars become optional:** PM supplies `stats.stars` (+ `open_issues`).
  Keeping our GitHub GraphQL stars fetch is redundant work at best, a
  freshness-mismatch at worst; the GitHub source can slim down to READMEs only.
  (Architecture decision to revisit — not blocking.)
- **Corpus size:** plan for ~1100 packages, not ~750 (feed size estimates still fine:
  ~1.5 MB raw / ~300 KB gzipped).
- **The `PM_EXPORT_URL` single-file fetch in `run.ts` is the wrong shape** for this
  delivery: the fetcher needs pagination (11 × `per_page=100`), an `Authorization`
  header from the `PACKAGE_MAVEN_TOKEN` secret, 429/`Retry-After` handling, and
  normalization into `packageMavenSnapshot` (`origin: 'live'`). The
  carry-forward-on-failure semantics already designed apply unchanged.

## Follow-ups

Done (2026-07-10):

1. ~~Untested-package representation~~ — `quality.tier` is now nullable (`null` =
   not yet tested); ranking omits the quality signal, the UI shows a "Not yet
   tested" badge, and hero counters exclude untested packages.
2. ~~Paginated fetcher + normalizer~~ — `src/pipeline/packagemaven.ts`, wired into
   the live path of `run.ts` (`PACKAGE_MAVEN_TOKEN` + optional `PM_API_URL`; the
   `PM_EXPORT_URL` manual-export path is gone — the API replaced it before it was
   ever used). `phpstanLevel` widened to `-1..9`; `displayName` falls back to
   `composer_name`; PM's reported stars fill `popularity.githubStars` when our own
   GitHub fetch is off. Unmapped PM category labels raise pipeline warnings so
   taxonomy drift is visible on scheduled runs.
3. ~~Categories~~ — `data/categories.json` maps PM's 20 live slugs; added `search`,
   `content`, and `security` canonical categories. Two judgment calls for curators
   to revisit: `checkout-payments` → `checkout` and `tax-pricing` → `payments`.

Done (2026-08-19):

4. ~~License / abandoned fields~~ — shipped by PM and consumed end to end
   (`license`, `abandoned` + replacement); the new `semver` verdict is consumed
   too (`quality.semver` in the feed).
5. ~~Redistribution terms~~ — now written into the API spec (attribution to
   package-maven.com + per-package Packagist links; see gap 6). A one-line
   confirmation to Jiří that this covers the open feed remains polite-but-likely-formality.
6. ~~PM package-page URL~~ — merge derived `package-maven.com/packages/<name>`,
   but real pages live at `package-maven.com/<vendor>/<package>`; attribution
   links now use PM's reported `links.web`.

Outstanding (awaiting PM / maintainers):

7. Ask (no urgency) about per-release/multi-Magento test results (gap 1) — the
   remaining nice-to-have; the 2026-07-09 email question about a version matrix
   is still open.
8. Decide whether `semver` should feed ranking (a curator/ranking-config
   decision; it is display-only today).
9. Remove `.github/workflows/pm-api-probe.yml` once a scheduled live pipeline
   run has succeeded end to end (the probe's `pipeline-live` job passed against
   the updated API on 2026-08-19).

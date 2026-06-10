# PackageMaven data access — proposal & field contract

A one-pager for discussing data access with [PackageMaven](https://package-maven.com/)
(Jiří Brada). The Mage-OS Extension Directory wants to build on PackageMaven's results
rather than duplicate them — PM is the structural data source for the whole directory
(see [decisions.md](decisions.md#2-packagemaven-as-the-sole-structural-data-source)).

## What we're asking for

Machine-readable access to PackageMaven's package index and test results — whichever is
least effort to provide and maintain:

1. **A periodically regenerated JSON export** at a stable URL (or pushed to a repo /
   object storage we can fetch). Simplest for both sides; or
2. **A read-only API endpoint** returning the same data.

**Cadence:** daily is plenty; our pipeline runs once a day. **Volume:** one fetch per
day from a GitHub Actions runner with a descriptive User-Agent — no crawling, no
per-page scraping, no load on the site.

## Fields needed (per package)

| Field | Notes |
|---|---|
| Packagist name | e.g. `vendor/module-name` — the join key |
| Display name | PM's friendly name |
| Description | short text |
| Category | PM's categorization |
| Source repository URL | for README/stars lookup on our side |
| Latest version + release date | for freshness display and ranking |
| Quality tier | Strict Compliant / No Errors / Ready to Install / Needs Help |
| PHPStan level | numeric, if applicable |
| Build status | passing / failing |
| Supported Magento versions | the versions PM verified the module against |
| Install count | as shown on PM |

Nice to have, if already tracked: license, abandoned flag, download counts. If absent
we can live without them or backfill from Packagist later.

A versioned schema (even just a `schemaVersion` field in the export) would let either
side evolve the format without surprises.

## What Mage-OS offers in return

- **Attribution everywhere:** quality data is labeled as PackageMaven's, with each
  package page linking back to its PM page — the directory drives traffic *to* PM, it
  does not replace it.
- **A second front door for PM's work:** the directory (public site now, Mage-OS admin
  panel integration later) puts PM's test results in front of merchants and agencies who
  would never find package-maven.com on their own.
- **Submission funnel:** "how to get listed" in the directory explicitly routes vendors
  to PM's submission process, growing PM's index.
- Openness to whatever credit/partnership framing PM prefers (logo, "powered by
  PackageMaven", co-announcement).

## What we explicitly will not do

- No scraping of package-maven.com.
- No re-publishing of PM data stripped of attribution.
- No load beyond the agreed fetch cadence.

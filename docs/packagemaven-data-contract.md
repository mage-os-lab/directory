# PackageMaven data access — proposal & field contract

The working document for data access with [PackageMaven](https://package-maven.com/)
(Jiří Brada). The Mage-OS Extension Directory wants to build on PackageMaven's results
rather than duplicate them — PM is the structural data source for the whole directory
(see [decisions.md](decisions.md#2-packagemaven-as-the-sole-structural-data-source)).

**Status (2026-08-19, superseded):** PM delivered option 3 — a real read-only API —
on 2026-07-06, then added the requested `license`/`abandoned` fields (plus a SemVer
verdict) on 2026-08-19. This document is kept as the historical proposal;
[packagemaven-api-evaluation.md](packagemaven-api-evaluation.md) tracks the shipped
API against it.

**Status (2026-07):** sent to Jiří as a starting point after his positive response; he
asked for specifics, which the sections below now provide (example payload, accepted
formats, delivery options). His timeline for a real API is months out — which is fine;
option 1 below is the near-term path and an API can replace it later without changing
the field contract.

## What we're asking for

Machine-readable access to PackageMaven's package index and test results — whichever is
least effort to provide and maintain, in escalating order of automation:

1. **A manually regenerated export, whenever convenient.** Any dump of the fields below
   — JSON preferred, but CSV or NDJSON is fine — shared however is easiest: a file at a
   stable URL, a gist/repo drop, even an emailed file. We normalize it on our side and
   the site displays "quality data as of &lt;date&gt;". Even a **monthly** manual refresh is
   enough for us to launch on. This asks nothing of PM's roadmap.
2. **A periodically regenerated JSON export** at a stable URL (or pushed to a repo /
   object storage we can fetch) — the same thing, automated on PM's side when
   convenient; or
3. **A read-only API endpoint** returning the same data — whenever PM's own timeline
   gets there. No urgency from our side.

**Cadence:** our pipeline runs daily and picks up whatever is there; anything from
daily to monthly works, we just disclose the refresh date. **Volume:** one fetch per
run from a GitHub Actions runner with a descriptive User-Agent — no crawling, no
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

**Per-release test matrix (nice to have, high value).** The fields above describe the
*latest* release. If PM also has results for earlier releases — which it presumably
does internally — a `releases` list per package (version, release date, Magento
versions verified) lets the directory answer "the latest release isn't verified on
your Magento 2.4.6, but v4.9.0 is" and generate the right `composer require`
constraint for a merchant's actual shop version. Without it, everything still works;
compatibility statements just apply to the latest release only. Even a truncated
matrix (say, the last 5 releases, or only releases still verified against a supported
Magento) is useful — we never present "not tested" as "incompatible", so gaps are
safe.

A versioned schema (even just a `schemaVersion` field in the export) would let either
side evolve the format without surprises.

## Example record

What one package would look like in a JSON export — field names are a suggestion, not
a requirement (we map whatever names PM uses):

```json
{
  "name": "acme/module-widget",
  "displayName": "Acme Widget Manager",
  "description": "Adds a widget management grid to the admin panel.",
  "category": "Admin Tools",
  "repositoryUrl": "https://github.com/acme/module-widget",
  "latestVersion": "2.3.1",
  "latestReleasedAt": "2026-05-14T09:30:00Z",
  "qualityTier": "no-errors",
  "phpstanLevel": 6,
  "buildStatus": "passing",
  "supportedMagento": ["2.4.7", "2.4.6"],
  "installs": 1834,
  "license": ["OSL-3.0"],
  "abandoned": false,
  "releases": [
    { "version": "2.3.1", "releasedAt": "2026-05-14T09:30:00Z", "supportedMagento": ["2.4.7", "2.4.6"] },
    { "version": "2.2.0", "releasedAt": "2025-11-02T10:00:00Z", "supportedMagento": ["2.4.6", "2.4.5"] }
  ]
}
```

The `releases` matrix is the optional part described above — omit it (or truncate it)
and the rest of the record stands on its own.

Whatever strings PM uses for quality tiers and categories are fine as-is — we keep a
mapping table on our side, so PM's labels can evolve without breaking anything. An
export is just an array of these records (plus, ideally, a `schemaVersion` and a
generated-at timestamp at the top level); at ~750 packages that's roughly 500 KB of
JSON. Same fields as CSV columns work too.

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

## Redistribution scope — worth agreeing explicitly

One thing to settle up front so there are never surprises: the directory republishes
the agreed fields as an open JSON feed (`/api/v1/feed.json`) that downstream consumers
— the future Magento admin module, possibly CLI tools or CI checks — will read. So the
permission we're asking for is **redistribution of the agreed fields with attribution**,
not just display on one website. Concretely:

- Attribution travels with the data itself: the feed's source metadata credits
  PackageMaven, not only the website UI.
- Scope is limited to the fields in this contract — we don't mirror PM's site or
  republish anything beyond them.
- The arrangement is revocable: if PM ever wants out, we stop publishing PM-derived
  fields and fall back to other sources. No lock-in in either direction.

## What we explicitly will not do

- No scraping of package-maven.com.
- No re-publishing of PM data stripped of attribution.
- No load beyond the agreed fetch cadence.

## Working contact

Ryan Hoerr (rhoerr@users.noreply.github.com, `rhoerr` on GitHub) — for the export handshake, a schema
sample exchange, or anything about this contract. An emailed sample of even 5–10
records is a perfect first step; we'll wire it into our pipeline and confirm the
mapping back.

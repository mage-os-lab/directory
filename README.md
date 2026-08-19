# Mage-OS Extension Directory

A trustworthy catalog for discovering quality open source modules for Mage-OS / Magento —
a public website first, designed for embedding into the Mage-OS admin panel later.

## How it works

There is no backend service. A scheduled GitHub Actions pipeline aggregates package data
into versioned static JSON, and publishes it together with a prerendered catalog site on
Cloudflare Pages. The JSON feed *is* the public API.

```
PackageMaven export ─┐
                     ├─→ daily pipeline → /api/v1/*.json → static site (Cloudflare Pages)
GitHub (READMEs/★) ──┤
                     │
data/vendors/*.json ─┘
```

- **[PackageMaven](https://package-maven.com/)** is the structural data backbone: it
  indexes ~750 Magento modules and tests them against real Magento versions, producing
  quality tiers, PHPStan levels, build status, and verified compatibility. The
  directory's universe is PackageMaven's index, with full attribution and links back.
- **GitHub** supplies READMEs and stars at build time (optional, failure-tolerant).
- **Mage-OS vendor trust files** — per-vendor JSON files in `data/vendors/`, edited by
  pull request — add the trust layer: trusted-vendor badges, partner tiers, editorial
  picks, and warnings that derank or hide problem packages.
- A transparent, config-tunable **ranking** blends trust, quality, freshness, and
  popularity into the default ordering, with the per-signal breakdown published in the
  feed.

The browse/search UI is also built as a standalone embeddable bundle
(`directory-ui.js`), which is how the future Magento admin module will reuse it.

## Key principles

- **Read-only in production** — no installs from any UI; "install" means a copyable
  `composer require` command.
- **Trust signals over completeness** — a curated, quality-tested universe rather than
  all of Packagist.
- **Static and simple** — no servers to run; the whole system is a build artifact, and
  every trust-data change is a pull request.

## Documentation

- **[Architecture](docs/architecture.md)** — data flow, pipeline, feed schema, vendor
  trust file format, ranking model, site/UI design, milestones, risks.
- **[Decision log](docs/decisions.md)** — what was chosen, why, and what was rejected.
- **[Trust policy](docs/trust-policy.md)** — who gets badges, how warnings work, how
  disputes and malicious-package reports are handled.
- **[PackageMaven data contract](docs/packagemaven-data-contract.md)** — the data-access
  proposal shared with PackageMaven's author.
- [Initial scoping notes](docs/initial-scope.md) — historical; superseded by the above.
- Original discussion: [mage-os-lab discussion #3](https://github.com/orgs/mage-os-lab/discussions/3)

## Status

**In implementation.** The architecture is decided, documented, and has been through
adversarial review. PackageMaven's author has responded positively to collaborating —
the data contract is with him now; his API timeline is months out, so launch rides on
a manually refreshed export (milestone M4a) with automated integration following
later (M4b). Implementation milestones run against fixture data until the first real
export lands (see [milestones](docs/architecture.md#milestones)).

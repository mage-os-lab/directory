# Mage-OS Extension Directory

A trustworthy catalog for discovering quality open source modules for Mage-OS /
Magento — a public website, an open JSON feed, and a Magento admin module, all built
from one repository:

| Where | What |
|---|---|
| [`service/`](service/) | The directory service: a daily static pipeline, the catalog website, the versioned JSON feed (`/api/v1/*`), and the embeddable browse/search UI bundle (`/embed/*`) |
| [`src/`](src/) | `MageOS_ExtensionDirectory` — the Magento 2 / Mage-OS admin module (Composer package `mage-os/module-extension-directory`, packaged from this repository's root) |

## How it works

There is no backend service. A scheduled GitHub Actions pipeline aggregates package
data into versioned static JSON, and publishes it together with a prerendered catalog
site. The JSON feed *is* the public API.

```
PackageMaven export ─┐
                     ├─→ daily pipeline → /api/v1/*.json → static site + embeddable UI
GitHub (READMEs/★) ──┤                                          │
                     │                                          └─→ Magento admin module
service/data/vendors/*.json (trust overlay, by PR) ─┘               (src/, this repo)
```

- **[PackageMaven](https://package-maven.com/)** is the structural data backbone: it
  indexes ~1,100 Magento modules and tests them against real Magento versions,
  producing quality tiers, PHPStan levels, build status, and verified compatibility.
  The directory's universe is PackageMaven's index, with full attribution and links
  back. Package metadata originates from [Packagist](https://packagist.org/).
- **GitHub** supplies READMEs and stars at build time (optional, failure-tolerant).
- **Mage-OS vendor trust files** — per-vendor JSON files in `service/data/vendors/`,
  edited by pull request — add the trust layer: trusted-vendor badges, partner tiers,
  editorial picks, and warnings that derank or hide problem packages.
- A transparent, config-tunable **ranking** blends trust, quality, freshness, and
  popularity into the default ordering, with the per-signal breakdown published in
  the feed.

## The admin module

The module renders the same browse/search UI inside the Magento admin
(**System → Mage-OS Extension Directory**), enriched with what only the shop knows:
its installed modules (read from `composer.lock` — never by shelling out) and its
Magento version, which drive installed/update badges and version pinning against
PackageMaven's test matrix. Package details open in an admin modal showing the
directory site's detail page; external links (Packagist, the repository,
PackageMaven) are followed only when clicked.

**It never installs anything.** Marking modules builds a
`composer require vendor/module:^x.y` command to copy and run on the server, where
Composer resolves dependencies.

One setting (Stores → Configuration → Mage-OS → Extension Directory): **Direct**
(default — admin browsers load the UI bundle and catalog straight from the directory
host) or **Proxy** (the store's server fetches and caches the feed, revalidating
against the 200-byte `manifest.json`, and serves the UI copy bundled with the module —
fully same-origin for restricted networks or privacy-sensitive admins).

```sh
composer require mage-os/module-extension-directory
bin/magento module:enable MageOS_ExtensionDirectory && bin/magento setup:upgrade
```

The Composer package is this repository's root; `.gitattributes` strips everything
except `composer.json`, `LICENSE`, `README.md`, and `src/` from dist archives, and CI
guards both the archive contents and that the vendored UI bundle in
`src/view/adminhtml/web/js/` is byte-identical to what `service/` builds.

## Key principles

- **Read-only in production** — no installs from any UI; "install" means a copyable
  `composer require` command.
- **Trust signals over completeness** — a curated, quality-tested universe rather
  than all of Packagist.
- **Static and simple** — no servers to run; the whole system is a build artifact,
  and every trust-data change is a pull request.
- **Untested is never incompatible** — PackageMaven's matrix is empirical; a missing
  test result is shown as untested, never as a failure, and never blocks anything.

## Development

```sh
# Service (Node 22)
cd service && npm install
npm test            # schema, ranking, pipeline, embed-contract tests
npm run dev         # pipeline on fixture data + the site on localhost

# Module (PHP 8.1+, no Magento credentials needed)
composer install --working-dir=dev/tests/unit
composer test       # hermetic unit suite against committed framework stubs
```

After changing `service/src/ui/**`, rebuild and re-vendor the bundle
(`cd service && npm run build:ui && cp public/embed/directory-ui.iife.js
../src/view/adminhtml/web/js/`) — CI fails on drift. See
[CONTRIBUTING.md](CONTRIBUTING.md) and [docs/updating-the-bundle.md](docs/updating-the-bundle.md).

## Documentation

- **[Architecture](docs/architecture.md)** — data flow, pipeline, feed schema, vendor
  trust file format, ranking model, site/UI design, milestones, risks.
- **[Decision log](docs/decisions.md)** — what was chosen, why, and what was rejected.
- **[Trust policy](docs/trust-policy.md)** — who gets badges, how warnings work, how
  disputes and malicious-package reports are handled.
- **[Admin module handoff](docs/magento-admin-module-handoff.md)** — the contract the
  module is built against (endpoints, data shapes, embed API, attribution).
- **[Module implementation plan](docs/implementation-plan.md)** — the module's design
  and validation record.
- **[PackageMaven data contract](docs/packagemaven-data-contract.md)** — the
  data-access proposal shared with PackageMaven's author.
- [Initial scoping notes](docs/initial-scope.md) — historical; superseded by the above.
- Original discussion: [mage-os-lab discussion #3](https://github.com/orgs/mage-os-lab/discussions/3)

## Data attribution

Quality and compatibility data is sourced from
[package-maven.com](https://package-maven.com/), operated by Tribound Creative s.r.o.
Package metadata originates from [Packagist](https://packagist.org/). Every package
view links back to its Packagist page. The data is empirical test output provided
"as is".

## License

OSL-3.0

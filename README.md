# Mage-OS Extension Directory

A trustworthy catalog for discovering quality open source modules for Mage-OS /
Magento — a public website, an open JSON feed, and a Magento admin module, all built
from one repository.

![The Mage-OS Extension Directory in the Magento admin: search, filter chips and package cards with version-fit badges; three modules are shortlisted and the tray offers to copy the list](https://raw.githubusercontent.com/mage-os-lab/directory/main/docs/images/admin-directory.png)

## Install the admin module

Requires PHP 8.1+ and Magento 2.4 / Mage-OS (`magento/framework` ^103.0). From the
Magento root:

```sh
composer require mage-os/module-extension-directory
bin/magento setup:upgrade
```

In production mode, finish with:

```sh
bin/magento setup:di:compile
bin/magento setup:static-content:deploy
bin/magento cache:flush
```

Then open **System → Extensions → Extension Directory** in the admin. There is nothing
to configure — the module ships working defaults, and it never installs anything on your
server. Admin roles other than the full-access one need the **Mage-OS Extension
Directory** ACL resource (System → Permissions → User Roles).

To update, `composer update mage-os/module-extension-directory` and re-run the commands
above; to remove it, `composer remove mage-os/module-extension-directory` followed by
`bin/magento setup:upgrade`.

## What's in this repository

| Where | What |
|---|---|
| [`service/`](service/) | The directory service: a daily static pipeline, the catalog website, the versioned JSON feed (`/api/v1/*`), and the embeddable browse/search UI bundle (`/embed/*`) |
| [`src/`](src/) | `MageOS_ExtensionDirectory` — the Magento 2 / Mage-OS admin module (Composer package `mage-os/module-extension-directory`, packaged from this repository's root) |

## How it works

There is no backend service. A scheduled GitHub Actions pipeline aggregates package
data into versioned static JSON, and publishes it together with a prerendered catalog
site. The JSON feed *is* the public API.

```
PackageMaven export ───┐
GitHub (READMEs/★) ────┤
                       ├─→ daily pipeline → /api/v1/*.json → static site + embeddable UI
Packagist (downloads) ─┤                                     │
trust overlay (by PR) ─┘                                     └─→ Magento admin module
                                                                 (src/, this repo)
```

- **[PackageMaven](https://package-maven.com/)** is the structural data backbone: it
  indexes ~1,100 Magento modules and tests them against real Magento versions,
  producing quality tiers, PHPStan levels, build status, and verified compatibility.
  The directory's universe is PackageMaven's index, with full attribution and links
  back. Package metadata originates from [Packagist](https://packagist.org/).
- **GitHub** supplies READMEs and stars at build time (optional, failure-tolerant).
- **Packagist** supplies download counters — lifetime, last 30 days, and when it first
  saw the package — which is all the trend signals need to be computed without the
  pipeline keeping any history of its own (optional, failure-tolerant).
- **Mage-OS vendor trust files** — per-vendor JSON files in `service/data/vendors/`,
  edited by pull request — add the trust layer: partner tiers, editorial picks, and
  warnings that derank or hide problem packages.
- A transparent, config-tunable **ranking** blends trust, quality, freshness,
  popularity and momentum — how a module's recent downloads compare with its own
  lifetime average — into the default ordering, with the per-signal breakdown
  published in the feed.

## The admin module

The module renders the same browse/search UI inside the Magento admin
(**System → Extensions → Extension Directory**) — one list with search, category chips,
one-click filters (editors' picks, tested with your version, recently updated, high
quality, popular, trending) and a page of cards at a time — enriched with what only
the shop knows:
its installed modules (read from `composer.lock` — never by shelling out) and its
Magento version, which drive installed/update badges and version pinning against
PackageMaven's test matrix. Package details open in an admin modal showing the
directory site's detail page; external links (Packagist, the repository,
PackageMaven) are followed only when clicked.

**It never installs anything.** Shortlisting modules builds a list to copy for whoever
maintains the store — each module with the release that fits this shop, how it was
tested, any warning, and a link to its page. Installing and testing modules is
development work, done on a development copy, so outside developer mode the admin shows
no Composer commands at all. The list is kept per browser tab, so a reload or a look at a module's
details does not lose it.

Three settings, all under Stores → Configuration → Advanced → Admin. **Extension
Directory → Show Install Commands** (default: in developer mode; or always, or never):
when shown, the shortlist builds a `composer require vendor/module:^x.y` command
instead, and the framed detail pages show theirs. **Extension Directory → Mode**
decides where the catalog data comes from: **Direct** (default — admin browsers fetch the
feed from the directory host) or **Proxy** (the store's server fetches and caches it,
revalidating against the 200-byte `manifest.json` — no requests to the directory host,
for restricted networks or privacy-sensitive admins). Either way the interface runs
from the copy bundled with the module; the admin never loads script from the directory. **Dashboard → Show Extension Directory Tip** (default on): a
short panel on the admin dashboard that points administrators whose role allows
everything at the directory; its own "Hide this tip" button turns the setting off for
everyone.

![The same page in developer mode: the shortlist tray shows a copyable composer require command for the three modules](https://raw.githubusercontent.com/mage-os-lab/directory/main/docs/images/admin-directory-developer.png)

The Composer package is this repository's root; `.gitattributes` strips everything
except `composer.json`, `LICENSE`, `README.md`, and `src/` from dist archives, and CI
guards both the archive contents and that the vendored UI bundle in
`src/view/adminhtml/web/js/` is byte-identical to what `service/` builds.

## Key principles

- **Read-only in production** — no installs from any UI; the admin hands on a
  shortlist, and a copyable `composer require` appears only where a developer turns it
  on (and on the public site's detail pages).
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

- **[Architecture](docs/architecture.md)** — data flow, the PackageMaven API and its
  field mapping, pipeline, feed schema, vendor trust file format, ranking model,
  site/UI design and the embed contract, hosting, standing risks.
- **[Decision log](docs/decisions.md)** — what was chosen, why, and what was rejected.
- **[Trust policy](docs/trust-policy.md)** — who gets badges, how warnings work, how
  disputes and malicious-package reports are handled.
- **[Updating the vendored UI bundle](docs/updating-the-bundle.md)** — the rebuild
  procedure and the checks CI cannot make.
- Original discussion: [mage-os-lab discussion #3](https://github.com/orgs/mage-os-lab/discussions/3)

## Data attribution

Quality and compatibility data is sourced from
[package-maven.com](https://package-maven.com/), operated by Tribound Creative s.r.o.
Package metadata originates from [Packagist](https://packagist.org/). Every package
view links back to its Packagist page. The data is empirical test output provided
"as is".

## License

OSL-3.0

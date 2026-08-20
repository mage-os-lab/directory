# MageOS_ExtensionDirectory

Browse the [Mage-OS Extension Directory](https://rhoerr.github.io/mage-os.directory)
from inside the Magento / Mage-OS admin panel — with the context only your shop has:
which modules are already installed, at which versions, and which Magento version you
run.

The catalog data comes from the Mage-OS directory service, which merges
[PackageMaven](https://package-maven.com/)'s empirical quality and compatibility test
results with a Mage-OS-curated trust overlay and republishes them as an open,
versioned JSON feed.

**This module never installs anything.** Marking modules builds a
`composer require vendor/module:^x.y` command you copy and run on your server —
no shell execution from PHP, no dependency resolution in the admin. Conflict
resolution stays where it belongs: `composer require --dry-run` on your machine.

## What you get

- **System → Mage-OS Extension Directory**: search, filter, and browse ~1,100 open
  source Magento modules with quality tiers, PHPStan levels, SemVer compliance,
  popularity, and Mage-OS trust badges.
- **Installed / update-available badges** — the module reads your `composer.lock`
  (never `composer` itself) and overlays your install state on the catalog.
- **Tested-with badges for *your* Magento version** — from PackageMaven's per-release
  test matrix. The install list pins the newest release verified against your version,
  even when the latest release was only tested on a newer one. A module without a
  test result is shown as *not tested* — that never means incompatible.
- **Copyable install commands** — per module, or a combined command for everything
  you've marked.

## Requirements

- Magento Open Source / Adobe Commerce / Mage-OS 2.4.4+ (`magento/framework ^103.0`)
- PHP 8.1+

## Installation

```sh
composer require mage-os/module-extension-directory
bin/magento module:enable MageOS_ExtensionDirectory
bin/magento setup:upgrade
bin/magento setup:static-content:deploy   # production mode
```

## Configuration

**Stores → Configuration → Mage-OS → Extension Directory**

| Setting | Default | Notes |
|---|---|---|
| Enabled | Yes | |
| Directory base URL | `https://rhoerr.github.io/mage-os.directory` | The directory's host **will change** (Cloudflare Pages, then a Mage-OS domain) — it is config for exactly that reason |
| Feed mode | Server-side proxy | The recommended default: your server fetches and caches the catalog; admin browsers never talk to a third-party host |
| UI bundle source | Bundled | The browse UI ships inside this module; switchable to loading it from the directory host |
| Feed cache TTL | 3600 s | The proxy revalidates cheaply against the directory's 200-byte `manifest.json` before ever refetching the full feed |
| HTTP timeout | 10 s | |

### How the proxy behaves

The feed (~1.7 MB raw, ~200 KB gzipped) is cached in a dedicated cache type
(`mageos_extension_directory`, visible in Cache Management). When the TTL expires the
module fetches only the tiny manifest and compares the feed's SHA-256 — unchanged data
costs one 200-byte request. If the directory host is unreachable, the last good copy
is served and the page notes its age. Fails soft, never breaks the admin.

### Direct / remote modes

Switching **Feed mode** to *direct* or **UI bundle source** to *remote* makes admin
browsers talk to the directory host. That requires:

1. CORS headers on the directory host (verify before switching — `curl -I` the feed
   URL and look for `Access-Control-Allow-Origin`).
2. CSP whitelisting. This module ships `etc/csp_whitelist.xml` entries for
   `rhoerr.github.io` and `mage-os-directory.pages.dev`; a custom domain later needs
   its own entry.

The defaults avoid all of this — and keep every admin user's browsing off third-party
hosts.

## Data attribution

Quality and compatibility data is sourced from
[package-maven.com](https://package-maven.com/), operated by Tribound Creative s.r.o.,
and redistributed with attribution via the Mage-OS directory service. Each module's
detail page on the directory site links to its Packagist page. The data is empirical
test output provided "as is" — it records what was actually tested, not what is
warranted to work.

## Development

```sh
composer install --working-dir=dev/tests/unit   # installs only PHPUnit, no Magento credentials needed
composer test                                    # = vendor/bin/phpunit -c dev/tests/unit/phpunit.xml.dist
```

The unit suite is hermetic: it runs against committed interface stubs
(`dev/tests/unit/stubs/`, `class_exists`-guarded so a real Magento installation's
classes always win). The nested toolchain manifest exists because the module's own
requirements (`magento/framework`) resolve from repo.magento.com / repo.mage-os.org,
not Packagist; a credentialed root `composer install` works too.

- Architecture and contract validation: [docs/implementation-plan.md](docs/implementation-plan.md)
- Refreshing the vendored UI bundle: [docs/updating-the-bundle.md](docs/updating-the-bundle.md)
- The upstream service and its data contracts: [rhoerr/mage-os.directory](https://github.com/rhoerr/mage-os.directory)

## Roadmap

- Surface `derank`/`hide` trust warnings for **installed** packages as admin system
  messages ("a module you have installed has a security advisory") — the
  highest-value follow-up, needs no new API.
- Dynamic CSP host derivation from the configured base URL.

## License

OSL-3.0

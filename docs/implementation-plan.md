# MageOS_ExtensionDirectory — implementation plan

Magento 2 / Mage-OS admin module rendering the Mage-OS Extension Directory inside the
admin panel. Built against the directory service's handoff document
(`docs/magento-admin-module-handoff.md` in [mage-os.directory](https://github.com/rhoerr/mage-os.directory)),
validated 2026-08-20 against `schemaVersion: 1`.

## Validation performed before this plan

| Handoff claim | Verified against | Result |
|---|---|---|
| Data contracts (§4) | `src/schema/feed.ts`, `src/schema/common.ts` (Zod) | Match, field for field |
| `mountDirectory` API + events (§5) | `src/ui/mount.tsx`, `test/mount.test.tsx` (8 tests) | Match; events bubbling + composed |
| Compatibility semantics (§7) | `src/ui/DirectoryBrowser.tsx`, `src/shared/version.ts` | Match (tested/older/untested; pinning via `compatibility`) |
| Bundle size / global | local `npm run build:ui` | 49.63 KB IIFE, global `MageOSDirectory` |
| Pipeline output validity | local `npm run pipeline:fixture` + `npm test` (48 passing) | Valid feed/manifest/detail artifacts |
| Daily deploy | GitHub Actions history | Last run green 2026-08-19, cron `23 5 * * *` |
| Attribution gap in bundle (§8) | grep of `src/ui` | Confirmed — bundle renders no attribution; **this module must** |
| CORS on GitHub Pages host (§3) | — | **Unverified** (host unreachable from build sandbox) — reinforces proxy default |

## Architecture decisions

Following the handoff's recommendation (§6): **server-side feed proxy + vendored bundle
by default**, each independently switchable to remote via system config.

1. **Vendored bundle default** — `view/adminhtml/web/js/directory-ui.iife.js` is the
   built artifact from mage-os.directory (see `docs/updating-the-bundle.md` for
   provenance and refresh steps). Same-origin: no CSP whitelist, no CORS, works on
   restricted networks. Config can switch to loading `/embed/directory-ui.iife.js`
   from the directory origin.
2. **Feed proxy default** — an admin controller serves the feed from Magento's cache
   (custom cache type), revalidating against `manifest.json`'s `feedHash` (200 bytes)
   before refetching the ~1.7 MB feed. Fail-soft: stale cache is served when the
   upstream fetch fails. Config can switch to the browser fetching the directory
   origin directly (requires CORS verified on the host + CSP whitelist).
3. **Base URL is configuration** (handoff §10.1) — default is today's live host,
   `https://rhoerr.github.io/mage-os.directory`; it will change at least twice.
4. **`linkMode: 'event'`** — clicking a package opens its detail page on the public
   directory site in a new tab. The admin never renders a package detail view itself,
   so the Packagist-link obligation (§8.2) is met by the directory site's detail pages,
   and the admin page carries the visible PackageMaven credit (§8.1) plus an as-is
   disclaimer (§8.3).
5. **The module never installs anything** — the bundle's built-in composer-command tray
   (`selectable: true`) is the whole install story, per the handoff.
6. **`schemaVersion` guard** (§10.6) — the proxy treats a feed whose `schemaVersion`
   is not `1` as a fetch failure (falls back to the last good cached copy) rather than
   serving something the vendored bundle might misrender.
7. **Hermetic unit tests** — PHPUnit against committed interface stubs
   (`class_exists`-guarded so a real Magento installation's classes always win). No
   repo.magento.com / repo.mage-os.org credentials needed to run the suite.

## Module identity

| | |
|---|---|
| Composer name | `mage-os/module-extension-directory` (type `magento2-module`) |
| Magento module | `MageOS_ExtensionDirectory` |
| PHP namespace | `MageOS\ExtensionDirectory` |
| PHP | `>=8.1` |
| Framework | `magento/framework ^103.0`, `magento/module-backend ^102.0` (Magento/Mage-OS 2.4.4+) |
| License | OSL-3.0 |
| Route | frontName `mageos_directory` |
| ACL | `MageOS_ExtensionDirectory::directory` (page), `MageOS_ExtensionDirectory::config` (system config) |
| Menu | System → "Mage-OS Extension Directory" |
| Cache type | `mageos_extension_directory` |

## System configuration (`mageos_extension_directory/general/*`)

| Path | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | yes/no | `1` | Master switch; page shows a notice when off |
| `base_url` | text | `https://rhoerr.github.io/mage-os.directory` | Directory origin, no trailing slash |
| `feed_mode` | select | `proxy` | `proxy` (server-side, cached) / `direct` (browser fetches origin) |
| `bundle_source` | select | `bundled` | `bundled` (vendored asset) / `remote` (`{base}/embed/directory-ui.iife.js`) |
| `cache_ttl` | text (int) | `3600` | Seconds before the proxy revalidates against `manifest.json` |
| `http_timeout` | text (int) | `10` | Outbound HTTP timeout, seconds |

## Component contracts

### `Model\Config`
Typed accessors over `ScopeConfigInterface`: `isEnabled(): bool`,
`getBaseUrl(): string` (trailing slash trimmed), `getFeedMode(): string`
(`'proxy'|'direct'`), `getBundleSource(): string` (`'bundled'|'remote'`),
`getCacheTtl(): int`, `getHttpTimeout(): int`.

### `Model\Feed\FeedProvider`
`get(): FeedResult` — returns the feed JSON as a raw string plus freshness metadata;
throws `FeedUnavailableException` only when there is no cached copy and the fetch fails.
`peek(): ?array{fetchedAt: int, feedHash: string}` — metadata without any network I/O.

Algorithm: cached body + metadata live in the custom cache type without TTL expiry
(freshness is decided from `fetchedAt` + configured TTL so an expired copy is still
available as the stale fallback). Fresh → serve. Expired → fetch `manifest.json`; same
`feedHash` → touch `fetchedAt` and serve; different → fetch `feed.json`, require
`schemaVersion === 1`, store, serve. Any failure → serve stale if cached, else throw.
Cold cache skips the manifest round-trip and fetches the feed directly.

### `Model\ComposerLock\InstalledPackages`
`getMap(): array<string,string>` — composer name → version from the Magento root
`composer.lock` (`packages` array only), leading `v` stripped. Missing/unreadable/
malformed lock → `[]` (logged at debug, never fatal). Result cached in the module cache
type keyed on the lock file's mtime+size.

### `Controller\Adminhtml\Directory\Index`
`Magento\Backend\App\Action`, `HttpGetActionInterface`,
`ADMIN_RESOURCE = 'MageOS_ExtensionDirectory::directory'`; returns a Page result,
sets the active menu and title.

### `Controller\Adminhtml\Feed\Index`
Same ACL resource, `HttpGetActionInterface`. Returns the raw feed body as
`application/json` (Raw result — no decode/re-encode). Disabled module → 503 JSON
error `{"error": "..."}`; `FeedUnavailableException` → 503 JSON error (the bundle
renders its retryable error state). Sets `Cache-Control: private, max-age=0, no-store`
and an `X-MageOS-Directory-Data-As-Of` header from the metadata.

### `ViewModel\DirectoryConfig` (`ArgumentInterface`)
- `isEnabled(): bool`
- `getBundleUrl(): string` — vendored asset URL (asset repository) or `{base}/embed/directory-ui.iife.js`
- `getMountConfigJson(): string` — JSON for the template:
  `{feedUrl, baseUrl, linkMode: "event", selectable: true, installed, magentoVersion}`
  where `feedUrl` is the keyed admin proxy URL (`mageos_directory/feed/index`) or
  `{base}/api/v1/feed.json`; `baseUrl` is the directory origin (so `mosd:select`'s
  `packageUrl` is absolute); `installed` from `InstalledPackages`; `magentoVersion`
  from `ProductMetadataInterface::getVersion()`.
- `getDirectoryBaseUrl(): string`
- `getDataAsOf(): ?string` — ISO date from `FeedProvider::peek()`, proxy mode only.

### Template `view/adminhtml/templates/directory.phtml`
- Disabled → admin notice, nothing else.
- Mount `<div>` with Magento-admin theme custom properties
  (`--mosd-theme-accent: #eb5202`, etc. — they pierce the shadow boundary).
- Config injected as `<script type="application/json">`; bundle `<script src>` and the
  inline init script emitted via `SecureHtmlRenderer` (CSP-safe).
- Init: `MageOSDirectory.mountDirectory(host, config)`; `mosd:select` →
  `window.open(detail.packageUrl, '_blank', 'noopener')`.
- **Attribution block (required, §8)**: visible "Quality and compatibility data by
  [PackageMaven](https://package-maven.com/)" credit; note that each module's detail
  page on the directory site links to its Packagist page; "provided as-is" disclaimer.
  Copy rule from §7: absence of a test result is never rendered as incompatibility.
- All output escaped via `$escaper`; all user-facing strings via `__()` / `i18n/en_US.csv`.

### CSP
`etc/csp_whitelist.xml` whitelists `rhoerr.github.io` and
`mage-os-directory.pages.dev` for `script-src` + `connect-src` — needed only for the
non-default remote modes; harmless otherwise. A future custom domain needs a matching
entry (documented in README).

## File inventory

```
composer.json  registration.php  LICENSE  README.md
etc/module.xml  etc/acl.xml  etc/config.xml  etc/cache.xml  etc/csp_whitelist.xml
etc/adminhtml/{menu,routes,system}.xml
Controller/Adminhtml/Directory/Index.php
Controller/Adminhtml/Feed/Index.php
Model/Config.php  Model/Cache/Type.php
Model/Feed/{FeedProvider,FeedResult,FeedUnavailableException}.php
Model/ComposerLock/InstalledPackages.php
ViewModel/DirectoryConfig.php
view/adminhtml/layout/mageos_directory_directory_index.xml
view/adminhtml/templates/directory.phtml
view/adminhtml/web/js/directory-ui.iife.js   (vendored — see docs/updating-the-bundle.md)
view/adminhtml/web/css/admin.css
i18n/en_US.csv
dev/tests/unit/{phpunit.xml.dist,bootstrap.php,stubs/,Test/}
.github/workflows/ci.yml
```

## Test plan

- `InstalledPackagesTest` — parses a fixture lock, strips `v`, ignores `packages-dev`,
  returns `[]` on missing/malformed lock.
- `FeedProviderTest` — fresh-cache short circuit (no HTTP); manifest-hash revalidation
  (no feed refetch); hash change → refetch + store; upstream failure → stale fallback;
  no cache + failure → `FeedUnavailableException`; `schemaVersion: 2` → treated as
  failure; cold cache skips manifest.
- `DirectoryConfigTest` — feed URL per mode, bundle URL per mode, mount JSON shape,
  installed map passthrough.
- CI: PHP syntax lint (8.1–8.4 matrix) + PHPUnit (stubs, no Magento credentials).

## Out of scope for v1 (tracked as follow-ups)

- Admin system messages when an *installed* package carries a `derank`/`hide` trust
  warning (handoff §9 "nice to have" — highest-value follow-up).
- Dynamic CSP (`CspAwareActionInterface`) deriving hosts from `base_url` config.
- Integration/MFTF tests against a real Magento installation.

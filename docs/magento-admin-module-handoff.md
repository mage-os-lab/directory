# Mage-OS admin module — implementation handoff

**Status:** the directory service is built, deployed, and serving live data.

> **Update 2026-08-20:** the module described here has been **built and lives in this
> repository** at `src/` (see [decision 12](decisions.md#12-one-repository-for-the-service-and-the-admin-module)
> and [implementation-plan.md](implementation-plan.md)). The service moved under
> `service/`, so repo paths below (`src/ui/…`, `data/…`, `public/…`, `examples/…`,
> `test/…`) now carry a `service/` prefix. This document remains the contract
> reference for the feed, the embed API, and the attribution obligations.

**Audience:** whoever builds `mage-os/module-extension-directory` (Magento 2 / Mage-OS
admin module). No prior context with this repo assumed.

**Last updated:** 2026-08-19, against `schemaVersion: 1`.

---

## 1. What the module is for

The directory is deliberately split in two tiers ([decision 6](decisions.md#6-embeddable-ui-bundle-from-day-one),
[initial scope](initial-scope.md)):

1. **The Discovery Service** (this repo) — a static pipeline that merges PackageMaven's
   quality/compatibility test results with a Mage-OS-curated trust overlay, and publishes
   a versioned JSON feed plus an embeddable browse/search UI. Runs independently of
   Magento; also powers the public website.
2. **The admin module** (to build) — a thin Magento module that renders that catalog
   inside the admin panel, enriched with what only the shop knows: which modules are
   already installed, at what versions, and which Magento version it runs.

**The module never installs anything.** The install action is a copy-to-clipboard
`composer require vendor/module:^x.y` command that the merchant runs themselves. This
is a deliberate constraint — no shell execution from PHP, no dependency resolution in
the admin, no hosting-permission surprises. Conflict resolution is left to
`composer require --dry-run` on the merchant's machine.

The module also needs **no PackageMaven credentials**. PM's API is token-gated, but the
pipeline consumes it server-side and republishes an open feed. The module only ever talks
to the directory's own public endpoints.

---

## 2. Status: what exists, what doesn't

### Built, tested, deployed

| Piece | Where | Notes |
|---|---|---|
| Live JSON feed | `/api/v1/feed.json` | 1090 packages from PackageMaven's live API |
| Per-package detail files | `/api/v1/packages/<vendor>/<name>.json` | Includes README HTML, release matrix, license |
| Freshness manifest | `/api/v1/manifest.json` | Tiny; SHA-256 of the feed for cheap cache checks |
| Embeddable UI bundle | `/embed/directory-ui.iife.js` (+ `.js` ESM, `.css`) | 49 KB IIFE, self-contained, Shadow DOM by default |
| `mountDirectory()` API | `src/ui/mount.tsx` | All admin-facing options implemented (see §5) |
| Event contract | `mosd:select` / `mosd:selection` / `mosd:error` | 8 tests in `test/mount.test.tsx` cover it |
| Reference embedder | `examples/embed-demo.html` | Working stand-in for the admin module |
| Daily rebuild | `.github/workflows/build-deploy.yml` | 05:23 UTC, live PM fetch, stale-carry-forward fallback |

### Not built

Everything on the Magento side. There is **no PHP in this repo at all** — no
`registration.php`, `etc/module.xml`, ACL, menu, route, controller, template, block, or
composer.lock reader. The module is also not on the roadmap: milestones M0–M5 in
[architecture.md](architecture.md#milestones) all cover the directory service, and M5 is
the website launch.

---

## 3. Endpoints and hosting

### Current URLs

The canonical host is **not settled yet** — see §10, open decision 1. Today the site runs
on a GitHub Pages fallback because Cloudflare credentials aren't provisioned:

```
https://rhoerr.github.io/mage-os.directory/api/v1/feed.json
https://rhoerr.github.io/mage-os.directory/api/v1/manifest.json
https://rhoerr.github.io/mage-os.directory/api/v1/packages/<vendor>/<name>.json
https://rhoerr.github.io/mage-os.directory/embed/directory-ui.iife.js
https://rhoerr.github.io/mage-os.directory/embed/directory-ui.css
```

Planned canonical host: `https://mage-os-directory.pages.dev`, then a Mage-OS custom
domain. **Make the base URL a system config value** (`etc/adminhtml/system.xml`) rather
than a constant — it will change at least twice.

### Caching and CORS

`public/_headers` sets, on the Cloudflare host:

```
/api/v1/*   Access-Control-Allow-Origin: *
            Cache-Control: public, max-age=300, must-revalidate
/embed/*    Access-Control-Allow-Origin: *
            Cache-Control: public, max-age=300, must-revalidate
```

⚠️ **`_headers` is a Cloudflare Pages file — GitHub Pages ignores it.** GitHub Pages is
believed to send `Access-Control-Allow-Origin: *` by default, but this has not been
verified against the deployed site. **Verify CORS on whatever host is live before
building a browser-side cross-origin fetch against it** (`curl -I` the feed URL and check
for the header). The server-side proxy approach in §6 sidesteps this entirely.

### Size and refresh

| | |
|---|---|
| Feed size | ~1.5–1.7 MB raw, ~200 KB gzipped at 1090 packages (extrapolated from fixture) |
| Detail file | ~2–20 KB each, depending on README |
| `manifest.json` | ~200 bytes |
| Refresh cadence | Daily (05:23 UTC) plus any push touching `data/**` |

The feed is big enough that fetching it on every admin page load is wasteful. Fetch
`manifest.json` (200 bytes) and compare `feedHash` to decide whether to refetch — that is
exactly what it exists for.

---

## 4. Data contracts

All artifacts carry `schemaVersion: 1`. The authoritative definitions are Zod schemas in
`src/schema/feed.ts` and `src/schema/common.ts`; the tables below are the same thing in
prose. The pipeline validates its own output against these before writing, so anything
served has passed them.

### 4.1 `/api/v1/feed.json`

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `1` | Bump = breaking change |
| `generatedAt` | ISO 8601 | Build time |
| `sources` | `SourceStatus[]` | See below — drives the "data as of" notice |
| `rankingConfigVersion` | string | Which ranking weights produced the scores |
| `categories` | `{slug, name, packageCount}[]` | Canonical Mage-OS taxonomy |
| `vendors` | `{slug, name, url, trustedVendor, partnerTier, packageCount}[]` | |
| `packages` | `PackageSummary[]` | Sorted by name; the whole universe |

`SourceStatus`: `{id: 'packagemaven' | 'github', ok: boolean, stale: boolean, fetchedAt: ISO|null}`.
When `packagemaven.stale` is true the pipeline carried forward an older snapshot because
the live fetch failed — **surface this to the merchant**; the bundle does it automatically.

### 4.2 `PackageSummary`

| Field | Type | Notes |
|---|---|---|
| `name` | string | Packagist name, `vendor/package`. **The join key** against composer.lock |
| `vendor` | string | Packagist vendor namespace |
| `displayName` | string | Human name; trust-file override wins over PM's |
| `description` | string | May be empty |
| `categories` | string[] | Canonical slugs (not PM's raw labels) |
| `repositoryUrl` | string \| null | |
| `latestVersion` | string \| null | |
| `latestReleasedAt` | ISO \| null | |
| `supportedMagento` | string[] | Magento versions the **latest** release was verified against |
| `compatibility` | `Record<magentoVersion, packageVersion>` | Newest release verified against each Magento version. **This is what enables version pinning** |
| `abandoned` | boolean \| null | From Packagist, via PM |
| `abandonedReplacement` | string \| null | Maintainer-suggested successor, composer name |
| `quality` | object | See 4.3 |
| `trust` | object | See 4.4 |
| `popularity` | `{installs: int\|null, githubStars: int\|null}` | |
| `ranking` | `{score: 0..1, components: Record<string, number>}` | Transparent breakdown; unavailable signals are omitted, not zeroed |

### 4.3 `quality`

| Field | Type | Notes |
|---|---|---|
| `tier` | enum \| **null** | `strict-compliant` \| `no-errors` \| `ready-to-install` \| `needs-help`. **`null` = PM hasn't tested it** — do not render as failure |
| `phpstanLevel` | int \| null | 0–9; **`-1` means analysis fails at level 0**; null = untested |
| `buildStatus` | enum | `passing` \| `failing` \| `unknown` |
| `semver` | object \| null | `{status: 'pending'\|'compliant'\|'violations'\|'unknown', compliancePercent: 0-100\|null}` — PM's semverdict check |
| `stale` | boolean | True when carried forward from an older snapshot |

Tier meanings (PM's definitions): `strict-compliant` = build works + PHPCS fully passing +
PHPStan ≥ 8; `no-errors` = build works + PHPStan ≥ 0 + no PHPCS errors; `ready-to-install`
= composer install, DI compile, and template compile all pass; `needs-help` = at least one
build step explicitly fails.

### 4.4 `trust` (Mage-OS curated, not PM)

| Field | Type | Notes |
|---|---|---|
| `trustedVendor` | boolean | |
| `partnerTier` | enum \| null | `platinum` \| `gold` \| `silver` \| `bronze` |
| `editorialPick` | boolean | |
| `warnings` | `PackageWarning[]` | `{code, severity, message, date, evidenceUrl?}`, severity `info`\|`derank`\|`hide` |
| `deranked` | boolean | Derived: any `derank` or `hide` warning |
| `hidden` | boolean | Derived: any `hide` warning |

**`hidden` packages stay in the feed** — their detail pages remain reachable with a warning
banner (no link rot), but they are excluded from default listings. The bundle handles this;
a custom UI must filter `trust.hidden` from listings by default.

See [trust-policy.md](trust-policy.md) for the governance rules behind these fields.

### 4.5 `/api/v1/packages/<vendor>/<name>.json` (`PackageDetail`)

Everything in `PackageSummary`, plus:

| Field | Type | Notes |
|---|---|---|
| `schemaVersion`, `generatedAt` | | |
| `readmeHtml` | string \| null | **Already sanitized at build time**; null when unavailable |
| `releases` | `{version, releasedAt, supportedMagento[]}[]` | Per-release test matrix, newest first |
| `license` | string[] \| null | SPDX ids; multiple when dual-licensed |
| `links` | `{packagist, packagemaven, repository, issues, docs}` | `packagist` and `packagemaven` always present — **required for attribution, see §8** |

### 4.6 Other files

- `/api/v1/manifest.json` — `{schemaVersion, generatedAt, feedHash, packageCount}`.
  `feedHash` is the SHA-256 of the canonical `feed.json` bytes.
- `/api/v1/sources/packagemaven.json` — the raw normalized PM snapshot, republished so the
  pipeline can carry it forward on fetch failure. **Internal; do not build against it.**

---

## 5. The embeddable bundle

Built with Vite in library mode from the same Preact component the website uses, so the
admin and the website never drift. Published at `/embed/*` on every deploy.

- `directory-ui.iife.js` — classic `<script src>`, exposes global `MageOSDirectory`
- `directory-ui.js` — ES module build
- `directory-ui.css` — **only needed for `shadow: false`**; shadow mounts inline their styles

### 5.1 API

```ts
MageOSDirectory.mountDirectory(el: HTMLElement, options: {
  feedUrl?: string;                    // default "/api/v1/feed.json" — pass the absolute
                                       // directory URL, or your own proxy endpoint
  linkMode?: 'href' | 'event';         // default 'href'. Use 'event' in the admin
  baseUrl?: string;                    // href prefix when linkMode 'href'; default ""
  initialFilters?: { category?: string; quality?: string[]; query?: string };
  shadow?: boolean;                    // default true — keep it; see 5.4
  installed?: Record<string, string>;  // composer name → installed version, from composer.lock
  selectable?: boolean;                // default false — mark-for-install toggles + command tray
  magentoVersion?: string;             // e.g. "2.4.7" — the shop's own version
}): () => void;                        // returns an unmount function
```

The component owns its own loading, error, and retry states. **`mountDirectory` never
throws asynchronously** — a failed feed fetch renders a retryable error inside the
component and dispatches `mosd:error`.

### 5.2 Events

All are `CustomEvent`, dispatched on the mount element, **bubbling and composed** (so they
cross the shadow boundary).

| Event | `detail` | When |
|---|---|---|
| `mosd:select` | `{name, vendor, packageUrl}` | A package is clicked in `linkMode: 'event'` (no navigation happens) |
| `mosd:selection` | `{packages: [{name, version}], command}` | The install list changed (`selectable: true`). `command` is the ready-to-paste `composer require …` string, empty when the list is empty |
| `mosd:error` | `{message}` | Feed fetch failed |

### 5.3 What the module must supply

Two inputs, both known only to the shop:

**`installed`** — composer name → installed version, e.g. `{"yireo/magento2-emailtester2": "2.1.0"}`.
Read `composer.lock` from the Magento root (`DirectoryList::ROOT` via
`\Magento\Framework\Filesystem`), take the `packages` array, map `name` → `version`, and
strip any leading `v`. Parsing the lock file directly is preferred over
`composer show --format=json`, which needs shell access that some hosting restricts
([initial-scope.md](initial-scope.md)).

**`magentoVersion`** — from `\Magento\Framework\App\ProductMetadataInterface::getVersion()`.
Note Mage-OS reports its own version scheme; if it doesn't match PM's tested Magento
versions the UI degrades gracefully to "not tested" rather than showing anything wrong.

### 5.4 Theming

The component prefixes every class `.mosd-*` and renders into an **open Shadow DOM by
default**. Keep `shadow: true` in the admin — class prefixes stop our styles leaking out,
but only Shadow DOM stops the Magento admin's global resets leaking *in*.

Theming still works: CSS custom properties pierce the shadow boundary. Set these on the
host element to match the admin:

```css
--mosd-theme-accent      /* default #e8590c */
--mosd-theme-accent-soft /* default #fdeee4 */
--mosd-theme-fg          /* default #1c1b1f */
--mosd-theme-fg-muted    /* default #5f5b66 */
--mosd-theme-bg          /* default #ffffff */
--mosd-theme-bg-soft     /* default #f3f2f7 */
--mosd-theme-border      /* default #dcd9e0 */
--mosd-theme-radius      /* default 12px */
--mosd-theme-band        /* default #262335 — card header band + composer-command bar */
--mosd-theme-band-2      /* default #3a3450 — band gradient end */
--mosd-theme-font        /* default Roboto, system-ui, sans-serif */
```

### 5.5 Working example

`examples/embed-demo.html` is a complete, runnable embedder: it loads the IIFE bundle,
mounts in event mode with a fake `installed` map and `magentoVersion: '2.4.6'`, and logs
every event. Start there — it is the admin module in miniature.

---

## 6. Integration approach

Two viable shapes. **Recommendation: proxy the feed server-side, and vendor the bundle
into the module.**

| | Remote (browser fetches directory directly) | Proxied + vendored (recommended) |
|---|---|---|
| CSP | Needs `etc/csp_whitelist.xml` entries for `script-src` and `connect-src` | Nothing to whitelist — same origin |
| CORS | Depends on the host's headers (unverified on GH Pages) | Not applicable |
| Restricted networks | Breaks behind egress proxies / air-gapped shops | Works if the *server* has outbound access; degrades cleanly if not |
| Merchant privacy | Every admin user's browser calls a third-party host | Only the shop's server does, once per cache period |
| Bandwidth | ~200 KB gzipped per admin user | Once per cache TTL for the whole shop |
| Staying current | Automatic | Feed is current; bundle updates need a module release |

The bundle is 49 KB and the data contract is versioned, so a vendored bundle aging between
releases is a small cost against the CSP, privacy, and restricted-network wins. Make both
choices configurable if in doubt — a system config toggle for "load UI from directory
origin vs. bundled copy" costs little.

Server-side proxy sketch: an admin controller fetches `feed.json`, stores it in Magento's
cache with a 1-hour TTL, and serves it at a local URL passed as `feedUrl`. Check
`manifest.json`'s `feedHash` before refetching. Fail soft — if the fetch fails and a cached
copy exists, serve the cached copy and flag its age.

---

## 7. Compatibility and version semantics

This is the subtlest part of the contract; getting it wrong misleads merchants.

Given `magentoVersion` (the shop's version), each package resolves to one of three states:

| State | Condition | Badge | Install target |
|---|---|---|---|
| **tested** | `supportedMagento` includes the shop's version | "Tested with 2.4.7" | `latestVersion` |
| **older** | `compatibility[shopVersion]` exists | "v5.0.0 tested with 2.4.6" | that older version |
| **untested** | neither | "Not tested with 2.4.6" | `latestVersion` |

**Absence of a test result is never incompatibility.** PM's matrix is empirical — it
records what was actually tested, not what is declared to work. A package with no result
for the shop's version may well work fine. Never render "untested" as "incompatible",
"unsupported", or a failure state, and never block installation on it.

Derived states:

- **Install state**: `not-installed` (not in the `installed` map) / `installed` (target
  version not newer than installed) / `update` (target is newer). Version comparison uses
  the shared semver-ish comparator in `src/shared/version.ts`.
- **Composer command**: `composer require vendor/a:^1.2 vendor/b` — a caret-prefixed
  constraint when a target version is known, bare name otherwise.

The bundle implements all of this; the table matters if you build custom UI, and for
writing merchant-facing copy either way.

---

## 8. Attribution obligations — required

PackageMaven's API spec (`info.description`, "Data ownership, attribution & disclaimer")
states the terms under which we redistribute their data:

> All data referenced through this API is sourced from package-maven.com, operated by
> Tribound Creative s.r.o. […] Any use, redistribution, or display of this data — whether
> via the website or the API — must include clear attribution to package-maven.com as the
> source, and, when displaying a package, attribution to the package's original Packagist
> page (provided per package as `links.packagist`). The data is provided "as is" […]

For the module this means, concretely:

1. A visible **"Quality and compatibility data by PackageMaven"** credit, linking to
   `https://package-maven.com/`, wherever directory data is shown.
2. On any package view, a link to that package's **Packagist page** —
   `PackageDetail.links.packagist`, or derived as
   `https://packagist.org/packages/<name>`.
3. Do not present the data as warranted or authoritative; it is empirical test output.

⚠️ **The embeddable bundle does not currently render this attribution** — only the
website's own footer does. Until that is fixed upstream (tracked as an action item for
this repo), **the module must render the attribution itself** in the surrounding admin
page. Verify it is present before shipping.

---

## 9. Magento-side build checklist

A sketch, not a spec — the module author owns the details.

**Package**

- `composer.json`, type `magento2-module`, suggested name `mage-os/module-extension-directory`
- `registration.php`, `etc/module.xml`

**Admin surface**

- `etc/acl.xml` — a resource such as `MageOS_ExtensionDirectory::directory`
- `etc/adminhtml/menu.xml` — menu entry (System, or its own top-level item)
- `etc/adminhtml/routes.xml` — admin router, frontName
- `Controller/Adminhtml/…` — extends `\Magento\Backend\App\Action`, sets `ADMIN_RESOURCE`
  to the ACL id, returns a `Page` result
- `view/adminhtml/layout/<route>_<controller>_<action>.xml`
- `view/adminhtml/templates/directory.phtml` — mount `<div>`, script tag, theming custom
  properties, and the attribution block from §8
- A ViewModel (preferred over a Block) supplying `feedUrl`, the `installed` map,
  `magentoVersion`, and the resolved bundle URL

**Data**

- composer.lock reader (§5.3) — cache it; it changes only on deploy
- Optional: a feed proxy controller + Magento cache entry (§6)

**Config and policy**

- `etc/adminhtml/system.xml` — directory base URL, cache TTL, enable/disable, bundle source
- `etc/csp_whitelist.xml` — **required if loading the bundle or feed from a remote origin**
  on Magento 2.4+; add `script-src` and `connect-src` entries for the directory host
- `etc/acl.xml` wiring so the menu item respects permissions

**Nice to have, later**

- Surface `trust.warnings` with `derank`/`hide` severity for *installed* packages as
  Magento admin system messages — "a module you have installed has a security advisory" is
  the single most valuable thing this data can do for a merchant, and it needs no new API.

---

## 10. Open decisions and risks

1. **The base URL is not stable.** Today: `rhoerr.github.io/mage-os.directory` (personal
   fallback). Next: `mage-os-directory.pages.dev` once Cloudflare secrets land. Then: a
   Mage-OS custom domain. Building against today's URL bakes in two future migrations —
   settle the domain first, or make it configuration-only.
2. **CORS on the current host is unverified** (§3). Verify, or use the proxy approach.
3. **Where does the module live?** Separate repo and composer package, almost certainly —
   decision 6 kept the bundle framework-agnostic precisely so the Magento side stays
   decoupled. Who owns and maintains it is undecided.
4. **Support matrix** — which Magento 2.4.x and Mage-OS versions, and which PHP versions,
   the module targets.
5. **Distribution** — bundled in the Mage-OS distribution by default, or opt-in install?
   Default-bundled raises the bar on privacy and offline behavior considerably.
6. **`schemaVersion` bump policy** — the module should check `schemaVersion` and degrade
   gracefully rather than misrender a future v2. No bump is planned.
7. **Trust data is thin.** `data/vendors/` currently holds three demo vendor files whose
   packages don't exist in the live corpus. Real curated trust data is a Mage-OS
   association task, independent of the module.
8. **Attribution gap in the bundle** (§8) — fix upstream, or handle in the module.

**Timeline context:** the directory was targeted to be ready before Mage-OS's next feature
release in **October**. The directory side is done; the module is the remaining work.

---

## 11. Reference

### In this repo

| Document | What's in it |
|---|---|
| [architecture.md](architecture.md) | Full system design; "Site and embeddable UI" specifies the embed contract |
| [decisions.md](decisions.md) | Numbered decision log with rationale and rejected alternatives |
| [initial-scope.md](initial-scope.md) | Original two-tier reasoning, incl. the admin-module discussion |
| [trust-policy.md](trust-policy.md) | Governance for trusted vendors, partner tiers, warnings |
| [packagemaven-api-evaluation.md](packagemaven-api-evaluation.md) | Upstream API assessment, field mapping, gaps |
| [packagemaven-openapi.json](packagemaven-openapi.json) | PM's OpenAPI spec, incl. the attribution terms |

### Key source files

| Path | Why you'd read it |
|---|---|
| `src/schema/feed.ts` | Authoritative feed/detail/manifest schemas |
| `src/schema/common.ts` | Enums: quality tiers, build status, partner tiers, warning severities |
| `src/ui/mount.tsx` | `mountDirectory` — the embed entry point and event dispatch |
| `src/ui/DirectoryBrowser.tsx` | Compatibility/install-state/composer-command logic |
| `test/mount.test.tsx` | Executable specification of the embed contract |
| `examples/embed-demo.html` | Runnable reference embedder |
| `public/_headers` | CORS/caching intent (Cloudflare only) |

### Contacts

| Who | Role | Contact |
|---|---|---|
| Ryan Hoerr | Mage-OS Association — directory owner, curation, trust policy | ryan.hoerr@mage-os.org |
| Jiří Brada | PackageMaven (Tribound Creative s.r.o.) — upstream data, API | jiri@jbrada.cz |

PM API docs: <https://package-maven.com/api/docs> (bearer-token gated; access granted to
Mage-OS for the pipeline). The token lives in the `PACKAGE_MAVEN_TOKEN` GitHub Actions
secret. **The module needs neither the docs nor the token** — it consumes our open feed.

Open collaboration items with PM, for context: a per-release/multi-Magento test matrix
(PM currently reports one tested `(package_version, magento_version)` pair per package),
and confirmation that the written spec terms cover our open feed republication.

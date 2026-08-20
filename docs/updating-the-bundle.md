# Updating the vendored UI bundle

`view/adminhtml/web/js/directory-ui.iife.js` is a **built artifact**, vendored from the
[mage-os.directory](https://github.com/rhoerr/mage-os.directory) repository per the
integration recommendation in its admin-module handoff (§6: proxied + vendored). Do not
edit it by hand.

## Current provenance

| | |
|---|---|
| Source repo | `rhoerr/mage-os.directory` |
| Commit | `77d2974` (branch `claude/magento-admin-extension-ui-m4h03l`; adds the `--mosd-theme-band`/`--mosd-theme-band-2`/`--mosd-theme-font` theming hooks this module relies on) |
| Built with | `npm run build:ui` (Vite library mode, `vite.ui.config.ts`) |
| Size | 49,835 bytes (≈16.7 KB gzipped) |
| Data contract | `schemaVersion: 1` |
| Global | `MageOSDirectory` (plain IIFE — no AMD/UMD wrapper, coexists with the admin's RequireJS) |

The bundle is data-independent: the same file is produced regardless of which data
source (live or fixture) the directory pipeline ran with. Styles are inlined into the
shadow root at mount time, so `directory-ui.css` is deliberately **not** vendored
(only `shadow: false` embedders need it, and this module keeps the default
`shadow: true`).

## Refresh procedure

```sh
git clone https://github.com/rhoerr/mage-os.directory && cd mage-os.directory
npm ci
npm run build:ui        # emits public/embed/directory-ui.iife.js
npm test                # 8 tests in test/mount.test.tsx are the embed contract
cp public/embed/directory-ui.iife.js \
   ../module-extension-directory/view/adminhtml/web/js/directory-ui.iife.js
```

Then update the provenance table above (commit, size) and check:

1. `schemaVersion` is still `1` — a bump is a breaking change (handoff §10.6).
2. The `mountDirectory` options and `mosd:select` / `mosd:selection` / `mosd:error`
   event contract are unchanged (`src/ui/mount.tsx`, `test/mount.test.tsx`).
3. Whether the bundle now renders the PackageMaven attribution itself (tracked
   upstream). Until it does, the attribution block in
   `view/adminhtml/templates/directory.phtml` is **required** — do not remove it
   without verifying the bundle took over that obligation.

After copying, remember that deployed shops only pick up the new file after
`bin/magento setup:static-content:deploy` (production mode) and a browser-cache-busting
static content version bump.

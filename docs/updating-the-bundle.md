# Updating the vendored UI bundle

`src/view/adminhtml/web/js/directory-ui.iife.js` is a **built artifact**: the embeddable
browse/search UI compiled from `service/src/ui/` by Vite (`service/vite.ui.config.ts`).
The module ships this copy so its Proxy mode works fully same-origin — restricted
networks, no CSP surprises. Do not edit it by hand.

Since the module and the bundle source live in this repository, keeping them in sync is
a build step, not a cross-repo ritual — and CI enforces it: the **Module CI /
bundle-sync** job rebuilds the bundle and fails on any byte difference.

## Refresh procedure

After any change under `service/src/ui/` or `service/src/shared/`:

```sh
cd service
npm ci                  # first time only
npm test                # the embed contract lives in service/test/mount.test.tsx
npm run build:ui        # emits service/public/embed/directory-ui.iife.js
cp public/embed/directory-ui.iife.js ../src/view/adminhtml/web/js/directory-ui.iife.js
```

Commit the rebuilt file together with the source change — one atomic commit, which is
the point of the monorepo ([decision 12](decisions.md#12-one-repository-for-the-service-and-the-admin-module)).

## Checks that still need a human

1. `schemaVersion` is still `1` — a bump is a breaking change
   ([handoff §10.6](magento-admin-module-handoff.md)).
2. The `mountDirectory` options and `mosd:select` / `mosd:selection` / `mosd:error`
   event contract are unchanged (`service/src/ui/mount.tsx`,
   `service/test/mount.test.tsx`), or the module's template/tests are updated in the
   same commit.
3. Whether the bundle now renders the PackageMaven/Packagist attribution itself. Until
   it does, the attribution block in `src/view/adminhtml/templates/directory.phtml` is
   **required** — do not remove it without verifying the bundle took over that
   obligation.

Notes: `directory-ui.css` is deliberately not vendored — the module keeps the default
`shadow: true`, and shadow mounts inline their styles. Deployed shops pick up the new
file only after `bin/magento setup:static-content:deploy` (production mode).

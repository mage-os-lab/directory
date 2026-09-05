# Contributing

This repository holds both the directory service (`service/` — pipeline, site,
embeddable UI) and the Magento admin module (`src/` — Composer package
`mage-os/module-extension-directory`).

Two kinds of contribution matter here: code, and trust data. Service code follows the
usual fork-and-PR flow (`cd service && npm install && npm test` is the whole setup);
module code needs only PHP (`composer install --working-dir=dev/tests/unit &&
composer test`). Trust data has its own
rules because it makes public claims about vendors — this page covers those; the
governing policy is [docs/trust-policy.md](docs/trust-policy.md).

## Getting a package listed

The directory lists exactly what [PackageMaven](https://package-maven.com/) indexes —
we don't add packages by PR. Publish on Packagist, then submit the module on
PackageMaven's site. Once it appears in PM's index, it appears here on the next daily
build.

## Creating or updating a vendor trust file

Vendor trust files (`service/data/vendors/<vendor>.json`) add badges, display-name and
category overrides, editorial picks, and warnings on top of the indexed data.

1. Copy an existing file (e.g. `service/data/vendors/vendic.json`) and adjust it. The
   filename must equal the `vendor` field — your Packagist vendor namespace. (The demo
   vendors under `service/data/fixtures/vendors/` decorate the fixture snapshot only;
   don't add real vendors there.)
2. Include proof you control the namespace in the PR description (see the
   [trust policy](docs/trust-policy.md#vendor-identity)): open the PR from an account
   in the org that owns the vendor's repositories, or link a commit/site note that
   references the PR.
3. `trustedVendor`, `partnerTier`, and `editorialPick` are granted by maintainers, not
   self-assigned — leave them out or expect the PR review to set them.
4. Run the formatter and validator before pushing:

   ```sh
   npm run format:vendors
   npm run validate:data
   ```

CI enforces the schema (`service/data/vendor.schema.json` gives editor autocomplete), the
canonical format, category references, and that every package you reference exists in
the current PM snapshot.

## Filing a warning about a package

Warnings (`info` / `derank` / `hide`) correct the public record — they follow the
evidence, notification, and dispute rules in the
[trust policy](docs/trust-policy.md#warnings). In short: `derank`/`hide` require a
public `evidenceUrl`, the vendor gets notified with a 7-day response window, and
security emergencies use the expedited path below.

## Reporting a malicious or dangerous package

Open a [security report issue](.github/ISSUE_TEMPLATE/security-report.yml) — or, if
the details shouldn't be public before triage, email the maintainers (see the security
contact in the issue template). Credible malware/backdoor evidence gets an expedited
`hide` merge.

## Code contributions

Service (run inside `service/`):

- `npm test` — schema, ranking, and pipeline tests
- `npm run typecheck` — TypeScript + Astro check
- `npm run dev` — pipeline on fixture data, then the site on localhost
- `npm run build:ui && npm run dev` — then open `service/examples/embed-demo.html`
  for the embeddable bundle

Module (run from the repository root):

- `composer install --working-dir=dev/tests/unit` — installs the PHPUnit toolchain
  (no Magento credentials needed)
- `composer test` — the module's hermetic unit suite
- A change to `service/src/ui/**` must be followed by `npm run build:ui` and copying
  `service/public/embed/directory-ui.iife.js` to
  `src/view/adminhtml/web/js/directory-ui.iife.js` — CI fails on drift.

Keep changes small and covered by a test where behavior changes. Schema changes must
regenerate the committed JSON Schemas (`npm run generate:schemas` — CI checks drift).


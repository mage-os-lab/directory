# Contributing

Two kinds of contribution matter here: code, and trust data. Code follows the usual
fork-and-PR flow (`npm install && npm test` is the whole setup). Trust data has its own
rules because it makes public claims about vendors — this page covers those; the
governing policy is [docs/trust-policy.md](docs/trust-policy.md).

## Getting a package listed

The directory lists exactly what [PackageMaven](https://package-maven.com/) indexes —
we don't add packages by PR. Publish on Packagist, then submit the module on
PackageMaven's site. Once it appears in PM's index, it appears here on the next daily
build.

## Creating or updating a vendor trust file

Vendor trust files (`data/vendors/<vendor>.json`) add badges, display-name and
category overrides, editorial picks, and warnings on top of the indexed data.

1. Copy an existing file (e.g. `data/vendors/pixelforge.json`) and adjust it. The
   filename must equal the `vendor` field — your Packagist vendor namespace.
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

CI enforces the schema (`data/vendor.schema.json` gives editor autocomplete), the
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

- `npm test` — schema, ranking, and pipeline tests
- `npm run typecheck` — TypeScript + Astro check
- `npm run dev` — pipeline on fixture data, then the site on localhost
- `npm run build:ui && npm run dev` — then open `examples/embed-demo.html` for the
  embeddable bundle

Keep changes small and covered by a test where behavior changes. Schema changes must
regenerate the committed JSON Schemas (`npm run generate:schemas` — CI checks drift).

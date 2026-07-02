# Trust policy

This document governs the trust overlay described in
[architecture.md](architecture.md#vendor-trust-files): who can claim a vendor namespace,
what it takes to earn a Trusted Vendor badge or a partner tier, how editorial picks stay
independent of partnership, how warnings get filed and disputed, and how to report a
malicious package. It applies to every `data/vendors/<vendor>.json` file and every PR
that touches one.

## Vendor identity

- A vendor slug is a Packagist vendor namespace (the part before the `/` in
  `acme/module-widget` → `acme`). One trust file per namespace:
  `data/vendors/acme.json`.
- Creating or modifying a vendor file requires proof of namespace control. The PR must
  either come from a GitHub account that is a member of the GitHub org owning the
  namespace's repositories, or include a verifiable artifact: a commit to one of the
  vendor's repos referencing the PR, or a note on the vendor's published site linking to
  it. A reviewing maintainer checks this before merge — it is not automated.
- Vendors publishing under multiple Packagist namespaces (e.g. `acme` and
  `acme-labs`) get one file per namespace. Shared identity is established once (the
  namespaces point at the same org/site), but `trustedVendor`, `partnerTier`, and
  warnings are granted per namespace, not inherited across them.

## Trusted vendor

The `trustedVendor` badge signals a sustained track record, not a one-time check.
Eligibility:

- At least one package maintained (releases and issue responses) for 12+ months.
- No open `derank` or `hide` severity warning against any of the vendor's packages.
- Demonstrated responsiveness: issues on the vendor's repos get triaged, not ignored,
  within a reasonable window.
- Identity verified per [Vendor identity](#vendor-identity) above.

Granted or revoked only by a maintainer PR review (CODEOWNERS-guarded, same as every
`data/vendors/**` change). Revocation for cause — e.g. an unresolved `hide` warning, or a
pattern of unresponsiveness — must state the reason in the PR description, not just flip
the field silently; the PR itself is the audit trail.

## Partner tiers

- `partnerTier` (`platinum`/`gold`/`silver`/`bronze`) reflects the Mage-OS partnership
  program: a relationship with the Mage-OS organization, which may be commercial.
- Because partner tier feeds directly into the ranking score (weight `0.10`, see
  [architecture.md](architecture.md#ranking)), the site must disclose what each badge
  means and that partnership can be commercial. This disclosure lives on the site (e.g. a
  "what do these badges mean" note near tier badges) and is not optional.
- There is no pay-to-rank beyond that published, fixed weight — a commercial partnership
  buys a badge and a bounded ranking bump, not arbitrary placement.
- Tier changes only land via a PR approved by a Mage-OS maintainer per CODEOWNERS. No
  self-service tier upgrades.

## Editorial picks

- `editorialPick` is a maintainer judgment about quality or usefulness of a specific
  package. It is independent of partner status — being a platinum partner does not make a
  package more likely to be picked, and picks happen for non-partner vendors routinely.
- When a picked package's vendor also holds a partner tier, the pick still needs its own
  stated justification in the PR (what makes this package worth featuring), separate from
  the partnership. This is the firewall: a reviewer should be able to read the PR and see
  the pick stands on its own.

## Warnings

- Three severities, enforced by schema: `info` (badge only, no ranking effect),
  `derank` (ranking penalty via the `deranked` multiplier), `hide` (excluded from default
  search results; the package's detail page stays up with a prominent warning banner —
  no link rot).
- Evidence bar: any `derank` or `hide` warning MUST carry an `evidenceUrl` pointing to a
  public issue, security advisory, or discussion — this is schema-enforced, the pipeline
  rejects a warning of that severity without one. The `message` field must be factual and
  sourced; no unverifiable accusations, no editorializing about motive.
- Notification: opening a PR that adds a `derank` or `hide` warning requires notifying the
  vendor — an issue on their repo or a message to their published contact — and giving
  them a stated response window (7 days) before the PR merges. Exception: the security
  emergency path below.
- Conflict of interest: a maintainer with a commercial relationship to either the warned
  vendor or a competitor filing the warning must recuse from reviewing that PR.
- Disputes and appeals: the vendor opens an issue or a counter-PR (e.g. removing the
  warning with evidence it's resolved or was wrong). A maintainer who was not involved in
  merging the original warning reviews the dispute.
- Warnings correct the public record; they are never applied silently. History stays in
  git — a resolved warning is removed by a new PR, not by editing the merge commit.

## Reporting a malicious or dangerous package

- Public intake: a GitHub issue template for security reports, plus a security contact
  email for reports that shouldn't be public before triage.
- Expedited process: for credible evidence of malware, a backdoor, or active supply-chain
  compromise, a maintainer may merge a `hide` warning immediately, skipping the standard
  notification window, and notify the vendor in parallel rather than beforehand. Normal
  evidence and dispute rules still apply after the fact.

## Trademarks and logos

- Vendor logos are used only with the vendor's permission.
- The site carries a standing disclaimer: "Magento is a registered trademark of Adobe
  Inc.; Mage-OS is not affiliated with Adobe." The directory does not imply endorsement
  by Adobe, Magento, or any listed vendor.

/**
 * Merchant-facing names for PackageMaven's quality tiers, shared by the
 * browse UI and the prerendered pages so one vocabulary reaches the reader
 * everywhere.
 *
 * The tier slugs are PackageMaven's and stay the API contract; these are the
 * words shown to someone choosing a module, who is not the person who would
 * fix it. "Strict compliant" and "Needs help" describe a codebase to its
 * contributors; "Strict checks pass" and "Known issues" describe a candidate
 * to its buyer.
 */
export const QUALITY_LABELS: Record<string, string> = {
  'strict-compliant': 'Strict checks pass',
  'no-errors': 'No errors found',
  'ready-to-install': 'Installs cleanly',
  'needs-help': 'Known issues',
};

/** Shown when PackageMaven has no result for the package at all. */
export const QUALITY_UNTESTED = 'Not assessed yet';

export function qualityLabel(tier: string | null): string {
  return tier === null ? QUALITY_UNTESTED : (QUALITY_LABELS[tier] ?? QUALITY_UNTESTED);
}

import { z } from 'zod';
import {
  categorySlug,
  isoDate,
  packageName,
  partnerTier,
  vendorSlug,
  warningSeverity,
} from './common.js';

/** A single curator warning attached to a package. */
export const packageWarning = z.object({
  /** Stable machine code, e.g. "unmaintained", "security-advisory". */
  code: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be a lowercase kebab-case code'),
  severity: warningSeverity,
  /** Human-readable explanation shown in the UI. Keep it factual and sourced. */
  message: z.string().min(10),
  date: isoDate,
  /** Link to the evidence: issue, advisory, discussion. Required for derank/hide. */
  evidenceUrl: z.url().optional(),
});
export type PackageWarning = z.infer<typeof packageWarning>;

/** Per-package trust overrides inside a vendor file. */
export const packageTrustEntry = z
  .object({
    displayName: z.string().min(1).optional(),
    categories: z.array(categorySlug).min(1).optional(),
    editorialPick: z.boolean().optional(),
    warnings: z.array(packageWarning).optional(),
    /** Extra links surfaced on the detail page. */
    docsUrl: z.url().optional(),
    issuesUrl: z.url().optional(),
  })
  .strict();
export type PackageTrustEntry = z.infer<typeof packageTrustEntry>;

/**
 * A vendor trust file — data/vendors/<vendor>.json. Filename must equal the
 * `vendor` field; every package key must start with "<vendor>/". Enforced by
 * validate-data in CI (schema alone can't cross-check filenames).
 */
export const vendorFile = z
  .object({
    $schema: z.string().optional(),
    vendor: vendorSlug,
    vendorName: z.string().min(1),
    url: z.url().optional(),
    trustedVendor: z.boolean().default(false),
    partnerTier: partnerTier.nullable().default(null),
    packages: z.record(packageName, packageTrustEntry).default({}),
  })
  .strict();
export type VendorFile = z.infer<typeof vendorFile>;

/**
 * derank/hide warnings must carry evidence — enforced beyond the base schema.
 */
export function validateWarningEvidence(file: VendorFile): string[] {
  const problems: string[] = [];
  for (const [pkg, entry] of Object.entries(file.packages)) {
    for (const warning of entry.warnings ?? []) {
      if (warning.severity !== 'info' && !warning.evidenceUrl) {
        problems.push(
          `${pkg}: warning "${warning.code}" has severity "${warning.severity}" but no evidenceUrl — derank/hide warnings must link evidence`,
        );
      }
    }
  }
  return problems;
}

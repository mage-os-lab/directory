import { z } from 'zod';

/** Current published schema version for /api/v1 artifacts. */
export const SCHEMA_VERSION = 1;

/** Packagist package name, e.g. "acme/module-widget". */
export const packageName = z
  .string()
  .regex(
    /^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*$/,
    'must be a valid Packagist package name (vendor/package, lowercase)',
  );

/** Vendor slug — the Packagist vendor namespace, e.g. "acme". */
export const vendorSlug = z
  .string()
  .regex(/^[a-z0-9]([_.-]?[a-z0-9]+)*$/, 'must be a lowercase Packagist vendor namespace');

/** Category slug, e.g. "payments". */
export const categorySlug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be a lowercase kebab-case slug');

/** ISO 8601 timestamp. */
export const isoDateTime = z.iso.datetime();

/** ISO 8601 calendar date (YYYY-MM-DD). */
export const isoDate = z.iso.date();

export const qualityTier = z.enum([
  'strict-compliant',
  'no-errors',
  'ready-to-install',
  'needs-help',
]);
export type QualityTier = z.infer<typeof qualityTier>;

export const buildStatus = z.enum(['passing', 'failing', 'unknown']);
export type BuildStatus = z.infer<typeof buildStatus>;

export const partnerTier = z.enum(['platinum', 'gold', 'silver', 'bronze']);
export type PartnerTier = z.infer<typeof partnerTier>;

export const warningSeverity = z.enum(['info', 'derank', 'hide']);
export type WarningSeverity = z.infer<typeof warningSeverity>;

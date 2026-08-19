import { z } from 'zod';
import {
  buildStatus,
  categorySlug,
  isoDateTime,
  packageName,
  partnerTier,
  qualityTier,
  vendorSlug,
} from './common.js';
import { packageWarning } from './vendor-file.js';
import { sourceStatus } from './source.js';

export const packageQuality = z.object({
  tier: qualityTier,
  phpstanLevel: z.number().int().nullable(),
  buildStatus: buildStatus,
  /** True when quality data was carried forward from a previous snapshot. */
  stale: z.boolean(),
});

export const packageTrust = z.object({
  trustedVendor: z.boolean(),
  partnerTier: partnerTier.nullable(),
  editorialPick: z.boolean(),
  warnings: z.array(packageWarning),
  /** Derived: any warning with severity "derank" (or "hide"). */
  deranked: z.boolean(),
  /** Derived: any warning with severity "hide". Hidden packages stay in the
   * feed (their detail pages render a warning banner) but are excluded from
   * default search results by the UI. */
  hidden: z.boolean(),
});

export const packagePopularity = z.object({
  installs: z.number().int().nullable(),
  githubStars: z.number().int().nullable(),
});

export const packageRanking = z.object({
  /** Final score, 0..1. */
  score: z.number().min(0).max(1),
  /** Per-signal breakdown (normalized 0..1 values), for transparency.
   * A signal whose underlying data is unavailable (null installs/stars,
   * no release date) is omitted from components and its weight is
   * redistributed — see src/pipeline/rank.ts. */
  components: z.record(z.string(), z.number()),
});

export const packageSummary = z.object({
  name: packageName,
  vendor: vendorSlug,
  displayName: z.string(),
  description: z.string(),
  /** Canonical category slugs; trust-file override wins over PM mapping. */
  categories: z.array(categorySlug),
  repositoryUrl: z.url().nullable(),
  latestVersion: z.string().nullable(),
  latestReleasedAt: isoDateTime.nullable(),
  /** Magento versions the latest release was verified against (PM test data). */
  supportedMagento: z.array(z.string()),
  /**
   * Magento version → newest package release verified against it, derived
   * from PM's per-release test matrix (latest release included). Lets a
   * client on Magento 2.4.6 pin the newest release known to work there even
   * when the latest release is only verified on 2.4.7. Empty when PM
   * supplied no compatibility data. Keys sorted newest Magento first.
   */
  compatibility: z.record(z.string(), z.string()),
  abandoned: z.boolean().nullable(),
  quality: packageQuality,
  trust: packageTrust,
  popularity: packagePopularity,
  ranking: packageRanking,
});
export type PackageSummary = z.infer<typeof packageSummary>;

export const categoryEntry = z.object({
  slug: categorySlug,
  name: z.string(),
  packageCount: z.number().int().min(0),
});

export const vendorSummary = z.object({
  slug: vendorSlug,
  name: z.string(),
  url: z.url().nullable(),
  trustedVendor: z.boolean(),
  partnerTier: partnerTier.nullable(),
  packageCount: z.number().int().min(0),
});
export type VendorSummary = z.infer<typeof vendorSummary>;

/** /api/v1/feed.json — everything the search/browse UI needs. */
export const feed = z.object({
  schemaVersion: z.literal(1),
  generatedAt: isoDateTime,
  sources: z.array(sourceStatus),
  rankingConfigVersion: z.string(),
  categories: z.array(categoryEntry),
  vendors: z.array(vendorSummary),
  packages: z.array(packageSummary),
});
export type Feed = z.infer<typeof feed>;

/** One row of the published per-release test matrix. */
export const packageRelease = z.object({
  version: z.string(),
  releasedAt: isoDateTime.nullable(),
  supportedMagento: z.array(z.string()),
});
export type PackageRelease = z.infer<typeof packageRelease>;

/** /api/v1/packages/<vendor>/<name>.json — full per-package detail. */
export const packageDetail = packageSummary.extend({
  schemaVersion: z.literal(1),
  generatedAt: isoDateTime,
  /** Sanitized at build time; null when the README is unavailable. */
  readmeHtml: z.string().nullable(),
  /** PM's per-release test matrix, newest release first (latest included).
   * Empty when PM supplied no per-release data. */
  releases: z.array(packageRelease),
  license: z.array(z.string()).nullable(),
  links: z.object({
    packagist: z.url(),
    packagemaven: z.url(),
    repository: z.url().nullable(),
    issues: z.url().nullable(),
    docs: z.url().nullable(),
  }),
});
export type PackageDetail = z.infer<typeof packageDetail>;

/** /api/v1/manifest.json — cheap freshness check. */
export const manifest = z.object({
  schemaVersion: z.literal(1),
  generatedAt: isoDateTime,
  /** SHA-256 of the canonical feed.json bytes. */
  feedHash: z.string().regex(/^[0-9a-f]{64}$/),
  packageCount: z.number().int().min(0),
});
export type Manifest = z.infer<typeof manifest>;

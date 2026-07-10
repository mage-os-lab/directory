import { z } from 'zod';
import {
  buildStatus,
  categorySlug,
  isoDateTime,
  packageName,
  qualityTier,
} from './common.js';

/**
 * The normalized PackageMaven source record — the shape the PM fetcher emits
 * after normalizing whatever delivery format PM provides (export file, API,
 * or a manually shared snapshot). This is the pipeline's internal contract
 * with its structural source; docs/packagemaven-data-contract.md is the
 * human-readable version sent to PM.
 */
/** One row of PM's per-release test matrix. */
export const sourceRelease = z.object({
  version: z.string().min(1),
  releasedAt: isoDateTime.nullable().default(null),
  /** Magento/Mage-OS versions PM verified this release against. */
  supportedMagento: z.array(z.string()).default([]),
});
export type SourceRelease = z.infer<typeof sourceRelease>;

export const sourcePackage = z.object({
  /** Packagist name — the join key. */
  name: packageName,
  displayName: z.string().min(1),
  description: z.string().default(''),
  /** PM's raw category label(s), mapped to canonical slugs during merge. */
  rawCategories: z.array(z.string()).default([]),
  repositoryUrl: z.url().nullable().default(null),
  latestVersion: z.string().nullable().default(null),
  latestReleasedAt: isoDateTime.nullable().default(null),
  /** Magento versions PM verified the *latest* release against, e.g. ["2.4.7"]. */
  supportedMagento: z.array(z.string()).default([]),
  /**
   * Per-release test matrix (optional — see the PM data contract). When PM's
   * export only covers the latest release, this stays empty and per-Magento
   * compatibility degrades to latest-release-only. The latest release does
   * not need to be repeated here; merge folds latestVersion/supportedMagento
   * into the matrix.
   */
  releases: z.array(sourceRelease).default([]),
  /** Null means PM has not (yet) tested the package — distinct from any tier. */
  qualityTier: qualityTier.nullable(),
  /**
   * Highest PHPStan level passing with zero errors (PM's scale: 0–9).
   * -1 means the analysis fails even at level 0; null means untested.
   */
  phpstanLevel: z.number().int().min(-1).max(9).nullable().default(null),
  buildStatus: buildStatus.default('unknown'),
  installs: z.number().int().min(0).nullable().default(null),
  /** GitHub stars as reported by PM; fallback when our own GitHub fetch is off. */
  stars: z.number().int().min(0).nullable().default(null),
  /** Nice-to-have fields; null when PM's export doesn't carry them. */
  license: z.array(z.string()).nullable().default(null),
  abandoned: z.boolean().nullable().default(null),
});
export type SourcePackage = z.infer<typeof sourcePackage>;

/**
 * A PackageMaven snapshot: the raw normalized source universe. The pipeline
 * persists its latest successful snapshot (dist/api/v1/sources/packagemaven.json)
 * and carries it forward when a fetch fails, so trust data and ranking are
 * always re-merged from source rather than from previously merged output.
 */
export const packageMavenSnapshot = z.object({
  schemaVersion: z.literal(1),
  fetchedAt: isoDateTime,
  /** Where this snapshot came from: live fetch, manual drop, or fixture. */
  origin: z.enum(['live', 'manual', 'fixture']),
  packages: z.array(sourcePackage),
});
export type PackageMavenSnapshot = z.infer<typeof packageMavenSnapshot>;

/** Per-source status block published in the feed. */
export const sourceStatus = z.object({
  id: z.enum(['packagemaven', 'github']),
  ok: z.boolean(),
  /** True when this run reused a previous snapshot because the fetch failed. */
  stale: z.boolean(),
  fetchedAt: isoDateTime.nullable(),
});
export type SourceStatus = z.infer<typeof sourceStatus>;

/** Categories taxonomy file (data/categories.json). */
export const categoriesFile = z.object({
  $schema: z.string().optional(),
  categories: z.array(
    z.object({
      slug: categorySlug,
      name: z.string().min(1),
      description: z.string().optional(),
      /** PM raw category labels that map onto this canonical category. */
      packageMavenLabels: z.array(z.string()).default([]),
    }),
  ),
  /** Canonical slug for packages whose PM category maps to nothing. */
  fallbackCategory: categorySlug,
});
export type CategoriesFile = z.infer<typeof categoriesFile>;

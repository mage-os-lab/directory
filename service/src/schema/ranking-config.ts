import { z } from 'zod';
import { partnerTier, qualityTier } from './common.js';

const weight = z.number().min(0).max(1);

/** data/ranking.json — tunable ranking weights and curves. */
export const rankingConfig = z
  .object({
    $schema: z.string().optional(),
    /** Bumped on every tuning change; published in the feed for auditability. */
    version: z.string().min(1),
    weights: z.object({
      editorialPick: weight,
      partnerTier: weight,
      trustedVendor: weight,
      qualityTier: weight,
      freshness: weight,
      installs: weight,
      stars: weight,
    }),
    qualityTierValues: z.record(qualityTier, z.number().min(0).max(1)),
    partnerTierValues: z.record(partnerTier, z.number().min(0).max(1)),
    freshnessHalfLifeDays: z.number().positive(),
    /** Corpus percentile installs/stars are log-normalized against. */
    popularityPercentile: z.number().gt(0).lt(1),
    penalties: z.object({
      deranked: z.number().min(0).max(1),
      abandoned: z.number().min(0).max(1),
    }),
  })
  .refine(
    (config) => {
      const sum = Object.values(config.weights).reduce((a, b) => a + b, 0);
      return Math.abs(sum - 1) < 1e-9;
    },
    { message: 'ranking weights must sum to 1.0' },
  );
export type RankingConfig = z.infer<typeof rankingConfig>;

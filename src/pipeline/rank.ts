import type { RankingConfig } from '../schema/ranking-config.js';

/** The inputs the ranker needs per package — a slice of the merged record. */
export interface RankingInput {
  editorialPick: boolean;
  partnerTier: keyof RankingConfig['partnerTierValues'] | null;
  trustedVendor: boolean;
  qualityTier: keyof RankingConfig['qualityTierValues'];
  latestReleasedAt: string | null;
  installs: number | null;
  githubStars: number | null;
  deranked: boolean;
  abandoned: boolean | null;
}

export interface RankingResult {
  score: number;
  components: Record<string, number>;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Percentile of the non-null values in a corpus (nearest-rank).
 * Returns null when there are no usable values or the percentile is 0 —
 * a degenerate scale means the signal is unavailable for everyone.
 */
export function percentileOf(values: Array<number | null>, percentile: number): number | null {
  const usable = values.filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b);
  if (usable.length === 0) return null;
  const index = Math.min(usable.length - 1, Math.ceil(percentile * usable.length) - 1);
  const value = usable[Math.max(0, index)]!;
  return value > 0 ? value : null;
}

/** Log-normalize a count against the corpus percentile; 0..1. */
function logNormalize(value: number, scale: number): number {
  return clamp01(Math.log1p(value) / Math.log1p(scale));
}

/** Freshness decays with a half-life; clamped so future dates can't exceed 1. */
function freshness(latestReleasedAt: string, now: Date, halfLifeDays: number): number {
  const ageDays = (now.getTime() - Date.parse(latestReleasedAt)) / 86_400_000;
  return clamp01(0.5 ** (Math.max(0, ageDays) / halfLifeDays));
}

/**
 * Corpus-level normalization context, computed once per pipeline run.
 * A null scale means that signal is unavailable across the whole corpus.
 */
export interface RankingContext {
  now: Date;
  installsScale: number | null;
  starsScale: number | null;
}

export function buildRankingContext(
  packages: Array<Pick<RankingInput, 'installs' | 'githubStars'>>,
  config: RankingConfig,
  now: Date,
): RankingContext {
  return {
    now,
    installsScale: percentileOf(
      packages.map((p) => p.installs),
      config.popularityPercentile,
    ),
    starsScale: percentileOf(
      packages.map((p) => p.githubStars),
      config.popularityPercentile,
    ),
  };
}

/**
 * Compute the ranking score for one package.
 *
 * Missing data is not a zero score: a signal whose underlying data is
 * unavailable (null installs/stars, no release date, degenerate corpus scale)
 * is omitted from `components` and the remaining weights are renormalized to
 * sum to 1 — packages aren't punished for data we couldn't fetch, and the
 * omission is visible in the published breakdown.
 */
export function rankPackage(
  input: RankingInput,
  config: RankingConfig,
  context: RankingContext,
): RankingResult {
  const { weights } = config;
  // Every signal is either [weight, value 0..1] or null (unavailable).
  const signals: Record<string, [number, number] | null> = {
    editorialPick: [weights.editorialPick, input.editorialPick ? 1 : 0],
    partnerTier: [
      weights.partnerTier,
      input.partnerTier === null ? 0 : (config.partnerTierValues[input.partnerTier] ?? 0),
    ],
    trustedVendor: [weights.trustedVendor, input.trustedVendor ? 1 : 0],
    qualityTier: [weights.qualityTier, clamp01(config.qualityTierValues[input.qualityTier] ?? 0)],
    freshness:
      input.latestReleasedAt === null
        ? null
        : [
            weights.freshness,
            freshness(input.latestReleasedAt, context.now, config.freshnessHalfLifeDays),
          ],
    installs:
      input.installs === null || context.installsScale === null
        ? null
        : [weights.installs, logNormalize(input.installs, context.installsScale)],
    stars:
      input.githubStars === null || context.starsScale === null
        ? null
        : [weights.stars, logNormalize(input.githubStars, context.starsScale)],
  };

  const available = Object.entries(signals).filter(
    (entry): entry is [string, [number, number]] => entry[1] !== null,
  );
  const weightSum = available.reduce((sum, [, [weight]]) => sum + weight, 0);

  const components: Record<string, number> = {};
  let score = 0;
  for (const [name, [weight, value]] of available) {
    components[name] = roundScore(value);
    // weightSum can only be 0 if every weight in config is 0 on the available
    // signals; guard anyway so a pathological config can't emit NaN.
    score += weightSum > 0 ? (weight / weightSum) * value : 0;
  }

  if (input.deranked) score *= config.penalties.deranked;
  if (input.abandoned === true) score *= config.penalties.abandoned;

  return { score: roundScore(clamp01(score)), components };
}

/** Stable rounding keeps emitted JSON deterministic across platforms. */
function roundScore(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

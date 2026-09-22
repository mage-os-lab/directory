import type { RankingConfig } from '../schema/ranking-config.js';

/** The inputs the ranker needs per package — a slice of the merged record. */
export interface RankingInput {
  editorialPick: boolean;
  partnerTier: keyof RankingConfig['partnerTierValues'] | null;
  trustedVendor: boolean;
  /** Null = PM hasn't tested the package; the quality signal is omitted. */
  qualityTier: keyof RankingConfig['qualityTierValues'] | null;
  latestReleasedAt: string | null;
  installs: number | null;
  githubStars: number | null;
  /** Packagist download counters; null when the package has none this run. */
  downloads: DownloadCounters | null;
  deranked: boolean;
  abandoned: boolean | null;
}

/** The slice of a Packagist stats entry the trend signals read. */
export interface DownloadCounters {
  total: number;
  monthly: number;
  /** YYYY-MM-DD; null means the lifetime average (and so momentum) is unknowable. */
  createdAt: string | null;
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

/** Median of the positive values, or null when there are none. */
function medianOf(values: Array<number | null>): number | null {
  return percentileOf(values, 0.5);
}

const DAYS_PER_MONTH = 365.25 / 12;

/**
 * How a package's last 30 days compare with its lifetime monthly average:
 * `(monthly + k) / (lifetimeAverage + k)`, where k (the corpus median monthly
 * count) keeps 3 → 30 downloads from reading as a tenfold surge. Age is
 * floored at one month so a package Packagist met last week lands near 1
 * (neutral) rather than somewhere absurd. Null when the age is unknown.
 *
 * This is the raw ratio; rankPackage maps it onto 0..1 relative to the
 * corpus median, because ecosystem-wide download growth makes ~1.8 the
 * typical value and only the deviation from typical is signal.
 */
export function momentumRatio(
  downloads: DownloadCounters,
  now: Date,
  smoothing: number,
): number | null {
  if (downloads.createdAt === null) return null;
  const created = Date.parse(`${downloads.createdAt}T00:00:00.000Z`);
  if (Number.isNaN(created)) return null;
  const ageMonths = Math.max(1, (now.getTime() - created) / 86_400_000 / DAYS_PER_MONTH);
  const lifetimeAverage = downloads.total / ageMonths;
  const k = Math.max(0, smoothing);
  const denominator = lifetimeAverage + k;
  if (denominator <= 0) return null;
  return (downloads.monthly + k) / denominator;
}

/**
 * Momentum on the 0..1 scale the ranker and the "Trending" mark share: the
 * corpus median scores 0.5, `ceiling` times the median scores 1, and a
 * `ceiling`th of the median scores 0 — log-symmetric, so halving and
 * doubling are the same distance from typical.
 */
export function normalizeMomentum(ratio: number, median: number, ceiling: number): number {
  if (ratio <= 0 || median <= 0) return 0;
  return clamp01(0.5 + 0.5 * (Math.log(ratio / median) / Math.log(ceiling)));
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
  /** Monthly downloads at the popularity percentile. */
  recentInstallsScale: number | null;
  /** Corpus median monthly downloads — the momentum ratio's smoothing term. */
  monthlyMedian: number | null;
  /** Corpus median momentum ratio — what "typical growth" means this run. */
  momentumMedian: number | null;
}

export function buildRankingContext(
  packages: Array<Pick<RankingInput, 'installs' | 'githubStars' | 'downloads'>>,
  config: RankingConfig,
  now: Date,
): RankingContext {
  const monthly = packages.map((p) => p.downloads?.monthly ?? null);
  const monthlyMedian = medianOf(monthly);
  const ratios =
    monthlyMedian === null
      ? []
      : packages.map((p) =>
          p.downloads === null ? null : momentumRatio(p.downloads, now, monthlyMedian),
        );
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
    recentInstallsScale: percentileOf(monthly, config.popularityPercentile),
    monthlyMedian,
    momentumMedian: medianOf(ratios),
  };
}

/**
 * A package's momentum on the shared 0..1 scale, or null when the package
 * has no counters, no creation date, or the corpus has no usable median.
 * Published in the feed as `activity.momentum` and used as the momentum
 * ranking signal, so the "Trending" mark and the ranking agree.
 */
export function packageMomentum(
  downloads: DownloadCounters | null,
  config: RankingConfig,
  context: RankingContext,
): number | null {
  if (downloads === null || context.monthlyMedian === null || context.momentumMedian === null) {
    return null;
  }
  const ratio = momentumRatio(downloads, context.now, context.monthlyMedian);
  if (ratio === null) return null;
  return normalizeMomentum(ratio, context.momentumMedian, config.momentumCeiling);
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
  const momentum = packageMomentum(input.downloads, config, context);
  // Every signal is either [weight, value 0..1] or null (unavailable).
  const signals: Record<string, [number, number] | null> = {
    editorialPick: [weights.editorialPick, input.editorialPick ? 1 : 0],
    partnerTier: [
      weights.partnerTier,
      input.partnerTier === null ? 0 : (config.partnerTierValues[input.partnerTier] ?? 0),
    ],
    trustedVendor: [weights.trustedVendor, input.trustedVendor ? 1 : 0],
    qualityTier:
      input.qualityTier === null
        ? null
        : [weights.qualityTier, clamp01(config.qualityTierValues[input.qualityTier] ?? 0)],
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
    recentInstalls:
      input.downloads === null || context.recentInstallsScale === null
        ? null
        : [
            weights.recentInstalls,
            logNormalize(input.downloads.monthly, context.recentInstallsScale),
          ],
    momentum: momentum === null ? null : [weights.momentum, momentum],
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

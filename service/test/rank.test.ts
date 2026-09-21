import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  buildRankingContext,
  momentumRatio,
  normalizeMomentum,
  percentileOf,
  rankPackage,
} from '../src/pipeline/rank.js';
import type { DownloadCounters, RankingInput } from '../src/pipeline/rank.js';
import { rankingConfig, type RankingConfig } from '../src/schema/ranking-config.js';
import { loadRankingConfig } from '../src/pipeline/load.js';

const config: RankingConfig = rankingConfig.parse({
  version: 'test-1',
  weights: {
    editorialPick: 0.2,
    partnerTier: 0.1,
    trustedVendor: 0.1,
    qualityTier: 0.2,
    freshness: 0.15,
    installs: 0.06,
    recentInstalls: 0.07,
    momentum: 0.04,
    stars: 0.08,
  },
  qualityTierValues: {
    'strict-compliant': 1.0,
    'no-errors': 0.8,
    'ready-to-install': 0.5,
    'needs-help': 0.15,
  },
  partnerTierValues: { platinum: 1.0, gold: 0.8, silver: 0.6, bronze: 0.4 },
  freshnessHalfLifeDays: 180,
  popularityPercentile: 0.95,
  momentumCeiling: 4,
  penalties: { deranked: 0.3, abandoned: 0.1 },
});

const now = new Date('2026-07-01T00:00:00.000Z');

const base: RankingInput = {
  editorialPick: false,
  partnerTier: null,
  trustedVendor: false,
  qualityTier: 'no-errors',
  latestReleasedAt: '2026-06-01T00:00:00.000Z',
  installs: 1000,
  githubStars: 100,
  downloads: { total: 6000, monthly: 200, createdAt: '2024-07-01' },
  deranked: false,
  abandoned: null,
};

const context = buildRankingContext(
  [
    { installs: 100, githubStars: 10, downloads: { total: 600, monthly: 20, createdAt: '2024-07-01' } },
    { installs: 1000, githubStars: 100, downloads: { total: 6000, monthly: 200, createdAt: '2024-07-01' } },
    {
      installs: 10000,
      githubStars: 1000,
      downloads: { total: 60_000, monthly: 2000, createdAt: '2024-07-01' },
    },
  ],
  config,
  now,
);

describe('rankingConfig schema', () => {
  it('rejects weights that do not sum to 1', () => {
    expect(() =>
      rankingConfig.parse({
        ...JSON.parse(JSON.stringify(config)),
        weights: { ...config.weights, stars: 0.5 },
      }),
    ).toThrow(/sum to 1/);
  });
});

describe('percentileOf', () => {
  it('ignores nulls and zeros', () => {
    expect(percentileOf([null, 0, 10, 20, 30], 0.95)).toBe(30);
  });
  it('returns null for an all-null corpus', () => {
    expect(percentileOf([null, null], 0.95)).toBeNull();
  });
  it('returns null for an all-zero corpus (degenerate scale)', () => {
    expect(percentileOf([0, 0, 0], 0.95)).toBeNull();
  });
});

describe('rankPackage', () => {
  it('produces a score in [0, 1] with all components present', () => {
    const result = rankPackage(base, config, context);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(Object.keys(result.components).sort()).toEqual([
      'editorialPick',
      'freshness',
      'installs',
      'momentum',
      'partnerTier',
      'qualityTier',
      'recentInstalls',
      'stars',
      'trustedVendor',
    ]);
  });

  it('a perfect package scores 1', () => {
    const result = rankPackage(
      {
        editorialPick: true,
        partnerTier: 'platinum',
        trustedVendor: true,
        qualityTier: 'strict-compliant',
        latestReleasedAt: now.toISOString(),
        installs: 1_000_000,
        githubStars: 1_000_000,
        downloads: { total: 1_000_000, monthly: 1_000_000, createdAt: '2024-07-01' },
        deranked: false,
        abandoned: false,
      },
      config,
      context,
    );
    expect(result.score).toBe(1);
  });

  it('omits unavailable signals and renormalizes weights instead of scoring zero', () => {
    const withNulls = rankPackage(
      { ...base, installs: null, githubStars: null, downloads: null, latestReleasedAt: null },
      config,
      context,
    );
    expect(withNulls.components).not.toHaveProperty('installs');
    expect(withNulls.components).not.toHaveProperty('stars');
    expect(withNulls.components).not.toHaveProperty('freshness');
    // Same trust/quality inputs, missing popularity data: score must not crater.
    const scoreAllSignals = rankPackage(base, config, context).score;
    expect(withNulls.score).toBeGreaterThan(scoreAllSignals * 0.5);
  });

  it('omits the quality signal for untested packages (tier null) instead of zeroing it', () => {
    const untested = rankPackage({ ...base, qualityTier: null }, config, context);
    expect(untested.components).not.toHaveProperty('qualityTier');
    // An untested package must score better than one that tested badly.
    const needsHelp = rankPackage({ ...base, qualityTier: 'needs-help' }, config, context);
    expect(untested.score).toBeGreaterThan(needsHelp.score);
  });

  it('treats a degenerate corpus scale as signal-unavailable, not divide-by-zero', () => {
    const degenerate = buildRankingContext(
      [{ installs: null, githubStars: null, downloads: null }],
      config,
      now,
    );
    const result = rankPackage(base, config, degenerate);
    expect(result.components).not.toHaveProperty('installs');
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it('clamps freshness for future-dated releases', () => {
    const result = rankPackage(
      { ...base, latestReleasedAt: '2030-01-01T00:00:00.000Z' },
      config,
      context,
    );
    expect(result.components['freshness']).toBe(1);
  });

  it('applies derank and abandoned penalties multiplicatively', () => {
    const clean = rankPackage(base, config, context).score;
    const deranked = rankPackage({ ...base, deranked: true }, config, context).score;
    const both = rankPackage({ ...base, deranked: true, abandoned: true }, config, context).score;
    expect(deranked).toBeCloseTo(clean * 0.3, 5);
    expect(both).toBeCloseTo(clean * 0.3 * 0.1, 5);
  });

  it('null abandoned is treated as false (no penalty)', () => {
    const nullFlag = rankPackage({ ...base, abandoned: null }, config, context).score;
    const falseFlag = rankPackage({ ...base, abandoned: false }, config, context).score;
    expect(nullFlag).toBe(falseFlag);
  });
});

/** A counter set whose lifetime average is `monthly / growth`. */
function counters(monthly: number, growth: number, ageMonths: number): DownloadCounters {
  const created = new Date(now.getTime() - ageMonths * 30.4375 * 86_400_000);
  return {
    total: Math.round((monthly / growth) * ageMonths),
    monthly,
    createdAt: created.toISOString().slice(0, 10),
  };
}

describe('momentumRatio', () => {
  it('floors age at one month, so a package Packagist met last week reads as neutral', () => {
    const week = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
    const ratio = momentumRatio({ total: 400, monthly: 400, createdAt: week }, now, 0);
    // Every download it has arrived in the last 30 days; without the floor a
    // one-week-old package would look like a fourfold surge.
    expect(ratio).toBeCloseTo(1, 5);
  });

  it('reads a real surge as a ratio above 1 and a decline as one below', () => {
    // Day-granular creation dates make the age approximate; the ratio is not.
    expect(momentumRatio(counters(3000, 3, 24), now, 0)!).toBeCloseTo(3, 2);
    expect(momentumRatio(counters(500, 0.5, 24), now, 0)!).toBeCloseTo(0.5, 2);
  });

  it('smoothing pulls small numbers back towards typical', () => {
    // 3 downloads a month becoming 30 is not a tenfold story worth telling.
    const raw = momentumRatio({ total: 36, monthly: 30, createdAt: '2025-07-01' }, now, 0)!;
    const smoothed = momentumRatio({ total: 36, monthly: 30, createdAt: '2025-07-01' }, now, 200)!;
    expect(raw).toBeGreaterThan(9);
    expect(smoothed).toBeLessThan(1.2);
    expect(smoothed).toBeGreaterThan(1);
  });

  it('is null when Packagist did not say when it met the package', () => {
    expect(momentumRatio({ total: 1000, monthly: 100, createdAt: null }, now, 0)).toBeNull();
  });
});

describe('normalizeMomentum', () => {
  it('puts the corpus median at the middle of the scale', () => {
    expect(normalizeMomentum(1.8, 1.8, 4)).toBeCloseTo(0.5, 6);
  });

  it('puts the ceiling above and below the median at the ends', () => {
    expect(normalizeMomentum(1.8 * 4, 1.8, 4)).toBeCloseTo(1, 6);
    expect(normalizeMomentum(1.8 / 4, 1.8, 4)).toBeCloseTo(0, 6);
  });

  it('clamps beyond the ceiling instead of running off the scale', () => {
    expect(normalizeMomentum(1000, 1.8, 4)).toBe(1);
    expect(normalizeMomentum(0.0001, 1.8, 4)).toBe(0);
    expect(normalizeMomentum(0, 1.8, 4)).toBe(0);
  });
});

describe('buildRankingContext trend scales', () => {
  it('computes the monthly median and the median momentum ratio of the corpus', () => {
    const built = buildRankingContext(
      [
        { installs: null, githubStars: null, downloads: counters(100, 1, 24) },
        { installs: null, githubStars: null, downloads: counters(200, 2, 24) },
        { installs: null, githubStars: null, downloads: counters(300, 3, 24) },
      ],
      config,
      now,
    );
    expect(built.monthlyMedian).toBe(200);
    expect(built.recentInstallsScale).toBe(300);
    // Smoothed by the 200/month median, so the raw 1/2/3 ratios compress.
    expect(built.momentumMedian).not.toBeNull();
    expect(built.momentumMedian!).toBeGreaterThan(1);
    expect(built.momentumMedian!).toBeLessThan(2);
  });

  it('leaves the trend scales null when no package reports downloads', () => {
    const built = buildRankingContext(
      [{ installs: 10, githubStars: 1, downloads: null }],
      config,
      now,
    );
    expect(built.monthlyMedian).toBeNull();
    expect(built.momentumMedian).toBeNull();
    expect(built.recentInstallsScale).toBeNull();
  });
});

describe('trend signals in rankPackage', () => {
  it('emits both trend components when the package has counters', () => {
    const result = rankPackage(base, config, context);
    expect(result.components['recentInstalls']).toBeGreaterThan(0);
    expect(result.components['momentum']).toBeDefined();
  });

  it('omits both and renormalizes when Packagist had nothing', () => {
    const without = rankPackage({ ...base, downloads: null }, config, context);
    expect(without.components).not.toHaveProperty('recentInstalls');
    expect(without.components).not.toHaveProperty('momentum');
    expect(without.score).toBeGreaterThan(rankPackage(base, config, context).score * 0.5);
  });

  it('omits momentum alone when the creation date is unknown', () => {
    const undated = rankPackage(
      { ...base, downloads: { total: 6000, monthly: 200, createdAt: null } },
      config,
      context,
    );
    expect(undated.components['recentInstalls']).toBeDefined();
    expect(undated.components).not.toHaveProperty('momentum');
  });
});

describe('the point of the trend signals, under the shipped config', () => {
  const shipped = loadRankingConfig(path.join(__dirname, '..', 'data'));

  /** Same everything, bar age and download history. */
  const contender = (downloads: DownloadCounters, installs: number): RankingInput => ({
    editorialPick: false,
    partnerTier: null,
    trustedVendor: false,
    qualityTier: 'no-errors',
    latestReleasedAt: '2026-06-01T00:00:00.000Z',
    installs,
    githubStars: 100,
    downloads,
    deranked: false,
    abandoned: null,
  });

  it('lets a young module with today\u2019s adoption stand beside a coasting veteran', () => {
    // Both are downloaded 3,000 times a month right now. The veteran has
    // eight flat years behind it; the newcomer has six months and is growing.
    const veteran = contender(counters(3000, 1, 96), 288_000);
    const newcomer = contender(counters(3000, 3, 6), 6_000);
    // The lifetime totals are fifty-fold apart — the gap lifetime installs
    // alone would turn into a ranking chasm.
    expect(veteran.downloads!.total / newcomer.downloads!.total).toBeGreaterThan(40);

    const corpus = [
      veteran,
      newcomer,
      contender(counters(500, 1, 36), 18_000),
      contender(counters(50, 1, 36), 1_800),
      contender(counters(9000, 1.2, 60), 540_000),
    ];
    const shippedContext = buildRankingContext(corpus, shipped, now);

    const veteranScore = rankPackage(veteran, shipped, shippedContext).score;
    const newcomerScore = rankPackage(newcomer, shipped, shippedContext).score;
    expect(Math.abs(veteranScore - newcomerScore)).toBeLessThan(0.1);
  });
});

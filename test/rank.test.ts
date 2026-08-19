import { describe, expect, it } from 'vitest';
import { buildRankingContext, percentileOf, rankPackage } from '../src/pipeline/rank.js';
import type { RankingInput } from '../src/pipeline/rank.js';
import { rankingConfig, type RankingConfig } from '../src/schema/ranking-config.js';

const config: RankingConfig = rankingConfig.parse({
  version: 'test-1',
  weights: {
    editorialPick: 0.2,
    partnerTier: 0.1,
    trustedVendor: 0.1,
    qualityTier: 0.25,
    freshness: 0.15,
    installs: 0.12,
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
  deranked: false,
  abandoned: null,
};

const context = buildRankingContext(
  [
    { installs: 100, githubStars: 10 },
    { installs: 1000, githubStars: 100 },
    { installs: 10000, githubStars: 1000 },
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
      'partnerTier',
      'qualityTier',
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
      { ...base, installs: null, githubStars: null, latestReleasedAt: null },
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

  it('treats a degenerate corpus scale as signal-unavailable, not divide-by-zero', () => {
    const degenerate = buildRankingContext(
      [{ installs: null, githubStars: null }],
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

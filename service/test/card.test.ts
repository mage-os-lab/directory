import { describe, expect, it } from 'vitest';
import {
  installsAtPercentile,
  installsLabel,
  isHighQuality,
  isRecent,
  isRisky,
  latestMagentoVersion,
  magentoRange,
  releasedAgo,
} from '../src/ui/DirectoryBrowser.js';
import type { PackageSummary } from '../src/ui/types.js';

const NOW = Date.parse('2026-07-01T00:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

const pkg = (over: Partial<PackageSummary>): PackageSummary =>
  ({
    supportedMagento: [],
    abandoned: null,
    trust: { warnings: [] },
    ...over,
  }) as PackageSummary;

describe('magentoRange', () => {
  it('spans the tested versions lowest to highest, whatever order the feed used', () => {
    expect(magentoRange(pkg({ supportedMagento: ['2.4.7', '2.4.5', '2.4.6'] }))).toBe('2.4.5–2.4.7');
  });

  it('collapses a single tested version instead of showing a range of one', () => {
    expect(magentoRange(pkg({ supportedMagento: ['2.4.7'] }))).toBe('2.4.7');
  });

  it('says nothing rather than inventing a range with no test results', () => {
    expect(magentoRange(pkg({ supportedMagento: [] }))).toBeNull();
  });
});

describe('releasedAgo', () => {
  it('reads in the units a person would use', () => {
    expect(releasedAgo(daysAgo(2), NOW)).toBe('updated this week');
    expect(releasedAgo(daysAgo(14), NOW)).toBe('updated 2 weeks ago');
    expect(releasedAgo(daysAgo(95), NOW)).toBe('updated 3 months ago');
    expect(releasedAgo(daysAgo(364), NOW)).toBe('updated 11 months ago');
    expect(releasedAgo(daysAgo(400), NOW)).toBe('updated 1 year ago');
    expect(releasedAgo(daysAgo(900), NOW)).toBe('updated 2 years ago');
  });

  it('stays quiet on a missing, unparseable or future date', () => {
    expect(releasedAgo(null, NOW)).toBeNull();
    expect(releasedAgo('whenever', NOW)).toBeNull();
    expect(releasedAgo(daysAgo(-5), NOW)).toBeNull();
  });
});

describe('installsLabel', () => {
  it('shows scale, not accounting', () => {
    expect(installsLabel(0)).toBe('0');
    expect(installsLabel(940)).toBe('940');
    expect(installsLabel(1000)).toBe('1k');
    expect(installsLabel(8700)).toBe('8.7k');
    expect(installsLabel(9847)).toBe('9.8k');
    expect(installsLabel(25_400)).toBe('25k');
  });
});

describe('isRisky', () => {
  it('is true for abandonment or any warning, and false otherwise', () => {
    expect(isRisky(pkg({}))).toBe(false);
    expect(isRisky(pkg({ abandoned: true }))).toBe(true);
    expect(
      isRisky(
        pkg({
          trust: {
            trustedVendor: false,
            partnerTier: null,
            editorialPick: false,
            warnings: [
              { code: 'unmaintained', severity: 'info', message: 'No release since 2023.', date: '2026-05-01' },
            ],
            deranked: false,
            hidden: false,
          },
        }),
      ),
    ).toBe(true);
  });
});

describe('isRecent', () => {
  it('counts a release inside the last year, and nothing older or unknown', () => {
    expect(isRecent(pkg({ latestReleasedAt: daysAgo(30) }), NOW)).toBe(true);
    expect(isRecent(pkg({ latestReleasedAt: daysAgo(364) }), NOW)).toBe(true);
    expect(isRecent(pkg({ latestReleasedAt: daysAgo(400) }), NOW)).toBe(false);
    expect(isRecent(pkg({ latestReleasedAt: null }), NOW)).toBe(false);
    expect(isRecent(pkg({ latestReleasedAt: 'whenever' }), NOW)).toBe(false);
  });
});

describe('isHighQuality', () => {
  it('is the top two PackageMaven tiers only', () => {
    const tier = (t: string | null) => pkg({ quality: { tier: t } as PackageSummary['quality'] });
    expect(isHighQuality(tier('strict-compliant'))).toBe(true);
    expect(isHighQuality(tier('no-errors'))).toBe(true);
    expect(isHighQuality(tier('ready-to-install'))).toBe(false);
    expect(isHighQuality(tier('needs-help'))).toBe(false);
    expect(isHighQuality(tier(null))).toBe(false);
  });
});

describe('latestMagentoVersion', () => {
  it('is the newest version anything was verified against, by numeric order', () => {
    expect(
      latestMagentoVersion([
        pkg({ supportedMagento: ['2.4.10', '2.4.6'] }),
        pkg({ supportedMagento: ['2.4.9'] }),
        pkg({ supportedMagento: [] }),
      ]),
    ).toBe('2.4.10');
  });

  it('is null when nothing has been tested', () => {
    expect(latestMagentoVersion([pkg({ supportedMagento: [] })])).toBeNull();
  });
});

describe('installsAtPercentile', () => {
  const withInstalls = (installs: number | null) =>
    pkg({ popularity: { installs, githubStars: null } });

  it('is the nearest-rank percentile of packages that report installs', () => {
    const packages = [10, 20, 30, 40, 50, 60, 70, 80, null, 0].map(withInstalls);
    expect(installsAtPercentile(packages, 0.75)).toBe(60);
    expect(installsAtPercentile(packages, 0.5)).toBe(40);
  });

  it('declines to call anything popular in a corpus too small to rank', () => {
    expect(installsAtPercentile([10, 20, 30].map(withInstalls), 0.75)).toBeNull();
  });
});

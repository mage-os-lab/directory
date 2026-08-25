import { describe, expect, it } from 'vitest';
import {
  installsLabel,
  isRisky,
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

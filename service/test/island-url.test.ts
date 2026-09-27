import { describe, expect, it } from 'vitest';
import { filtersFromSearch, searchFromFilters } from '../src/site/components/SearchIsland.js';

describe('filter state in the URL', () => {
  it('reads every filter the site mirrors, and ignores what it does not know', () => {
    expect(
      filtersFromSearch(
        '?q=stripe&category=checkout-payments&only=picks,tested,bogus&sort=installs&x=1',
      ),
    ).toEqual({
      query: 'stripe',
      category: 'checkout-payments',
      sort: 'installs',
      flags: ['picks', 'tested'],
    });
    expect(filtersFromSearch('?sort=whatever&only=nope')).toBeUndefined();
    // The trusted-vendor chip is gone; an old link that asks for it is not an error.
    expect(filtersFromSearch('?only=trusted')).toBeUndefined();
    expect(filtersFromSearch('')).toBeUndefined();
  });

  it('writes only what narrows the list, so the bare URL stays bare', () => {
    expect(searchFromFilters({})).toBe('');
    expect(searchFromFilters({ sort: 'recommended' })).toBe('');
    expect(
      searchFromFilters({ query: 'a b', category: 'seo-urls', flags: ['picks', 'recent'], sort: 'name' }),
    ).toBe('?q=a+b&category=seo-urls&only=picks%2Crecent&sort=name');
  });

  it("follows a category slug from before PackageMaven's taxonomy to its replacement", () => {
    expect(filtersFromSearch('?category=seo')).toEqual({ category: 'seo-urls' });
    expect(filtersFromSearch('?category=other')).toEqual({ category: 'miscellaneous' });
    // A current slug, or one nobody knows, passes through untouched.
    expect(filtersFromSearch('?category=search')).toEqual({ category: 'search' });
    expect(filtersFromSearch('?category=toString')).toEqual({ category: 'toString' });
  });

  it('round-trips', () => {
    const filters = { query: 'x', category: 'catalog-management', flags: ['quality' as const], sort: 'stars' as const };
    expect(filtersFromSearch(searchFromFilters(filters))).toEqual(filters);
  });
});

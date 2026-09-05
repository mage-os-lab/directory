import { describe, expect, it } from 'vitest';
import { filtersFromSearch, searchFromFilters } from '../src/site/components/SearchIsland.js';

describe('filter state in the URL', () => {
  it('reads every filter the site mirrors, and ignores what it does not know', () => {
    expect(
      filtersFromSearch('?q=stripe&category=payments&only=trusted,tested,bogus&sort=installs&x=1'),
    ).toEqual({
      query: 'stripe',
      category: 'payments',
      sort: 'installs',
      flags: ['trusted', 'tested'],
    });
    expect(filtersFromSearch('?sort=whatever&only=nope')).toBeUndefined();
    expect(filtersFromSearch('')).toBeUndefined();
  });

  it('writes only what narrows the list, so the bare URL stays bare', () => {
    expect(searchFromFilters({})).toBe('');
    expect(searchFromFilters({ sort: 'recommended' })).toBe('');
    expect(
      searchFromFilters({ query: 'a b', category: 'seo', flags: ['picks', 'recent'], sort: 'name' }),
    ).toBe('?q=a+b&category=seo&only=picks%2Crecent&sort=name');
  });

  it('round-trips', () => {
    const filters = { query: 'x', category: 'catalog', flags: ['quality' as const], sort: 'stars' as const };
    expect(filtersFromSearch(searchFromFilters(filters))).toEqual(filters);
  });
});

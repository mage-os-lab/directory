/**
 * Astro island wrapper around the pure Preact DirectoryBrowser (src/ui/).
 * Fetches /api/v1/feed.json client-side (the Astro pages only touch the
 * feed at build time via node:fs; the browser always gets it fresh),
 * shows loading/error states, and mounts DirectoryBrowser with
 * linkMode 'href' + the site's own base path (usually '', but fallback
 * hosts can serve from a subpath) since the site owns full-page navigation.
 *
 * The URL is the filter state: ?q=, ?category=, ?sort= and ?only= (comma
 * separated flags) seed the browser, and every change is mirrored back with
 * replaceState so a filtered view is a link someone can share — and so the
 * old /categories/<slug>/ pages can simply redirect here.
 */
import { useEffect, useState } from 'preact/hooks';
import { DirectoryBrowser } from '../../ui/DirectoryBrowser.js';
import type { DirectoryFilters, Feed, FilterFlag, SortKey } from '../../ui/types.js';
import { withBase } from '../lib/base.js';
import '../../ui/directory.css';

const FLAGS: ReadonlySet<string> = new Set<FilterFlag>([
  'trusted',
  'picks',
  'tested',
  'recent',
  'quality',
  'popular',
]);
const SORTS: ReadonlySet<string> = new Set<SortKey>([
  'recommended',
  'installs',
  'stars',
  'recency',
  'name',
]);

/** Filters from a query string; unknown values are dropped, never thrown. */
export function filtersFromSearch(search: string): DirectoryFilters | undefined {
  const params = new URLSearchParams(search);
  const filters: DirectoryFilters = {};
  const category = params.get('category');
  const query = params.get('q');
  const sort = params.get('sort');
  const only = (params.get('only') ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter((f): f is FilterFlag => FLAGS.has(f));
  if (category) filters.category = category;
  if (query) filters.query = query;
  if (sort && SORTS.has(sort)) filters.sort = sort as SortKey;
  if (only.length > 0) filters.flags = only;
  return Object.keys(filters).length > 0 ? filters : undefined;
}

/** The query string for a filter state — empty when nothing is narrowed. */
export function searchFromFilters(filters: DirectoryFilters): string {
  const params = new URLSearchParams();
  if (filters.query) params.set('q', filters.query);
  if (filters.category) params.set('category', filters.category);
  if (filters.flags && filters.flags.length > 0) params.set('only', filters.flags.join(','));
  if (filters.sort && filters.sort !== 'recommended') params.set('sort', filters.sort);
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

function initialFiltersFromLocation(): DirectoryFilters | undefined {
  if (typeof window === 'undefined') return undefined;
  return filtersFromSearch(window.location.search);
}

function mirrorToLocation(filters: DirectoryFilters): void {
  if (typeof window === 'undefined') return;
  const next = `${window.location.pathname}${searchFromFilters(filters)}${window.location.hash}`;
  window.history.replaceState(window.history.state, '', next);
}

export function SearchIsland() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [initialFilters] = useState(initialFiltersFromLocation);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch(withBase('/api/v1/feed.json'))
      .then(async (response) => {
        if (!response.ok) throw new Error(`feed fetch failed: HTTP ${response.status}`);
        return (await response.json()) as Feed;
      })
      .then((data) => {
        if (!cancelled) setFeed(data);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (error !== null) {
    return (
      <div class="mosd-browser">
        <p class="mosd-error">
          Could not load the module directory ({error}).
          <button type="button" onClick={() => setAttempt(attempt + 1)}>
            Retry
          </button>
        </p>
      </div>
    );
  }

  if (feed === null) {
    return (
      <div class="mosd-browser">
        <p class="mosd-loading">Loading module directory…</p>
      </div>
    );
  }

  return (
    <DirectoryBrowser
      feed={feed}
      linkMode="href"
      baseUrl={withBase('')}
      initialFilters={initialFilters}
      onFiltersChange={mirrorToLocation}
    />
  );
}

export default SearchIsland;

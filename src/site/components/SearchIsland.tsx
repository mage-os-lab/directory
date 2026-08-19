/**
 * Astro island wrapper around the pure Preact DirectoryBrowser (src/ui/).
 * Fetches /api/v1/feed.json client-side (the Astro pages only touch the
 * feed at build time via node:fs; the browser always gets it fresh),
 * shows loading/error states, and mounts DirectoryBrowser with
 * linkMode 'href' + the site's own base path (usually '', but fallback
 * hosts can serve from a subpath) since the site owns full-page navigation.
 *
 * Reads ?category= and ?q= from the current URL as initial filters so
 * links like /?category=payments (from a category page's "search within
 * this category") land pre-filtered.
 */
import { useEffect, useState } from 'preact/hooks';
import { DirectoryBrowser } from '../../ui/DirectoryBrowser.js';
import type { DirectoryFilters, Feed } from '../../ui/types.js';
import { withBase } from '../lib/base.js';
import '../../ui/directory.css';

function initialFiltersFromLocation(): DirectoryFilters | undefined {
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  const category = params.get('category') ?? undefined;
  const query = params.get('q') ?? undefined;
  if (!category && !query) return undefined;
  const filters: DirectoryFilters = {};
  if (category) filters.category = category;
  if (query) filters.query = query;
  return filters;
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
    />
  );
}

export default SearchIsland;

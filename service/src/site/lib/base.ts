/**
 * Base-path-aware URL helper for the site's own pages and islands.
 *
 * The canonical deploy serves from the domain root (base '/'), but fallback
 * hosts can serve from a subpath (GitHub Pages project sites live at
 * /<repo>/). Astro inlines import.meta.env.BASE_URL into both frontmatter
 * and island code at build time, so this works in either context — and,
 * unlike lib/data.ts, it has no node-only imports and is safe to ship to
 * the browser.
 */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path}`;
}

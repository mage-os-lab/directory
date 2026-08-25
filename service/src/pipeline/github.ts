import type { GithubExtras } from './merge.js';
import { openHttpCache, type HttpCache } from './http-cache.js';
import { sanitizeReadme } from './readme.js';

/**
 * GitHub READMEs + stars — presentation extras, failure-tolerant by design.
 *
 * READMEs come from the REST readme endpoint with the `html` media type
 * (GitHub renders GFM; we sanitize — see readme.ts), fetched with
 * ETag-conditional requests against a cache that `actions/cache` carries
 * between runs. Stars come from batched GraphQL queries.
 *
 * Nothing here throws: a missing token, a rate-limit wall, a 404, or GitHub
 * being down all degrade to null READMEs/stars for the affected packages
 * (PackageMaven's own star count still fills in via merge.ts), the `github`
 * source is reported as not-ok in the feed, and the build completes.
 */

export const DEFAULT_GITHUB_API_URL = 'https://api.github.com';
const USER_AGENT = 'mage-os-extension-directory-pipeline (github.com/rhoerr/mage-os.directory)';
const API_VERSION = '2022-11-28';
/** Repos fetched in parallel. Well under GitHub's concurrency guidance, and
 * enough to keep a cold ~1100-repo run in the low minutes. */
const README_CONCURRENCY = 8;
/** Repos per GraphQL query; ~1100 packages is then ~22 cheap queries. */
const STARS_BATCH_SIZE = 50;

export interface GithubPackageRef {
  name: string;
  repositoryUrl: string | null;
}

export interface GithubFetchOptions {
  packages: GithubPackageRef[];
  /** No token → the whole step is skipped (60 req/hr doesn't fit the corpus). */
  token: string | undefined;
  /** Directory for the persisted ETag cache; null disables caching. */
  cacheDir?: string | null;
  now: Date;
  fetchImpl?: typeof fetch;
  apiUrl?: string;
  concurrency?: number;
}

export interface GithubFetchResult {
  extras: Map<string, GithubExtras>;
  ok: boolean;
  fetchedAt: string | null;
  warnings: string[];
}

/** The disabled state: fixture builds and any run without a token. */
export function disabledGithubExtras(): GithubFetchResult {
  return { extras: new Map(), ok: false, fetchedAt: null, warnings: [] };
}

interface RepoRef {
  owner: string;
  repo: string;
  /** owner/repo, lowercased — the dedupe key (monorepos ship many packages). */
  key: string;
  packages: string[];
}

/** owner/repo for a GitHub repository URL, or null for anything else. */
export function parseGithubRepo(url: string | null): { owner: string; repo: string } | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') return null;

  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
  if (segments.length < 2) return null;
  const owner = segments[0]!;
  const repo = segments[1]!.replace(/\.git$/i, '');
  // Names GitHub can't have; also what keeps the GraphQL aliases below safe.
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) return null;
  return { owner, repo };
}

function groupByRepo(packages: GithubPackageRef[]): RepoRef[] {
  const byKey = new Map<string, RepoRef>();
  for (const pkg of packages) {
    const parsed = parseGithubRepo(pkg.repositoryUrl);
    if (!parsed) continue;
    const key = `${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.packages.push(pkg.name);
    } else {
      byKey.set(key, { ...parsed, key, packages: [pkg.name] });
    }
  }
  // Stable order: a rate-limited cold run always covers the same prefix, and
  // what it cached is free (304) on the next run, so coverage converges.
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key, 'en'));
}

function headers(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'x-github-api-version': API_VERSION,
    'user-agent': USER_AGENT,
    ...extra,
  };
}

function isRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  return response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0';
}

async function forEachWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (let index = next++; index < items.length; index = next++) {
      await worker(items[index]!);
    }
  });
  await Promise.all(runners);
}

interface StarsResult {
  stars: Map<string, number>;
  ok: boolean;
  warnings: string[];
}

/** Star counts for every repo, in batched GraphQL queries. */
async function fetchStars(
  repos: RepoRef[],
  token: string,
  apiUrl: string,
  fetchImpl: typeof fetch,
): Promise<StarsResult> {
  const stars = new Map<string, number>();
  const warnings: string[] = [];
  let ok = true;

  for (let start = 0; start < repos.length; start += STARS_BATCH_SIZE) {
    const batch = repos.slice(start, start + STARS_BATCH_SIZE);
    const query = `query {\n${batch
      .map(
        (repo, index) =>
          `  r${index}: repository(owner: ${JSON.stringify(repo.owner)}, name: ${JSON.stringify(
            repo.repo,
          )}) { stargazerCount }`,
      )
      .join('\n')}\n}`;

    try {
      const response = await fetchImpl(`${apiUrl}/graphql`, {
        method: 'POST',
        headers: headers(token, { 'content-type': 'application/json' }),
        body: JSON.stringify({ query }),
      });
      if (isRateLimited(response)) {
        warnings.push('GitHub GraphQL rate limit reached — star counts fall back to PackageMaven');
        return { stars, ok: false, warnings };
      }
      if (!response.ok) {
        warnings.push(`GitHub GraphQL returned HTTP ${response.status} — star counts incomplete`);
        return { stars, ok: false, warnings };
      }
      // Partial data is normal: a renamed/deleted repo nulls its own alias and
      // reports an error, while the rest of the batch is still usable.
      const body = (await response.json()) as {
        data?: Record<string, { stargazerCount?: number } | null>;
      };
      for (const [index, repo] of batch.entries()) {
        const count = body.data?.[`r${index}`]?.stargazerCount;
        if (typeof count === 'number') stars.set(repo.key, count);
      }
      if (body.data === undefined) ok = false;
    } catch (error) {
      warnings.push(
        `GitHub GraphQL request failed (${(error as Error).message}) — star counts incomplete`,
      );
      return { stars, ok: false, warnings };
    }
  }

  return { stars, ok, warnings };
}

interface ReadmeResult {
  readmes: Map<string, { html: string; sourceUrl: string }>;
  ok: boolean;
  warnings: string[];
}

async function fetchReadmes(
  repos: RepoRef[],
  token: string,
  apiUrl: string,
  fetchImpl: typeof fetch,
  cache: HttpCache,
  concurrency: number,
  now: Date,
): Promise<ReadmeResult> {
  const readmes = new Map<string, { html: string; sourceUrl: string }>();
  const counts = { missing: 0, failed: 0, unpublishable: 0, unexpectedMediaType: 0 };
  let rateLimited = false;

  await forEachWithConcurrency(repos, concurrency, async (repo) => {
    const url = `${apiUrl}/repos/${repo.owner}/${repo.repo}/readme`;
    const cached = cache.read(url);

    let raw: string | null = null;
    if (rateLimited) {
      // Out of budget: serve whatever the cache already has, ask for nothing.
      raw = cached?.body ?? null;
    } else {
      try {
        const response = await fetchImpl(url, {
          headers: headers(token, {
            accept: 'application/vnd.github.html',
            ...(cached?.etag ? { 'if-none-match': cached.etag } : {}),
          }),
        });

        if (response.status === 304) {
          raw = cached?.body ?? null;
        } else if (isRateLimited(response)) {
          rateLimited = true;
          raw = cached?.body ?? null;
        } else if (response.status === 404 || response.status === 451) {
          // No README published, or the repo is unavailable. Not a failure.
          counts.missing += 1;
        } else if (!response.ok) {
          counts.failed += 1;
          raw = cached?.body ?? null;
        } else if (response.headers.get('content-type')?.includes('json')) {
          // The html media type wasn't honored; we don't render Markdown here.
          counts.unexpectedMediaType += 1;
        } else {
          raw = await response.text();
          const etag = response.headers.get('etag');
          if (etag) {
            cache.write({ url, etag, body: raw, storedAt: now.toISOString() });
          }
        }
      } catch {
        counts.failed += 1;
        raw = cached?.body ?? null;
      }
    }

    if (raw === null) return;
    const html = sanitizeReadme(raw, repo);
    if (html === null) {
      // Empty after sanitization, or past the published-size cap.
      counts.unpublishable += 1;
      return;
    }
    readmes.set(repo.key, {
      html,
      sourceUrl: `https://github.com/${repo.owner}/${repo.repo}#readme`,
    });
  });

  const warnings: string[] = [];
  if (rateLimited) {
    warnings.push(
      `GitHub rate limit reached — ${readmes.size} of ${repos.length} repositories have a ` +
        'README this run; the rest fall back to their cached copy, and the next run resumes ' +
        'from the persisted cache',
    );
  }
  if (counts.failed > 0) {
    warnings.push(`${counts.failed} README requests failed — those packages render without one`);
  }
  if (counts.unpublishable > 0) {
    warnings.push(
      `${counts.unpublishable} READMEs were empty after sanitization or over the size cap — ` +
        'those packages render without one',
    );
  }
  if (counts.unexpectedMediaType > 0) {
    warnings.push(
      `${counts.unexpectedMediaType} README responses were not rendered HTML — ` +
        'the GitHub html media type may have changed',
    );
  }
  return { readmes, ok: !rateLimited && counts.failed === 0 && counts.unexpectedMediaType === 0, warnings };
}

export async function fetchGithubExtras(options: GithubFetchOptions): Promise<GithubFetchResult> {
  const token = options.token?.trim();
  if (!token) {
    return {
      ...disabledGithubExtras(),
      warnings: [
        'GITHUB_TOKEN is not set — READMEs and live star counts are disabled for this run',
      ],
    };
  }

  const apiUrl = (options.apiUrl?.trim() || DEFAULT_GITHUB_API_URL).replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const repos = groupByRepo(options.packages);
  const cache = openHttpCache(options.cacheDir);

  const stars = await fetchStars(repos, token, apiUrl, fetchImpl);
  const readmes = await fetchReadmes(
    repos,
    token,
    apiUrl,
    fetchImpl,
    cache,
    options.concurrency ?? README_CONCURRENCY,
    options.now,
  );
  cache.prune();

  const extras = new Map<string, GithubExtras>();
  for (const repo of repos) {
    const readme = readmes.readmes.get(repo.key) ?? null;
    for (const name of repo.packages) {
      extras.set(name, {
        readmeHtml: readme?.html ?? null,
        readmeSourceUrl: readme?.sourceUrl ?? null,
        stars: stars.stars.get(repo.key) ?? null,
      });
    }
  }

  return {
    extras,
    ok: stars.ok && readmes.ok,
    fetchedAt: options.now.toISOString(),
    warnings: [...stars.warnings, ...readmes.warnings, ...cache.problems],
  };
}

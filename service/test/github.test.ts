import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fetchGithubExtras, parseGithubRepo } from '../src/pipeline/github.js';

const tempDirs: string[] = [];
function tempCacheDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosd-http-cache-'));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const now = new Date('2026-07-01T12:00:00.000Z');
const README_HTML = '<h1>Order Export</h1><p>See <a href="docs/setup.md">setup</a>.</p>';

interface Call {
  url: string;
  headers: Record<string, string>;
}

interface StubOptions {
  readme?: (url: string) => Response;
  stars?: Response;
}

function stubFetch(options: StubOptions = {}): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    if (url.endsWith('/graphql')) {
      return (
        options.stars ??
        new Response(JSON.stringify({ data: { r0: { stargazerCount: 128 } } }), {
          headers: { 'content-type': 'application/json' },
        })
      );
    }
    return (
      options.readme?.(url) ??
      new Response(README_HTML, { headers: { 'content-type': 'text/html', etag: 'W/"abc"' } })
    );
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const packages = [
  { name: 'northware/module-order-export', repositoryUrl: 'https://github.com/northware/mage-modules' },
  // Same repository: a monorepo must cost exactly one README request.
  { name: 'northware/module-order-sync', repositoryUrl: 'https://github.com/northware/mage-modules/' },
  // Not GitHub: no extras, no request.
  { name: 'pixelforge/module-seo', repositoryUrl: 'https://gitlab.com/pixelforge/module-seo' },
];

describe('parseGithubRepo', () => {
  it('accepts the URL shapes Packagist reports', () => {
    expect(parseGithubRepo('https://github.com/Northware/Mage-Modules')).toEqual({
      owner: 'Northware',
      repo: 'Mage-Modules',
    });
    expect(parseGithubRepo('https://www.github.com/a/b.git')).toEqual({ owner: 'a', repo: 'b' });
    expect(parseGithubRepo('https://github.com/a/b/tree/main/mod')).toEqual({ owner: 'a', repo: 'b' });
  });

  it('rejects everything else', () => {
    expect(parseGithubRepo(null)).toBeNull();
    expect(parseGithubRepo('not a url')).toBeNull();
    expect(parseGithubRepo('https://gitlab.com/a/b')).toBeNull();
    expect(parseGithubRepo('https://github.com/a')).toBeNull();
    expect(parseGithubRepo('https://github.com/a/b%22')).toBeNull();
  });
});

describe('fetchGithubExtras', () => {
  it('is disabled without a token, and says so', async () => {
    const result = await fetchGithubExtras({ packages, token: undefined, now });
    expect(result.extras.size).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.fetchedAt).toBeNull();
    expect(result.warnings).toEqual([
      'GITHUB_TOKEN is not set — READMEs and live star counts are disabled for this run',
    ]);
  });

  it('fetches once per repository and applies the result to every package on it', async () => {
    const { fetchImpl, calls } = stubFetch();
    const result = await fetchGithubExtras({
      packages,
      token: 't',
      now,
      fetchImpl,
      cacheDir: null,
    });

    expect(result.ok).toBe(true);
    expect(result.fetchedAt).toBe(now.toISOString());
    expect(result.warnings).toEqual([]);
    expect(calls.filter((c) => c.url.endsWith('/readme'))).toHaveLength(1);

    const first = result.extras.get('northware/module-order-export')!;
    const second = result.extras.get('northware/module-order-sync')!;
    expect(first).toEqual(second);
    expect(first.stars).toBe(128);
    expect(first.readmeSourceUrl).toBe('https://github.com/northware/mage-modules#readme');
    // Sanitized on the way through: h1 demoted, relative link absolutized.
    expect(first.readmeHtml).toContain('<h2>Order Export</h2>');
    expect(first.readmeHtml).toContain(
      'https://github.com/northware/mage-modules/blob/HEAD/docs/setup.md',
    );
    // Non-GitHub repositories simply have no extras.
    expect(result.extras.has('pixelforge/module-seo')).toBe(false);
  });

  it('revalidates with the persisted ETag and serves the cached body on 304', async () => {
    const cacheDir = tempCacheDir();
    const cold = stubFetch();
    const first = await fetchGithubExtras({ packages, token: 't', now, fetchImpl: cold.fetchImpl, cacheDir });

    const warm = stubFetch({ readme: () => new Response(null, { status: 304 }) });
    const second = await fetchGithubExtras({
      packages,
      token: 't',
      now,
      fetchImpl: warm.fetchImpl,
      cacheDir,
    });

    const conditional = warm.calls.find((c) => c.url.endsWith('/readme'))!;
    expect(conditional.headers['if-none-match']).toBe('W/"abc"');
    expect(second.extras.get('northware/module-order-export')!.readmeHtml).toBe(
      first.extras.get('northware/module-order-export')!.readmeHtml,
    );
    expect(second.ok).toBe(true);
  });

  it('treats a missing README as normal, not a failure', async () => {
    const { fetchImpl } = stubFetch({ readme: () => new Response('', { status: 404 }) });
    const result = await fetchGithubExtras({ packages, token: 't', now, fetchImpl, cacheDir: null });
    const extras = result.extras.get('northware/module-order-export')!;
    expect(extras.readmeHtml).toBeNull();
    expect(extras.readmeSourceUrl).toBeNull();
    expect(extras.stars).toBe(128);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('stops at the rate limit, keeps what it has, and warns', async () => {
    const { fetchImpl } = stubFetch({
      readme: () =>
        new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
    });
    const result = await fetchGithubExtras({ packages, token: 't', now, fetchImpl, cacheDir: null });
    expect(result.ok).toBe(false);
    expect(result.extras.get('northware/module-order-export')!.readmeHtml).toBeNull();
    expect(result.warnings.join(' ')).toContain('rate limit reached');
  });

  it('keeps READMEs when the GraphQL star query fails', async () => {
    const { fetchImpl } = stubFetch({ stars: new Response('nope', { status: 502 }) });
    const result = await fetchGithubExtras({ packages, token: 't', now, fetchImpl, cacheDir: null });
    const extras = result.extras.get('northware/module-order-export')!;
    expect(extras.stars).toBeNull();
    expect(extras.readmeHtml).toContain('<h2>Order Export</h2>');
    expect(result.ok).toBe(false);
    expect(result.warnings).toEqual([
      'GitHub GraphQL returned HTTP 502 — star counts incomplete',
    ]);
  });

  it('does not publish a Markdown fallback when the html media type is not honored', async () => {
    const { fetchImpl } = stubFetch({
      readme: () =>
        new Response(JSON.stringify({ content: 'IyBUaXRsZQ==' }), {
          headers: { 'content-type': 'application/json; charset=utf-8' },
        }),
    });
    const result = await fetchGithubExtras({ packages, token: 't', now, fetchImpl, cacheDir: null });
    expect(result.extras.get('northware/module-order-export')!.readmeHtml).toBeNull();
    expect(result.ok).toBe(false);
    expect(result.warnings.join(' ')).toContain('not rendered HTML');
  });
});

import { describe, expect, it } from 'vitest';
import {
  CARRY_FORWARD_MAX_AGE_DAYS,
  PACKAGIST_USER_AGENT,
  fetchPackagistStats,
} from '../src/pipeline/packagist.js';
import type { PackagistSnapshot } from '../src/schema/source.js';

const now = new Date('2026-07-01T12:00:00.000Z');
const API = 'https://packagist.test';

interface Call {
  url: string;
  headers: Record<string, string>;
  /** The virtual clock reading when the request went out — what pacing shapes. */
  at: number;
}

/**
 * A virtual clock the injected sleep advances: no test here waits on real
 * time, and the pacing assertions read the same numbers the pacer computed.
 */
function harness(responder: (name: string) => Response | Error) {
  let elapsed = 0;
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, at: elapsed });
    const name = url.replace(`${API}/packages/`, '').replace('/stats.json', '');
    const outcome = responder(name);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }) as typeof fetch;
  return {
    calls,
    sleeps,
    fetchImpl,
    clock: () => elapsed,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      elapsed += ms;
    },
  };
}

const stats = (total: number, monthly: number, daily: number, date?: string) =>
  new Response(JSON.stringify({ downloads: { total, monthly, daily }, ...(date ? { date } : {}) }), {
    headers: { 'content-type': 'application/json' },
  });

const throttled = (retryAfter?: string) =>
  new Response('slow down', {
    status: 429,
    headers: retryAfter === undefined ? {} : { 'retry-after': retryAfter },
  });

const previousSnapshot = (
  entries: Array<{ name: string; monthly: number; fetchedAt: string }>,
): PackagistSnapshot => ({
  schemaVersion: 1,
  fetchedAt: entries[0]?.fetchedAt ?? now.toISOString(),
  origin: 'live',
  packages: entries.map((e) => ({
    name: e.name,
    totalDownloads: e.monthly * 10,
    monthlyDownloads: e.monthly,
    dailyDownloads: 1,
    createdAt: '2024-01-01',
    fetchedAt: e.fetchedAt,
  })),
});

/** No pacing unless the test is about pacing; everything else is instant. */
function run(
  options: Partial<Parameters<typeof fetchPackagistStats>[0]> & {
    packages: string[];
    fetchImpl: typeof fetch;
  },
) {
  return fetchPackagistStats({
    now,
    previous: null,
    apiUrl: API,
    requestsPerSecond: 0,
    concurrency: 1,
    ...options,
  });
}

describe('fetchPackagistStats', () => {
  it('parses the documented counters and creation date', async () => {
    const h = harness(() => stats(52_000, 2400, 80, '2021-04-08'));
    const result = await run({
      packages: ['acme/one'],
      fetchImpl: h.fetchImpl,
      clock: h.clock,
      sleep: h.sleep,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.snapshot.packages).toEqual([
      {
        name: 'acme/one',
        totalDownloads: 52_000,
        monthlyDownloads: 2400,
        dailyDownloads: 80,
        createdAt: '2021-04-08',
        fetchedAt: now.toISOString(),
      },
    ]);
    expect(h.calls[0]!.url).toBe(`${API}/packages/acme/one/stats.json`);
  });

  it('identifies itself with a mailto, as Packagist asks', async () => {
    const h = harness(() => stats(10, 1, 0, '2025-01-01'));
    await run({
      packages: ['acme/one'],
      fetchImpl: h.fetchImpl,
      clock: h.clock,
      sleep: h.sleep,
    });
    expect(h.calls[0]!.headers['user-agent']).toBe(PACKAGIST_USER_AGENT);
    expect(h.calls[0]!.headers['user-agent']).toContain('mailto:tech@mage-os.org');
  });

  it('omits a package Packagist does not know, without failing the step', async () => {
    const h = harness((name) =>
      name === 'acme/gone' ? new Response('nope', { status: 404 }) : stats(500, 40, 2, '2025-01-01'),
    );
    const result = await run({
      packages: ['acme/gone', 'acme/one'],
      fetchImpl: h.fetchImpl,
      clock: h.clock,
      sleep: h.sleep,
    });

    expect(result.snapshot.packages.map((p) => p.name)).toEqual(['acme/one']);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('honours Retry-After once and then succeeds', async () => {
    let first = true;
    const h = harness(() => {
      if (first) {
        first = false;
        return throttled('7');
      }
      return stats(900, 90, 3, '2025-02-02');
    });
    const result = await run({
      packages: ['acme/one'],
      fetchImpl: h.fetchImpl,
      clock: h.clock,
      sleep: h.sleep,
    });

    expect(h.sleeps).toEqual([7000]);
    expect(h.calls).toHaveLength(2);
    expect(result.ok).toBe(true);
    expect(result.snapshot.packages[0]!.monthlyDownloads).toBe(90);
  });

  it('caps an absurd Retry-After rather than sleeping out the build', async () => {
    let first = true;
    const h = harness(() => {
      if (first) {
        first = false;
        return throttled('86400');
      }
      return stats(900, 90, 3, '2025-02-02');
    });
    await run({
      packages: ['acme/one'],
      fetchImpl: h.fetchImpl,
      clock: h.clock,
      sleep: h.sleep,
    });
    expect(h.sleeps).toEqual([60_000]);
  });

  it('stops the whole step on a second throttle and carries the rest forward', async () => {
    const h = harness(() => throttled('1'));
    const result = await run({
      packages: ['acme/one', 'acme/two'],
      previous: previousSnapshot([
        { name: 'acme/two', monthly: 222, fetchedAt: '2026-06-25T00:00:00.000Z' },
      ]),
      fetchImpl: h.fetchImpl,
      clock: h.clock,
      sleep: h.sleep,
    });

    // Two attempts at the first package, then nothing: the breaker is global.
    expect(h.calls).toHaveLength(2);
    expect(result.ok).toBe(false);
    expect(result.carriedForward).toEqual(['acme/two']);
    expect(result.snapshot.packages.map((p) => p.name)).toEqual(['acme/two']);
    expect(result.snapshot.packages[0]!.monthlyDownloads).toBe(222);
    expect(result.warnings[0]).toContain('stopped early');
  });

  it('refuses to publish carried-forward counters older than the carry-forward window', async () => {
    const stale = new Date(
      now.getTime() - (CARRY_FORWARD_MAX_AGE_DAYS + 1) * 86_400_000,
    ).toISOString();
    const h = harness(() => throttled('1'));
    const result = await run({
      packages: ['acme/one', 'acme/two'],
      previous: previousSnapshot([{ name: 'acme/two', monthly: 222, fetchedAt: stale }]),
      fetchImpl: h.fetchImpl,
      clock: h.clock,
      sleep: h.sleep,
    });

    expect(result.carriedForward).toEqual([]);
    expect(result.snapshot.packages).toEqual([]);
  });

  it('counts a thrown request as failed without stopping the run', async () => {
    const h = harness((name) =>
      name === 'acme/one' ? new Error('ECONNRESET') : stats(700, 70, 2, '2025-03-03'),
    );
    const result = await run({
      packages: ['acme/one', 'acme/two'],
      fetchImpl: h.fetchImpl,
      clock: h.clock,
      sleep: h.sleep,
    });

    expect(h.calls).toHaveLength(2);
    expect(result.snapshot.packages.map((p) => p.name)).toEqual(['acme/two']);
    expect(result.ok).toBe(false);
    expect(result.warnings.join(' ')).toContain('requests failed');
    expect(result.warnings.join(' ')).not.toContain('stopped early');
  });

  it('spaces request starts by the configured rate', async () => {
    const h = harness(() => stats(100, 10, 1, '2025-01-01'));
    await run({
      packages: ['acme/one', 'acme/two', 'acme/three'],
      requestsPerSecond: 2,
      fetchImpl: h.fetchImpl,
      clock: h.clock,
      sleep: h.sleep,
    });
    expect(h.calls.map((c) => c.at)).toEqual([0, 500, 1000]);
  });

  it('trips the breaker when the request budget is spent', async () => {
    const h = harness(() => stats(100, 10, 1, '2025-01-01'));
    const result = await run({
      packages: ['acme/one', 'acme/two', 'acme/three'],
      maxRequests: 2,
      fetchImpl: h.fetchImpl,
      clock: h.clock,
      sleep: h.sleep,
    });

    expect(h.calls).toHaveLength(2);
    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain('stopped early');
    expect(result.warnings[0]).toContain('request budget');
    expect(result.snapshot.packages.map((p) => p.name)).toEqual(['acme/one', 'acme/three']);
  });

  it('trips the breaker when the time budget is spent', async () => {
    const h = harness(() => stats(100, 10, 1, '2025-01-01'));
    const result = await run({
      packages: ['acme/one', 'acme/two', 'acme/three'],
      requestsPerSecond: 1,
      maxDurationMs: 900,
      fetchImpl: h.fetchImpl,
      clock: h.clock,
      sleep: h.sleep,
    });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain('time budget');
    expect(h.calls.length).toBeLessThan(3);
  });
});

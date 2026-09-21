import { z } from 'zod';
import type { PackagistPackageStats, PackagistSnapshot } from '../schema/source.js';

/**
 * Packagist download stats — the trend signals' only input, fetched fresh
 * every run from the documented per-package stats endpoint
 * (packagist.org/apidoc, "Get package download stats"): lifetime, trailing
 * 30-day and daily counts plus the date Packagist first saw the package.
 * Total ÷ age gives the lifetime average, so momentum needs no history of
 * our own.
 *
 * Packagist publishes no numeric rate limit; its stated terms are at most
 * ten concurrent requests, no bursts, a User-Agent with a mailto, and cron
 * jobs off the hour. So this client paces itself: a global minimum gap
 * between request starts (4/s by default, ~5 minutes for the corpus), low
 * concurrency, one Retry-After-honouring retry, and a breaker that stops
 * the whole step on the second throttling response or when the run's
 * request or time budget is spent. Nothing here throws: whatever was not
 * fetched is carried forward from the previously published snapshot (when
 * the caller supplies one) or left out, and the feed marks the source.
 */

export const DEFAULT_PACKAGIST_URL = 'https://packagist.org';
export const PACKAGIST_USER_AGENT =
  'mage-os-extension-directory-pipeline (github.com/mage-os-lab/directory; mailto:tech@mage-os.org)';
/** Requests started per second, corpus-wide. */
const DEFAULT_REQUESTS_PER_SECOND = 4;
const DEFAULT_CONCURRENCY = 3;
/** Wall-clock budget for the step; the breaker trips past it. */
const DEFAULT_MAX_DURATION_MS = 8 * 60_000;
/** Requests allowed beyond one per package — headroom for retries only. */
const RETRY_HEADROOM = 0.1;
/** Longest we sleep on a Retry-After, whatever Packagist asks for. */
const MAX_RETRY_AFTER_MS = 60_000;
/** A carried-forward entry older than this is dropped rather than published. */
export const CARRY_FORWARD_MAX_AGE_DAYS = 30;

const statsResponse = z.object({
  downloads: z.object({
    total: z.number().int().min(0),
    monthly: z.number().int().min(0),
    daily: z.number().int().min(0),
  }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export interface PackagistFetchOptions {
  packages: string[];
  now: Date;
  /** The previously published snapshot, for carry-forward; null on a first run. */
  previous: PackagistSnapshot | null;
  fetchImpl?: typeof fetch;
  apiUrl?: string;
  /** Sleep and clock hooks, injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
  requestsPerSecond?: number;
  concurrency?: number;
  maxDurationMs?: number;
  /** Override the derived request budget (tests; live runs derive it per corpus). */
  maxRequests?: number;
}

export interface PackagistFetchResult {
  snapshot: PackagistSnapshot;
  /** False when the step stopped early or any request failed outright. */
  ok: boolean;
  /** Packages whose entry came from the previous snapshot, not this run. */
  carriedForward: string[];
  warnings: string[];
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A shared pacer: every request start waits for the next free slot, spaced
 * `1000 / requestsPerSecond` apart, whichever worker asks. Concurrency then
 * only bounds how many are in flight, never the rate.
 */
function makePacer(
  requestsPerSecond: number,
  clock: () => number,
  sleep: (ms: number) => Promise<void>,
): () => Promise<void> {
  const interval = requestsPerSecond > 0 && Number.isFinite(requestsPerSecond)
    ? 1000 / requestsPerSecond
    : 0;
  let nextSlot = 0;
  return async () => {
    if (interval === 0) return;
    const now = clock();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + interval;
    if (slot > now) await sleep(slot - now);
  };
}

function isThrottled(response: Response): boolean {
  return response.status === 429 || response.status === 503;
}

function retryAfterMs(response: Response): number {
  const header = response.headers.get('retry-after');
  const seconds = Number(header);
  if (header !== null && Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }
  return Math.min(10_000, MAX_RETRY_AFTER_MS);
}

/** The previous snapshot's entries young enough to stand in for a missed fetch. */
function reusableEntries(
  previous: PackagistSnapshot | null,
  now: Date,
): Map<string, PackagistPackageStats> {
  const reusable = new Map<string, PackagistPackageStats>();
  if (previous === null) return reusable;
  const cutoff = now.getTime() - CARRY_FORWARD_MAX_AGE_DAYS * 86_400_000;
  for (const entry of previous.packages) {
    if (Date.parse(entry.fetchedAt) >= cutoff) reusable.set(entry.name, entry);
  }
  return reusable;
}

export async function fetchPackagistStats(
  options: PackagistFetchOptions,
): Promise<PackagistFetchResult> {
  const apiUrl = (options.apiUrl?.trim() || DEFAULT_PACKAGIST_URL).replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const clock = options.clock ?? (() => Date.now());
  const pace = makePacer(options.requestsPerSecond ?? DEFAULT_REQUESTS_PER_SECOND, clock, sleep);
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;

  // Stable order: a run the breaker cuts short always covers the same
  // prefix, and carry-forward fills the rest, so coverage stays whole.
  const names = [...new Set(options.packages)].sort((a, b) => a.localeCompare(b, 'en'));
  const maxRequests =
    options.maxRequests ?? names.length + Math.ceil(names.length * RETRY_HEADROOM);
  const startedAt = clock();
  const fetchedAt = options.now.toISOString();

  const fetched = new Map<string, PackagistPackageStats>();
  const counts = { missing: 0, failed: 0, unparseable: 0 };
  let requests = 0;
  let throttles = 0;
  let stopped: string | null = null;

  const stop = (reason: string) => {
    if (stopped === null) stopped = reason;
  };

  const worker = async (name: string): Promise<void> => {
    for (let attempt = 0; ; attempt++) {
      if (stopped !== null) return;
      if (requests >= maxRequests) {
        stop(`the request budget (${maxRequests}) was spent`);
        return;
      }
      if (clock() - startedAt > maxDurationMs) {
        stop(`the ${Math.round(maxDurationMs / 60_000)}-minute time budget was spent`);
        return;
      }
      await pace();
      if (stopped !== null) return;
      requests += 1;

      let response: Response;
      try {
        response = await fetchImpl(`${apiUrl}/packages/${name}/stats.json`, {
          headers: { accept: 'application/json', 'user-agent': PACKAGIST_USER_AGENT },
        });
      } catch {
        counts.failed += 1;
        return;
      }

      if (isThrottled(response)) {
        throttles += 1;
        if (throttles > 1 || attempt > 0) {
          stop(`Packagist answered HTTP ${response.status} twice`);
          return;
        }
        await sleep(retryAfterMs(response));
        continue;
      }
      if (response.status === 404) {
        // PackageMaven indexes it, Packagist doesn't (or not any more).
        counts.missing += 1;
        return;
      }
      if (!response.ok) {
        counts.failed += 1;
        return;
      }

      let parsed: z.infer<typeof statsResponse> | null = null;
      try {
        const candidate = statsResponse.safeParse(await response.json());
        parsed = candidate.success ? candidate.data : null;
      } catch {
        parsed = null;
      }
      if (parsed === null) {
        counts.unparseable += 1;
        return;
      }
      fetched.set(name, {
        name,
        totalDownloads: parsed.downloads.total,
        monthlyDownloads: parsed.downloads.monthly,
        dailyDownloads: parsed.downloads.daily,
        createdAt: parsed.date ?? null,
        fetchedAt,
      });
      return;
    }
  };

  const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, names.length));
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let index = next++; index < names.length; index = next++) {
        if (stopped !== null) return;
        await worker(names[index]!);
      }
    }),
  );

  const reusable = reusableEntries(options.previous, options.now);
  const carriedForward: string[] = [];
  const packages: PackagistPackageStats[] = [];
  for (const name of names) {
    const entry = fetched.get(name);
    if (entry !== undefined) {
      packages.push(entry);
      continue;
    }
    const previous = reusable.get(name);
    if (previous !== undefined) {
      packages.push(previous);
      carriedForward.push(name);
    }
  }

  const warnings: string[] = [];
  if (stopped !== null) {
    warnings.push(
      `Packagist stats stopped early because ${stopped} — ${fetched.size} of ${names.length} ` +
        `packages fetched this run; ${carriedForward.length} carried forward from the previous snapshot`,
    );
  }
  if (counts.failed > 0) {
    warnings.push(`${counts.failed} Packagist stats requests failed — those packages ` +
      'keep their previous counters or none');
  }
  if (counts.unparseable > 0) {
    warnings.push(
      `${counts.unparseable} Packagist stats responses had an unexpected shape — ` +
        'the stats endpoint may have changed',
    );
  }

  return {
    snapshot: { schemaVersion: 1, fetchedAt, origin: 'live', packages },
    ok: stopped === null && counts.failed === 0 && counts.unparseable === 0,
    carriedForward,
    warnings,
  };
}

/** The empty state: a fixture build without a fixture, or tests. */
export function emptyPackagistSnapshot(now: Date, origin: 'live' | 'fixture' = 'live'): PackagistSnapshot {
  return { schemaVersion: 1, fetchedAt: now.toISOString(), origin, packages: [] };
}

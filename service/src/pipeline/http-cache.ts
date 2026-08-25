import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * A tiny on-disk HTTP cache for conditional (ETag) requests.
 *
 * Actions runners are ephemeral, so this directory is what `actions/cache`
 * persists between runs: a steady-state daily build re-requests every README
 * with `If-None-Match` and gets 304s, which GitHub does not count against the
 * rate limit. A cold cache costs one slower run, never a wrong result — every
 * read is best-effort and a corrupt or unreadable entry is simply a miss.
 */

export interface HttpCacheEntry {
  url: string;
  etag: string | null;
  body: string;
  storedAt: string;
}

export interface HttpCache {
  read(url: string): HttpCacheEntry | null;
  write(entry: HttpCacheEntry): void;
  /** Delete entries not touched this run (repos that left the corpus). */
  prune(): void;
  /** Cache misses/writes are silently tolerated; failures surface here. */
  problems: string[];
}

function fileFor(dir: string, url: string): string {
  return path.join(dir, `${crypto.createHash('sha256').update(url).digest('hex').slice(0, 32)}.json`);
}

/** A cache that never hits and never stores — local runs and unit tests. */
export function nullHttpCache(): HttpCache {
  return { read: () => null, write: () => {}, prune: () => {}, problems: [] };
}

export function openHttpCache(dir: string | null | undefined): HttpCache {
  if (!dir) return nullHttpCache();

  const problems: string[] = [];
  const touched = new Set<string>();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    problems.push(`HTTP cache disabled (${(error as Error).message})`);
    return nullHttpCache();
  }

  return {
    problems,
    read(url) {
      const file = fileFor(dir, url);
      touched.add(path.basename(file));
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as HttpCacheEntry;
        // A hash collision or a repurposed file must not serve another URL's body.
        if (parsed?.url !== url || typeof parsed.body !== 'string') return null;
        return parsed;
      } catch {
        return null;
      }
    },
    write(entry) {
      const file = fileFor(dir, entry.url);
      touched.add(path.basename(file));
      try {
        fs.writeFileSync(file, JSON.stringify(entry));
      } catch (error) {
        if (problems.length < 3) {
          problems.push(`HTTP cache write failed (${(error as Error).message})`);
        }
      }
    },
    prune() {
      try {
        for (const name of fs.readdirSync(dir)) {
          if (name.endsWith('.json') && !touched.has(name)) {
            fs.rmSync(path.join(dir, name), { force: true });
          }
        }
      } catch {
        // A cache we can't prune is still a cache.
      }
    },
  };
}

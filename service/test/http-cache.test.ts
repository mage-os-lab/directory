import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { nullHttpCache, openHttpCache } from '../src/pipeline/http-cache.js';

const dirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosd-cache-'));
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

const entry = {
  url: 'https://api.github.com/repos/a/b/readme',
  etag: 'W/"1"',
  body: '<p>hi</p>',
  storedAt: '2026-07-01T12:00:00.000Z',
};

describe('openHttpCache', () => {
  it('round-trips an entry across cache instances', () => {
    const dir = tempDir();
    openHttpCache(dir).write(entry);
    expect(openHttpCache(dir).read(entry.url)).toEqual(entry);
  });

  it('misses on an unknown, corrupt, or mismatched entry', () => {
    const dir = tempDir();
    const cache = openHttpCache(dir);
    expect(cache.read(entry.url)).toBeNull();

    cache.write(entry);
    const [file] = fs.readdirSync(dir);
    fs.writeFileSync(path.join(dir, file!), 'not json');
    expect(openHttpCache(dir).read(entry.url)).toBeNull();

    // A file whose body belongs to another URL must never be served.
    fs.writeFileSync(path.join(dir, file!), JSON.stringify({ ...entry, url: 'https://other/' }));
    expect(openHttpCache(dir).read(entry.url)).toBeNull();
  });

  it('prunes entries no run touched — repositories that left the corpus', () => {
    const dir = tempDir();
    const seeding = openHttpCache(dir);
    seeding.write(entry);
    seeding.write({ ...entry, url: 'https://api.github.com/repos/c/d/readme' });

    const next = openHttpCache(dir);
    next.read(entry.url);
    next.prune();

    expect(fs.readdirSync(dir)).toHaveLength(1);
    expect(next.read(entry.url)).toEqual(entry);
  });

  it('degrades to a no-op cache when disabled', () => {
    for (const cache of [nullHttpCache(), openHttpCache(null)]) {
      cache.write(entry);
      expect(cache.read(entry.url)).toBeNull();
      expect(cache.problems).toEqual([]);
    }
  });
});

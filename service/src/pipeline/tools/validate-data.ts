/**
 * CI validation for everything under data/: categories, ranking config, and
 * both trust overlays (schema + cross-file rules).
 *
 * Package references are cross-checked against the universe each overlay
 * belongs to: the fixture overlay against the committed fixture snapshot, the
 * real overlay against the last published PM snapshot
 * (PUBLISHED_BASE_URL/api/v1/sources/packagemaven.json). A dangling reference
 * FAILS the PR; scheduled pipeline runs only warn and skip.
 *
 * Until PUBLISHED_BASE_URL is configured — or when it can't be reached — the
 * real overlay's package references cannot be resolved and are reported as
 * unverified rather than failing the PR. Vendor files carrying only a
 * partner tier or a trusted-vendor badge name no packages at all, so they
 * validate fully either way.
 * Run: npm run validate:data
 */
import path from 'node:path';
import process from 'node:process';
import {
  loadCategories,
  loadRankingConfig,
  loadSnapshot,
  loadVendorFiles,
  vendorsDirFor,
  DataError,
} from '../load.js';
import { fetchPublishedSnapshot } from '../run.js';
import type { VendorFile } from '../../schema/vendor-file.js';

const rootDir = process.cwd();
const dataDir = path.join(rootDir, 'data');

function danglingIn(vendorFiles: VendorFile[], known: Set<string>): string[] {
  return vendorFiles.flatMap((file) =>
    Object.keys(file.packages).filter((name) => !known.has(name)),
  );
}

function packageRefCount(vendorFiles: VendorFile[]): number {
  return vendorFiles.reduce((total, file) => total + Object.keys(file.packages).length, 0);
}

try {
  const categories = loadCategories(dataDir);
  const ranking = loadRankingConfig(dataDir);

  const fixtureVendorFiles = loadVendorFiles(vendorsDirFor(dataDir, 'fixture'), categories);
  const vendorFiles = loadVendorFiles(vendorsDirFor(dataDir, 'live'), categories);

  const snapshot = loadSnapshot(path.join(dataDir, 'fixtures', 'packagemaven-snapshot.json'));
  const fixtureDangling = danglingIn(fixtureVendorFiles, new Set(snapshot.packages.map((p) => p.name)));
  if (fixtureDangling.length > 0) {
    throw new DataError(
      'data/fixtures/vendors',
      `trust entries reference packages absent from the fixture snapshot: ${fixtureDangling.join(', ')}`,
    );
  }

  let liveUniverse: string;
  const publishedBase = process.env.PUBLISHED_BASE_URL;
  const refCount = packageRefCount(vendorFiles);
  if (!publishedBase) {
    liveUniverse = `${refCount} package ref(s) UNVERIFIED (PUBLISHED_BASE_URL is not set)`;
  } else {
    try {
      const published = await fetchPublishedSnapshot(publishedBase);
      const dangling = danglingIn(vendorFiles, new Set(published.packages.map((p) => p.name)));
      if (dangling.length > 0) {
        throw new DataError(
          'data/vendors',
          `trust entries reference packages absent from the published PM snapshot: ${dangling.join(', ')}`,
        );
      }
      liveUniverse = `${refCount} package ref(s) checked against ${published.packages.length} published packages`;
    } catch (error) {
      if (error instanceof DataError) throw error;
      // A published feed that is unreachable (first deploy, network blip, a
      // fork without the variable) must not red an unrelated PR.
      liveUniverse = `${refCount} package ref(s) UNVERIFIED (${(error as Error).message})`;
      console.warn(`::warning::could not reach the published PM snapshot: ${(error as Error).message}`);
    }
  }

  console.log(
    `data OK: ${categories.categories.length} categories, ranking config ${ranking.version}, ` +
      `${vendorFiles.length} vendor file(s) [${liveUniverse}], ` +
      `${fixtureVendorFiles.length} fixture vendor file(s) against ${snapshot.packages.length} fixture packages`,
  );
} catch (error) {
  console.error(error instanceof DataError ? error.message : error);
  process.exit(1);
}

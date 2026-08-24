/**
 * CI validation for everything under data/: categories, ranking config, and
 * vendor trust files (schema + cross-file rules). Optionally cross-checks
 * trust entries against a PM snapshot (fixture by default) — in CI this
 * FAILS the PR on dangling references; scheduled pipeline runs only warn.
 * Run: npm run validate:data
 */
import path from 'node:path';
import process from 'node:process';
import { loadCategories, loadRankingConfig, loadSnapshot, loadVendorFiles, DataError } from '../load.js';

const rootDir = process.cwd();
const dataDir = path.join(rootDir, 'data');

try {
  const categories = loadCategories(dataDir);
  const ranking = loadRankingConfig(dataDir);
  const vendorFiles = loadVendorFiles(dataDir, categories);

  const snapshot = loadSnapshot(path.join(dataDir, 'fixtures', 'packagemaven-snapshot.json'));
  const known = new Set(snapshot.packages.map((p) => p.name));
  const dangling = vendorFiles.flatMap((file) =>
    Object.keys(file.packages).filter((name) => !known.has(name)),
  );
  if (dangling.length > 0) {
    throw new DataError(
      'data/vendors',
      `trust entries reference packages absent from the PM snapshot: ${dangling.join(', ')}`,
    );
  }

  console.log(
    `data OK: ${categories.categories.length} categories, ranking config ${ranking.version}, ` +
      `${vendorFiles.length} vendor file(s), snapshot of ${snapshot.packages.length} packages`,
  );
} catch (error) {
  console.error(error instanceof DataError ? error.message : error);
  process.exit(1);
}

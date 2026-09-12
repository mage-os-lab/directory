import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  loadCategories,
  loadRankingConfig,
  loadSnapshot,
  loadVendorFiles,
  vendorsDirFor,
} from './load.js';
import { mergeToFeed } from './merge.js';
import { emitArtifacts } from './emit.js';
import { disabledGithubExtras, fetchGithubExtras } from './github.js';
import { fetchPackageMavenSnapshot } from './packagemaven.js';
import { packageMavenSnapshot, type PackageMavenSnapshot } from '../schema/source.js';

interface PipelineOptions {
  source: 'fixture' | 'live';
  rootDir: string;
  outDir: string;
  /** Injectable clock so fixture builds and tests are deterministic. */
  now: Date;
}

export interface PipelineRunResult {
  feedHash: string;
  packageCount: number;
  stale: boolean;
  warnings: string[];
}

export async function runPipeline(options: PipelineOptions): Promise<PipelineRunResult> {
  const dataDir = path.join(options.rootDir, 'data');
  const warnings: string[] = [];

  const categories = loadCategories(dataDir);
  const rankingConfig = loadRankingConfig(dataDir);
  const vendorFiles = loadVendorFiles(vendorsDirFor(dataDir, options.source), categories);

  let snapshot: PackageMavenSnapshot;
  let snapshotStale = false;
  if (options.source === 'fixture') {
    snapshot = loadSnapshot(path.join(dataDir, 'fixtures', 'packagemaven-snapshot.json'));
  } else {
    const live = await fetchLiveSnapshot(options.now);
    snapshot = live.snapshot;
    snapshotStale = live.stale;
    warnings.push(...live.warnings);
  }

  // Live runs only: a fixture build must stay hermetic (the fixture's
  // repository URLs are invented), so it publishes the disabled state —
  // every package renders without a README or live star count.
  const github =
    options.source === 'live'
      ? await fetchGithubExtras({
          packages: snapshot.packages.map((p) => ({
            name: p.name,
            repositoryUrl: p.repositoryUrl,
          })),
          token: process.env.GITHUB_TOKEN,
          cacheDir: path.join(options.rootDir, '.cache', 'http'),
          now: options.now,
        })
      : disabledGithubExtras();
  warnings.push(...github.warnings);

  const { feed, details, danglingTrustEntries, unmappedCategories } = mergeToFeed({
    snapshot,
    snapshotStale,
    vendorFiles,
    categories,
    rankingConfig,
    github: github.extras,
    githubOk: github.ok,
    githubFetchedAt: github.fetchedAt,
    now: options.now,
  });

  for (const name of danglingTrustEntries) {
    warnings.push(
      `trust entry for "${name}" references a package absent from the PM snapshot — skipped`,
    );
  }
  for (const label of unmappedCategories) {
    warnings.push(
      `PM category "${label}" has no mapping in data/categories.json — its packages ` +
        `fall back to the "${categories.fallbackCategory}" category`,
    );
  }

  const result = emitArtifacts(options.outDir, feed, details, snapshot);
  return {
    feedHash: result.feedHash,
    packageCount: feed.packages.length,
    stale: snapshotStale,
    warnings,
  };
}

/**
 * Live mode: fetch from the PackageMaven API (PACKAGE_MAVEN_TOKEN, optional
 * PM_API_URL override). On failure, carry forward the previously published
 * raw snapshot (PUBLISHED_BASE_URL/api/v1/sources/packagemaven.json) marked
 * stale. If nothing is available (first-ever run), fail with an explicit
 * message — bootstrap via a fixture workflow_dispatch instead.
 */
async function fetchLiveSnapshot(now: Date): Promise<{
  snapshot: PackageMavenSnapshot;
  stale: boolean;
  warnings: string[];
}> {
  const token = process.env.PACKAGE_MAVEN_TOKEN;
  const publishedBase = process.env.PUBLISHED_BASE_URL;
  const warnings: string[] = [];

  let fetchError: string | null = null;
  if (token) {
    try {
      const result = await fetchPackageMavenSnapshot({
        token,
        now,
        apiUrl: process.env.PM_API_URL,
      });
      for (const name of result.skipped) {
        warnings.push(`PM API record for "${name}" failed normalization — skipped`);
      }
      return { snapshot: result.snapshot, stale: false, warnings };
    } catch (error) {
      fetchError = (error as Error).message;
    }
  } else {
    fetchError = 'PACKAGE_MAVEN_TOKEN is not set';
  }

  if (publishedBase) {
    try {
      const snapshot = await fetchPublishedSnapshot(publishedBase);
      warnings.push(
        `PM fetch failed (${fetchError}); carried forward published snapshot from ${snapshot.fetchedAt}`,
      );
      return { snapshot, stale: true, warnings };
    } catch (error) {
      throw new Error(
        `PM fetch failed (${fetchError}) and no published snapshot could be carried forward ` +
          `(${(error as Error).message}). First-ever run? Bootstrap with --source fixture.`,
      );
    }
  }

  throw new Error(
    `PM fetch failed (${fetchError}) and PUBLISHED_BASE_URL is not set — nothing to carry ` +
      `forward. First-ever run? Bootstrap with --source fixture.`,
  );
}

/**
 * The raw PM snapshot the last successful build published. It is the only
 * copy of the real universe available outside a PM-token run, so both the
 * stale-carry-forward path above and `validate:data` resolve trust-file
 * package references through it.
 */
export async function fetchPublishedSnapshot(publishedBase: string): Promise<PackageMavenSnapshot> {
  const response = await fetch(new URL('/api/v1/sources/packagemaven.json', publishedBase));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return packageMavenSnapshot.parse(await response.json());
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { values } = parseArgs({
    options: {
      source: { type: 'string', default: 'live' },
      out: { type: 'string', default: 'dist' },
      now: { type: 'string' },
    },
  });
  const source = values.source === 'fixture' ? 'fixture' : 'live';
  const now = values.now ? new Date(values.now) : new Date();
  if (Number.isNaN(now.getTime())) {
    console.error(`invalid --now value: ${values.now}`);
    process.exit(1);
  }

  runPipeline({
    source,
    rootDir: process.cwd(),
    outDir: path.resolve(values.out ?? 'dist'),
    now,
  })
    .then((result) => {
      for (const warning of result.warnings) {
        console.warn(`::warning::${warning}`);
      }
      console.log(
        `pipeline: emitted ${result.packageCount} packages (feed ${result.feedHash.slice(0, 12)}…)` +
          (result.stale ? ' [STALE snapshot carried forward]' : ''),
      );
      const vendorsDir = vendorsDirFor(path.join(process.cwd(), 'data'), source);
      if (!fs.existsSync(vendorsDir)) {
        console.warn(
          `::warning::${path.relative(process.cwd(), vendorsDir)}/ does not exist yet — ` +
            'no trust overlay applied',
        );
      }
    })
    .catch((error) => {
      console.error(`pipeline failed: ${(error as Error).message}`);
      process.exit(1);
    });
}

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadCategories, loadRankingConfig, loadSnapshot, loadVendorFiles } from './load.js';
import { mergeToFeed } from './merge.js';
import { emitArtifacts } from './emit.js';
import { fetchGithubExtras } from './github.js';
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
  const vendorFiles = loadVendorFiles(dataDir, categories);

  let snapshot: PackageMavenSnapshot;
  let snapshotStale = false;
  if (options.source === 'fixture') {
    snapshot = loadSnapshot(path.join(dataDir, 'fixtures', 'packagemaven-snapshot.json'));
  } else {
    const live = await fetchLiveSnapshot();
    snapshot = live.snapshot;
    snapshotStale = live.stale;
    if (live.warning) warnings.push(live.warning);
  }

  const github = await fetchGithubExtras();

  const { feed, details, danglingTrustEntries } = mergeToFeed({
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

  const result = emitArtifacts(options.outDir, feed, details, snapshot);
  return {
    feedHash: result.feedHash,
    packageCount: feed.packages.length,
    stale: snapshotStale,
    warnings,
  };
}

/**
 * Live mode: fetch the PM export from PM_EXPORT_URL and normalize it. On
 * failure, carry forward the previously published raw snapshot
 * (PUBLISHED_BASE_URL/api/v1/sources/packagemaven.json) marked stale. If
 * neither is available (first-ever run), fail with an explicit message —
 * bootstrap via a fixture workflow_dispatch instead.
 */
async function fetchLiveSnapshot(): Promise<{
  snapshot: PackageMavenSnapshot;
  stale: boolean;
  warning?: string;
}> {
  const exportUrl = process.env.PM_EXPORT_URL;
  const publishedBase = process.env.PUBLISHED_BASE_URL;

  let fetchError: string | null = null;
  if (exportUrl) {
    try {
      const response = await fetch(exportUrl, {
        headers: { 'user-agent': 'mage-os-extension-directory-pipeline' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // The PM delivery format is normalized here once agreed; until then the
      // pipeline accepts our own snapshot shape directly (manual drops are
      // pre-normalized with tools/normalize-pm-export).
      const snapshot = packageMavenSnapshot.parse(await response.json());
      return { snapshot, stale: false };
    } catch (error) {
      fetchError = (error as Error).message;
    }
  } else {
    fetchError = 'PM_EXPORT_URL is not set';
  }

  if (publishedBase) {
    try {
      const response = await fetch(
        new URL('/api/v1/sources/packagemaven.json', publishedBase),
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot = packageMavenSnapshot.parse(await response.json());
      return {
        snapshot,
        stale: true,
        warning: `PM fetch failed (${fetchError}); carried forward published snapshot from ${snapshot.fetchedAt}`,
      };
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
      if (!fs.existsSync(path.join(process.cwd(), 'data', 'vendors'))) {
        console.warn('::warning::data/vendors/ does not exist yet — no trust overlay applied');
      }
    })
    .catch((error) => {
      console.error(`pipeline failed: ${(error as Error).message}`);
      process.exit(1);
    });
}

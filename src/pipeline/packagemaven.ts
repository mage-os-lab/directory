import { z } from 'zod';
import { sourcePackage, type PackageMavenSnapshot, type SourcePackage } from '../schema/source.js';
import type { QualityTier } from '../schema/common.js';

/**
 * PackageMaven API client + normalizer (see docs/packagemaven-api-evaluation.md
 * and docs/packagemaven-openapi.json for the upstream contract).
 *
 * The API is paginated (`per_page` max 100) and bearer-token authenticated;
 * responses are rate-limited to 60/minute — a full sweep of ~1100 packages is
 * ~11 requests, so a single 429 retry honoring Retry-After is all the pacing
 * a daily pipeline needs.
 */

export const DEFAULT_PM_API_URL = 'https://package-maven.com/api/v1';
const USER_AGENT = 'mage-os-extension-directory-pipeline (github.com/rhoerr/mage-os.directory)';
const PER_PAGE = 100;
/** Hard stop for pagination — ~10× today's corpus; a moving last_page can't loop us forever. */
const MAX_PAGES = 120;

/** The subset of PM's Package schema the normalizer consumes. */
export const pmApiPackage = z.object({
  composer_name: z.string(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  repository_url: z.string().nullable(),
  latest_release: z.object({
    version: z.string().nullable(),
    date: z.string().nullable(),
  }),
  stats: z.object({
    stars: z.number().int().nullable(),
    open_issues: z.number().int().nullable(),
    installs: z.number().int().nullable(),
  }),
  quality: z.object({
    strict_compliant: z.boolean(),
    no_errors: z.boolean(),
    build_works: z.boolean(),
    needs_help: z.boolean(),
  }),
  test_results: z.object({
    magento_version: z.string().nullable(),
    package_version: z.string().nullable(),
    phpstan_level: z.number().int().min(-1).max(9).nullable(),
  }),
  categories: z.array(z.object({ slug: z.string() })),
});
export type PmApiPackage = z.infer<typeof pmApiPackage>;

const pmPackagesPage = z.object({
  data: z.array(z.unknown()),
  meta: z.object({ current_page: z.number(), last_page: z.number(), total: z.number() }),
});

/** PM's quality flags are tiered; null means the package hasn't been tested. */
export function tierFromFlags(quality: PmApiPackage['quality']): QualityTier | null {
  if (quality.strict_compliant) return 'strict-compliant';
  if (quality.no_errors) return 'no-errors';
  if (quality.build_works) return 'ready-to-install';
  if (quality.needs_help) return 'needs-help';
  return null;
}

function toIso(date: string | null): string | null {
  if (!date) return null;
  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function validUrl(url: string | null): string | null {
  if (!url) return null;
  return z.url().safeParse(url).success ? url : null;
}

/**
 * Normalize one PM API package into the internal source shape.
 *
 * PM's test results describe one (package_version, magento_version) pair, and
 * the tested version can lag the latest release — so the pair becomes a row in
 * the per-release matrix attributed to the *tested* version, and the latest
 * release only claims Magento support when it is the version that was tested.
 * Returns null for records that don't survive schema validation (the caller
 * warns and skips; one bad upstream record must not fail the run).
 */
export function normalizePmApiPackage(raw: unknown): SourcePackage | null {
  const parsed = pmApiPackage.safeParse(raw);
  if (!parsed.success) return null;
  const pkg = parsed.data;

  const latestVersion = pkg.latest_release.version;
  const latestReleasedAt = toIso(pkg.latest_release.date);
  const { magento_version: testedMagento, package_version: testedVersion } = pkg.test_results;

  const releases =
    testedVersion && testedMagento
      ? [
          {
            version: testedVersion,
            releasedAt: testedVersion === latestVersion ? latestReleasedAt : null,
            supportedMagento: [testedMagento],
          },
        ]
      : [];

  const candidate = {
    name: pkg.composer_name.toLowerCase(),
    displayName: pkg.name?.trim() || pkg.composer_name,
    description: pkg.description ?? '',
    rawCategories: pkg.categories.map((c) => c.slug),
    repositoryUrl: validUrl(pkg.repository_url),
    latestVersion,
    latestReleasedAt,
    supportedMagento: testedMagento && testedVersion === latestVersion ? [testedMagento] : [],
    releases,
    qualityTier: tierFromFlags(pkg.quality),
    phpstanLevel: pkg.test_results.phpstan_level,
    buildStatus: pkg.quality.build_works
      ? ('passing' as const)
      : pkg.quality.needs_help
        ? ('failing' as const)
        : ('unknown' as const),
    installs: pkg.stats.installs,
    stars: pkg.stats.stars,
    license: null,
    abandoned: null,
  };

  const validated = sourcePackage.safeParse(candidate);
  return validated.success ? validated.data : null;
}

export interface PmFetchResult {
  snapshot: PackageMavenSnapshot;
  /** Upstream records that failed normalization, by composer name (best effort). */
  skipped: string[];
}

interface PmFetchOptions {
  apiUrl?: string;
  token: string;
  now: Date;
  fetchImpl?: typeof fetch;
  /** Sleep hook, injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function getPage(
  url: string,
  token: string,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'user-agent': USER_AGENT,
      },
    });
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get('retry-after')) || 60;
      await sleep(Math.min(retryAfter, 120) * 1000);
      continue;
    }
    if (!response.ok) throw new Error(`GET ${url} → HTTP ${response.status}`);
    return response.json();
  }
}

/**
 * Fetch the full PM package index and normalize it into a snapshot
 * (origin: 'live'). Throws on transport/HTTP errors — the caller owns the
 * carry-forward-a-stale-snapshot fallback.
 */
export async function fetchPackageMavenSnapshot(options: PmFetchOptions): Promise<PmFetchResult> {
  const apiUrl = (options.apiUrl ?? DEFAULT_PM_API_URL).replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  const packages: SourcePackage[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (let page = 1, lastPage = 1; page <= lastPage && page <= MAX_PAGES; page++) {
    const body = await getPage(
      `${apiUrl}/packages?per_page=${PER_PAGE}&page=${page}`,
      options.token,
      fetchImpl,
      sleep,
    );
    const parsed = pmPackagesPage.safeParse(body);
    if (!parsed.success) {
      throw new Error(`PM API page ${page}: unexpected response shape`);
    }
    lastPage = parsed.data.meta.last_page;

    for (const raw of parsed.data.data) {
      const normalized = normalizePmApiPackage(raw);
      if (normalized === null) {
        const name = (raw as { composer_name?: unknown })?.composer_name;
        skipped.push(typeof name === 'string' ? name : '(unparseable record)');
        continue;
      }
      // The index can shift between pages (default sort is by release date);
      // dedupe so a package that moved pages doesn't appear twice.
      if (seen.has(normalized.name)) continue;
      seen.add(normalized.name);
      packages.push(normalized);
    }
  }

  return {
    snapshot: {
      schemaVersion: 1,
      fetchedAt: options.now.toISOString(),
      origin: 'live',
      packages,
    },
    skipped,
  };
}

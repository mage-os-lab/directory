import { z } from 'zod';
import { sourcePackage, type PackageMavenSnapshot, type SourcePackage } from '../schema/source.js';
import type { QualityTier } from '../schema/common.js';
import { normalizeVersion } from '../shared/version.js';

/**
 * PackageMaven API client + normalizer. The upstream contract is PM's public spec
 * at https://package-maven.com/api/v1/openapi.json; the field mapping is documented
 * under "PackageMaven" in docs/architecture.md.
 *
 * The API is paginated (`per_page` max 100) and bearer-token authenticated;
 * responses are rate-limited to 60/minute — a full sweep of ~1100 packages is
 * ~11 requests, so a single 429 retry honoring Retry-After is all the pacing
 * a daily pipeline needs.
 */

export const DEFAULT_PM_API_URL = 'https://package-maven.com/api/v1';
const USER_AGENT = 'mage-os-extension-directory-pipeline (github.com/mage-os-lab/directory)';
const PER_PAGE = 100;
/** Hard stop for pagination — ~10× today's corpus; a moving last_page can't loop us forever. */
const MAX_PAGES = 120;

/** The subset of PM's Package schema the normalizer consumes. */
export const pmApiPackage = z.object({
  composer_name: z.string(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  repository_url: z.string().nullable(),
  /** SPDX id(s), comma-separated when dual-licensed (e.g. "OSL-3.0, AFL-3.0"). */
  license: z.string().nullable(),
  /** Packagist abandonment state. */
  abandoned: z.object({
    is_abandoned: z.boolean(),
    replacement: z.string().nullable(),
  }),
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
  /** SemVer compliance of released versions (PM's semverdict check). */
  semver: z.object({
    status: z.enum(['pending', 'compliant', 'violations', 'unknown']),
    compliance_percent: z.number().int().min(0).max(100).nullable(),
  }),
  categories: z.array(z.object({ slug: z.string() })),
  links: z.object({ web: z.string() }),
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

/** Split PM's comma-separated SPDX string ("OSL-3.0, AFL-3.0") into a list. */
export function parseLicense(license: string | null): string[] | null {
  if (!license) return null;
  const parts = license
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : null;
}

/**
 * PM's human name often repeats what the directory context already says
 * ("Magento2 Google Tag Manager", "Module Scope Hint", "Magento 2 module for
 * Klarna"). Strip those leading words — repeatedly, and only as standalone
 * prefixes followed by whitespace or a separator — so card titles read "Google
 * Tag Manager" / "Scope Hint" / "Klarna". "Module for" is one prefix, not two,
 * so the "for" goes with the "module" instead of surviving as " for Klarna";
 * a bare "module" is left alone when only "for" follows it, so that name stays
 * whole for the nothing-but-a-prefix check below. The rest of the name is left
 * exactly as it arrived, and a name that is nothing but a prefix ("Magento2")
 * is returned untouched rather than emptied.
 */
const REDUNDANT_NAME_PREFIX =
  /^(?:magento\s*2|module\s+for|module(?!\s+for\s*$))(?:\s*[-\u2013:_|]\s*|\s+)(?=\S)/i;

/**
 * The same redundancy also shows up as a trailing or mid-name phrase ("Google
 * Tag Manager for Magento 2", "Foo (for Magento 2) - Pro"), optionally wrapped
 * in parentheses or brackets. Matched as whole words only, so a version suffix
 * ("for Magento 2.4") or a longer number ("for Magento 25") is left alone.
 */
const REDUNDANT_NAME_PHRASE = /\s*(?:[([]\s*)?\bfor\s*magento\s*2(?![a-z0-9]|\.\d)(?:\s*[)\]])?/gi;

/** A separator the phrase removal can strand at either end of the name. */
const DANGLING_SEPARATOR = /^\s*[-\u2013:_|]\s*|\s*[-\u2013:_|]\s*$/g;

/** What a stripped name can be left as when it carried nothing else: a bare word. */
const REDUNDANT_NAME_ONLY = /^(?:magento\s*2|module(?:\s+for)?)$/i;

function stripRedundantPrefixes(name: string): string {
  let cleaned = name;
  while (REDUNDANT_NAME_PREFIX.test(cleaned)) {
    cleaned = cleaned.replace(REDUNDANT_NAME_PREFIX, '');
  }
  return cleaned;
}

/**
 * The stripped form of an already-trimmed name — empty when the name was
 * nothing but the redundant words ("Magento2", "Module", "for Magento 2").
 * Shared by cleanDisplayName and isRedundantName so the two can't disagree.
 */
function stripRedundancy(trimmed: string): string {
  let cleaned = stripRedundantPrefixes(trimmed);
  const withoutPhrase = cleaned.replace(REDUNDANT_NAME_PHRASE, '');
  if (withoutPhrase !== cleaned) {
    // Only tidy when the phrase actually went, so an untouched name keeps the
    // internal spacing and separators it legitimately carries. Dropping the
    // phrase can also expose a fresh prefix ("for Magento 2 - Module Foo").
    cleaned = stripRedundantPrefixes(
      withoutPhrase.replace(/\s+/g, ' ').trim().replace(DANGLING_SEPARATOR, '').trim(),
    );
  }
  return REDUNDANT_NAME_ONLY.test(cleaned) ? '' : cleaned;
}

export function cleanDisplayName(name: string): string {
  const trimmed = name.trim();
  return stripRedundancy(trimmed) || trimmed;
}

/**
 * True when a PM name is *nothing but* the redundant words, so cleaning it
 * would leave nothing and cleanDisplayName hands back the bare word
 * ("Magento2", "Module", "for Magento 2"). The merge step asks this to title
 * such a card with the vendor's name instead.
 */
export function isRedundantName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && stripRedundancy(trimmed) === '';
}

/**
 * Normalize one PM API package into the internal source shape.
 *
 * PM's test results describe one (package_version, magento_version) pair, and
 * the tested version can lag the latest release — so the pair becomes a row in
 * the per-release matrix attributed to the *tested* version, and the latest
 * release only claims Magento support when it is the version that was tested.
 * Versions lose their tag-style "v" prefix here, so that equality holds
 * whichever form each field arrived in and the feed carries one form.
 * Returns null for records that don't survive schema validation (the caller
 * warns and skips; one bad upstream record must not fail the run).
 */
export function normalizePmApiPackage(raw: unknown): SourcePackage | null {
  const parsed = pmApiPackage.safeParse(raw);
  if (!parsed.success) return null;
  const pkg = parsed.data;

  const latestVersion =
    pkg.latest_release.version === null ? null : normalizeVersion(pkg.latest_release.version);
  const latestReleasedAt = toIso(pkg.latest_release.date);
  const testedMagento = pkg.test_results.magento_version;
  const testedVersion =
    pkg.test_results.package_version === null
      ? null
      : normalizeVersion(pkg.test_results.package_version);

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
    displayName: cleanDisplayName(pkg.name ?? '') || pkg.composer_name,
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
    license: parseLicense(pkg.license),
    abandoned: pkg.abandoned.is_abandoned,
    abandonedReplacement: pkg.abandoned.replacement?.trim() || null,
    semver: {
      status: pkg.semver.status,
      compliancePercent: pkg.semver.compliance_percent,
    },
    pmUrl: validUrl(pkg.links.web),
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
  // `||` (not `??`): CI passes PM_API_URL as the empty string when the repo
  // variable is undefined, and that must mean "use the default" too.
  const apiUrl = (options.apiUrl?.trim() || DEFAULT_PM_API_URL).replace(/\/$/, '');
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

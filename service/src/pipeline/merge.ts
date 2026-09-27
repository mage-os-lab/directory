import type {
  PackageMavenSnapshot,
  PackagistSnapshot,
  SourcePackage,
} from '../schema/source.js';
import type { PackageWarning, VendorFile } from '../schema/vendor-file.js';
import type {
  Feed,
  PackageDetail,
  PackageRelease,
  PackageSummary,
  VendorSummary,
} from '../schema/feed.js';
import type { RankingConfig } from '../schema/ranking-config.js';
import { SCHEMA_VERSION } from '../schema/common.js';
import { categoryNameFromSlug, packageCategories } from '../shared/categories.js';
import { compareVersions, isNewer, parseVersion } from '../shared/version.js';
import { buildRankingContext, packageMomentum, rankPackage } from './rank.js';
import { isRedundantName } from './packagemaven.js';

/** A vendor's human name; vendors without a trust file are named by their slug. */
function vendorDisplayName(slug: string, file: VendorFile | undefined): string {
  return file?.vendorName ?? slug;
}

/** Per-package GitHub extras; all nullable, failure-tolerant. */
export interface GithubExtras {
  readmeHtml: string | null;
  /** Where the README was reproduced from, for attribution on the detail page. */
  readmeSourceUrl: string | null;
  stars: number | null;
}

export interface MergeInput {
  snapshot: PackageMavenSnapshot;
  /** True when the snapshot was carried forward because the fetch failed. */
  snapshotStale: boolean;
  vendorFiles: VendorFile[];
  rankingConfig: RankingConfig;
  github: Map<string, GithubExtras>;
  githubOk: boolean;
  githubFetchedAt: string | null;
  /** Packagist download stats; entries older than the snapshot were carried forward. */
  packagist: PackagistSnapshot;
  packagistOk: boolean;
  now: Date;
}

export interface MergeOutput {
  feed: Feed;
  details: PackageDetail[];
  /** Trust entries referencing packages absent from the snapshot (warn + skip). */
  danglingTrustEntries: string[];
  /** Category slugs that trust-file overrides name but PM's taxonomy lacks
   * (warn; the override still applies). PM's taxonomy can move between our
   * runs, and this is how a scheduled build surfaces the drift. */
  unknownOverrideCategories: string[];
}

/**
 * PM's per-release test matrix with the latest release folded in (unless the
 * matrix already carries a row for it), newest release first.
 */
export function buildReleases(source: SourcePackage): PackageRelease[] {
  const rows: PackageRelease[] = source.releases.map((r) => ({
    version: r.version,
    releasedAt: r.releasedAt,
    supportedMagento: [...r.supportedMagento].sort((a, b) => compareVersions(b, a)),
  }));
  if (source.latestVersion && !rows.some((r) => r.version === source.latestVersion)) {
    rows.push({
      version: source.latestVersion,
      releasedAt: source.latestReleasedAt,
      supportedMagento: [...source.supportedMagento].sort((a, b) => compareVersions(b, a)),
    });
  }
  return rows.sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * Magento version → newest release verified against it. Preferring a
 * parseable version over an unparseable one, then strictly newer wins; ties
 * keep the first (already newest-first) entry.
 */
export function buildCompatibility(releases: PackageRelease[]): Record<string, string> {
  const map = new Map<string, string>();
  for (const release of releases) {
    for (const magento of release.supportedMagento) {
      const current = map.get(magento);
      const better =
        current === undefined ||
        (parseVersion(current) === null
          ? parseVersion(release.version) !== null
          : isNewer(release.version, current));
      if (better) map.set(magento, release.version);
    }
  }
  return Object.fromEntries(
    [...map.entries()].sort(([a], [b]) => compareVersions(b, a)),
  );
}

export function mergeToFeed(input: MergeInput): MergeOutput {
  const { snapshot, vendorFiles, rankingConfig, github, now } = input;

  const vendorBySlug = new Map(vendorFiles.map((file) => [file.vendor, file]));
  const downloadsByName = new Map(input.packagist.packages.map((entry) => [entry.name, entry]));
  const snapshotNames = new Set(snapshot.packages.map((p) => p.name));

  const danglingTrustEntries: string[] = [];
  for (const file of vendorFiles) {
    for (const packageName of Object.keys(file.packages)) {
      if (!snapshotNames.has(packageName)) {
        danglingTrustEntries.push(packageName);
      }
    }
  }

  // First pass: assemble everything except ranking (needs corpus context).
  const assembled = snapshot.packages.map((source) => {
    const vendorSlug = source.name.split('/')[0]!;
    const vendorFile = vendorBySlug.get(vendorSlug);
    const trustEntry = vendorFile?.packages[source.name];
    const extras = github.get(source.name) ?? {
      readmeHtml: null,
      readmeSourceUrl: null,
      stars: null,
    };
    const downloads = downloadsByName.get(source.name) ?? null;
    const warnings = sortWarnings(trustEntry?.warnings ?? []);
    const deranked = warnings.some((w) => w.severity === 'derank' || w.severity === 'hide');
    const hidden = warnings.some((w) => w.severity === 'hide');
    const releases = buildReleases(source);

    return {
      source,
      vendorSlug,
      vendorFile,
      trustEntry,
      extras,
      releases,
      downloads:
        downloads === null
          ? null
          : {
              total: downloads.totalDownloads,
              monthly: downloads.monthlyDownloads,
              createdAt: downloads.createdAt,
            },
      downloadsStale: downloads !== null && downloads.fetchedAt !== input.packagist.fetchedAt,
      summaryBase: {
        name: source.name,
        vendor: vendorSlug,
        // A PM name that is nothing but "Magento2"/"Module"/"for Magento 2"
        // cleans down to that bare word, so title the card with the vendor instead.
        displayName:
          trustEntry?.displayName ??
          (isRedundantName(source.displayName)
            ? vendorDisplayName(vendorSlug, vendorFile)
            : source.displayName),
        description: source.description,
        categories: packageCategories(trustEntry?.categories ?? source.rawCategories),
        repositoryUrl: source.repositoryUrl,
        latestVersion: source.latestVersion,
        latestReleasedAt: source.latestReleasedAt,
        supportedMagento: source.supportedMagento,
        compatibility: buildCompatibility(releases),
        abandoned: source.abandoned,
        abandonedReplacement: source.abandonedReplacement,
        quality: {
          tier: source.qualityTier,
          phpstanLevel: source.phpstanLevel,
          buildStatus: source.buildStatus,
          semver: source.semver,
          stale: input.snapshotStale,
        },
        trust: {
          partnerTier: vendorFile?.partnerTier ?? null,
          editorialPick: trustEntry?.editorialPick ?? false,
          warnings,
          deranked,
          hidden,
        },
        popularity: {
          installs: source.installs,
          // Live GitHub data wins; PM's reported star count fills the gap
          // when our own GitHub fetch is disabled or fails.
          githubStars: extras.stars ?? source.stars,
        },
      },
    };
  });

  const rankingContext = buildRankingContext(
    assembled.map((a) => ({
      installs: a.summaryBase.popularity.installs,
      githubStars: a.summaryBase.popularity.githubStars,
      downloads: a.downloads,
    })),
    rankingConfig,
    now,
  );

  const packages: PackageSummary[] = assembled
    .map((a) => ({
      ...a.summaryBase,
      activity:
        a.downloads === null
          ? null
          : {
              monthlyDownloads: a.downloads.monthly,
              momentum: roundMomentum(packageMomentum(a.downloads, rankingConfig, rankingContext)),
              stale: a.downloadsStale,
            },
      ranking: rankPackage(
        {
          editorialPick: a.summaryBase.trust.editorialPick,
          partnerTier: a.summaryBase.trust.partnerTier,
          qualityTier: a.summaryBase.quality.tier,
          latestReleasedAt: a.summaryBase.latestReleasedAt,
          installs: a.summaryBase.popularity.installs,
          githubStars: a.summaryBase.popularity.githubStars,
          downloads: a.downloads,
          deranked: a.summaryBase.trust.deranked,
          abandoned: a.summaryBase.abandoned,
        },
        rankingConfig,
        rankingContext,
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));

  const generatedAt = now.toISOString();

  const details: PackageDetail[] = assembled
    .map((a) => {
      const summary = packages.find((p) => p.name === a.source.name)!;
      return {
        ...summary,
        schemaVersion: SCHEMA_VERSION,
        generatedAt,
        readmeHtml: a.extras.readmeHtml,
        readmeSourceUrl: a.extras.readmeHtml === null ? null : a.extras.readmeSourceUrl,
        releases: a.releases,
        license: a.source.license,
        links: {
          packagist: `https://packagist.org/packages/${a.source.name}`,
          // PM package pages live at package-maven.com/<vendor>/<package>;
          // prefer the URL PM reports over deriving it.
          packagemaven: a.source.pmUrl ?? `https://package-maven.com/${a.source.name}`,
          repository: a.source.repositoryUrl,
          issues: a.trustEntry?.issuesUrl ?? deriveIssuesUrl(a.source),
          docs: a.trustEntry?.docsUrl ?? null,
        },
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));

  const feed: Feed = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    sources: [
      {
        id: 'packagemaven',
        ok: !input.snapshotStale,
        stale: input.snapshotStale,
        fetchedAt: snapshot.fetchedAt,
      },
      {
        id: 'github',
        ok: input.githubOk,
        stale: false,
        fetchedAt: input.githubFetchedAt,
      },
      {
        id: 'packagist',
        ok: input.packagistOk,
        stale: assembled.some((a) => a.downloadsStale),
        fetchedAt: input.packagist.packages.length > 0 ? input.packagist.fetchedAt : null,
      },
    ],
    rankingConfigVersion: rankingConfig.version,
    categories: buildCategoryEntries(packages, snapshot),
    vendors: buildVendorSummaries(packages, vendorBySlug),
    packages,
  };

  return {
    feed,
    details,
    danglingTrustEntries: danglingTrustEntries.sort(),
    unknownOverrideCategories: unknownOverrideCategories(vendorFiles, snapshot),
  };
}

/** Same precision as ranking.components, so the two published numbers agree. */
function roundMomentum(momentum: number | null): number | null {
  return momentum === null ? null : Math.round(momentum * 1e6) / 1e6;
}

function sortWarnings(warnings: PackageWarning[]): PackageWarning[] {
  return [...warnings].sort((a, b) => b.date.localeCompare(a.date) || a.code.localeCompare(b.code));
}

function deriveIssuesUrl(source: SourcePackage): string | null {
  if (source.repositoryUrl?.startsWith('https://github.com/')) {
    return `${source.repositoryUrl.replace(/\/$/, '')}/issues`;
  }
  return null;
}

/** Every category PM names or a package carries, with PM's name for it. */
export function knownCategories(snapshot: PackageMavenSnapshot): Map<string, string> {
  const names = new Map(snapshot.categories.map((c) => [c.slug, c.name]));
  for (const pkg of snapshot.packages) {
    for (const slug of pkg.rawCategories) {
      if (!names.has(slug)) names.set(slug, categoryNameFromSlug(slug));
    }
  }
  return names;
}

function buildCategoryEntries(packages: PackageSummary[], snapshot: PackageMavenSnapshot) {
  const names = knownCategories(snapshot);
  // A trust-file override can name a category no PM package carries yet.
  for (const pkg of packages) {
    for (const slug of pkg.categories) {
      if (!names.has(slug)) names.set(slug, categoryNameFromSlug(slug));
    }
  }
  return [...names.entries()]
    .map(([slug, name]) => ({
      slug,
      name,
      packageCount: packages.filter((p) => p.categories.includes(slug)).length,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug, 'en'));
}

/** Override slugs outside PM's taxonomy, distinct and sorted. */
function unknownOverrideCategories(
  vendorFiles: VendorFile[],
  snapshot: PackageMavenSnapshot,
): string[] {
  const known = knownCategories(snapshot);
  const unknown = new Set<string>();
  for (const file of vendorFiles) {
    for (const entry of Object.values(file.packages)) {
      for (const slug of entry.categories ?? []) {
        if (!known.has(slug)) unknown.add(slug);
      }
    }
  }
  return [...unknown].sort();
}

function buildVendorSummaries(
  packages: PackageSummary[],
  vendorBySlug: Map<string, VendorFile>,
): VendorSummary[] {
  const slugs = [...new Set(packages.map((p) => p.vendor))].sort((a, b) =>
    a.localeCompare(b, 'en'),
  );
  return slugs.map((slug) => {
    const file = vendorBySlug.get(slug);
    return {
      slug,
      name: vendorDisplayName(slug, file),
      url: file?.url ?? null,
      partnerTier: file?.partnerTier ?? null,
      packageCount: packages.filter((p) => p.vendor === slug).length,
    };
  });
}

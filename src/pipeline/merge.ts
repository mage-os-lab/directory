import type { CategoriesFile, PackageMavenSnapshot, SourcePackage } from '../schema/source.js';
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
import { compareVersions, isNewer, parseVersion } from '../shared/version.js';
import { buildRankingContext, rankPackage } from './rank.js';

/** Per-package GitHub extras; both nullable, failure-tolerant. */
export interface GithubExtras {
  readmeHtml: string | null;
  stars: number | null;
}

export interface MergeInput {
  snapshot: PackageMavenSnapshot;
  /** True when the snapshot was carried forward because the fetch failed. */
  snapshotStale: boolean;
  vendorFiles: VendorFile[];
  categories: CategoriesFile;
  rankingConfig: RankingConfig;
  github: Map<string, GithubExtras>;
  githubOk: boolean;
  githubFetchedAt: string | null;
  now: Date;
}

export interface MergeOutput {
  feed: Feed;
  details: PackageDetail[];
  /** Trust entries referencing packages absent from the snapshot (warn + skip). */
  danglingTrustEntries: string[];
}

/** Map PM's raw category labels to canonical slugs via data/categories.json. */
export function mapCategories(rawCategories: string[], categories: CategoriesFile): string[] {
  const byLabel = new Map<string, string>();
  for (const category of categories.categories) {
    for (const label of category.packageMavenLabels) {
      byLabel.set(label.toLowerCase(), category.slug);
    }
  }
  const slugs = new Set<string>();
  for (const raw of rawCategories) {
    slugs.add(byLabel.get(raw.trim().toLowerCase()) ?? categories.fallbackCategory);
  }
  if (slugs.size === 0) slugs.add(categories.fallbackCategory);
  return [...slugs].sort();
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
  const { snapshot, vendorFiles, categories, rankingConfig, github, now } = input;

  const vendorBySlug = new Map(vendorFiles.map((file) => [file.vendor, file]));
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
    const extras = github.get(source.name) ?? { readmeHtml: null, stars: null };
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
      summaryBase: {
        name: source.name,
        vendor: vendorSlug,
        displayName: trustEntry?.displayName ?? source.displayName,
        description: source.description,
        categories: trustEntry?.categories
          ? [...trustEntry.categories].sort()
          : mapCategories(source.rawCategories, categories),
        repositoryUrl: source.repositoryUrl,
        latestVersion: source.latestVersion,
        latestReleasedAt: source.latestReleasedAt,
        supportedMagento: source.supportedMagento,
        compatibility: buildCompatibility(releases),
        abandoned: source.abandoned,
        quality: {
          tier: source.qualityTier,
          phpstanLevel: source.phpstanLevel,
          buildStatus: source.buildStatus,
          stale: input.snapshotStale,
        },
        trust: {
          trustedVendor: vendorFile?.trustedVendor ?? false,
          partnerTier: vendorFile?.partnerTier ?? null,
          editorialPick: trustEntry?.editorialPick ?? false,
          warnings,
          deranked,
          hidden,
        },
        popularity: {
          installs: source.installs,
          githubStars: extras.stars,
        },
      },
    };
  });

  const rankingContext = buildRankingContext(
    assembled.map((a) => ({
      installs: a.summaryBase.popularity.installs,
      githubStars: a.summaryBase.popularity.githubStars,
    })),
    rankingConfig,
    now,
  );

  const packages: PackageSummary[] = assembled
    .map((a) => ({
      ...a.summaryBase,
      ranking: rankPackage(
        {
          editorialPick: a.summaryBase.trust.editorialPick,
          partnerTier: a.summaryBase.trust.partnerTier,
          trustedVendor: a.summaryBase.trust.trustedVendor,
          qualityTier: a.summaryBase.quality.tier,
          latestReleasedAt: a.summaryBase.latestReleasedAt,
          installs: a.summaryBase.popularity.installs,
          githubStars: a.summaryBase.popularity.githubStars,
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
        releases: a.releases,
        license: a.source.license,
        links: {
          packagist: `https://packagist.org/packages/${a.source.name}`,
          packagemaven: `https://package-maven.com/packages/${a.source.name}`,
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
    ],
    rankingConfigVersion: rankingConfig.version,
    categories: buildCategoryEntries(packages, categories),
    vendors: buildVendorSummaries(packages, vendorBySlug),
    packages,
  };

  return { feed, details, danglingTrustEntries: danglingTrustEntries.sort() };
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

function buildCategoryEntries(packages: PackageSummary[], categories: CategoriesFile) {
  return categories.categories
    .map((category) => ({
      slug: category.slug,
      name: category.name,
      packageCount: packages.filter((p) => p.categories.includes(category.slug)).length,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug, 'en'));
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
      name: file?.vendorName ?? slug,
      url: file?.url ?? null,
      trustedVendor: file?.trustedVendor ?? false,
      partnerTier: file?.partnerTier ?? null,
      packageCount: packages.filter((p) => p.vendor === slug).length,
    };
  });
}

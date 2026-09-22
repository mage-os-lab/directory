/**
 * The marks a module can earn — trusted vendor, editors' pick, high quality,
 * popular, trending — as one set of predicates shared by the browse UI (its
 * "show only" chips and the badges in each card's corner) and the
 * prerendered pages, so that what a chip narrows to is what every card
 * shows. Trusted vendor and editors' pick are read straight off the trust
 * overlay; the rest need computing.
 */
import type { PackageSummary } from '../schema/feed.js';

/** "Popular" means installs at or above this percentile of the catalog. */
export const POPULAR_PERCENTILE = 0.85;

/** PackageMaven found nothing wrong: the top two tiers. */
export function isHighQuality(pkg: PackageSummary): boolean {
  return pkg.quality.tier === 'strict-compliant' || pkg.quality.tier === 'no-errors';
}

/**
 * Install count at the given percentile of packages that report one
 * (nearest rank), or null when too few do for "popular" to mean anything.
 */
export function installsAtPercentile(
  packages: PackageSummary[],
  percentile: number,
): number | null {
  const counts = packages
    .map((p) => p.popularity.installs)
    .filter((n): n is number => n !== null && n > 0)
    .sort((a, b) => a - b);
  if (counts.length < 4) return null;
  const index = Math.min(counts.length - 1, Math.ceil(percentile * counts.length) - 1);
  return counts[Math.max(0, index)]!;
}

/** Installs at or above the catalog's popular floor (see installsAtPercentile). */
export function isPopular(pkg: PackageSummary, floor: number | null): boolean {
  return floor !== null && pkg.popularity.installs !== null && pkg.popularity.installs >= floor;
}

/**
 * "Trending" means recent downloads well above the package's own lifetime
 * average — momentum (see rank.ts) at or above this point on the shared
 * 0..1 scale. With the configured ceiling of 4, 0.75 is roughly twice the
 * typical growth rate: a real acceleration, not the ecosystem's tide.
 */
export const TRENDING_MOMENTUM = 0.75;

/**
 * Trending also needs volume. Below the catalog's median monthly downloads,
 * a handful of CI installs is a tripled ratio, and the mark would point at
 * noise.
 */
export const TRENDING_VOLUME_PERCENTILE = 0.5;

/**
 * Monthly downloads at the given percentile of packages that report any
 * (nearest rank), or null when too few do for a floor to mean anything.
 * Mirrors installsAtPercentile, over Packagist's trailing-30-day counter.
 */
export function monthlyDownloadsAtPercentile(
  packages: PackageSummary[],
  percentile: number,
): number | null {
  const counts = packages
    .map((p) => p.activity?.monthlyDownloads ?? null)
    .filter((n): n is number => n !== null && n > 0)
    .sort((a, b) => a - b);
  if (counts.length < 4) return null;
  const index = Math.min(counts.length - 1, Math.ceil(percentile * counts.length) - 1);
  return counts[Math.max(0, index)]!;
}

/**
 * Growing faster than its own history, with enough volume to mean it — and
 * nothing against it. The guards are the point: momentum is the most
 * volatile and most gameable number the directory publishes (a nightly CI
 * job installing a package is indistinguishable from adoption), so a
 * directory whose premise is trust must not hand a badge to something it is
 * simultaneously warning readers away from. An abandoned, deranked or
 * hidden package can climb all it likes; it is still not a recommendation.
 */
export function isTrending(pkg: PackageSummary, floor: number | null): boolean {
  if (pkg.activity === null || floor === null) return false;
  if (pkg.activity.momentum === null || pkg.activity.momentum < TRENDING_MOMENTUM) return false;
  if (pkg.activity.monthlyDownloads < floor) return false;
  return pkg.abandoned !== true && !pkg.trust.deranked && !pkg.trust.hidden;
}

/**
 * The marks a module can earn — trusted vendor, editors' pick, high quality,
 * popular — as one set of predicates shared by the browse UI (its "show
 * only" chips and the badges in each card's corner) and the prerendered
 * pages, so that what a chip narrows to is what every card shows. Trusted
 * vendor and editors' pick are read straight off the trust overlay; these
 * two need computing.
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

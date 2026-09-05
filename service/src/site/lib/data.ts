/**
 * Build-time data access for the Astro site. Reads the pipeline's already
 * emitted JSON artifacts under public/api/v1 with plain node:fs — this runs
 * only in Astro frontmatter (build time), never ships to the browser. The
 * client island instead fetches /api/v1/feed.json at runtime.
 *
 * Types-only import from src/schema — Zod never ships to the browser and
 * these helpers don't re-validate; the pipeline already validated its own
 * output before writing it.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Feed, PackageDetail, PackageSummary } from '../../schema/feed.js';
import { withBase } from './base.js';

const API_DIR = path.join(process.cwd(), 'public', 'api', 'v1');

let cachedFeed: Feed | null = null;

/** Reads and caches /api/v1/feed.json (parsed once per build process). */
export function loadFeed(): Feed {
  if (cachedFeed) return cachedFeed;
  const raw = fs.readFileSync(path.join(API_DIR, 'feed.json'), 'utf-8');
  cachedFeed = JSON.parse(raw) as Feed;
  return cachedFeed;
}

/** Reads /api/v1/packages/<vendor>/<name>.json for a single package. */
export function loadPackageDetail(vendor: string, name: string): PackageDetail {
  const raw = fs.readFileSync(path.join(API_DIR, 'packages', vendor, `${name}.json`), 'utf-8');
  return JSON.parse(raw) as PackageDetail;
}

/** Packages excluding those withdrawn (trust.hidden) — for every listing
 * surface except the package's own detail page, which stays reachable with
 * a warning banner (no link rot). */
export function visiblePackages(feed: Feed): PackageSummary[] {
  return feed.packages.filter((p) => !p.trust.hidden);
}

export function byScoreDesc(a: PackageSummary, b: PackageSummary): number {
  return b.ranking.score - a.ranking.score;
}

/** Top editorial picks by ranking score, hidden packages excluded. */
export function editorialPicks(feed: Feed, limit = 6): PackageSummary[] {
  return visiblePackages(feed)
    .filter((p) => p.trust.editorialPick)
    .sort(byScoreDesc)
    .slice(0, limit);
}

export function packagesForCategory(feed: Feed, slug: string): PackageSummary[] {
  return visiblePackages(feed)
    .filter((p) => p.categories.includes(slug))
    .sort(byScoreDesc);
}

export function packagesForVendor(feed: Feed, slug: string): PackageSummary[] {
  return visiblePackages(feed)
    .filter((p) => p.vendor === slug)
    .sort(byScoreDesc);
}

/** Splits a Packagist package name ("vendor/module-name") into the
 * name segment used in per-package API/detail-page paths. */
export function packageNameSegment(pkg: PackageSummary): string {
  return pkg.name.slice(pkg.vendor.length + 1);
}

export function packageHref(pkg: PackageSummary): string {
  return withBase(`/packages/${pkg.name}/`);
}

export function vendorHref(vendorSlug: string): string {
  return withBase(`/vendors/${vendorSlug}/`);
}

/** The packagemaven source's fetchedAt when it's marked stale, or null —
 * drives the site-wide "quality data as of <date>" banner. */
export function staleNotice(feed: Feed): string | null {
  const src = feed.sources.find((s) => s.id === 'packagemaven' && s.stale);
  return src?.fetchedAt ?? null;
}

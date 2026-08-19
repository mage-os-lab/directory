/**
 * Types for the browse/search UI. Types-only imports from src/schema — Zod
 * never ships to the browser; the pipeline already validated the feed at
 * build time.
 */
import type { Feed, PackageSummary } from '../schema/feed.js';

export type { Feed, PackageSummary };

export type SortKey = 'recommended' | 'installs' | 'stars' | 'recency' | 'name';

export interface DirectoryFilters {
  query?: string;
  category?: string;
  quality?: string[];
}

export interface SelectDetail {
  name: string;
  vendor: string;
  packageUrl: string;
}

export interface MountOptions {
  feedUrl?: string;
  linkMode?: 'href' | 'event';
  initialFilters?: DirectoryFilters;
  baseUrl?: string;
  shadow?: boolean;
}

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

/** Detail of the mosd:selection event: the current install list. */
export interface SelectionDetail {
  packages: Array<{ name: string; version: string | null }>;
  /** `composer require vendor/a:^1.2 vendor/b` — empty string when nothing is marked. */
  command: string;
}

export interface MountOptions {
  feedUrl?: string;
  linkMode?: 'href' | 'event';
  initialFilters?: DirectoryFilters;
  baseUrl?: string;
  shadow?: boolean;
  /**
   * Composer package name → installed version, as read from the host's
   * composer.lock (the Magento admin module's job). When provided, cards get
   * "Installed" / "update available" badges and an installed-state filter.
   */
  installed?: Record<string, string>;
  /**
   * Enable the install list: cards get a "mark for install/update" toggle and
   * a tray shows the composer require command (copyable); every change
   * dispatches mosd:selection on the mount element.
   */
  selectable?: boolean;
  /**
   * The host shop's Magento/Mage-OS version (e.g. "2.4.6"), as known to the
   * admin module. When provided, cards get tested-with badges (from PM's
   * empirical test matrix — "not tested" never means "incompatible"), a
   * tested-only filter, and the install list pins the newest release
   * verified against this version instead of the latest.
   */
  magentoVersion?: string;
}

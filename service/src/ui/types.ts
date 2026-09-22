/**
 * Types for the browse/search UI. Types-only imports from src/schema — Zod
 * never ships to the browser; the pipeline already validated the feed at
 * build time.
 */
import type { Feed, PackageSummary } from '../schema/feed.js';

export type { Feed, PackageSummary };

export type SortKey = 'recommended' | 'installs' | 'stars' | 'trending' | 'recency' | 'name';

/**
 * The one-click filters. Each answers a question a reader asks before
 * shortlisting: who stands behind it, does it fit, is anyone maintaining it,
 * is it any good, does anyone use it, is it catching on — plus, where the
 * host knows the shop, do I already run it.
 */
export type FilterFlag =
  | 'trusted'
  | 'picks'
  | 'tested'
  | 'recent'
  | 'quality'
  | 'popular'
  | 'trending'
  | 'installed'
  | 'update';

export interface DirectoryFilters {
  query?: string;
  category?: string;
  /** Quality tiers to keep. Honoured, but no longer has its own control. */
  quality?: string[];
  flags?: FilterFlag[];
  sort?: SortKey;
}

/**
 * 'auto' follows the reader's OS preference; 'light' / 'dark' pin the palette
 * for hosts whose own chrome only has one (the Magento admin is light-only).
 */
export type ColorScheme = 'auto' | 'light' | 'dark';

/** How a package relates to the host's composer.lock, when the host supplied one. */
export type InstallState = 'not-installed' | 'installed' | 'update';

export interface SelectDetail {
  name: string;
  vendor: string;
  packageUrl: string;
  /**
   * The install-list state of the selected package, so a host that shows the
   * package elsewhere (a detail modal, say) can offer the same mark toggle
   * there. `markable` is false on a mount that cannot select and for a
   * package the shop already has at its target version.
   */
  installState: InstallState;
  markable: boolean;
  marked: boolean;
}

/**
 * Detail of the mosd:mark event a host dispatches *on* the mount element to
 * change the install list from outside the bundle: toggle when `marked` is
 * omitted, else set. Ignored unless the mount is selectable and the package
 * is in the catalog and not already installed; every change it does make is
 * announced through mosd:selection like any other.
 */
export interface MarkDetail {
  name: string;
  marked?: boolean;
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
   * "Installed" / "update available" badges and installed-state filters.
   */
  installed?: Record<string, string>;
  /**
   * Enable the install list: cards get a "mark for install/update" toggle and
   * a tray shows the composer require command (copyable); every change
   * dispatches mosd:selection on the mount element. The list is kept in
   * sessionStorage, so it survives a reload of the tab and ends with the tab;
   * a mount that restores a non-empty list dispatches mosd:selection once.
   */
  selectable?: boolean;
  /**
   * The host shop's Magento/Mage-OS version (e.g. "2.4.6"), as known to the
   * admin module. When provided, cards get tested-with badges (from PM's
   * empirical test matrix — "not tested" never means "incompatible"), the
   * tested-with filter targets this version, and the install list pins the
   * newest release verified against it instead of the latest. Matched by
   * release line, so "2.4.9-p1" counts as a match for "2.4.9".
   */
  magentoVersion?: string;
  /**
   * The host's own distribution when it isn't Magento itself, e.g.
   * `{ name: 'Mage-OS', version: '3.5.0' }`. Sent alongside magentoVersion
   * (which then carries the Magento release that distribution is built on,
   * the one PackageMaven tested). Every "tested with" label then names the
   * distribution, since that is the version the admin recognises; the Magento
   * number appears only in the chip's tooltip, as the explanation. Ignored
   * without magentoVersion.
   */
  distribution?: { name: string; version: string };
  /** Palette: follow the OS ('auto', default) or pin 'light' / 'dark'. */
  colorScheme?: ColorScheme;
  /** Cards per page (default 24); pages load as the reader nears the end, with "Show more" as the fallback. */
  pageSize?: number;
}

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import MiniSearch from 'minisearch';
import { qualityLabel } from '../shared/quality.js';
import { compareVersions, isNewer } from '../shared/version.js';
import type {
  ColorScheme,
  DirectoryFilters,
  Feed,
  FilterFlag,
  PackageSummary,
  SelectDetail,
  SelectionDetail,
  SortKey,
} from './types.js';

export interface DirectoryBrowserProps {
  feed: Feed;
  linkMode: 'href' | 'event';
  baseUrl: string;
  initialFilters?: DirectoryFilters;
  onSelect?: (detail: SelectDetail) => void;
  /** Composer package name → installed version (from the host's composer.lock). */
  installed?: Record<string, string>;
  /** Enable marking packages for install and the composer-command tray. */
  selectable?: boolean;
  onSelectionChange?: (detail: SelectionDetail) => void;
  /** The host shop's Magento/Mage-OS version (e.g. "2.4.6"). */
  magentoVersion?: string;
  /** Follow the OS palette ('auto', default) or pin one. */
  colorScheme?: ColorScheme;
  /** Cards shown before "Show more". */
  pageSize?: number;
  /** Fired after every filter/sort change (not on mount) — the site mirrors it into the URL. */
  onFiltersChange?: (filters: DirectoryFilters) => void;
}

/**
 * How a package relates to the host's Magento version, per PM's test matrix:
 * the latest release is verified against it, only an older release is, or
 * nothing is (which means "not tested", never "incompatible").
 */
type MagentoSupport =
  | { state: 'tested'; version: string | null }
  | { state: 'older'; version: string }
  | { state: 'untested' };

type InstallState = 'not-installed' | 'installed' | 'update';

export const DEFAULT_PAGE_SIZE = 24;

/** "Recently updated" means a release inside this window. */
export const RECENT_DAYS = 365;

/** "Popular" means installs at or above this percentile of the catalog. */
export const POPULAR_PERCENTILE = 0.75;

export function composerCommand(entries: Array<{ name: string; version: string | null }>): string {
  const args = entries.map((e) => (e.version ? `${e.name}:^${e.version}` : e.name));
  return `composer require ${args.join(' ')}`;
}

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'recommended', label: 'Recommended' },
  { key: 'installs', label: 'Most installed' },
  { key: 'stars', label: 'Most starred' },
  { key: 'recency', label: 'Recently released' },
  { key: 'name', label: 'Name A–Z' },
];

export function packageUrl(baseUrl: string, pkg: PackageSummary): string {
  return `${baseUrl}/packages/${pkg.name}/`;
}

/** "2.4.5–2.4.7", or the single version, for surfaces with no host version
 * to compare against. Sorted here rather than trusted from the feed. */
export function magentoRange(pkg: PackageSummary): string | null {
  if (pkg.supportedMagento.length === 0) return null;
  const sorted = [...pkg.supportedMagento].sort(compareVersions);
  const lowest = sorted[0];
  const highest = sorted[sorted.length - 1];
  return lowest === highest ? lowest : `${lowest}–${highest}`;
}

/**
 * The newest Magento version anything in the catalog has been verified
 * against — what "compatible with the latest version" means on the public
 * site, where there is no shop version to ask about. Null when PM has
 * reported no test results at all.
 */
export function latestMagentoVersion(packages: PackageSummary[]): string | null {
  let newest: string | null = null;
  for (const pkg of packages) {
    for (const version of pkg.supportedMagento) {
      if (newest === null || compareVersions(version, newest) > 0) newest = version;
    }
  }
  return newest;
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

/** Released within RECENT_DAYS of `now`. Unparseable dates are not recent. */
export function isRecent(pkg: PackageSummary, now: number = Date.now()): boolean {
  if (pkg.latestReleasedAt === null) return false;
  const released = Date.parse(pkg.latestReleasedAt);
  if (Number.isNaN(released)) return false;
  return now - released <= RECENT_DAYS * 86_400_000;
}

/** PackageMaven found nothing wrong: the top two tiers. */
export function isHighQuality(pkg: PackageSummary): boolean {
  return pkg.quality.tier === 'strict-compliant' || pkg.quality.tier === 'no-errors';
}

/**
 * Time since the last release, in words. "Recently released" is a sort
 * option; this is the column it sorts on, and the answer to "is anyone
 * still working on this".
 */
export function releasedAgo(iso: string | null, now: number = Date.now()): string | null {
  if (iso === null) return null;
  const released = Date.parse(iso);
  if (Number.isNaN(released)) return null;
  const days = Math.floor((now - released) / 86_400_000);
  if (days < 0) return null;
  if (days < 7) return 'updated this week';
  if (days < 31) {
    const weeks = Math.max(1, Math.round(days / 7));
    return `updated ${weeks} week${weeks === 1 ? '' : 's'} ago`;
  }
  if (days < 365) {
    const months = Math.min(11, Math.max(1, Math.round(days / 30.44)));
    return `updated ${months} month${months === 1 ? '' : 's'} ago`;
  }
  const years = Math.floor(days / 365);
  return `updated ${years} year${years === 1 ? '' : 's'} ago`;
}

/** Install counts are scale, not accounting: 9.8k reads faster than 9,847. */
export function installsLabel(installs: number): string {
  if (installs < 1000) return String(installs);
  const thousands = installs / 1000;
  const rounded = thousands >= 10 ? String(Math.round(thousands)) : thousands.toFixed(1);
  return `${rounded.replace(/\.0$/, '')}k`;
}

/** Warnings and abandonment are the only things on a card allowed to be red. */
export function isRisky(pkg: PackageSummary): boolean {
  return pkg.abandoned === true || pkg.trust.warnings.length > 0;
}

function compare(a: PackageSummary, b: PackageSummary, sort: SortKey): number {
  switch (sort) {
    case 'installs':
      return (b.popularity.installs ?? -1) - (a.popularity.installs ?? -1);
    case 'stars':
      return (b.popularity.githubStars ?? -1) - (a.popularity.githubStars ?? -1);
    case 'recency':
      return (b.latestReleasedAt ?? '').localeCompare(a.latestReleasedAt ?? '');
    case 'name':
      return a.displayName.localeCompare(b.displayName, 'en', { sensitivity: 'base' });
    default:
      return b.ranking.score - a.ranking.score;
  }
}

const SearchIcon = () => (
  <svg class="mosd-search-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
    <path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  </svg>
);

export function DirectoryBrowser(props: DirectoryBrowserProps) {
  const { feed, linkMode, baseUrl } = props;
  const pageSize = Math.max(1, props.pageSize ?? DEFAULT_PAGE_SIZE);
  const [query, setQuery] = useState(props.initialFilters?.query ?? '');
  const [category, setCategory] = useState(props.initialFilters?.category ?? '');
  const [quality] = useState<Set<string>>(new Set(props.initialFilters?.quality ?? []));
  const [flags, setFlags] = useState<Set<FilterFlag>>(
    new Set(props.initialFilters?.flags ?? []),
  );
  const [sort, setSort] = useState<SortKey>(props.initialFilters?.sort ?? 'recommended');
  const [showHidden, setShowHidden] = useState(false);
  const [limit, setLimit] = useState(pageSize);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const categories = useMemo(
    () =>
      feed.categories
        .filter((c) => c.packageCount > 0)
        .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })),
    [feed],
  );

  const categoryNames = useMemo(
    () => new Map(feed.categories.map((c) => [c.slug, c.name])),
    [feed],
  );

  const vendorNames = useMemo(
    () => new Map(feed.vendors.map((v) => [v.slug, v.name])),
    [feed],
  );

  const latestMagento = useMemo(() => latestMagentoVersion(feed.packages), [feed]);
  const popularFloor = useMemo(
    () => installsAtPercentile(feed.packages, POPULAR_PERCENTILE),
    [feed],
  );

  const magentoSupport = (pkg: PackageSummary): MagentoSupport | null => {
    const magento = props.magentoVersion;
    if (!magento) return null;
    if (pkg.supportedMagento.includes(magento)) {
      return { state: 'tested', version: pkg.latestVersion };
    }
    const older = pkg.compatibility[magento];
    if (older !== undefined) return { state: 'older', version: older };
    return { state: 'untested' };
  };

  /** What the install list pins: the newest release verified against the
   * host's Magento when that isn't the latest, else the latest. */
  const targetVersion = (pkg: PackageSummary): string | null => {
    const support = magentoSupport(pkg);
    return support?.state === 'older' ? support.version : pkg.latestVersion;
  };

  const installed = props.installed;
  const installState = (pkg: PackageSummary): InstallState => {
    const version = installed?.[pkg.name];
    if (version === undefined) return 'not-installed';
    const target = targetVersion(pkg);
    return target && isNewer(target, version) ? 'update' : 'installed';
  };

  /**
   * The host knows something about this shop — its Magento version, its
   * composer.lock, or both. That is what separates the embedded surface from
   * the public site, and it is what promotes the fit answer to the top of
   * the card.
   */
  const hostAware = props.magentoVersion !== undefined || installed !== undefined;

  /** "Tested with" targets the shop's version when known, else the newest
   * version anything in the catalog was verified against. */
  const testedTarget = props.magentoVersion ?? latestMagento;
  const testedWith = (pkg: PackageSummary): boolean => {
    if (props.magentoVersion) return magentoSupport(pkg)?.state !== 'untested';
    return testedTarget !== null && pkg.supportedMagento.includes(testedTarget);
  };

  /**
   * The chips, in the order a reader shortlists: who is behind it, does it
   * fit, is it maintained, is it sound, is it used — then, where the host
   * knows the shop, where I stand with it. Each is a yes/no the card can
   * show, so a chip never hides something the card wouldn't have said.
   */
  const chips: Array<{ flag: FilterFlag; label: string; title: string }> = [
    { flag: 'trusted', label: 'Trusted vendor', title: 'From a vendor with a sustained track record' },
    { flag: 'picks', label: 'Editors’ picks', title: 'Selected by the Mage-OS maintainers' },
  ];
  if (testedTarget !== null) {
    chips.push({
      flag: 'tested',
      label: `Tested with ${testedTarget}`,
      title: props.magentoVersion
        ? `A release is verified against your Magento ${props.magentoVersion}`
        : `The latest release is verified against Magento ${testedTarget}, the newest version in the catalog`,
    });
  }
  chips.push(
    { flag: 'recent', label: 'Recently updated', title: 'Released in the last 12 months' },
    { flag: 'quality', label: 'High quality', title: 'PackageMaven found no errors' },
  );
  if (popularFloor !== null) {
    chips.push({
      flag: 'popular',
      label: 'Popular',
      title: `Top quarter of the catalog by installs (${installsLabel(popularFloor)}+)`,
    });
  }
  if (installed) {
    chips.push(
      { flag: 'installed', label: 'Installed', title: 'Already in this shop’s composer.lock' },
      { flag: 'update', label: 'Update available', title: 'A newer verified release than the one installed' },
    );
  }

  const passesFlag = (pkg: PackageSummary, flag: FilterFlag): boolean => {
    switch (flag) {
      case 'trusted':
        return pkg.trust.trustedVendor;
      case 'picks':
        return pkg.trust.editorialPick;
      case 'tested':
        return testedWith(pkg);
      case 'recent':
        return isRecent(pkg);
      case 'quality':
        return isHighQuality(pkg);
      case 'popular':
        return (
          popularFloor !== null &&
          pkg.popularity.installs !== null &&
          pkg.popularity.installs >= popularFloor
        );
      case 'installed':
        return installState(pkg) !== 'not-installed';
      case 'update':
        return installState(pkg) === 'update';
      default:
        return true;
    }
  };

  const search = useMemo(() => {
    const index = new MiniSearch<PackageSummary>({
      idField: 'name',
      fields: ['name', 'displayName', 'description', 'vendor'],
      searchOptions: { boost: { displayName: 3, name: 2 }, prefix: true, fuzzy: 0.15 },
    });
    index.addAll(feed.packages);
    return index;
  }, [feed]);

  const staleSource = feed.sources.find((s) => s.id === 'packagemaven' && s.stale);
  const dataAsOf = staleSource?.fetchedAt ?? null;

  const results = useMemo(() => {
    const byName = new Map(feed.packages.map((p) => [p.name, p]));
    let matched: PackageSummary[];
    if (query.trim()) {
      matched = search
        .search(query)
        .map((r) => byName.get(r.id as string))
        .filter((p): p is PackageSummary => p !== undefined);
    } else {
      matched = [...feed.packages].sort((a, b) => compare(a, b, sort));
    }
    if (query.trim() && sort !== 'recommended') {
      matched = [...matched].sort((a, b) => compare(a, b, sort));
    }
    return matched.filter(
      (p) =>
        (showHidden || !p.trust.hidden) &&
        (category === '' || p.categories.includes(category)) &&
        (quality.size === 0 || (p.quality.tier !== null && quality.has(p.quality.tier))) &&
        [...flags].every((flag) => passesFlag(p, flag)),
    );
  }, [
    feed,
    search,
    query,
    category,
    quality,
    flags,
    sort,
    showHidden,
    installed,
    props.magentoVersion,
  ]);

  // Every change to what is being asked starts the list over from the top.
  useEffect(() => {
    setLimit(pageSize);
  }, [query, category, flags, sort, showHidden, pageSize]);

  const filtersActive = query.trim() !== '' || category !== '' || flags.size > 0;

  // Report filter state after it settles, never on mount: the host seeded it.
  const reportedOnce = useRef(false);
  useEffect(() => {
    if (!reportedOnce.current) {
      reportedOnce.current = true;
      return;
    }
    props.onFiltersChange?.({
      query: query.trim() || undefined,
      category: category || undefined,
      flags: flags.size > 0 ? [...flags] : undefined,
      sort: sort === 'recommended' ? undefined : sort,
    });
  }, [query, category, flags, sort]);

  const toggleFlag = (flag: FilterFlag) => {
    const next = new Set(flags);
    if (next.has(flag)) next.delete(flag);
    else next.add(flag);
    setFlags(next);
  };

  const clearFilters = () => {
    setQuery('');
    setCategory('');
    setFlags(new Set());
  };

  const select = (event: Event, pkg: PackageSummary) => {
    if (linkMode === 'event') {
      event.preventDefault();
      props.onSelect?.({ name: pkg.name, vendor: pkg.vendor, packageUrl: packageUrl(baseUrl, pkg) });
    }
  };

  const markedEntries = feed.packages
    .filter((p) => marked.has(p.name))
    .map((p) => ({ name: p.name, version: targetVersion(p) }));
  const command = markedEntries.length > 0 ? composerCommand(markedEntries) : '';

  // Emit selection changes from an effect (not the click handler) so rapid
  // marks can't act on a stale set; skip the initial mount's empty state.
  const emittedOnce = useRef(false);
  useEffect(() => {
    if (!emittedOnce.current) {
      emittedOnce.current = true;
      return;
    }
    props.onSelectionChange?.({ packages: markedEntries, command });
  }, [marked]);

  const toggleMark = (pkg: PackageSummary) => {
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(pkg.name)) next.delete(pkg.name);
      else next.add(pkg.name);
      return next;
    });
    setCopied(false);
  };

  const clearMarks = () => {
    setMarked(new Set());
    setCopied(false);
  };

  const copyCommand = () => {
    navigator.clipboard?.writeText(command).then(
      () => setCopied(true),
      () => {},
    );
  };

  /**
   * The card's fit answer. With a host Magento version it leads the card in
   * a coloured strip; without one it is a neutral range in the footer. The
   * wording stays PackageMaven's: a missing test result is "not tested",
   * never "incompatible", and an older verified release is named so the
   * reader can see what the install list would pin.
   */
  const fitLine = (pkg: PackageSummary): { tone: string; text: string } | null => {
    const support = magentoSupport(pkg);
    if (support === null) {
      const span = magentoRange(pkg);
      return span === null ? null : { tone: 'plain', text: `Magento ${span}` };
    }
    if (support.state === 'tested') {
      return { tone: 'ok', text: `Tested with ${props.magentoVersion}` };
    }
    if (support.state === 'older') {
      return { tone: 'older', text: `v${support.version} tested with ${props.magentoVersion}` };
    }
    return { tone: 'untested', text: `Not tested with ${props.magentoVersion}` };
  };

  /** Where the reader stands with the package — admin surfaces only. */
  const stateTag = (pkg: PackageSummary) => {
    const state = installState(pkg);
    if (state === 'installed') {
      return (
        <span class="mosd-state mosd-state-installed">
          <span aria-hidden="true">✓</span> Installed v{installed![pkg.name]}
        </span>
      );
    }
    if (state === 'update') {
      return (
        <span class="mosd-state mosd-state-update">
          <span aria-hidden="true">↑</span> Update v{installed![pkg.name]} → v
          {targetVersion(pkg)}
        </span>
      );
    }
    return null;
  };

  /**
   * A rail is a fact the system knows, a ring is a choice the reader made,
   * and a card is often both — so they are separate classes that compose.
   * Risk outranks install state: an abandoned module you have installed is
   * the most useful thing this view can tell anyone.
   */
  const cardClass = (pkg: PackageSummary): string => {
    const state = installState(pkg);
    const rail = isRisky(pkg)
      ? 'mosd-is-risk'
      : state === 'update'
        ? 'mosd-is-update'
        : state === 'installed'
          ? 'mosd-is-installed'
          : '';
    if (!marked.has(pkg.name)) return `mosd-card ${rail}`.trim();
    // Nothing else is claiming the surface, so the selection may tint it.
    const solo = rail === '' ? ' mosd-is-marked-only' : '';
    return `mosd-card ${rail} mosd-is-marked${solo}`.replace(/\s+/g, ' ').trim();
  };

  /** The first warning, in full, plus what the maintainer suggests instead. */
  const riskLine = (pkg: PackageSummary) => {
    if (!isRisky(pkg)) return null;
    const [warning, ...rest] = pkg.trust.warnings;
    return (
      <p class="mosd-card-risk">
        <span class="mosd-risk-mark" aria-hidden="true">⚠</span>
        <span>
          {pkg.abandoned === true && 'Abandoned by its maintainer. '}
          {warning !== undefined && `${warning.message} `}
          {pkg.abandonedReplacement !== null && (
            <>
              Replaced by <code>{pkg.abandonedReplacement}</code>.{' '}
            </>
          )}
          {rest.length > 0 && `+${rest.length} more warning${rest.length === 1 ? '' : 's'}.`}
        </span>
      </p>
    );
  };

  const shown = results.slice(0, limit);
  const remaining = results.length - shown.length;
  const total = feed.packages.filter((p) => showHidden || !p.trust.hidden).length;
  const scheme = props.colorScheme ?? 'auto';

  return (
    <div class="mosd-browser" data-mosd-scheme={scheme === 'auto' ? undefined : scheme}>
      {dataAsOf && (
        <p class="mosd-stale-notice" role="status">
          Quality data as of {dataAsOf.slice(0, 10)} — the live source was unavailable at the
          last update.
        </p>
      )}
      <div class="mosd-panel">
        <div class="mosd-controls">
          <label class="mosd-search-field">
            <SearchIcon />
            <input
              class="mosd-search"
              type="search"
              placeholder="Search by name, package or purpose…"
              aria-label="Search modules"
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            />
          </label>
          <label class="mosd-select-field mosd-category-field">
            <span class="mosd-select-label">Category</span>
            <select
              class="mosd-category"
              aria-label="Category"
              value={category}
              onChange={(e) => setCategory((e.target as HTMLSelectElement).value)}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name} ({c.packageCount})
                </option>
              ))}
            </select>
          </label>
          <label class="mosd-select-field">
            <span class="mosd-select-label">Sort</span>
            <select
              class="mosd-sort"
              aria-label="Sort by"
              value={sort}
              onChange={(e) => setSort((e.target as HTMLSelectElement).value as SortKey)}
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div class="mosd-chip-row mosd-category-row" role="group" aria-label="Category">
          <span class="mosd-chip-row-label">Category</span>
          <button
            type="button"
            class="mosd-filter-chip mosd-category-chip"
            aria-pressed={category === ''}
            onClick={() => setCategory('')}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.slug}
              type="button"
              class="mosd-filter-chip mosd-category-chip"
              aria-pressed={category === c.slug}
              onClick={() => setCategory(category === c.slug ? '' : c.slug)}
            >
              {c.name} <span class="mosd-chip-count">{c.packageCount}</span>
            </button>
          ))}
        </div>
        <div class="mosd-chip-row" role="group" aria-label="Show only">
          <span class="mosd-chip-row-label">Show only</span>
          {chips.map((chip) => (
            <button
              key={chip.flag}
              type="button"
              class={`mosd-filter-chip mosd-flag-${chip.flag}`}
              aria-pressed={flags.has(chip.flag)}
              title={chip.title}
              onClick={() => toggleFlag(chip.flag)}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <div class="mosd-panel-foot">
          <p class="mosd-count" role="status">
            {results.length === total ? (
              <>
                Showing <strong>{Math.min(shown.length, results.length)}</strong> of{' '}
                <strong>{total}</strong> modules
              </>
            ) : (
              <>
                <strong>{results.length}</strong> of {total} modules match
                {shown.length < results.length && <> · showing {shown.length}</>}
              </>
            )}
          </p>
          {feed.packages.some((p) => p.trust.hidden) && (
            <label class="mosd-show-hidden">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={() => setShowHidden(!showHidden)}
              />{' '}
              include withdrawn listings
            </label>
          )}
          {filtersActive && (
            <button type="button" class="mosd-link-btn mosd-clear" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      </div>
      <ul class="mosd-results">
        {shown.map((pkg) => {
          const fit = fitLine(pkg);
          const state = stateTag(pkg);
          // The fit answer leads the card wherever the host knows something
          // about this shop; otherwise it is a neutral note in the footer.
          const leads = fit !== null && hostAware;
          const age = releasedAgo(pkg.latestReleasedAt);
          return (
            <li key={pkg.name} class={cardClass(pkg)}>
              {leads && (
                <p class={`mosd-card-fit mosd-fit-${fit.tone}`}>
                  <span>{fit.text}</span>
                  {state}
                </p>
              )}
              <div class="mosd-card-body">
                <div class="mosd-card-head">
                  <a
                    class="mosd-card-title"
                    href={packageUrl(baseUrl, pkg)}
                    onClick={(e) => select(e, pkg)}
                  >
                    {pkg.displayName}
                  </a>
                  <span
                    class={`mosd-badge mosd-badge-quality mosd-badge-${pkg.quality.tier ?? 'untested'}`}
                  >
                    {qualityLabel(pkg.quality.tier)}
                  </span>
                  <p class="mosd-card-name">
                    <code>{pkg.name}</code>
                  </p>
                </div>
                {!leads && state !== null && <p class="mosd-card-state">{state}</p>}
                <p class="mosd-card-description">{pkg.description}</p>
                <p class="mosd-card-vendor">
                  {linkMode === 'href' ? (
                    <a href={`${baseUrl}/vendors/${pkg.vendor}/`}>
                      {vendorNames.get(pkg.vendor) ?? pkg.vendor}
                    </a>
                  ) : (
                    <span>{vendorNames.get(pkg.vendor) ?? pkg.vendor}</span>
                  )}
                  {pkg.trust.trustedVendor && (
                    <span class="mosd-trust-mark">✓ Trusted vendor</span>
                  )}
                  {pkg.trust.partnerTier && (
                    <span class="mosd-trust-partner">
                      {pkg.trust.partnerTier[0].toUpperCase() + pkg.trust.partnerTier.slice(1)}{' '}
                      partner
                    </span>
                  )}
                  {pkg.trust.editorialPick && <span class="mosd-trust-pick">★ Editors’ pick</span>}
                </p>
                {riskLine(pkg)}
                <div class="mosd-card-categories">
                  {pkg.categories.slice(0, 2).map((slug) => (
                    <button
                      key={slug}
                      type="button"
                      class="mosd-chip"
                      aria-pressed={category === slug}
                      onClick={() => setCategory(slug)}
                    >
                      {categoryNames.get(slug) ?? slug}
                    </button>
                  ))}
                </div>
                <p class="mosd-card-stats">
                  {pkg.popularity.installs !== null && (
                    <span class="mosd-stat">
                      <strong>{installsLabel(pkg.popularity.installs)}</strong> installs
                    </span>
                  )}
                  {age !== null && <span class="mosd-stat">{age}</span>}
                  {!leads && fit !== null && (
                    <span class="mosd-card-span">{fit.text}</span>
                  )}
                </p>
                {props.selectable && installState(pkg) !== 'installed' && (
                  <p class="mosd-card-actions">
                    <button
                      type="button"
                      class={`mosd-mark${marked.has(pkg.name) ? ' mosd-marked' : ''}`}
                      onClick={() => toggleMark(pkg)}
                    >
                      {marked.has(pkg.name)
                        ? '✓ On install list'
                        : installState(pkg) === 'update'
                          ? '+ Mark for update'
                          : '+ Mark for install'}
                    </button>
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {results.length === 0 && (
        <div class="mosd-empty">
          <p class="mosd-empty-title">No modules match</p>
          <p>Try a different search, or widen the filters.</p>
          {filtersActive && (
            <button type="button" class="mosd-btn" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      )}
      {remaining > 0 && (
        <div class="mosd-more">
          <button
            type="button"
            class="mosd-btn mosd-btn-more"
            onClick={() => setLimit(limit + pageSize)}
          >
            Show {Math.min(pageSize, remaining)} more
          </button>
          <span class="mosd-more-note">{remaining} more not shown</span>
        </div>
      )}
      {props.selectable && marked.size > 0 && (
        <div class="mosd-tray" role="region" aria-label="Install list">
          <span class="mosd-tray-count">
            {marked.size} module{marked.size === 1 ? '' : 's'} marked
          </span>
          <code class="mosd-tray-command">{command}</code>
          <button type="button" class="mosd-btn mosd-btn-primary" onClick={copyCommand}>
            {copied ? 'Copied ✓' : 'Copy command'}
          </button>
          <button type="button" class="mosd-btn" onClick={clearMarks}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

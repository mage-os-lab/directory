import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import MiniSearch from 'minisearch';
import { QUALITY_LABELS, qualityLabel } from '../shared/quality.js';
import { compareVersions, isNewer } from '../shared/version.js';
import type {
  DirectoryFilters,
  Feed,
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

const INSTALL_FILTERS: Array<{ key: '' | InstallState; label: string }> = [
  { key: '', label: 'All modules' },
  { key: 'installed', label: 'Installed' },
  { key: 'update', label: 'Update available' },
  { key: 'not-installed', label: 'Not installed' },
];

export function composerCommand(entries: Array<{ name: string; version: string | null }>): string {
  const args = entries.map((e) => (e.version ? `${e.name}:^${e.version}` : e.name));
  return `composer require ${args.join(' ')}`;
}

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'recommended', label: 'Recommended' },
  { key: 'installs', label: 'Most installed' },
  { key: 'stars', label: 'Most starred' },
  { key: 'recency', label: 'Recently released' },
  { key: 'name', label: 'Name' },
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
      return a.name.localeCompare(b.name);
    default:
      return b.ranking.score - a.ranking.score;
  }
}

export function DirectoryBrowser(props: DirectoryBrowserProps) {
  const { feed, linkMode, baseUrl } = props;
  const [query, setQuery] = useState(props.initialFilters?.query ?? '');
  const [category, setCategory] = useState(props.initialFilters?.category ?? '');
  const [quality, setQuality] = useState<Set<string>>(
    new Set(props.initialFilters?.quality ?? []),
  );
  const [sort, setSort] = useState<SortKey>('recommended');
  const [showHidden, setShowHidden] = useState(false);
  const [installFilter, setInstallFilter] = useState<'' | InstallState>('');
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const categoryNames = useMemo(
    () => new Map(feed.categories.map((c) => [c.slug, c.name])),
    [feed],
  );

  const vendorNames = useMemo(
    () => new Map(feed.vendors.map((v) => [v.slug, v.name])),
    [feed],
  );

  const [testedOnly, setTestedOnly] = useState(false);

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
        (installFilter === '' || installState(p) === installFilter) &&
        (!testedOnly || magentoSupport(p)?.state !== 'untested'),
    );
  }, [
    feed,
    search,
    query,
    category,
    quality,
    sort,
    showHidden,
    installFilter,
    installed,
    testedOnly,
    props.magentoVersion,
  ]);

  const toggleQuality = (tier: string) => {
    const next = new Set(quality);
    if (next.has(tier)) next.delete(tier);
    else next.add(tier);
    setQuality(next);
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

  return (
    <div class="mosd-browser">
      {dataAsOf && (
        <p class="mosd-stale-notice" role="status">
          Quality data as of {dataAsOf.slice(0, 10)} — the live source was unavailable at the
          last update.
        </p>
      )}
      <div class="mosd-controls">
        <input
          class="mosd-search"
          type="search"
          placeholder="Search modules…"
          aria-label="Search modules"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        <select
          class="mosd-category"
          aria-label="Category"
          value={category}
          onChange={(e) => setCategory((e.target as HTMLSelectElement).value)}
        >
          <option value="">All categories</option>
          {feed.categories
            .filter((c) => c.packageCount > 0)
            .map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name} ({c.packageCount})
              </option>
            ))}
        </select>
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
        {installed && (
          <select
            class="mosd-install-filter"
            aria-label="Installed state"
            value={installFilter}
            onChange={(e) =>
              setInstallFilter((e.target as HTMLSelectElement).value as '' | InstallState)
            }
          >
            {INSTALL_FILTERS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        )}
      </div>
      <div class="mosd-quality-filters" role="group" aria-label="Quality tier">
        {Object.entries(QUALITY_LABELS).map(([tier, label]) => (
          <label key={tier} class="mosd-quality-toggle">
            <input
              type="checkbox"
              checked={quality.has(tier)}
              onChange={() => toggleQuality(tier)}
            />{' '}
            {label}
          </label>
        ))}
        {props.magentoVersion && (
          <label class="mosd-quality-toggle mosd-tested-toggle">
            <input
              type="checkbox"
              checked={testedOnly}
              onChange={() => setTestedOnly(!testedOnly)}
            />{' '}
            Tested with {props.magentoVersion}
          </label>
        )}
      </div>
      <p class="mosd-count" role="status">
        {results.length} module{results.length === 1 ? '' : 's'}
        {feed.packages.some((p) => p.trust.hidden) && (
          <label class="mosd-show-hidden">
            {' '}
            <input
              type="checkbox"
              checked={showHidden}
              onChange={() => setShowHidden(!showHidden)}
            />{' '}
            include withdrawn listings
          </label>
        )}
      </p>
      <ul class="mosd-results">
        {results.map((pkg) => {
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
      {results.length === 0 && <p class="mosd-empty">No modules match. Try widening the filters.</p>}
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

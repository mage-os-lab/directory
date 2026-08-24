import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import MiniSearch from 'minisearch';
import { isNewer } from '../shared/version.js';
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

const QUALITY_LABELS: Record<string, string> = {
  'strict-compliant': 'Strict compliant',
  'no-errors': 'No errors',
  'ready-to-install': 'Ready to install',
  'needs-help': 'Needs help',
};

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
  const [copiedCard, setCopiedCard] = useState<string | null>(null);

  const categoryNames = useMemo(
    () => new Map(feed.categories.map((c) => [c.slug, c.name])),
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

  const copyRequire = (pkg: PackageSummary) => {
    const single = composerCommand([{ name: pkg.name, version: targetVersion(pkg) }]);
    navigator.clipboard?.writeText(single).then(
      () => setCopiedCard(pkg.name),
      () => {},
    );
  };

  const magentoBadge = (pkg: PackageSummary) => {
    const support = magentoSupport(pkg);
    if (support === null) return null;
    if (support.state === 'tested') {
      return (
        <span class="mosd-badge mosd-badge-compat-ok">Tested with {props.magentoVersion}</span>
      );
    }
    if (support.state === 'older') {
      return (
        <span class="mosd-badge mosd-badge-compat-older">
          v{support.version} tested with {props.magentoVersion}
        </span>
      );
    }
    return (
      <span class="mosd-badge mosd-badge-compat-untested">
        Not tested with {props.magentoVersion}
      </span>
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
        {results.map((pkg) => (
          <li key={pkg.name} class="mosd-card">
            <div class="mosd-card-band">
              <div class="mosd-card-head">
                <a
                  class="mosd-card-title"
                  href={packageUrl(baseUrl, pkg)}
                  onClick={(e) => select(e, pkg)}
                >
                  {pkg.displayName}
                </a>
                <span class={`mosd-badge mosd-badge-quality mosd-badge-${pkg.quality.tier ?? 'untested'}`}>
                  {pkg.quality.tier ? QUALITY_LABELS[pkg.quality.tier] : 'Not yet tested'}
                </span>
              </div>
              <p class="mosd-card-name">
                <code>{pkg.name}</code>
              </p>
            </div>
            <div class="mosd-card-body">
            <p class="mosd-card-vendor">
              by{' '}
              {linkMode === 'href' ? (
                <a href={`${baseUrl}/vendors/${pkg.vendor}/`}>{pkg.vendor}</a>
              ) : (
                pkg.vendor
              )}
            </p>
            <div class="mosd-card-categories">
              {pkg.categories.slice(0, 3).map((slug) => (
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
            <p class="mosd-card-description">{pkg.description}</p>
            <p class="mosd-card-stats">
              {pkg.popularity.githubStars !== null && (
                <span class="mosd-stat">
                  ★ <strong>{pkg.popularity.githubStars.toLocaleString()}</strong>
                </span>
              )}
              {pkg.popularity.installs !== null && (
                <span class="mosd-stat">
                  ⤓ <strong>{pkg.popularity.installs.toLocaleString()}</strong>
                </span>
              )}
              {pkg.quality.phpstanLevel !== null && pkg.quality.phpstanLevel >= 0 && (
                <span class="mosd-stat">
                  PHPStan <strong>L{pkg.quality.phpstanLevel}</strong>
                </span>
              )}
              {pkg.quality.semver !== null && pkg.quality.semver.compliancePercent !== null && (
                <span class="mosd-stat">
                  SemVer <strong>{pkg.quality.semver.compliancePercent}%</strong>
                </span>
              )}
              {pkg.latestVersion && (
                <span class="mosd-stat">
                  <strong>v{pkg.latestVersion}</strong>
                </span>
              )}
            </p>
            <p class="mosd-card-meta">
              {pkg.trust.editorialPick && <span class="mosd-badge mosd-badge-pick">Editors’ pick</span>}
              {pkg.trust.trustedVendor && (
                <span class="mosd-badge mosd-badge-trusted">Trusted vendor</span>
              )}
              {pkg.trust.partnerTier && (
                <span class={`mosd-badge mosd-badge-partner-${pkg.trust.partnerTier}`}>
                  {pkg.trust.partnerTier} partner
                </span>
              )}
              {pkg.trust.warnings.length > 0 && (
                <span class="mosd-badge mosd-badge-warning">
                  {pkg.trust.warnings.length} warning{pkg.trust.warnings.length === 1 ? '' : 's'}
                </span>
              )}
              {pkg.abandoned && <span class="mosd-badge mosd-badge-abandoned">Abandoned</span>}
              {magentoBadge(pkg)}
              {installState(pkg) === 'installed' && (
                <span class="mosd-badge mosd-badge-installed">
                  Installed v{installed![pkg.name]}
                </span>
              )}
              {installState(pkg) === 'update' && (
                <span class="mosd-badge mosd-badge-update">
                  Installed v{installed![pkg.name]} → v{targetVersion(pkg)}
                </span>
              )}
            </p>
            <div class="mosd-require">
              <code>{composerCommand([{ name: pkg.name, version: targetVersion(pkg) }])}</code>
              <button
                type="button"
                class="mosd-require-copy"
                aria-label={`Copy composer command for ${pkg.name}`}
                onClick={() => copyRequire(pkg)}
              >
                {copiedCard === pkg.name ? '✓ Copied' : 'Copy'}
              </button>
            </div>
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
            {pkg.quality.tier === 'needs-help' && (
              <p class="mosd-contribute">
                {pkg.repositoryUrl ? (
                  <a href={pkg.repositoryUrl} rel="noopener">
                    Needs help — contribute on the repository →
                  </a>
                ) : (
                  'Needs help — contributions welcome'
                )}
              </p>
            )}
            </div>
          </li>
        ))}
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

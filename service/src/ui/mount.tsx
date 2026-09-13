/**
 * mountDirectory — the embeddable-bundle entry and the contract the future
 * Magento admin module consumes. See docs/architecture.md "Site and
 * embeddable UI" for the specified behavior:
 *  - linkMode 'event': selecting a package dispatches a bubbling, composed
 *    CustomEvent('mosd:select', {detail: {name, vendor, packageUrl,
 *    installState, markable, marked}}) on the mount element instead of
 *    navigating; the last three let the host offer the same mark toggle
 *    wherever it shows the package.
 *  - Feed fetch failure renders a retryable error state and dispatches
 *    CustomEvent('mosd:error'); mountDirectory never throws asynchronously.
 *  - shadow: true (default) renders into an open Shadow DOM with the styles
 *    injected inside it — host-page CSS can't leak in, theming still works
 *    via CSS custom properties.
 *  - installed (composer name → version, read from the host's composer.lock)
 *    adds Installed/update badges and an installed-state filter; selectable
 *    adds mark-for-install toggles and a copyable composer-require tray, with
 *    every change dispatched as CustomEvent('mosd:selection',
 *    {detail: {packages, command}}). The list is kept in sessionStorage per
 *    tab, so a reload restores it (and dispatches it once on mount). The host
 *    can change the list itself by dispatching CustomEvent('mosd:mark',
 *    {detail: {name, marked?}}) on the mount element — toggle, or set — under
 *    the same rules as the card's own toggle; the result comes back as
 *    mosd:selection.
 *  - magentoVersion (the host shop's Magento release, or the one its
 *    distribution is built on) adds tested-with badges from PM's test matrix,
 *    points the "tested with" filter at that version, and makes the install
 *    list pin the newest release verified against it ("not tested" is never
 *    presented as "incompatible"). Matching is by release line, so a shop on
 *    2.4.9-p1 matches PM's 2.4.9 results. distribution ({name, version}, e.g.
 *    Mage-OS 3.5.0) relabels every "tested with" with the version the admin
 *    recognises, leaving the Magento number to the chip's tooltip; it is
 *    ignored without magentoVersion.
 *  - colorScheme pins the palette ('light' | 'dark') for hosts whose chrome
 *    has only one; the default 'auto' follows prefers-color-scheme.
 *  - pageSize caps the cards rendered before a "Show more" button (24).
 */
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { DirectoryBrowser } from './DirectoryBrowser.js';
import type {
  ColorScheme,
  Feed,
  MarkDetail,
  MountOptions,
  SelectDetail,
  SelectionDetail,
} from './types.js';
// The plain import makes the library build emit directory-ui.css, which is
// what shadow:false embedders link. The ?inline import is the same styles as
// a string, injected into the shadow root for the default shadow:true path.
import './directory.css';
import styles from './directory.css?inline';

interface RootProps {
  options: Required<Pick<MountOptions, 'feedUrl' | 'linkMode' | 'baseUrl'>> &
    Pick<
      MountOptions,
      | 'initialFilters'
      | 'installed'
      | 'selectable'
      | 'magentoVersion'
      | 'distribution'
      | 'colorScheme'
      | 'pageSize'
    >;
  host: HTMLElement;
}

/** The data attribute the stylesheet keys the pinned palette on; 'auto' sets none. */
function schemeAttr(scheme: ColorScheme | undefined): 'light' | 'dark' | undefined {
  return scheme === 'light' || scheme === 'dark' ? scheme : undefined;
}

function Root({ options, host }: RootProps) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch(options.feedUrl)
      .then(async (response) => {
        if (!response.ok) throw new Error(`feed fetch failed: HTTP ${response.status}`);
        return (await response.json()) as Feed;
      })
      .then((data) => {
        if (!cancelled) setFeed(data);
      })
      .catch((cause: Error) => {
        if (cancelled) return;
        setError(cause.message);
        host.dispatchEvent(
          new CustomEvent('mosd:error', {
            bubbles: true,
            composed: true,
            detail: { message: cause.message },
          }),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [options.feedUrl, attempt]);

  const scheme = schemeAttr(options.colorScheme);
  if (error !== null) {
    return (
      <div class="mosd-browser" data-mosd-scheme={scheme}>
        <p class="mosd-error">
          Could not load the module directory ({error}).
          <button type="button" onClick={() => setAttempt(attempt + 1)}>
            Retry
          </button>
        </p>
      </div>
    );
  }
  if (feed === null) {
    return (
      <div class="mosd-browser" data-mosd-scheme={scheme}>
        <p class="mosd-loading">Loading module directory…</p>
      </div>
    );
  }
  return (
    <DirectoryBrowser
      feed={feed}
      linkMode={options.linkMode}
      baseUrl={options.baseUrl}
      initialFilters={options.initialFilters}
      installed={options.installed}
      selectable={options.selectable}
      magentoVersion={options.magentoVersion}
      distribution={options.distribution}
      colorScheme={options.colorScheme}
      pageSize={options.pageSize}
      markSource={host}
      onSelect={(detail: SelectDetail) => {
        host.dispatchEvent(
          new CustomEvent('mosd:select', { bubbles: true, composed: true, detail }),
        );
      }}
      onSelectionChange={(detail: SelectionDetail) => {
        host.dispatchEvent(
          new CustomEvent('mosd:selection', { bubbles: true, composed: true, detail }),
        );
      }}
    />
  );
}

export function mountDirectory(el: HTMLElement, options: MountOptions = {}): () => void {
  const resolved = {
    feedUrl: options.feedUrl ?? '/api/v1/feed.json',
    linkMode: options.linkMode ?? 'href',
    baseUrl: (options.baseUrl ?? '').replace(/\/$/, ''),
    initialFilters: options.initialFilters,
    installed: options.installed,
    selectable: options.selectable ?? false,
    magentoVersion: options.magentoVersion,
    distribution: options.distribution,
    colorScheme: options.colorScheme,
    pageSize: options.pageSize,
  } as const;
  const shadow = options.shadow ?? true;

  let container: HTMLElement | ShadowRoot = el;
  if (shadow) {
    container = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    container.innerHTML = '';
    const style = document.createElement('style');
    style.textContent = styles;
    container.appendChild(style);
  }

  const target = document.createElement('div');
  container.appendChild(target);
  render(<Root options={resolved} host={el} />, target);

  return () => {
    render(null, target);
    target.remove();
    if (shadow && container instanceof ShadowRoot) container.innerHTML = '';
  };
}

export type { MarkDetail, MountOptions, SelectDetail, SelectionDetail };

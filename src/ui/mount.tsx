/**
 * mountDirectory — the embeddable-bundle entry and the contract the future
 * Magento admin module consumes. See docs/architecture.md "Site and
 * embeddable UI" for the specified behavior:
 *  - linkMode 'event': selecting a package dispatches a bubbling, composed
 *    CustomEvent('mosd:select', {detail: {name, vendor, packageUrl}}) on the
 *    mount element instead of navigating.
 *  - Feed fetch failure renders a retryable error state and dispatches
 *    CustomEvent('mosd:error'); mountDirectory never throws asynchronously.
 *  - shadow: true (default) renders into an open Shadow DOM with the styles
 *    injected inside it — host-page CSS can't leak in, theming still works
 *    via CSS custom properties.
 */
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { DirectoryBrowser } from './DirectoryBrowser.js';
import type { Feed, MountOptions, SelectDetail } from './types.js';
// Vite turns this into a plain string in both the Astro build and the
// library build, so the styles can be injected into the shadow root.
import styles from './directory.css?inline';

interface RootProps {
  options: Required<Pick<MountOptions, 'feedUrl' | 'linkMode' | 'baseUrl'>> &
    Pick<MountOptions, 'initialFilters'>;
  host: HTMLElement;
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

  if (error !== null) {
    return (
      <div class="mosd-browser">
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
      <div class="mosd-browser">
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
      onSelect={(detail: SelectDetail) => {
        host.dispatchEvent(
          new CustomEvent('mosd:select', { bubbles: true, composed: true, detail }),
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

export type { MountOptions, SelectDetail };

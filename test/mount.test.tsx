// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDirectory } from '../src/ui/mount.js';
import type { Feed } from '../src/ui/types.js';

const feed: Feed = {
  schemaVersion: 1,
  generatedAt: '2026-07-01T12:00:00.000Z',
  sources: [
    { id: 'packagemaven', ok: true, stale: false, fetchedAt: '2026-07-01T06:00:00.000Z' },
    { id: 'github', ok: false, stale: false, fetchedAt: null },
  ],
  rankingConfigVersion: 'test-1',
  categories: [{ slug: 'payments', name: 'Payments', packageCount: 1 }],
  vendors: [
    {
      slug: 'acme',
      name: 'Acme',
      url: null,
      trustedVendor: true,
      partnerTier: null,
      packageCount: 1,
    },
  ],
  packages: [
    {
      name: 'acme/module-pay',
      vendor: 'acme',
      displayName: 'Acme Pay',
      description: 'A payment method.',
      categories: ['payments'],
      repositoryUrl: null,
      latestVersion: '1.0.0',
      latestReleasedAt: '2026-06-01T00:00:00.000Z',
      supportedMagento: ['2.4.7'],
      abandoned: null,
      quality: { tier: 'no-errors', phpstanLevel: 5, buildStatus: 'passing', stale: false },
      trust: {
        trustedVendor: true,
        partnerTier: null,
        editorialPick: false,
        warnings: [],
        deranked: false,
        hidden: false,
      },
      popularity: { installs: 100, githubStars: null },
      ranking: { score: 0.7, components: { qualityTier: 0.8 } },
    },
  ],
};

// Preact effects flush on rAF and the feed load takes several microtask
// hops — give the loop a few macrotask turns to settle.
const flush = async () => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe('mountDirectory', () => {
  let el: HTMLElement;
  let unmount: (() => void) | null = null;

  beforeEach(() => {
    el = document.createElement('div');
    document.body.appendChild(el);
  });

  afterEach(() => {
    unmount?.();
    unmount = null;
    el.remove();
    vi.unstubAllGlobals();
  });

  it('renders into an open shadow root by default with styles inside', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(feed), { status: 200 })),
    );
    unmount = mountDirectory(el, { feedUrl: '/feed.json' });
    await flush();

    expect(el.shadowRoot).not.toBeNull();
    expect(el.shadowRoot!.querySelector('style')?.textContent).toContain('.mosd-browser');
    expect(el.shadowRoot!.textContent).toContain('Acme Pay');
  });

  it('dispatches mosd:select instead of navigating in event mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(feed), { status: 200 })),
    );
    unmount = mountDirectory(el, { feedUrl: '/feed.json', linkMode: 'event', shadow: false });
    await flush();

    const selected: unknown[] = [];
    el.addEventListener('mosd:select', (event) => selected.push((event as CustomEvent).detail));
    const link = el.querySelector<HTMLAnchorElement>('.mosd-card-title')!;
    link.click();

    expect(selected).toEqual([
      { name: 'acme/module-pay', vendor: 'acme', packageUrl: '/packages/acme/module-pay/' },
    ]);
  });

  it('renders a retryable error state and dispatches mosd:error on fetch failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(feed), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const errors: unknown[] = [];
    el.addEventListener('mosd:error', (event) => errors.push((event as CustomEvent).detail));

    unmount = mountDirectory(el, { feedUrl: '/feed.json', shadow: false });
    await flush();

    expect(errors).toEqual([{ message: 'feed fetch failed: HTTP 500' }]);
    const retry = el.querySelector<HTMLButtonElement>('.mosd-error button')!;
    expect(retry).not.toBeNull();

    retry.click();
    await flush();
    expect(el.textContent).toContain('Acme Pay');
  });

  it('unmount cleans the tree', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(feed), { status: 200 })),
    );
    unmount = mountDirectory(el, { feedUrl: '/feed.json' });
    await flush();
    unmount();
    unmount = null;
    expect(el.shadowRoot!.textContent).toBe('');
  });
});

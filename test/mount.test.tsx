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
    {
      name: 'acme/module-search',
      vendor: 'acme',
      displayName: 'Acme Search',
      description: 'A search engine.',
      categories: ['payments'],
      repositoryUrl: null,
      latestVersion: '2.1.0',
      latestReleasedAt: '2026-05-01T00:00:00.000Z',
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
      popularity: { installs: 20, githubStars: null },
      ranking: { score: 0.3, components: { qualityTier: 0.4 } },
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

  it('shows installed and update-available badges from the installed map', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(feed), { status: 200 })),
    );
    unmount = mountDirectory(el, {
      feedUrl: '/feed.json',
      shadow: false,
      installed: { 'acme/module-pay': '1.0.0', 'acme/module-search': '2.0.0' },
    });
    await flush();

    const badges = [...el.querySelectorAll('.mosd-badge-installed, .mosd-badge-update')].map(
      (b) => b.textContent,
    );
    expect(badges).toContain('Installed v1.0.0');
    expect(badges).toContain('Installed v2.0.0 → v2.1.0');
    // Up-to-date packages get no mark button even when selectable.
    expect(el.querySelector('select.mosd-install-filter')).not.toBeNull();
  });

  it('builds the composer command and dispatches mosd:selection when marking', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(feed), { status: 200 })),
    );
    const selections: unknown[] = [];
    el.addEventListener('mosd:selection', (event) =>
      selections.push((event as CustomEvent).detail),
    );
    unmount = mountDirectory(el, { feedUrl: '/feed.json', shadow: false, selectable: true });
    await flush();

    const buttons = [...el.querySelectorAll<HTMLButtonElement>('.mosd-mark')];
    expect(buttons).toHaveLength(2);
    buttons[0].click();
    await flush();
    [...el.querySelectorAll<HTMLButtonElement>('.mosd-mark')]
      .filter((b) => !b.classList.contains('mosd-marked'))[0]
      .click();
    await flush();

    expect(el.querySelector('.mosd-tray-command')!.textContent).toBe(
      'composer require acme/module-pay:^1.0.0 acme/module-search:^2.1.0',
    );
    expect(selections).toEqual([
      {
        packages: [{ name: 'acme/module-pay', version: '1.0.0' }],
        command: 'composer require acme/module-pay:^1.0.0',
      },
      {
        packages: [
          { name: 'acme/module-pay', version: '1.0.0' },
          { name: 'acme/module-search', version: '2.1.0' },
        ],
        command: 'composer require acme/module-pay:^1.0.0 acme/module-search:^2.1.0',
      },
    ]);

    // Clear empties the list and announces it.
    (el.querySelector('.mosd-tray .mosd-btn:not(.mosd-btn-primary)') as HTMLButtonElement).click();
    await flush();
    expect(el.querySelector('.mosd-tray')).toBeNull();
    expect(selections[2]).toEqual({ packages: [], command: '' });
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

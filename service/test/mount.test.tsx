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
      compatibility: { '2.4.7': '1.0.0', '2.4.6': '0.9.0' },
      abandoned: null,
      abandonedReplacement: null,
      quality: {
        tier: 'no-errors',
        phpstanLevel: 5,
        buildStatus: 'passing',
        semver: { status: 'compliant', compliancePercent: 100 },
        stale: false,
      },
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
      compatibility: { '2.4.7': '2.1.0' },
      abandoned: null,
      abandonedReplacement: null,
      quality: {
        tier: 'no-errors',
        phpstanLevel: 5,
        buildStatus: 'passing',
        semver: null,
        stale: false,
      },
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
    {
      name: 'acme/module-legacy',
      vendor: 'acme',
      displayName: 'Acme Legacy',
      description: 'An old integration.',
      categories: ['payments'],
      repositoryUrl: null,
      latestVersion: '0.4.0',
      latestReleasedAt: '2023-01-01T00:00:00.000Z',
      supportedMagento: [],
      compatibility: {},
      abandoned: true,
      abandonedReplacement: 'acme/module-modern',
      quality: {
        tier: null,
        phpstanLevel: null,
        buildStatus: 'unknown',
        semver: null,
        stale: false,
      },
      trust: {
        trustedVendor: false,
        partnerTier: null,
        editorialPick: false,
        warnings: [
          {
            code: 'unmaintained',
            severity: 'derank',
            message: 'No release since 2023.',
            date: '2026-05-01',
          },
        ],
        deranked: true,
        hidden: false,
      },
      popularity: { installs: 4, githubStars: null },
      ranking: { score: 0.1, components: { qualityTier: 0.1 } },
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

  it('shows install state and rails on the card from the installed map', async () => {
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

    const states = [...el.querySelectorAll('.mosd-state')].map((s) =>
      s.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(states).toContain('✓ Installed v1.0.0');
    expect(states).toContain('↑ Update v2.0.0 → v2.1.0');
    // The rail classes carry the same two states without relying on colour.
    expect(el.querySelectorAll('.mosd-card.mosd-is-installed')).toHaveLength(1);
    expect(el.querySelectorAll('.mosd-card.mosd-is-update')).toHaveLength(1);
    expect(el.querySelector('select.mosd-install-filter')).not.toBeNull();
  });

  it('leads the card with the fit line only when the host knows the shop', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(feed), { status: 200 })),
    );
    unmount = mountDirectory(el, { feedUrl: '/feed.json', shadow: false });
    await flush();

    // The public site has no shop to compare against: no strip, and the
    // tested range sits in the footer instead.
    expect(el.querySelector('.mosd-card-fit')).toBeNull();
    expect([...el.querySelectorAll('.mosd-card-span')].map((s) => s.textContent)).toEqual([
      'Magento 2.4.7',
      'Magento 2.4.7',
    ]);
    // The abandoned package has no tested Magento versions at all, so it
    // gets no range rather than an empty or invented one.
    expect(el.querySelectorAll('.mosd-card')).toHaveLength(3);
  });

  it('marks a card as selected without hiding the rail underneath it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(feed), { status: 200 })),
    );
    unmount = mountDirectory(el, {
      feedUrl: '/feed.json',
      shadow: false,
      selectable: true,
      installed: { 'acme/module-search': '2.0.0' },
    });
    await flush();

    const cardOf = (name: string) =>
      [...el.querySelectorAll('.mosd-card')].find((c) =>
        c.querySelector('.mosd-card-name')!.textContent!.includes(name),
      )!;
    // Marking an update keeps the update rail and adds the selection ring;
    // marking an otherwise plain package may tint the surface as well.
    (cardOf('module-search').querySelector('.mosd-mark') as HTMLButtonElement).click();
    (cardOf('acme/module-pay').querySelector('.mosd-mark') as HTMLButtonElement).click();
    await flush();

    expect([...cardOf('module-search').classList].sort()).toEqual([
      'mosd-card',
      'mosd-is-marked',
      'mosd-is-update',
    ]);
    expect([...cardOf('acme/module-pay').classList].sort()).toEqual([
      'mosd-card',
      'mosd-is-marked',
      'mosd-is-marked-only',
    ]);
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
    expect(buttons).toHaveLength(3);
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

  it('shows tested-with badges for the host Magento version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(feed), { status: 200 })),
    );
    unmount = mountDirectory(el, { feedUrl: '/feed.json', shadow: false, magentoVersion: '2.4.6' });
    await flush();

    const fits = [...el.querySelectorAll('.mosd-card-fit')].map((f) =>
      f.querySelector('span')!.textContent!.trim(),
    );
    // module-pay: latest not verified on 2.4.6, but 0.9.0 is; module-search: nothing is.
    expect(fits).toContain('v0.9.0 tested with 2.4.6');
    expect(fits).toContain('Not tested with 2.4.6');
    expect(el.querySelector('.mosd-card-fit.mosd-fit-older')).not.toBeNull();
    expect(el.querySelector('.mosd-card-fit.mosd-fit-untested')).not.toBeNull();

    // The tested-only toggle hides the untested package.
    const toggle = el.querySelector<HTMLInputElement>('.mosd-tested-toggle input')!;
    toggle.click();
    await flush();
    expect(el.textContent).toContain('Acme Pay');
    expect(el.textContent).not.toContain('Acme Search');
  });

  it('pins the newest release verified for the host Magento in the install list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(feed), { status: 200 })),
    );
    const selections: unknown[] = [];
    el.addEventListener('mosd:selection', (event) =>
      selections.push((event as CustomEvent).detail),
    );
    unmount = mountDirectory(el, {
      feedUrl: '/feed.json',
      shadow: false,
      selectable: true,
      magentoVersion: '2.4.6',
      // Installed 0.8.0 < the 2.4.6-verified 0.9.0 → update targeting 0.9.0,
      // NOT the 2.4.7-only 1.0.0.
      installed: { 'acme/module-pay': '0.8.0' },
    });
    await flush();

    expect(el.querySelector('.mosd-state-update')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      '↑ Update v0.8.0 → v0.9.0',
    );
    const updateButton = [...el.querySelectorAll<HTMLButtonElement>('.mosd-mark')].find((b) =>
      b.textContent!.includes('update'),
    )!;
    updateButton.click();
    await flush();

    expect(el.querySelector('.mosd-tray-command')!.textContent).toBe(
      'composer require acme/module-pay:^0.9.0',
    );
    expect(selections).toEqual([
      {
        packages: [{ name: 'acme/module-pay', version: '0.9.0' }],
        command: 'composer require acme/module-pay:^0.9.0',
      },
    ]);
  });

  it('states the risk in full, and lets it outrank the installed rail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(feed), { status: 200 })),
    );
    unmount = mountDirectory(el, {
      feedUrl: '/feed.json',
      shadow: false,
      installed: { 'acme/module-legacy': '0.4.0' },
    });
    await flush();

    const risky = el.querySelector('.mosd-card.mosd-is-risk')!;
    expect(risky.querySelector('.mosd-card-name')!.textContent).toBe('acme/module-legacy');
    // Abandonment, the maintainer's replacement and the warning, in words —
    // not a "1 warning" count.
    expect(risky.querySelector('.mosd-card-risk')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      '⚠Abandoned by its maintainer. No release since 2023. Replaced by acme/module-modern.',
    );
    // Risk wins the rail; the card still says which version is installed.
    expect(risky.classList.contains('mosd-is-installed')).toBe(false);
    expect(risky.querySelector('.mosd-state')!.textContent).toContain('Installed v0.4.0');
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

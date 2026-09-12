import { describe, expect, it } from 'vitest';
import {
  cleanDisplayName,
  fetchPackageMavenSnapshot,
  isRedundantName,
  normalizePmApiPackage,
  tierFromFlags,
  type PmApiPackage,
} from '../src/pipeline/packagemaven.js';
import { packageMavenSnapshot } from '../src/schema/source.js';

const now = new Date('2026-07-10T00:00:00.000Z');

/** A realistic PM API record (see docs/packagemaven-openapi.json). */
function apiPackage(overrides: Partial<PmApiPackage> = {}): PmApiPackage {
  return {
    composer_name: 'acme/module-widget',
    name: 'Acme Widget Manager',
    description: 'Adds a widget management grid.',
    repository_url: 'https://github.com/acme/module-widget',
    license: 'MIT',
    abandoned: { is_abandoned: false, replacement: null },
    latest_release: { version: '2.3.1', date: '2026-05-14T09:30:00+00:00' },
    stats: { stars: 42, open_issues: 3, installs: 1834 },
    quality: { strict_compliant: false, no_errors: true, build_works: true, needs_help: false },
    test_results: {
      magento_version: '2.4.9',
      package_version: '2.3.1',
      phpstan_level: 6,
    },
    semver: { status: 'compliant', compliance_percent: 100 },
    categories: [{ slug: 'developer-tools' }, { slug: 'admin-tools' }],
    links: { web: 'https://package-maven.com/acme/module-widget' },
    ...overrides,
  };
}

describe('tierFromFlags', () => {
  it('picks the highest tier and treats all-false as untested', () => {
    const flags = (
      strict: boolean,
      noErrors: boolean,
      works: boolean,
      help: boolean,
    ): PmApiPackage['quality'] => ({
      strict_compliant: strict,
      no_errors: noErrors,
      build_works: works,
      needs_help: help,
    });
    expect(tierFromFlags(flags(true, true, true, false))).toBe('strict-compliant');
    expect(tierFromFlags(flags(false, true, true, false))).toBe('no-errors');
    expect(tierFromFlags(flags(false, false, true, false))).toBe('ready-to-install');
    expect(tierFromFlags(flags(false, false, false, true))).toBe('needs-help');
    expect(tierFromFlags(flags(false, false, false, false))).toBeNull();
  });
});

describe('cleanDisplayName', () => {
  it('drops a redundant leading Magento2 / Module word', () => {
    expect(cleanDisplayName('Magento2 Google Tag Manager')).toBe('Google Tag Manager');
    expect(cleanDisplayName('Magento 2 Foo')).toBe('Foo');
    expect(cleanDisplayName('Module Foo')).toBe('Foo');
  });

  it('strips repeated prefixes regardless of case', () => {
    expect(cleanDisplayName('magento2 module foo')).toBe('foo');
    expect(cleanDisplayName('Magento2 Module Scope Hint')).toBe('Scope Hint');
  });

  it('accepts a separator between the prefix and the name', () => {
    expect(cleanDisplayName('Magento2 - Foo')).toBe('Foo');
    expect(cleanDisplayName('Magento2: Foo')).toBe('Foo');
    expect(cleanDisplayName('Module | Foo')).toBe('Foo');
  });

  it('only strips whole standalone words', () => {
    expect(cleanDisplayName('Magento2Foo')).toBe('Magento2Foo');
    expect(cleanDisplayName('Modules Manager')).toBe('Modules Manager');
    expect(cleanDisplayName('Foo Magento2')).toBe('Foo Magento2');
  });

  it('never empties a name that is nothing but a prefix', () => {
    expect(cleanDisplayName('Magento2')).toBe('Magento2');
    expect(cleanDisplayName('  Module  ')).toBe('Module');
  });

  it('leaves the rest of the name and its trimmed edges alone', () => {
    expect(cleanDisplayName('  Magento2  Google  Tag Manager  ')).toBe('Google  Tag Manager');
  });

  it('drops a trailing "for Magento 2"', () => {
    expect(cleanDisplayName('Google Tag Manager for Magento 2')).toBe('Google Tag Manager');
    expect(cleanDisplayName('Google Tag Manager for Magento2')).toBe('Google Tag Manager');
  });

  it('drops the phrase when it is wrapped in parentheses or brackets', () => {
    expect(cleanDisplayName('Foo (for Magento 2)')).toBe('Foo');
    expect(cleanDisplayName('Foo [for Magento 2]')).toBe('Foo');
    expect(cleanDisplayName('Foo (for Magento 2) - Pro')).toBe('Foo - Pro');
  });

  it('drops the phrase mid-name and tidies the spacing around it', () => {
    expect(cleanDisplayName('Foo for Magento 2 - Pro')).toBe('Foo - Pro');
    expect(cleanDisplayName('Foo for Magento 2 Pro')).toBe('Foo Pro');
  });

  it('drops a separator the phrase strands at either end', () => {
    expect(cleanDisplayName('Foo - for Magento 2')).toBe('Foo');
    expect(cleanDisplayName('for Magento 2 - Foo')).toBe('Foo');
    expect(cleanDisplayName('Foo: for Magento 2')).toBe('Foo');
  });

  it('strips the phrase and the leading prefix together', () => {
    expect(cleanDisplayName('Magento2 Foo for Magento 2')).toBe('Foo');
    expect(cleanDisplayName('for Magento 2 - Module Foo')).toBe('Foo');
  });

  it('matches the phrase whatever its case', () => {
    expect(cleanDisplayName('Foo FOR MAGENTO 2')).toBe('Foo');
    expect(cleanDisplayName('Foo For Magento 2')).toBe('Foo');
    expect(cleanDisplayName('Foo for magento2')).toBe('Foo');
  });

  it('leaves a version suffix or a longer number alone', () => {
    expect(cleanDisplayName('Foo for Magento 2.4')).toBe('Foo for Magento 2.4');
    expect(cleanDisplayName('Foo for Magento 25')).toBe('Foo for Magento 25');
    expect(cleanDisplayName('Metafor Magento 2 Tools')).toBe('Metafor Magento 2 Tools');
  });

  it('never empties a name that is nothing but the phrase', () => {
    expect(cleanDisplayName('for Magento 2')).toBe('for Magento 2');
    expect(cleanDisplayName('  Magento2 for Magento 2  ')).toBe('Magento2 for Magento 2');
  });
});

describe('isRedundantName', () => {
  it('flags a name that is nothing but a redundant word', () => {
    expect(isRedundantName('Magento2')).toBe(true);
    expect(isRedundantName('  Module ')).toBe(true);
    expect(isRedundantName('Magento 2')).toBe(true);
  });

  it('flags a name that is nothing but the "for Magento 2" phrase', () => {
    expect(isRedundantName('for Magento 2')).toBe(true);
    expect(isRedundantName('Magento2 for Magento 2')).toBe(true);
  });

  it('leaves a name with something left after stripping alone', () => {
    expect(isRedundantName('Magento2 Foo')).toBe(false);
    expect(isRedundantName('Magento2Foo')).toBe(false);
    expect(isRedundantName('Acme Widget Manager')).toBe(false);
  });

  it('does not flag an empty name — there is nothing redundant to replace', () => {
    expect(isRedundantName('')).toBe(false);
    expect(isRedundantName('   ')).toBe(false);
  });
});

describe('normalizePmApiPackage', () => {
  it('maps a tested package onto the source shape', () => {
    const source = normalizePmApiPackage(apiPackage());
    expect(source).toMatchObject({
      name: 'acme/module-widget',
      displayName: 'Acme Widget Manager',
      rawCategories: ['developer-tools', 'admin-tools'],
      latestVersion: '2.3.1',
      latestReleasedAt: '2026-05-14T09:30:00.000Z',
      supportedMagento: ['2.4.9'],
      qualityTier: 'no-errors',
      phpstanLevel: 6,
      buildStatus: 'passing',
      installs: 1834,
      stars: 42,
      license: ['MIT'],
      abandoned: false,
      abandonedReplacement: null,
      semver: { status: 'compliant', compliancePercent: 100 },
      pmUrl: 'https://package-maven.com/acme/module-widget',
    });
    // The tested pair is a matrix row carrying the latest release's date.
    expect(source?.releases).toEqual([
      {
        version: '2.3.1',
        releasedAt: '2026-05-14T09:30:00.000Z',
        supportedMagento: ['2.4.9'],
      },
    ]);
  });

  it('attributes test results to the tested version when it lags the latest release', () => {
    const source = normalizePmApiPackage(
      apiPackage({
        latest_release: { version: '3.0.0', date: '2026-07-01T00:00:00+00:00' },
        test_results: { magento_version: '2.4.6', package_version: '2.3.1', phpstan_level: 4 },
      }),
    );
    // The latest release itself has no verified Magento version…
    expect(source?.supportedMagento).toEqual([]);
    // …but the tested older version keeps its result in the matrix.
    expect(source?.releases).toEqual([
      { version: '2.3.1', releasedAt: null, supportedMagento: ['2.4.6'] },
    ]);
  });

  it('drops the tag-style v prefix, so a tested release still matches the latest', () => {
    const source = normalizePmApiPackage(
      apiPackage({
        latest_release: { version: 'v2.7.0', date: '2026-05-14T09:30:00+00:00' },
        test_results: { magento_version: '2.4.9', package_version: '2.7.0', phpstan_level: 6 },
      }),
    );
    expect(source?.latestVersion).toBe('2.7.0');
    // Without normalization "v2.7.0" !== "2.7.0" and the latest release would
    // lose the Magento support its own test result earned.
    expect(source?.supportedMagento).toEqual(['2.4.9']);
    expect(source?.releases).toEqual([
      { version: '2.7.0', releasedAt: '2026-05-14T09:30:00.000Z', supportedMagento: ['2.4.9'] },
    ]);
  });

  it('represents an untested package as tier null / unknown build', () => {
    const source = normalizePmApiPackage(
      apiPackage({
        quality: {
          strict_compliant: false,
          no_errors: false,
          build_works: false,
          needs_help: false,
        },
        test_results: { magento_version: null, package_version: null, phpstan_level: null },
      }),
    );
    expect(source).toMatchObject({
      qualityTier: null,
      buildStatus: 'unknown',
      phpstanLevel: null,
      supportedMagento: [],
      releases: [],
    });
  });

  it('strips a redundant prefix from the display name', () => {
    const source = normalizePmApiPackage(apiPackage({ name: 'Magento2 Widget Manager' }));
    expect(source?.displayName).toBe('Widget Manager');
  });

  it('falls back to the composer name when the display name is missing', () => {
    expect(normalizePmApiPackage(apiPackage({ name: null }))?.displayName).toBe(
      'acme/module-widget',
    );
    expect(normalizePmApiPackage(apiPackage({ name: '  ' }))?.displayName).toBe(
      'acme/module-widget',
    );
  });

  it('keeps phpstan_level -1 (analysis fails at level 0) and needs-help build status', () => {
    const source = normalizePmApiPackage(
      apiPackage({
        quality: {
          strict_compliant: false,
          no_errors: false,
          build_works: false,
          needs_help: true,
        },
        test_results: { magento_version: '2.4.9', package_version: '2.3.1', phpstan_level: -1 },
      }),
    );
    expect(source?.phpstanLevel).toBe(-1);
    expect(source?.buildStatus).toBe('failing');
    expect(source?.qualityTier).toBe('needs-help');
  });

  it('splits comma-separated dual licenses and nulls empty ones', () => {
    expect(normalizePmApiPackage(apiPackage({ license: 'OSL-3.0, AFL-3.0' }))?.license).toEqual([
      'OSL-3.0',
      'AFL-3.0',
    ]);
    expect(normalizePmApiPackage(apiPackage({ license: null }))?.license).toBeNull();
    expect(normalizePmApiPackage(apiPackage({ license: ' , ' }))?.license).toBeNull();
  });

  it('maps the abandonment state including the suggested replacement', () => {
    const source = normalizePmApiPackage(
      apiPackage({ abandoned: { is_abandoned: true, replacement: 'acme/module-widget-next' } }),
    );
    expect(source?.abandoned).toBe(true);
    expect(source?.abandonedReplacement).toBe('acme/module-widget-next');
    // Abandoned without a named replacement.
    expect(
      normalizePmApiPackage(apiPackage({ abandoned: { is_abandoned: true, replacement: '' } })),
    ).toMatchObject({ abandoned: true, abandonedReplacement: null });
  });

  it('carries the semver verdict through verbatim', () => {
    expect(
      normalizePmApiPackage(apiPackage({ semver: { status: 'violations', compliance_percent: 70 } }))
        ?.semver,
    ).toEqual({ status: 'violations', compliancePercent: 70 });
    expect(
      normalizePmApiPackage(apiPackage({ semver: { status: 'pending', compliance_percent: null } }))
        ?.semver,
    ).toEqual({ status: 'pending', compliancePercent: null });
  });

  it("uses PM's own package page URL", () => {
    expect(normalizePmApiPackage(apiPackage())?.pmUrl).toBe(
      'https://package-maven.com/acme/module-widget',
    );
    expect(normalizePmApiPackage(apiPackage({ links: { web: 'not a url' } }))?.pmUrl).toBeNull();
  });

  it('nulls out an invalid repository URL and drops unparseable records', () => {
    expect(normalizePmApiPackage(apiPackage({ repository_url: 'not a url' }))?.repositoryUrl)
      .toBeNull();
    expect(normalizePmApiPackage({ composer_name: 42 })).toBeNull();
    // Composer name that can't be a Packagist name fails source validation.
    expect(normalizePmApiPackage(apiPackage({ composer_name: 'no-slash' }))).toBeNull();
  });
});

describe('fetchPackageMavenSnapshot', () => {
  const page = (packages: unknown[], currentPage: number, lastPage: number, total: number) =>
    new Response(
      JSON.stringify({
        data: packages,
        meta: { current_page: currentPage, last_page: lastPage, total },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  it('paginates, dedupes, and collects skipped records into a valid snapshot', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      if (new URL(String(url)).searchParams.get('page') === '1') {
        return page(
          [apiPackage(), apiPackage({ composer_name: 'other/module-a' }), { broken: true }],
          1,
          2,
          4,
        );
      }
      // Page 2 repeats a package (index shifted between requests).
      return page([apiPackage({ composer_name: 'other/module-a' })], 2, 2, 4);
    }) as typeof fetch;

    const result = await fetchPackageMavenSnapshot({ token: 'test-token', now, fetchImpl });

    expect(calls).toEqual([
      'https://package-maven.com/api/v1/packages?per_page=100&page=1',
      'https://package-maven.com/api/v1/packages?per_page=100&page=2',
    ]);
    expect(result.snapshot.packages.map((p) => p.name)).toEqual([
      'acme/module-widget',
      'other/module-a',
    ]);
    expect(result.skipped).toEqual(['(unparseable record)']);
    expect(result.snapshot.origin).toBe('live');
    expect(result.snapshot.fetchedAt).toBe('2026-07-10T00:00:00.000Z');
    expect(() => packageMavenSnapshot.parse(result.snapshot)).not.toThrow();
  });

  it('sends the bearer token and retries once on 429 honoring Retry-After', async () => {
    let attempt = 0;
    const sleeps: number[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toBe('Bearer test-token');
      attempt += 1;
      if (attempt === 1) {
        return new Response('{"message":"slow down"}', {
          status: 429,
          headers: { 'retry-after': '7' },
        });
      }
      return page([apiPackage()], 1, 1, 1);
    }) as typeof fetch;

    const result = await fetchPackageMavenSnapshot({
      token: 'test-token',
      now,
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(sleeps).toEqual([7000]);
    expect(result.snapshot.packages).toHaveLength(1);
  });

  it('falls back to the default API URL when the override is empty or blank', async () => {
    // CI sets PM_API_URL from a repo variable; an undefined variable arrives
    // as the empty string, which must not become the base URL.
    for (const apiUrl of ['', '  ']) {
      const calls: string[] = [];
      const fetchImpl = (async (url: string | URL | Request) => {
        calls.push(String(url));
        return page([apiPackage()], 1, 1, 1);
      }) as typeof fetch;
      await fetchPackageMavenSnapshot({ apiUrl, token: 'test-token', now, fetchImpl });
      expect(calls).toEqual(['https://package-maven.com/api/v1/packages?per_page=100&page=1']);
    }
  });

  it('throws on HTTP errors so the caller can carry a stale snapshot forward', async () => {
    const fetchImpl = (async () =>
      new Response('{"message":"nope"}', { status: 401 })) as typeof fetch;
    await expect(fetchPackageMavenSnapshot({ token: 'bad', now, fetchImpl })).rejects.toThrow(
      /HTTP 401/,
    );
  });
});

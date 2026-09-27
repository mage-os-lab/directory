import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runPipeline } from '../src/pipeline/run.js';
import { feed as feedSchema, packageDetail } from '../src/schema/feed.js';
import { mergeToFeed } from '../src/pipeline/merge.js';
import {
  loadRankingConfig,
  loadSnapshot,
  loadVendorFiles,
  vendorsDirFor,
} from '../src/pipeline/load.js';
import { packageMavenSnapshot, packagistSnapshot } from '../src/schema/source.js';
import { emptyPackagistSnapshot } from '../src/pipeline/packagist.js';
import { vendorFile as vendorFileSchema, type VendorFile } from '../src/schema/vendor-file.js';

const rootDir = path.resolve(__dirname, '..');
const now = new Date('2026-07-01T12:00:00.000Z');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosd-pipeline-'));

afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

describe('pipeline on fixture data', () => {
  it('emits a valid, deterministic /api/v1 tree', async () => {
    const first = await runPipeline({ source: 'fixture', rootDir, outDir, now });
    expect(first.packageCount).toBe(40);
    expect(first.stale).toBe(false);
    expect(first.warnings).toEqual([]);

    const feedRaw = fs.readFileSync(path.join(outDir, 'api/v1/feed.json'), 'utf8');
    const feed = feedSchema.parse(JSON.parse(feedRaw));

    // Determinism: a second run over the same inputs is byte-identical.
    const second = await runPipeline({ source: 'fixture', rootDir, outDir, now });
    expect(second.feedHash).toBe(first.feedHash);
    expect(fs.readFileSync(path.join(outDir, 'api/v1/feed.json'), 'utf8')).toBe(feedRaw);

    // Manifest agrees with the feed.
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'api/v1/manifest.json'), 'utf8'));
    expect(manifest.feedHash).toBe(first.feedHash);
    expect(manifest.packageCount).toBe(feed.packages.length);

    // Raw snapshot is republished for carry-forward.
    expect(fs.existsSync(path.join(outDir, 'api/v1/sources/packagemaven.json'))).toBe(true);

    // Every package has a valid detail file.
    for (const pkg of feed.packages) {
      const detailPath = path.join(outDir, 'api/v1/packages', `${pkg.name}.json`);
      packageDetail.parse(JSON.parse(fs.readFileSync(detailPath, 'utf8')));
    }
  });

  it('applies the trust overlay', async () => {
    await runPipeline({ source: 'fixture', rootDir, outDir, now });
    const feed = feedSchema.parse(
      JSON.parse(fs.readFileSync(path.join(outDir, 'api/v1/feed.json'), 'utf8')),
    );
    const byName = new Map(feed.packages.map((p) => [p.name, p]));

    const pick = byName.get('northware/module-order-export')!;
    expect(pick.displayName).toBe('Order Export Suite');
    expect(pick.trust.editorialPick).toBe(true);
    expect(pick.trust.partnerTier).toBe('gold');

    const deranked = byName.get('northware/module-order-sync')!;
    expect(deranked.trust.deranked).toBe(true);
    expect(deranked.trust.hidden).toBe(false);

    const hidden = byName.get('castlegate/module-fraud-shield')!;
    expect(hidden.trust.hidden).toBe(true);
    expect(hidden.trust.deranked).toBe(true);

    // Deranked package scores below an otherwise-similar sibling.
    const sibling = byName.get('northware/module-invoice-pdf')!;
    expect(deranked.ranking.score).toBeLessThan(sibling.ranking.score);

    // A category override wins over PM's categories.
    const overridden = byName.get('pixelforge/module-catalog-swatches')!;
    expect(overridden.categories).toEqual(['catalog-management', 'performance-optimization']);
  });

  it("publishes PackageMaven's categories under PackageMaven's names", async () => {
    await runPipeline({ source: 'fixture', rootDir, outDir, now });
    const feed = feedSchema.parse(
      JSON.parse(fs.readFileSync(path.join(outDir, 'api/v1/feed.json'), 'utf8')),
    );
    const byName = new Map(feed.packages.map((p) => [p.name, p]));

    expect(byName.get('ferrousbyte/module-graphql-extensions')!.categories).toEqual([
      'developer-tools',
      'integration-third-party',
    ]);
    // Miscellaneous is dropped beside a real category, and kept when it is all there is.
    expect(byName.get('quillstack/module-dashboard-widgets')!.categories).toEqual([
      'administration-backend',
    ]);
    expect(byName.get('wrenfield/module-gift-registry')!.categories).toEqual(['miscellaneous']);

    const categories = new Map(feed.categories.map((c) => [c.slug, c]));
    expect(categories.get('integration-third-party')!.name).toBe('Integration & Third-Party');
    expect(categories.get('miscellaneous')!.packageCount).toBe(1);
  });

  it('derives per-Magento compatibility from the per-release test matrix', async () => {
    await runPipeline({ source: 'fixture', rootDir, outDir, now });
    const feed = feedSchema.parse(
      JSON.parse(fs.readFileSync(path.join(outDir, 'api/v1/feed.json'), 'utf8')),
    );
    const byName = new Map(feed.packages.map((p) => [p.name, p]));

    // Fixture matrix: latest 5.1.0 is 2.4.7-only; 5.0.0 covers 2.4.6, 4.9.0 covers 2.4.5.
    const gateway = byName.get('castlegate/module-payment-gateway')!;
    expect(gateway.compatibility).toEqual({
      '2.4.7': '5.1.0',
      '2.4.6': '5.0.0',
      '2.4.5': '4.9.0',
    });

    // No per-release data → compatibility degrades to the latest release only.
    const seo = byName.get('brightloom/module-seo-toolkit')!;
    expect(seo.compatibility).toEqual({
      '2.4.7': '3.2.1',
      '2.4.6': '3.2.1',
      '2.4.5': '3.2.1',
    });

    // Detail files publish the full matrix, newest release first, latest folded in.
    const detail = packageDetail.parse(
      JSON.parse(
        fs.readFileSync(
          path.join(outDir, 'api/v1/packages/castlegate/module-payment-gateway.json'),
          'utf8',
        ),
      ),
    );
    expect(detail.releases.map((r) => r.version)).toEqual(['5.1.0', '5.0.0', '4.9.0', '4.8.0']);
    expect(detail.releases[0].supportedMagento).toEqual(['2.4.7']);
  });

  it('ranking components are published and scores are ordered sensibly', async () => {
    await runPipeline({ source: 'fixture', rootDir, outDir, now });
    const feed = feedSchema.parse(
      JSON.parse(fs.readFileSync(path.join(outDir, 'api/v1/feed.json'), 'utf8')),
    );
    for (const pkg of feed.packages) {
      expect(pkg.ranking.score).toBeGreaterThanOrEqual(0);
      expect(pkg.ranking.score).toBeLessThanOrEqual(1);
      expect(pkg.ranking.components['qualityTier']).toBeDefined();
      if (pkg.popularity.installs === null) {
        expect(pkg.ranking.components).not.toHaveProperty('installs');
      }
      // GitHub fetch is disabled on fixture builds, so the stars signal can
      // only come from PM's own reported count. A known zero still scores
      // (as zero) — only an unknown count drops the signal and redistributes
      // its weight.
      if (pkg.popularity.githubStars === null) {
        expect(pkg.ranking.components).not.toHaveProperty('stars');
      } else if (pkg.popularity.githubStars === 0) {
        expect(pkg.ranking.components['stars']).toBe(0);
      } else {
        expect(pkg.ranking.components['stars']).toBeGreaterThan(0);
      }
    }
  });

  it('publishes Packagist activity, its snapshot, and the trend signals', async () => {
    await runPipeline({ source: 'fixture', rootDir, outDir, now });
    const feed = feedSchema.parse(
      JSON.parse(fs.readFileSync(path.join(outDir, 'api/v1/feed.json'), 'utf8')),
    );

    // The snapshot is republished so the next live run can carry it forward.
    const snapshotPath = path.join(outDir, 'api/v1/sources/packagist.json');
    expect(fs.existsSync(snapshotPath)).toBe(true);
    const snapshot = packagistSnapshot.parse(JSON.parse(fs.readFileSync(snapshotPath, 'utf8')));
    expect(snapshot.packages.length).toBeGreaterThan(0);

    // The fixture deliberately carries one entry forward from an earlier run,
    // so the source block must report the corpus as partly stale.
    const source = feed.sources.find((s) => s.id === 'packagist')!;
    expect(source.ok).toBe(true);
    expect(source.stale).toBe(true);
    expect(source.fetchedAt).toBe(snapshot.fetchedAt);

    const withActivity = feed.packages.filter((p) => p.activity !== null);
    expect(withActivity.length).toBe(snapshot.packages.length);
    for (const pkg of withActivity) {
      expect(pkg.ranking.components['recentInstalls']).toBeDefined();
    }

    // Carried-forward counters say so on the package, not just the source.
    const carried = feed.packages.find((p) => p.name === 'castlegate/module-checkout-suite')!;
    expect(carried.activity!.stale).toBe(true);
    expect(feed.packages.filter((p) => p.activity?.stale === true)).toHaveLength(1);

    // No creation date means no lifetime average, so no momentum — but the
    // recent-downloads signal still counts.
    const undated = feed.packages.find((p) => p.name === 'castlegate/module-payment-gateway')!;
    expect(undated.activity!.momentum).toBeNull();
    expect(undated.ranking.components).not.toHaveProperty('momentum');
    expect(undated.ranking.components['recentInstalls']).toBeDefined();

    // A package Packagist had nothing for carries no activity block at all.
    const missing = feed.packages.filter((p) => p.activity === null);
    expect(missing.length).toBe(feed.packages.length - snapshot.packages.length);
    for (const pkg of missing) {
      expect(pkg.ranking.components).not.toHaveProperty('recentInstalls');
      expect(pkg.ranking.components).not.toHaveProperty('momentum');
    }
  });
});


describe('trust overlay separation', () => {
  const dataDir = path.join(rootDir, 'data');

  it('resolves each universe to its own overlay directory', () => {
    expect(vendorsDirFor(dataDir, 'live')).toBe(path.join(dataDir, 'vendors'));
    expect(vendorsDirFor(dataDir, 'fixture')).toBe(path.join(dataDir, 'fixtures', 'vendors'));
  });

  it('keeps the invented fixture vendors out of the live overlay', () => {
    const live = loadVendorFiles(vendorsDirFor(dataDir, 'live')).map((f) => f.vendor);
    const fixture = loadVendorFiles(vendorsDirFor(dataDir, 'fixture')).map((f) => f.vendor);
    expect(fixture.length).toBeGreaterThan(0);
    expect(live.filter((vendor) => fixture.includes(vendor))).toEqual([]);
  });

});

describe('categories', () => {
  const dataDir = path.join(rootDir, 'data');

  function merge(
    packages: Array<{ name: string; rawCategories: string[] }>,
    categories: Array<{ slug: string; name: string }>,
    vendorFiles: VendorFile[] = [],
  ) {
    return mergeToFeed({
      snapshot: packageMavenSnapshot.parse({
        schemaVersion: 1,
        fetchedAt: now.toISOString(),
        origin: 'fixture',
        categories,
        packages: packages.map((p) => ({ ...p, displayName: p.name, qualityTier: null })),
      }),
      snapshotStale: false,
      vendorFiles,
      rankingConfig: loadRankingConfig(dataDir),
      github: new Map(),
      githubOk: true,
      githubFetchedAt: now.toISOString(),
      packagist: emptyPackagistSnapshot(now),
      packagistOk: true,
      now,
    });
  }

  it('names a category PM left unnamed after its slug', () => {
    // A snapshot written before the directory adopted PM's taxonomy has no names.
    const { feed } = merge([{ name: 'acme/module-a', rawCategories: ['seo-urls'] }], []);
    expect(feed.categories).toEqual([{ slug: 'seo-urls', name: 'Seo Urls', packageCount: 1 }]);
  });

  it('warns about an override outside PM taxonomy, and still applies it', () => {
    const acme = vendorFileSchema.parse({
      vendor: 'acme',
      vendorName: 'Acme',
      packages: { 'acme/module-a': { categories: ['made-up'] } },
    });
    const { feed, unknownOverrideCategories } = merge(
      [{ name: 'acme/module-a', rawCategories: ['seo-urls'] }],
      [{ slug: 'seo-urls', name: 'SEO & URLs' }],
      [acme],
    );
    expect(unknownOverrideCategories).toEqual(['made-up']);
    expect(feed.packages[0]!.categories).toEqual(['made-up']);
  });
});

describe('display name fallback', () => {
  const dataDir = path.join(rootDir, 'data');

  /** One in-memory package plus whatever trust files should apply to it. */
  function merge(pkg: { name: string; displayName: string }, vendorFiles: VendorFile[]) {
    return mergeToFeed({
      snapshot: packageMavenSnapshot.parse({
        schemaVersion: 1,
        fetchedAt: now.toISOString(),
        origin: 'fixture',
        packages: [{ ...pkg, qualityTier: null }],
      }),
      snapshotStale: false,
      vendorFiles,
      rankingConfig: loadRankingConfig(dataDir),
      github: new Map(),
      githubOk: true,
      githubFetchedAt: now.toISOString(),
      packagist: emptyPackagistSnapshot(now),
      packagistOk: true,
      now,
    });
  }

  const quickpay = vendorFileSchema.parse({
    vendor: 'quickpay',
    vendorName: 'QuickPay',
  });

  it('names a package whose PM name is only "Magento2" after its vendor trust file', () => {
    const { feed } = merge({ name: 'quickpay/magento2', displayName: 'Magento2' }, [quickpay]);
    expect(feed.packages[0]!.displayName).toBe('QuickPay');
    // The card title and the vendor listing agree, by construction.
    expect(feed.vendors[0]!.name).toBe('QuickPay');
  });

  it('falls back to the vendor slug when that vendor has no trust file', () => {
    const { feed } = merge({ name: 'quickpay/magento2', displayName: 'Magento2' }, []);
    expect(feed.packages[0]!.displayName).toBe('quickpay');
    expect(feed.vendors[0]!.name).toBe('quickpay');
  });

  it('lets a trust-file displayName override win over the vendor fallback', () => {
    const withOverride = vendorFileSchema.parse({
      vendor: 'quickpay',
      vendorName: 'QuickPay',
      packages: { 'quickpay/magento2': { displayName: 'QuickPay Payments' } },
    });
    const { feed } = merge({ name: 'quickpay/magento2', displayName: 'Magento2' }, [withOverride]);
    expect(feed.packages[0]!.displayName).toBe('QuickPay Payments');
  });

  it('leaves a real PM name untouched by the fallback', () => {
    const { feed } = merge({ name: 'quickpay/module-checkout', displayName: 'Checkout' }, [
      quickpay,
    ]);
    expect(feed.packages[0]!.displayName).toBe('Checkout');
  });
});

describe('GitHub extras', () => {
  const dataDir = path.join(rootDir, 'data');
  const snapshot = loadSnapshot(path.join(dataDir, 'fixtures', 'packagemaven-snapshot.json'));

  function merge(github: Parameters<typeof mergeToFeed>[0]['github']) {
    return mergeToFeed({
      snapshot,
      snapshotStale: false,
      vendorFiles: [],
      rankingConfig: loadRankingConfig(dataDir),
      github,
      githubOk: true,
      githubFetchedAt: now.toISOString(),
      packagist: emptyPackagistSnapshot(now),
      packagistOk: true,
      now,
    });
  }

  const target = snapshot.packages[0]!.name;

  it('carries a README into the package detail and stars into the feed', () => {
    const { feed, details } = merge(
      new Map([
        [
          target,
          {
            readmeHtml: '<p>Docs</p>',
            readmeSourceUrl: 'https://github.com/northware/mage-modules#readme',
            stars: 512,
          },
        ],
      ]),
    );

    const detail = details.find((d) => d.name === target)!;
    expect(detail.readmeHtml).toBe('<p>Docs</p>');
    expect(detail.readmeSourceUrl).toBe('https://github.com/northware/mage-modules#readme');
    // Live stars win over PM's reported count.
    expect(feed.packages.find((p) => p.name === target)!.popularity.githubStars).toBe(512);

    // Packages without extras stay fully renderable.
    const other = details.find((d) => d.name !== target)!;
    expect(other.readmeHtml).toBeNull();
    expect(other.readmeSourceUrl).toBeNull();
  });

  it('never publishes an attribution link without the README it attributes', () => {
    const { details } = merge(
      new Map([
        [target, { readmeHtml: null, readmeSourceUrl: 'https://github.com/o/r#readme', stars: null }],
      ]),
    );
    expect(details.find((d) => d.name === target)!.readmeSourceUrl).toBeNull();
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runPipeline } from '../src/pipeline/run.js';
import { feed as feedSchema, packageDetail } from '../src/schema/feed.js';
import { mapCategories, unmappedCategoryLabels } from '../src/pipeline/merge.js';
import { loadCategories } from '../src/pipeline/load.js';

const rootDir = path.resolve(__dirname, '..');
const now = new Date('2026-07-01T12:00:00.000Z');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mosd-pipeline-'));

afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

describe('pipeline on fixture data', () => {
  it('emits a valid, deterministic /api/v1 tree', async () => {
    const first = await runPipeline({ source: 'fixture', rootDir, outDir, now });
    expect(first.packageCount).toBe(40);
    expect(first.stale).toBe(false);
    // The fixture deliberately carries one unmapped PM label to exercise the
    // fallback path — taxonomy drift must surface as a warning, not silence.
    expect(first.warnings).toEqual([
      'PM category "Misc Utilities" has no mapping in data/categories.json — its packages ' +
        'fall back to the "other" category',
    ]);

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
    expect(pick.trust.trustedVendor).toBe(true);
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

    // Category override wins over PM mapping.
    const overridden = byName.get('pixelforge/module-catalog-swatches')!;
    expect(overridden.categories).toEqual(['catalog']);
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
      // GitHub fetch is disabled on fixture builds — stars never contribute.
      expect(pkg.ranking.components).not.toHaveProperty('stars');
    }
  });
});

describe('category mapping', () => {
  const categories = loadCategories(path.join(rootDir, 'data'));

  it('maps PM labels to canonical slugs case-insensitively', () => {
    expect(mapCategories(['Payments'], categories)).toEqual(['payments']);
    expect(mapCategories(['payments', ' SEO '], categories)).toEqual(['payments', 'seo']);
  });

  it('routes unknown labels and empty lists to the fallback category', () => {
    expect(mapCategories(['Misc Utilities'], categories)).toEqual(['other']);
    expect(mapCategories([], categories)).toEqual(['other']);
  });

  it('reports unmapped labels so PM taxonomy drift surfaces as pipeline warnings', () => {
    expect(
      unmappedCategoryLabels(['payments', 'brand-new-pm-category', 'brand-new-pm-category'], categories),
    ).toEqual(['brand-new-pm-category']);
    // Every live PM slug (as of docs/packagemaven-openapi.json) is mapped.
    const liveSlugs = [
      'administration-backend', 'developer-tools', 'catalog-management',
      'performance-optimization', 'seo-urls', 'checkout-payments',
      'customer-authentication', 'email-communication', 'analytics-tracking',
      'search', 'content-management', 'images-media', 'integration-third-party',
      'security-compliance', 'order-shipping', 'tax-pricing',
      'devops-infrastructure', 'import-export', 'ai-automation', 'miscellaneous',
    ];
    expect(unmappedCategoryLabels(liveSlugs, categories)).toEqual([]);
  });
});

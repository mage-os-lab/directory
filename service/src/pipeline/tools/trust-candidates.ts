/**
 * Rank the corpus for trust-overlay curation: which packages look like
 * editorial picks.
 *
 * This is a *curation aid*, not a grant. The trust policy's bar for
 * `editorialPick` (a stated, package-specific justification) is human
 * judgment on evidence this tool cannot see. What it does is narrow
 * ~1,100 packages down to a shortlist worth reviewing, using the signals the
 * feed actually carries.
 *
 * Longevity is deliberately absent: PM carries the latest release date but not
 * the first, so "how long has this been maintained" has to come from Packagist
 * (or the repo) during review. Recency of the last release is the proxy here.
 *
 * Run against an emitted feed:
 *   npx tsx src/pipeline/tools/trust-candidates.ts --feed public/api/v1/feed.json
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { feed as feedSchema, type Feed, type PackageSummary } from '../../schema/feed.js';
import type { QualityTier } from '../../schema/common.js';

const TIER_SCORE: Record<QualityTier, number> = {
  'strict-compliant': 1,
  'no-errors': 0.8,
  'ready-to-install': 0.5,
  'needs-help': 0.15,
};

function monthsSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  return (now.getTime() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

/** log-scaled 0..1 against the corpus max, so one 5M-install outlier doesn't flatten the rest. */
function logScale(value: number | null, max: number): number {
  if (!value || value <= 0 || max <= 0) return 0;
  return Math.log10(1 + value) / Math.log10(1 + max);
}

export interface PickRow {
  name: string;
  tier: QualityTier | null;
  phpstan: number | null;
  installs: number | null;
  stars: number | null;
  months: number | null;
  magento: string;
  score: number;
}

/**
 * Editorial-pick shortlist: released within 18 months, not abandoned, no
 * standing warning.
 *
 * There is deliberately no quality-tier floor. PM's tiers grade PHPStan and
 * build cleanliness, not usefulness — only 26 of ~1,100 packages reach
 * strict-compliant, while the ecosystem's most-installed modules sit at
 * ready-to-install — so a floor would have the gate picking on code hygiene
 * instead of a curator picking on merit. Tier still contributes to the score;
 * it just no longer excludes.
 */
export function rankPicks(packages: PackageSummary[], now: Date): PickRow[] {
  const maxInstalls = Math.max(...packages.map((p) => p.popularity.installs ?? 0), 0);
  return packages
    .filter((p) => {
      const months = monthsSince(p.latestReleasedAt, now);
      return (
        p.abandoned !== true &&
        !p.trust.deranked &&
        !p.trust.hidden &&
        months !== null &&
        months <= 18
      );
    })
    .map((p) => {
      const months = monthsSince(p.latestReleasedAt, now)!;
      return {
        name: p.name,
        tier: p.quality.tier,
        phpstan: p.quality.phpstanLevel,
        installs: p.popularity.installs,
        stars: p.popularity.githubStars,
        months,
        magento: p.supportedMagento.join(' '),
        score:
          0.35 * (p.quality.tier === null ? 0 : TIER_SCORE[p.quality.tier]) +
          0.3 * logScale(p.popularity.installs, maxInstalls) +
          0.15 * logScale(p.popularity.githubStars, 2000) +
          0.1 * Math.max(0, 1 - months / 18) +
          0.1 * ((p.quality.phpstanLevel ?? 0) / 9),
      };
    })
    .sort((a, b) => b.score - a.score);
}

function table(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) =>
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join('  ');
  return [line(header), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

const { values } = parseArgs({
  options: {
    feed: { type: 'string', default: path.join('public', 'api', 'v1', 'feed.json') },
    vendors: { type: 'string' },
    /** Dump every signal for these exact packages, whatever the filters say. */
    packages: { type: 'string' },
    detail: { type: 'boolean', default: false },
    top: { type: 'string', default: '30' },
  },
});

const parsed: Feed = feedSchema.parse(JSON.parse(fs.readFileSync(values.feed!, 'utf8')));
const now = new Date(parsed.generatedAt);
const top = Number(values.top);
const only = values.vendors ? new Set(values.vendors.split(',').map((v) => v.trim())) : null;

const packages = only ? parsed.packages.filter((p) => only.has(p.vendor)) : parsed.packages;
const untested = parsed.packages.filter((p) => p.quality.tier === null).length;

console.log(
  `feed generated ${parsed.generatedAt} — ${parsed.packages.length} packages, ` +
    `${parsed.vendors.length} vendors, ${untested} untested by PM\n`,
);

console.log('## Editorial-pick shortlist (released within 18 months, not abandoned, unwarned)\n');
console.log(
  table(
    ['package', 'tier', 'phpstan', 'installs', 'stars', 'age_mo', 'magento', 'score'],
    rankPicks(packages, now)
      .slice(0, top)
      .map((r) => [
        r.name,
        r.tier ?? '-',
        r.phpstan === null ? '-' : String(r.phpstan),
        r.installs === null ? '-' : r.installs.toLocaleString('en-US'),
        r.stars === null ? '-' : String(r.stars),
        r.months === null ? '-' : r.months.toFixed(1),
        r.magento || '-',
        r.score.toFixed(3),
      ]),
  ),
);

if (values.packages) {
  const wanted = new Set(values.packages.split(',').map((n) => n.trim()));
  console.log('\n## Named packages\n');
  const found = parsed.packages.filter((p) => wanted.has(p.name));
  for (const name of wanted) {
    if (!found.some((p) => p.name === name)) console.log(`${name}: NOT IN THE PM INDEX`);
  }
  console.log(
    table(
      ['package', 'tier', 'phpstan', 'semver', 'build', 'installs', 'stars', 'released', 'aband', 'magento'],
      found.map((p) => [
        p.name,
        p.quality.tier ?? 'untested',
        p.quality.phpstanLevel === null ? '-' : String(p.quality.phpstanLevel),
        p.quality.semver ? `${p.quality.semver.status}${p.quality.semver.compliancePercent === null ? '' : ` ${p.quality.semver.compliancePercent}%`}` : '-',
        p.quality.buildStatus,
        p.popularity.installs === null ? '-' : p.popularity.installs.toLocaleString('en-US'),
        p.popularity.githubStars === null ? '-' : String(p.popularity.githubStars),
        (p.latestReleasedAt ?? '-').slice(0, 10),
        p.abandoned === true ? 'yes' : 'no',
        p.supportedMagento.join(' ') || '-',
      ]),
    ),
  );
}

if (values.detail && only) {
  console.log('\n## Per-package detail for the named vendors\n');
  console.log(
    table(
      ['package', 'tier', 'phpstan', 'installs', 'stars', 'released', 'aband'],
      packages
        .slice()
        .sort((a, b) => (b.popularity.installs ?? 0) - (a.popularity.installs ?? 0))
        .map((p) => [
          p.name,
          p.quality.tier ?? 'untested',
          p.quality.phpstanLevel === null ? '-' : String(p.quality.phpstanLevel),
          p.popularity.installs === null ? '-' : p.popularity.installs.toLocaleString('en-US'),
          p.popularity.githubStars === null ? '-' : String(p.popularity.githubStars),
          (p.latestReleasedAt ?? '-').slice(0, 10),
          p.abandoned === true ? 'yes' : 'no',
        ]),
    ),
  );
}

/**
 * Normalize both trust overlays (data/vendors/*.json and the fixture overlay
 * in data/fixtures/vendors/*.json) for clean diffs: canonical key order,
 * sorted package keys and warnings, 2-space indent, trailing newline.
 * Run: npm run format:vendors [-- --check]
 * --check exits 1 and prints the fix command instead of writing.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { vendorFile, type PackageTrustEntry, type VendorFile } from '../../schema/vendor-file.js';

const VENDOR_KEY_ORDER = [
  '$schema',
  'vendor',
  'vendorName',
  'url',
  'trustedVendor',
  'partnerTier',
  'packages',
] as const;
const ENTRY_KEY_ORDER = [
  'displayName',
  'categories',
  'editorialPick',
  'docsUrl',
  'issuesUrl',
  'warnings',
] as const;
const WARNING_KEY_ORDER = ['code', 'severity', 'message', 'date', 'evidenceUrl'] as const;

function orderKeys<T extends object>(value: T, order: readonly (keyof T & string)[]): T {
  const out: Record<string, unknown> = {};
  for (const key of order) {
    if (key in value) out[key] = value[key as keyof T];
  }
  // Preserve anything the order list doesn't know about (schema is strict,
  // so this is just belt-and-braces).
  for (const [key, val] of Object.entries(value)) {
    if (!(key in out)) out[key] = val;
  }
  return out as T;
}

export function formatVendorFile(raw: unknown): string {
  const parsed: VendorFile = vendorFile.parse(raw);
  const packages: Record<string, PackageTrustEntry> = {};
  for (const name of Object.keys(parsed.packages).sort()) {
    const entry = parsed.packages[name]!;
    const warnings = entry.warnings
      ? [...entry.warnings]
          .sort((a, b) => b.date.localeCompare(a.date) || a.code.localeCompare(b.code))
          .map((w) => orderKeys(w, WARNING_KEY_ORDER))
      : undefined;
    packages[name] = orderKeys({ ...entry, ...(warnings ? { warnings } : {}) }, ENTRY_KEY_ORDER);
  }
  const ordered = orderKeys({ ...parsed, packages }, VENDOR_KEY_ORDER);
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

const isMain =
  process.argv[1] !== undefined &&
  path.basename(process.argv[1]) === 'format-vendors.ts';

if (isMain) {
  const check = process.argv.includes('--check');
  const dirs = [
    path.join('data', 'vendors'),
    path.join('data', 'fixtures', 'vendors'),
  ];

  const unformatted: string[] = [];
  let fileCount = 0;
  for (const dir of dirs) {
    const vendorsDir = path.join(process.cwd(), dir);
    if (!fs.existsSync(vendorsDir)) continue;
    const files = fs.readdirSync(vendorsDir).filter((f) => f.endsWith('.json')).sort();
    fileCount += files.length;

    for (const name of files) {
      const filePath = path.join(vendorsDir, name);
      const current = fs.readFileSync(filePath, 'utf8');
      const formatted = formatVendorFile(JSON.parse(current));
      if (current !== formatted) {
        if (check) {
          unformatted.push(`${dir}/${name}`);
        } else {
          fs.writeFileSync(filePath, formatted);
          console.log(`formatted ${dir}/${name}`);
        }
      }
    }
  }

  if (check && unformatted.length > 0) {
    console.error(
      `trust files not canonically formatted: ${unformatted.join(', ')}\n` +
        `Fix with: npm run format:vendors`,
    );
    process.exit(1);
  }
  console.log(check ? `format check OK (${fileCount} file(s))` : `done (${fileCount} file(s))`);
}

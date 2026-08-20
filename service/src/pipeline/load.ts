import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { categoriesFile, packageMavenSnapshot } from '../schema/source.js';
import type { CategoriesFile, PackageMavenSnapshot } from '../schema/source.js';
import { rankingConfig, type RankingConfig } from '../schema/ranking-config.js';
import { validateWarningEvidence, vendorFile, type VendorFile } from '../schema/vendor-file.js';

export class DataError extends Error {
  constructor(
    public readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
    this.name = 'DataError';
  }
}

function readJson(filePath: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new DataError(filePath, `cannot read file: ${(error as Error).message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new DataError(filePath, `invalid JSON: ${(error as Error).message}`);
  }
}

function parseWith<T>(schema: z.ZodType<T>, filePath: string): T {
  const result = schema.safeParse(readJson(filePath));
  if (!result.success) {
    throw new DataError(filePath, z.prettifyError(result.error));
  }
  return result.data;
}

export function loadCategories(dataDir: string): CategoriesFile {
  const file = path.join(dataDir, 'categories.json');
  const parsed = parseWith(categoriesFile, file);
  const slugs = new Set(parsed.categories.map((c) => c.slug));
  if (slugs.size !== parsed.categories.length) {
    throw new DataError(file, 'duplicate category slugs');
  }
  if (!slugs.has(parsed.fallbackCategory)) {
    throw new DataError(file, `fallbackCategory "${parsed.fallbackCategory}" is not a category`);
  }
  return parsed;
}

export function loadRankingConfig(dataDir: string): RankingConfig {
  return parseWith(rankingConfig, path.join(dataDir, 'ranking.json'));
}

export function loadSnapshot(filePath: string): PackageMavenSnapshot {
  return parseWith(packageMavenSnapshot, filePath);
}

/**
 * Load and validate every data/vendors/*.json trust file. Malformed files
 * throw (our own data — CI on the PR should have caught it); cross-file
 * checks (filename = vendor, key prefixes, category refs, warning evidence)
 * are enforced here because the schema alone can't see filenames.
 */
export function loadVendorFiles(dataDir: string, categories: CategoriesFile): VendorFile[] {
  const vendorsDir = path.join(dataDir, 'vendors');
  if (!fs.existsSync(vendorsDir)) return [];

  const slugs = new Set(categories.categories.map((c) => c.slug));
  const files = fs
    .readdirSync(vendorsDir)
    .filter((name) => name.endsWith('.json'))
    .sort();

  return files.map((name) => {
    const filePath = path.join(vendorsDir, name);
    const parsed = parseWith(vendorFile, filePath);

    if (`${parsed.vendor}.json` !== name) {
      throw new DataError(filePath, `filename must equal vendor field ("${parsed.vendor}.json")`);
    }
    for (const [packageName, entry] of Object.entries(parsed.packages)) {
      if (!packageName.startsWith(`${parsed.vendor}/`)) {
        throw new DataError(filePath, `package "${packageName}" must start with "${parsed.vendor}/"`);
      }
      for (const category of entry.categories ?? []) {
        if (!slugs.has(category)) {
          throw new DataError(
            filePath,
            `package "${packageName}" references unknown category "${category}"`,
          );
        }
      }
    }
    const evidenceProblems = validateWarningEvidence(parsed);
    if (evidenceProblems.length > 0) {
      throw new DataError(filePath, evidenceProblems.join('; '));
    }
    return parsed;
  });
}

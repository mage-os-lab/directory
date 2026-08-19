/**
 * Regenerate the committed JSON Schemas in data/ from the Zod definitions,
 * so editors validate trust/config files against the same contract the
 * pipeline enforces. Run: npm run generate:schemas
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { z } from 'zod';
import { vendorFile } from '../../schema/vendor-file.js';
import { categoriesFile } from '../../schema/source.js';
import { rankingConfig } from '../../schema/ranking-config.js';

const targets: Array<{ file: string; schema: z.ZodType; title: string }> = [
  { file: 'vendor.schema.json', schema: vendorFile, title: 'Mage-OS Directory vendor trust file' },
  { file: 'categories.schema.json', schema: categoriesFile, title: 'Mage-OS Directory category taxonomy' },
  { file: 'ranking.schema.json', schema: rankingConfig, title: 'Mage-OS Directory ranking config' },
];

const dataDir = path.join(process.cwd(), 'data');
for (const target of targets) {
  const jsonSchema = { title: target.title, ...z.toJSONSchema(target.schema, { io: 'input' }) };
  fs.writeFileSync(path.join(dataDir, target.file), `${JSON.stringify(jsonSchema, null, 2)}\n`);
  console.log(`wrote data/${target.file}`);
}

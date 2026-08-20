import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_VERSION } from '../schema/common.js';
import { feed as feedSchema, manifest as manifestSchema, packageDetail } from '../schema/feed.js';
import { packageMavenSnapshot } from '../schema/source.js';
import type { Feed, PackageDetail } from '../schema/feed.js';
import type { PackageMavenSnapshot } from '../schema/source.js';

/** Deterministic JSON: stable key order comes from construction order in the
 * schemas/merge; this just fixes formatting (2-space indent, trailing \n). */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export interface EmitResult {
  files: string[];
  feedHash: string;
}

/**
 * Write /api/v1 artifacts under outDir. The pipeline validates its own
 * output against the shared schemas before anything is written.
 */
export function emitArtifacts(
  outDir: string,
  feed: Feed,
  details: PackageDetail[],
  snapshot: PackageMavenSnapshot,
): EmitResult {
  const feedParsed = feedSchema.safeParse(feed);
  if (!feedParsed.success) {
    throw new Error(`emit: feed failed schema validation:\n${feedParsed.error}`);
  }
  for (const detail of details) {
    const parsed = packageDetail.safeParse(detail);
    if (!parsed.success) {
      throw new Error(`emit: detail ${detail.name} failed schema validation:\n${parsed.error}`);
    }
  }
  const snapshotParsed = packageMavenSnapshot.safeParse(snapshot);
  if (!snapshotParsed.success) {
    throw new Error(`emit: snapshot failed schema validation:\n${snapshotParsed.error}`);
  }

  const apiDir = path.join(outDir, 'api', 'v1');
  fs.rmSync(apiDir, { recursive: true, force: true });
  fs.mkdirSync(apiDir, { recursive: true });

  const files: string[] = [];
  const write = (relative: string, content: string) => {
    const target = path.join(apiDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    files.push(path.join('api', 'v1', relative));
  };

  const feedJson = canonicalJson(feed);
  const feedHash = crypto.createHash('sha256').update(feedJson).digest('hex');

  write('feed.json', feedJson);
  write(
    'manifest.json',
    canonicalJson(
      manifestSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        generatedAt: feed.generatedAt,
        feedHash,
        packageCount: feed.packages.length,
      }),
    ),
  );
  write(path.join('sources', 'packagemaven.json'), canonicalJson(snapshot));
  for (const detail of details) {
    const [vendor, name] = detail.name.split('/') as [string, string];
    write(path.join('packages', vendor, `${name}.json`), canonicalJson(detail));
  }

  return { files: files.sort(), feedHash };
}

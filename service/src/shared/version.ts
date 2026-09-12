/**
 * Just enough version handling for compatibility logic, shared by the
 * pipeline (per-Magento newest-compatible-release maps) and the browser UI
 * (installed/update badges) — numeric dot segments, a leading "v" tolerated,
 * pre-release/build suffixes ignored. Not a composer constraint solver.
 */

/**
 * A version as the directory prints, compares and pins it: trimmed, with the
 * tag-style "v" prefix dropped. Upstream sources disagree on the prefix
 * (Packagist tags carry it, PackageMaven's test results may not), and every
 * consumer — the "v1.2.3" labels, the composer command, the equality that
 * decides whether the tested release is the latest — wants one form.
 */
export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

/** Numeric segments of a version, or null when it isn't a plain x.y.z-ish
 * string (dev-master, branch aliases). */
export function parseVersion(version: string): number[] | null {
  const numeric = normalizeVersion(version)
    .split(/[-+]/, 1)[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  return numeric.every(Number.isFinite) ? numeric : null;
}

/**
 * Is `latest` strictly newer than `installed`? Unparseable versions never
 * flag an update: a wrong "update available" badge is worse than a missing
 * one.
 */
export function isNewer(latest: string, installed: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(installed);
  if (a === null || b === null) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * Total order for sorting versions (or Magento version strings) newest
 * first via `sort((a, b) => compareVersions(b, a))`. Parseable versions sort
 * above unparseable ones; unparseable ties break lexicographically so output
 * stays deterministic.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null && pb === null) return a.localeCompare(b, 'en');
  if (pa === null) return -1;
  if (pb === null) return 1;
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

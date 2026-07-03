/**
 * Just enough version comparison to answer "is the feed's latest release
 * newer than what the host says is installed?" — numeric dot segments, a
 * leading "v" tolerated, pre-release/build suffixes ignored. Unparseable
 * versions (dev-master, branch aliases) never flag an update: a wrong "update
 * available" badge is worse than a missing one.
 */
export function isNewer(latest: string, installed: string): boolean {
  const segments = (version: string): number[] => {
    const numeric = version
      .trim()
      .replace(/^v/i, '')
      .split(/[-+]/, 1)[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10));
    return numeric.every(Number.isFinite) ? numeric : [];
  };
  const a = segments(latest);
  const b = segments(installed);
  if (a.length === 0 || b.length === 0) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

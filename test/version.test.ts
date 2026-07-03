import { describe, expect, it } from 'vitest';
import { isNewer } from '../src/ui/version.js';

describe('isNewer', () => {
  it('compares numeric segments', () => {
    expect(isNewer('1.5.0', '1.4.9')).toBe(true);
    expect(isNewer('2.0.0', '1.9.9')).toBe(true);
    expect(isNewer('1.4.9', '1.5.0')).toBe(false);
    expect(isNewer('1.5.0', '1.5.0')).toBe(false);
  });

  it('pads missing segments with zero', () => {
    expect(isNewer('1.5', '1.4.9')).toBe(true);
    expect(isNewer('1.5.1', '1.5')).toBe(true);
    expect(isNewer('1.5', '1.5.0')).toBe(false);
  });

  it('tolerates a leading v and ignores pre-release/build suffixes', () => {
    expect(isNewer('v1.5.0', '1.4.0')).toBe(true);
    expect(isNewer('1.5.0', 'v1.5.0-p1')).toBe(false);
    expect(isNewer('1.5.0+build.7', '1.4.0')).toBe(true);
  });

  it('never flags unparseable versions', () => {
    expect(isNewer('1.5.0', 'dev-master')).toBe(false);
    expect(isNewer('dev-main', '1.0.0')).toBe(false);
  });
});

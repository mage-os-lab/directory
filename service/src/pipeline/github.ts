import type { GithubExtras } from './merge.js';

export interface GithubFetchResult {
  extras: Map<string, GithubExtras>;
  ok: boolean;
  fetchedAt: string | null;
}

/**
 * GitHub READMEs + stars (presentation extras, failure-tolerant).
 *
 * Not implemented yet: lands with the live-data milestone (M4a) alongside the
 * actions/cache-persisted ETag cache — fixture builds must not hit the
 * network. Disabled is a first-class state: every package renders without a
 * README/star count, exactly the degraded mode the architecture requires
 * when GitHub is down.
 */
export async function fetchGithubExtras(): Promise<GithubFetchResult> {
  return { extras: new Map(), ok: false, fetchedAt: null };
}

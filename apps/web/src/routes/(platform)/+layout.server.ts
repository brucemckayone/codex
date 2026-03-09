/**
 * Platform layout - server load
 * Reads user library version from KV for cross-device purchase staleness detection.
 */
import type { KVNamespace } from '@cloudflare/workers-types';
import { CacheType, VersionedCache } from '@codex/cache';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, platform, depends }) => {
  // Enables invalidate('cache:versions') on the client to re-run this load
  // (triggered on tab visibility return to detect cross-device purchases).
  depends('cache:versions');
  const versions: Record<string, string | null> = {};

  if (locals.user && platform?.env?.CACHE_KV) {
    const cache = new VersionedCache({
      kv: platform.env.CACHE_KV as KVNamespace,
    });
    // Library version — bumped by ecom-api when a purchase completes.
    // Client uses this to detect cross-device purchase staleness on mount.
    versions[CacheType.COLLECTION_USER_LIBRARY(locals.user.id)] =
      await cache.getVersion(CacheType.COLLECTION_USER_LIBRARY(locals.user.id));
  }

  return { versions };
};

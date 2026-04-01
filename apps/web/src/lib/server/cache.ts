import type { KVNamespace } from '@cloudflare/workers-types';
import { VersionedCache } from '@codex/cache';

/**
 * Invalidate a versioned cache entry if CACHE_KV is available.
 * Safely no-ops when the KV binding is missing (local dev without cache).
 */
export async function invalidateCache(
  platform: App.Platform | undefined,
  id: string
): Promise<void> {
  if (!platform?.env?.CACHE_KV) return;
  const cache = new VersionedCache({
    kv: platform.env.CACHE_KV as KVNamespace,
  });
  await cache.invalidate(id);
}

/**
 * Standard cache header presets for server-side load functions.
 */
export const CACHE_HEADERS = {
  /** Public static pages: 1 hour browser + CDN */
  STATIC_PUBLIC: {
    'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    Vary: 'Accept-Language',
  },
  /** Dynamic public content: 5 min browser + CDN */
  DYNAMIC_PUBLIC: {
    'Cache-Control': 'public, max-age=300, s-maxage=300',
    Vary: 'Accept-Language',
  },
  /** Authenticated/private: no caching */
  PRIVATE: {
    'Cache-Control': 'private, no-cache',
  },
} as const;

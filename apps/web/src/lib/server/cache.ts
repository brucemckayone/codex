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
 *
 * `stale-while-revalidate` lets browsers and CDNs serve the stale response
 * immediately on return visits while revalidating in the background — the
 * user sees the page instantly, and a fresh copy is fetched for next time.
 * `max-age` still enforces the freshness window for the foreground response.
 *
 * NOTE: No `Vary: Accept-Language` — Paraglide is configured with a single
 * language tag (`en`), so responses do not vary by locale. Adding Vary would
 * fragment the CDN cache across every user's Accept-Language string (many
 * unique variants per real-world traffic) with no benefit. If a second
 * language is ever added to project.inlang/settings.json, bring Vary back.
 */
export const CACHE_HEADERS = {
  /** Public static pages: 1 hour browser + CDN, 1 day SWR */
  STATIC_PUBLIC: {
    'Cache-Control':
      'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
  },
  /** Dynamic public content: 5 min browser + CDN, 1 hour SWR */
  DYNAMIC_PUBLIC: {
    'Cache-Control':
      'public, max-age=300, s-maxage=300, stale-while-revalidate=3600',
  },
  /**
   * Dynamic page whose response varies by auth state (e.g. same URL shows
   * purchase CTA for anonymous vs stream button for buyer). `max-age=0` forces
   * the browser to revalidate on every request — so once the user's session
   * cookie exists, the next navigation gets a fresh auth-aware response
   * instead of the anonymous response the browser cached during the logged-out
   * visit. `s-maxage=300` preserves the CDN win for anonymous visitors.
   *
   * Use this (not DYNAMIC_PUBLIC) any time the server load branches on
   * `locals.user` or returns auth-dependent data in the payload.
   */
  DYNAMIC_PUBLIC_REVALIDATE: {
    'Cache-Control':
      'public, max-age=0, s-maxage=300, stale-while-revalidate=3600',
  },
  /** Authenticated/private: no caching */
  PRIVATE: {
    'Cache-Control': 'private, no-cache',
  },
} as const;

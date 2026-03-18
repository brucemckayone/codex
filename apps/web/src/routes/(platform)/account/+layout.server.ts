/**
 * Account layout - server load
 * Auth guard: redirects unauthenticated users to login.
 * Version passthrough: reads user entity version from KV for client staleness detection.
 */
import type { KVNamespace } from '@cloudflare/workers-types';
import { VersionedCache } from '@codex/cache';
import { redirect } from '@sveltejs/kit';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({
  locals,
  platform,
  setHeaders,
}) => {
  if (!locals.user) {
    redirect(303, '/login?redirect=/account');
  }

  setHeaders(CACHE_HEADERS.PRIVATE);

  const versions: Record<string, string | null> = {};
  if (platform?.env?.CACHE_KV) {
    const cache = new VersionedCache({
      kv: platform.env.CACHE_KV as KVNamespace,
    });
    // User entity version — tracks profile, preferences, and library staleness.
    // org:{orgId} and user:{userId}:library added in Phase 2 platform layout.
    versions[`user:${locals.user.id}`] = await cache.getVersion(locals.user.id);
  }

  return { versions };
};

/**
 * Notification preferences page server load
 * Fetches preferences from the identity API with cache-backed SSR
 */
import type { KVNamespace } from '@cloudflare/workers-types';
import { CacheType, logCacheStats, VersionedCache } from '@codex/cache';
import { redirect } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

const DEFAULT_PREFERENCES = {
  emailMarketing: true,
  emailTransactional: true,
  emailDigest: true,
};

export const load: PageServerLoad = async ({ locals, platform, cookies }) => {
  if (!locals.user) {
    redirect(303, '/login?redirect=/account/notifications');
  }

  // `waitUntil` is what makes the cache-aside WRITE survive (Codex-e32xz):
  // `getWithResult` does not await its data-slot put, and the Workers runtime
  // cancels un-awaited work the moment the response is returned. `platform`
  // (and its `context`) is absent under `vite dev`, so this stays optional —
  // VersionedCache then keeps its old best-effort behaviour.
  const cacheWaitUntil = platform?.context
    ? (promise: Promise<unknown>) => platform.context.waitUntil(promise)
    : undefined;

  const cache = platform?.env?.CACHE_KV
    ? new VersionedCache({
        kv: platform.env.CACHE_KV as KVNamespace,
        waitUntil: cacheWaitUntil,
        obs: logger,
      })
    : null;

  const api = createServerApi(platform, cookies);

  let preferences = null;

  try {
    if (cache) {
      const result = await cache.getWithResult(
        locals.user.id,
        CacheType.USER_PREFERENCES,
        async () => await api.account.getNotificationPreferences(),
        { ttl: 600 }
      );
      preferences = result.data;
      // Emitted here rather than after the try: a fetcher throw must not be
      // reported as a cache event, and the catch below turns any failure into
      // `preferences = null` without distinguishing the cause.
      logCacheStats(cache, logger, { cacheType: CacheType.USER_PREFERENCES });
    } else {
      const response = await api.account.getNotificationPreferences();
      preferences = response;
    }
  } catch {
    preferences = null;
  }

  return {
    preferences: {
      emailMarketing:
        preferences?.emailMarketing ?? DEFAULT_PREFERENCES.emailMarketing,
      emailTransactional:
        preferences?.emailTransactional ??
        DEFAULT_PREFERENCES.emailTransactional,
      emailDigest: preferences?.emailDigest ?? DEFAULT_PREFERENCES.emailDigest,
    },
  };
};

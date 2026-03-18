/**
 * Notification preferences page server load
 * Fetches preferences from the identity API with cache-backed SSR
 */
import type { KVNamespace } from '@cloudflare/workers-types';
import { CacheType, VersionedCache } from '@codex/cache';
import { redirect } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

const DEFAULT_PREFERENCES = {
  emailMarketing: false,
  emailTransactional: true,
  emailDigest: false,
};

export const load: PageServerLoad = async ({ locals, platform, cookies }) => {
  if (!locals.user) {
    redirect(303, '/login?redirect=/account/notifications');
  }

  const cache = platform?.env?.CACHE_KV
    ? new VersionedCache({ kv: platform.env.CACHE_KV as KVNamespace })
    : null;

  const api = createServerApi(platform, cookies);

  let preferences = null;

  try {
    if (cache) {
      const result = await cache.getWithResult(
        locals.user.id,
        CacheType.USER_PREFERENCES,
        async () => (await api.account.getNotificationPreferences()).data,
        { ttl: 600 }
      );
      preferences = result.data;
    } else {
      const response = await api.account.getNotificationPreferences();
      preferences = response.data;
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

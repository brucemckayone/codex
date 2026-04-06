/**
 * Org Pricing page - server load
 *
 * Loads subscription tiers for the org + user's current subscription (if auth'd).
 * Public page — cache is DYNAMIC_PUBLIC for unauthenticated users.
 */
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  parent,
  locals,
  platform,
  cookies,
  setHeaders,
}) => {
  const { org } = await parent();

  setHeaders(
    locals.user ? CACHE_HEADERS.PRIVATE : CACHE_HEADERS.DYNAMIC_PUBLIC
  );

  const api = createServerApi(platform, cookies);

  // Load tiers (public) and current subscription (if auth'd) in parallel
  const [tiers, currentSubscription] = await Promise.all([
    api.tiers.list(org.id).catch(() => []),
    locals.user
      ? api.subscription.getCurrent(org.id).catch(() => null)
      : Promise.resolve(null),
  ]);

  return {
    tiers,
    currentSubscription,
    isAuthenticated: !!locals.user,
  };
};

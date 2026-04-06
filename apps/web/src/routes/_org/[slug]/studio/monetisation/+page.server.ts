/**
 * Studio Monetisation page - server load
 *
 * Loads subscription tiers, Connect account status, feature settings,
 * and subscription stats for the studio monetisation dashboard.
 * Owner-only: redirects non-owners back to studio.
 */
import { redirect } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, platform, cookies }) => {
  // Cache-Control is set by the parent studio layout — don't duplicate it

  const { org, userRole } = await parent();

  if (userRole !== 'owner') {
    redirect(302, '/studio');
  }

  const api = createServerApi(platform, cookies);

  // Load all monetisation data in parallel
  const [tiers, connectStatus, settings, stats] = await Promise.all([
    api.tiers.list(org.id).catch(() => []),
    api.connect.getStatus(org.id).catch(() => ({
      isConnected: false,
      accountId: null,
      chargesEnabled: false,
      payoutsEnabled: false,
      status: null,
    })),
    api.org.getSettings(org.id).catch(() => null),
    api.subscription.getStats(org.id).catch(() => ({
      totalSubscribers: 0,
      activeSubscribers: 0,
      mrrCents: 0,
      tierBreakdown: [],
    })),
  ]);

  return {
    tiers,
    connectStatus,
    enableSubscriptions: settings?.features?.enableSubscriptions ?? false,
    stats,
  };
};

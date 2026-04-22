/**
 * Account Subscriptions page - server load
 *
 * Lists all active/cancelling subscriptions for the current user.
 * Auth is enforced by the parent layout (`(platform)/account/+layout.server.ts`).
 *
 * Registers a dedicated dependency key (`account:subscriptions`) so that the
 * page can re-run this load in isolation after a cancel / reactivate mutation.
 * See `docs/subscription-cache-audit/phase-1-p0.md` → "Design — account page
 * refresh" for the root cause (the old `invalidate('cache:versions')` call hit
 * the platform layout's key, not this page's load).
 */
import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, cookies, depends }) => {
  depends('account:subscriptions');
  const api = createServerApi(platform, cookies);
  const subscriptions = await api.subscription.getMine();
  return { subscriptions };
};

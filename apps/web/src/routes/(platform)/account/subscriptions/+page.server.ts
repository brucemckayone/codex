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
 *
 * Error shape is a tagged `loadError` discriminator so the page renders a
 * retryable alert instead of falling through to +error.svelte on a transient
 * API failure — the page is reachable but the list is empty. An API outage
 * here should not force a full-page 500.
 */
import { createServerApi } from '$lib/server/api';
import type { UserOrgSubscription } from '$lib/types';
import type { PageServerLoad } from './$types';

type LoadResult =
  | { subscriptions: UserOrgSubscription[]; loadError: false }
  | { subscriptions: UserOrgSubscription[]; loadError: true };

export const load: PageServerLoad = async ({
  platform,
  cookies,
  depends,
}): Promise<LoadResult> => {
  depends('account:subscriptions');
  const api = createServerApi(platform, cookies);

  try {
    const subscriptions = await api.subscription.getMine();
    return { subscriptions, loadError: false };
  } catch {
    return { subscriptions: [], loadError: true };
  }
};

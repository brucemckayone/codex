/**
 * Account Subscriptions page - server load
 *
 * Lists the current user's memberships and course subscriptions
 * (Codex-2hxff.52, C1): two lists, fetched side by side.
 * Auth is enforced by the parent layout (`(platform)/account/+layout.server.ts`).
 *
 * Registers a dedicated dependency key (`account:subscriptions`) so that the
 * page can re-run this load in isolation after a cancel / reactivate mutation.
 * The root cause it fixed (the old `invalidate('cache:versions')` call hit
 * the platform layout's key, not this page's load).
 *
 * Each list carries its own tagged error (`loadError`, `courseLoadError`) so
 * the page renders a retryable alert for the list that failed instead of
 * falling through to +error.svelte, and a failed list never reads as an
 * empty one. An API outage here should not force a full-page 500.
 */
import { createServerApi } from '$lib/server/api';
import type { UserCourseSubscription, UserOrgSubscription } from '$lib/types';
import type { PageServerLoad } from './$types';

/** The page shows them all; data design §6.3 asks for 50. */
const COURSE_SUBSCRIPTIONS_LIMIT = '50';

interface LoadResult {
  subscriptions: UserOrgSubscription[];
  loadError: boolean;
  courseSubscriptions: UserCourseSubscription[];
  courseLoadError: boolean;
}

export const load: PageServerLoad = async ({
  platform,
  cookies,
  depends,
}): Promise<LoadResult> => {
  depends('account:subscriptions');
  const api = createServerApi(platform, cookies);

  const [memberships, courses] = await Promise.allSettled([
    api.subscription.getMine(),
    api.subscription.listMyCourseSubscriptions(
      new URLSearchParams({ limit: COURSE_SUBSCRIPTIONS_LIMIT })
    ),
  ]);

  return {
    subscriptions: memberships.status === 'fulfilled' ? memberships.value : [],
    loadError: memberships.status === 'rejected',
    courseSubscriptions:
      courses.status === 'fulfilled' ? courses.value.items : [],
    courseLoadError: courses.status === 'rejected',
  };
};

/**
 * Creator Studio layout - server load
 *
 * Access control guard for the personal creator studio.
 * Redirects unauthenticated users to login and non-creators to homepage.
 * Loads creator profile and organization list for the sidebar/switcher.
 */
import {
  CONTENT_LIFECYCLE,
  CONTENT_LIST_SCOPE,
  STUDIO_ROLES,
} from '@codex/constants';
import { redirect } from '@sveltejs/kit';
import { shouldResumeInWizard } from '$lib/onboarding/onboarding-flow';
import { getProfile } from '$lib/remote/account.remote';
import { getCreatorOnboarding } from '$lib/remote/onboarding.remote';
import { getMyOrganizations } from '$lib/remote/org.remote';
import { createServerApi } from '$lib/server/api';
import { CACHE_HEADERS } from '$lib/server/cache';
import { logSignedInReadFailure } from '$lib/server/read-failure';
import { buildPlatformUrl } from '$lib/utils/subdomain';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({
  locals,
  depends,
  url,
  platform,
  cookies,
  setHeaders,
}) => {
  // Auth gate: must be logged in
  // Use full URL in redirect param to preserve the creators subdomain after login
  if (!locals.user) {
    redirect(302, `/login?redirect=${encodeURIComponent(url.pathname)}`);
  }

  // Role gate: must be a creator, admin, or platform_owner
  if (!STUDIO_ROLES.has(locals.user.role)) {
    redirect(302, '/?error=access_denied');
  }

  // Safety net: a creator who started the guided onboarding wizard and then
  // navigated straight to the studio is bounced back to finish it. Gated on the
  // stored pointer (not a data-derived "incomplete"), so a legacy creator whose
  // record is a fresh `essentials` upsert is never trapped, and finished /
  // dismissed creators are left alone. See shouldResumeInWizard.
  const onboarding = await getCreatorOnboarding().catch(() => null);
  if (onboarding && shouldResumeInWizard(onboarding)) {
    redirect(
      302,
      buildPlatformUrl(url, `/become-creator?step=${onboarding.currentStep}`)
    );
  }

  // Studio is always user-specific — prevent public caching
  setHeaders(CACHE_HEADERS.PRIVATE);

  depends('cache:studio');

  // Profile, orgs and the draft badge in parallel for the sidebar/switcher.
  const [profile, orgsResult, draftCount] = await Promise.all([
    getProfile().catch(() => null),
    getMyOrganizations().catch(() => []),
    // Non-critical: the badge just won't show. Logged, so a refused scope or
    // an outage is never read as "no drafts".
    countPersonalDrafts(platform, cookies).catch((error: unknown) => {
      logSignedInReadFailure(
        {
          refused: 'studio.draft_badge_refused',
          unavailable: 'studio.draft_badge_unavailable',
        },
        { scope: CONTENT_LIST_SCOPE.PERSONAL },
        error
      );
      return 0;
    }),
  ]);

  const orgs = (orgsResult ?? []).map((o) => ({
    // The content list's Where names its org by id (Codex-a6ofh.3.2).
    id: o.id,
    name: o.name,
    slug: o.slug,
    logoUrl: o.logoUrl ?? undefined,
  }));

  return {
    creator: {
      id: locals.user.id,
      name: profile?.name ?? locals.user.name ?? 'Creator',
      username: profile?.username ?? null,
      avatarUrl: profile?.image ?? null,
    },
    orgs,
    studioUser: {
      name: locals.user.name ?? '',
      email: locals.user.email ?? '',
    },
    badgeCounts: {
      draftContent: draftCount,
    },
  };
};

/**
 * The draft badge's count: a limit-1 read, for its `pagination.total`. The
 * personal drafts, as the list the badge opens shows them: with no scope the
 * read spans every org, so the badge counted org drafts the list (Personal by
 * default) leaves out (Codex-a6ofh.3.2).
 */
async function countPersonalDrafts(
  ...api: Parameters<typeof createServerApi>
): Promise<number> {
  const result = await createServerApi(...api).content.list(
    new URLSearchParams({
      // The drafts never live, the Drafts tab's (Codex-a6ofh.3.6).
      lifecycle: CONTENT_LIFECYCLE.DRAFT,
      scope: CONTENT_LIST_SCOPE.PERSONAL,
      limit: '1',
      page: '1',
    })
  );
  return result?.pagination?.total ?? 0;
}

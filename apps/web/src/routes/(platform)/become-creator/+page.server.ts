/**
 * Become Creator — guided onboarding wizard server load.
 *
 * Owns the whole identity-setup arc (username → avatar+bio+links → payouts →
 * finish), with the active step in `?step=`. Resolution and the
 * routing guards are driven by the server `creator_onboarding` record so the
 * flow is resumable across the Stripe Connect external redirect.
 *
 * Guards:
 *  - logged-out            → /login
 *  - finished / dismissed  → studio (unless explicitly viewing the finish step)
 *  - otherwise             → stay in the flow at the resolved step
 */

import { redirect } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import {
  isOnboardingActive,
  resolveOnboardingStep,
} from '$lib/onboarding/onboarding-flow';
import { createServerApi } from '$lib/server/api';
import { buildCreatorsUrl } from '$lib/utils/subdomain';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  locals,
  url,
  platform,
  cookies,
}) => {
  if (!locals.user) {
    redirect(303, '/login?redirect=/become-creator');
  }

  const api = createServerApi(platform, cookies);
  const isCreator = locals.user.role !== 'customer';
  const requestedStep = url.searchParams.get('step');

  // ── Stripe Connect return handling (only meaningful post-upgrade) ──────────
  // Stripe redirects back with ?connect=success|refresh. Sync BEFORE reading
  // status so the returned state is fresh (the webhook may lag, esp. locally).
  const connectParam = url.searchParams.get('connect');
  let connectReturnBanner: 'success' | 'sync_failed' | 'refresh' | null = null;
  if (isCreator && connectParam === 'success') {
    try {
      await api.connect.syncMyStatus();
      connectReturnBanner = 'success';
    } catch (err) {
      logger.error('become-creator:syncMyStatus failed on connect return', {
        error: err instanceof Error ? err.message : String(err),
        userId: locals.user.id,
      });
      connectReturnBanner = 'sync_failed';
    }
  } else if (connectParam === 'refresh') {
    connectReturnBanner = 'refresh';
  }

  // Profile (username/bio/avatar) + onboarding record both feed step resolution.
  const [profile, onboarding] = await Promise.all([
    api.account.getProfile().catch(() => null),
    api.account.getCreatorOnboarding().catch(() => null),
  ]);

  // Finished or dismissed creators belong in the studio — but still let them
  // view the celebration if they explicitly land on the finish step.
  if (
    isCreator &&
    onboarding &&
    !isOnboardingActive(onboarding) &&
    requestedStep !== 'finish'
  ) {
    redirect(303, buildCreatorsUrl(url, '/studio'));
  }

  // Connect status only matters post-upgrade — a customer can't have an account
  // yet, so skip the round-trip and treat payouts as not-enabled.
  type ConnectStatusResult =
    | Awaited<ReturnType<typeof api.connect.getMyStatus>>
    | { fetchFailed: true }
    | null;
  let connectStatus: ConnectStatusResult = null;
  let payoutsEnabled = false;
  if (isCreator) {
    connectStatus = await api.connect.getMyStatus().catch((err) => {
      logger.error('become-creator:getMyStatus failed', {
        error: err instanceof Error ? err.message : String(err),
        userId: locals.user?.id,
      });
      return { fetchFailed: true as const };
    });
    payoutsEnabled =
      !!connectStatus &&
      !('fetchFailed' in connectStatus) &&
      !!connectStatus.chargesEnabled &&
      !!connectStatus.payoutsEnabled;
  }

  const step = resolveOnboardingStep(
    {
      role: locals.user.role,
      hasUsername: !!profile?.username,
      hasAvatar: !!profile?.image,
      payoutsEnabled,
      currentStep: onboarding?.currentStep ?? 'essentials',
    },
    requestedStep
  );

  return {
    step,
    profile: {
      name: locals.user.name,
      username: profile?.username ?? null,
      bio: profile?.bio ?? null,
      avatarUrl: profile?.image ?? null,
      socialLinks: profile?.socialLinks ?? null,
    },
    onboarding,
    connectStatus,
    payoutsEnabled,
    connectReturnBanner,
  };
};

/**
 * Creator Onboarding Remote Functions
 *
 * Server-side reads/patches of the creator first-run onboarding state that
 * drives the guided /become-creator wizard.
 *
 * - `getCreatorOnboarding` — query() for reactive reads (studio guard, wizard,
 *   first-run modal tour).
 * - `updateCreatorOnboarding` — command() for the wizard's step-pointer moves
 *   and welcomeSeen/dismissed/completed intents.
 *
 * Backend: workers/identity-api/src/routes/users.ts (`/api/user/creator-onboarding`)
 */

import { updateCreatorOnboardingSchema } from '@codex/validation';
import { command, getRequestEvent, query } from '$app/server';
import { createServerApi } from '$lib/server/api';

/**
 * Get the authenticated creator's onboarding state.
 * The backend upserts defaults on first access, so this always resolves to a
 * concrete record for a logged-in creator.
 */
export const getCreatorOnboarding = query(async () => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.account.getCreatorOnboarding();
});

/**
 * Patch the onboarding state (step pointer + boolean intents).
 * Refreshes the query so dependent UI reflects the new state.
 */
export const updateCreatorOnboarding = command(
  updateCreatorOnboardingSchema,
  async (input) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    const result = await api.account.updateCreatorOnboarding(input);
    await getCreatorOnboarding().refresh();
    return result;
  }
);

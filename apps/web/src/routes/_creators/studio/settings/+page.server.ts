/**
 * Creator Studio Settings - server load
 *
 * Loads the creator's profile data for the settings form.
 * Auth is handled by the parent studio layout.
 */
import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, cookies }) => {
  try {
    const api = createServerApi(platform, cookies);
    const response = await api.account.getProfile();
    return { profile: response };
  } catch {
    return { profile: null };
  }
};

/**
 * General Settings Page - Server Load
 *
 * Fetches contact settings (platform name, support email, social URLs, timezone)
 * for the admin settings page. The orgId is provided by the parent settings layout
 * which also enforces the admin/owner role guard.
 */

import { getContactSettings } from '$lib/remote/settings.remote';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, depends }) => {
  depends('cache:studio-page:settings');
  const { orgId } = await parent();

  try {
    const contact = await getContactSettings(orgId);

    return {
      contact: contact ?? null,
    };
  } catch {
    return {
      contact: null,
    };
  }
};

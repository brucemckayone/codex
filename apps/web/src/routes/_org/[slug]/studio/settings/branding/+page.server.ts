/**
 * Branding Settings Page - Server Load
 *
 * Fetches branding settings (logo, primary color) for the admin settings page.
 * The orgId is provided by the parent settings layout which also enforces the
 * admin/owner role guard.
 */

import { getBrandingSettings } from '$lib/remote/branding.remote';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
  const { orgId } = await parent();

  try {
    const branding = await getBrandingSettings(orgId);

    return {
      branding: branding ?? null,
    };
  } catch {
    return {
      branding: null,
    };
  }
};

/**
 * Organization layout server load
 * Resolves org from slug and injects branding
 *
 * Uses unauthenticated getPublicBranding for public org pages.
 * The org data is minimal (logo, name, colors) for public display.
 */

import { getPublicBranding } from '$lib/remote/org.remote';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals }) => {
  const { slug } = params;

  // Load public branding (unauthenticated, fast)
  const branding = await getPublicBranding(slug);

  // If org not found, return minimal data for error handling
  if (!branding) {
    return {
      org: null,
      user: locals.user,
    };
  }

  return {
    org: {
      id: branding.orgId,
      slug,
      name: branding.platformName,
      description: null,
      logoUrl: branding.logoUrl,
      brandColors: {
        primary: branding.primaryColorHex,
      },
    },
    user: locals.user,
  };
};

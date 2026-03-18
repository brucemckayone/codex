/**
 * Organization layout server load
 * Resolves org from slug and injects branding.
 *
 * Calls the public org info endpoint directly (no auth required) so
 * org pages work across subdomains where session cookies don't propagate.
 * Falls back to the authenticated remote function.
 */

import { error } from '@sveltejs/kit';
import { getOrganization } from '$lib/remote/org.remote';
import { createServerApi } from '$lib/server/api';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({
  params,
  locals,
  platform,
  cookies,
}) => {
  const { slug } = params;

  // Try public endpoint first (works across subdomains without cookies)
  try {
    const api = createServerApi(platform, cookies);
    const result = await api.org.getPublicInfo(slug);
    // procedure() wraps handler return in { data: ... }
    const inner = (result as { data: { data: unknown } })?.data;
    const org =
      (
        inner as {
          data: {
            id: string;
            slug: string;
            name: string;
            description: string | null;
            logoUrl: string | null;
            brandColors: { primary?: string };
          };
        }
      )?.data ?? inner;

    if (org && typeof org === 'object' && 'id' in org) {
      return {
        org: org as {
          id: string;
          slug: string;
          name: string;
          description: string | null;
          logoUrl: string | null;
          brandColors: { primary?: string };
        },
        user: locals.user,
      };
    }
  } catch {
    // Public endpoint failed — try authenticated
  }

  // Fall back to authenticated remote function
  try {
    const orgResult = await getOrganization(slug);
    const org = orgResult?.data;

    if (org) {
      return {
        org: {
          id: org.id,
          slug: org.slug,
          name: org.name,
          description: org.description,
          logoUrl: org.logoUrl,
          brandColors: org.brandColors,
        },
        user: locals.user,
      };
    }
  } catch {
    // Both endpoints failed
  }

  error(404, `Organization "${slug}" not found`);
};

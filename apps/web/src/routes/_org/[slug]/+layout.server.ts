/**
 * Organization layout server load
 * Resolves org from slug and injects branding
 */

import { error } from '@sveltejs/kit';
import { getOrganization } from '$lib/remote/org.remote';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals }) => {
  const { slug } = params;

  // Load organization using remote query
  const orgResult = await getOrganization(slug);
  const org = orgResult?.data;

  if (!org) {
    error(404, `Organization "${slug}" not found`);
  }

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
};

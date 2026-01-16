/**
 * Organization layout server load
 * Resolves org from slug and injects branding
 */

import type { OrganizationData } from '$lib/types';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals }) => {
  const { slug } = params;

  // TODO: Fetch org data from Organization-API
  // const orgApiUrl = platform?.env?.ORG_API_URL ?? 'http://localhost:42071';
  // const response = await fetch(`${orgApiUrl}/api/organizations/by-slug/${slug}`);

  // For now, return placeholder org data
  // In production, this would error(404) if org not found
  const org: OrganizationData = {
    id: 'placeholder-id',
    slug,
    name: slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' '),
    description: 'Organization description',
    logoUrl: null,
    brandColors: {
      primary: '#e94560',
      secondary: '#1a1a2e',
      accent: '#ff6b6b',
    },
  };

  return {
    org,
    user: locals.user,
  };
};

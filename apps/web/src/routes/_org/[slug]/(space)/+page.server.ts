/**
 * Organization landing page - server load
 * Sets public cache headers for edge caching
 */

import { getPublicBranding } from '$lib/remote/org.remote';
import { CACHE_HEADERS } from '$lib/server/cache';
import type { PageServerLoad } from './$types';

// Content item type for featured content
interface ContentItem {
  id: string;
  title: string;
  thumbnail: string | null;
  description: string | null;
  contentType: 'video' | 'audio' | 'article';
  duration: number | null;
  creator: {
    username?: string;
    displayName?: string;
    avatar?: string | null;
  };
}

export const load: PageServerLoad = async ({ params, parent, setHeaders }) => {
  setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC);

  const parentData = await parent();

  // Get branding if not already in parentData
  const branding =
    parentData.branding ?? (await getPublicBranding(params.slug));

  // TODO: Wire to content API once Codex-qv2 is complete
  const featuredContent: ContentItem[] = [];

  return {
    org: parentData.org ?? {
      id: '',
      slug: params.slug,
      name: branding?.platformName ?? params.slug,
      description: null,
      logoUrl: branding?.logoUrl ?? null,
      brandColors: branding
        ? {
            primary: branding.primaryColorHex,
          }
        : undefined,
    },
    branding,
    featuredContent,
  };
};

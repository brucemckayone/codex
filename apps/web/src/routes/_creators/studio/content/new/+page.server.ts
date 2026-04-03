/**
 * New Content Page (Creator Studio) - Server Load
 *
 * Loads available media items for the media picker.
 * Media is always creator-scoped, so no organizationId filter needed.
 */
import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, cookies }) => {
  try {
    const api = createServerApi(platform, cookies);
    const params = new URLSearchParams();
    params.set('status', 'ready');
    params.set('limit', '50');
    params.set('sortBy', 'createdAt');
    params.set('sortOrder', 'desc');

    const mediaResult = await api.media.list(params);

    return {
      organizationId: null,
      orgSlug: null,
      mediaItems: mediaResult?.items ?? [],
    };
  } catch {
    return {
      organizationId: null,
      orgSlug: null,
      mediaItems: [],
    };
  }
};

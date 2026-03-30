/**
 * New Content Page - Server Load
 *
 * Loads available media items for the media picker in the content form.
 * Auth is handled by the parent studio layout.
 */

import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, platform, cookies }) => {
  const { org } = await parent();

  // Load ready media items for the media picker
  try {
    const api = createServerApi(platform, cookies);
    const params = new URLSearchParams();
    params.set('organizationId', org.id);
    params.set('status', 'ready');
    params.set('limit', '50');
    params.set('sortBy', 'createdAt');
    params.set('sortOrder', 'desc');

    const mediaResult = await api.media.list(params);

    return {
      organizationId: org.id,
      orgSlug: org.slug,
      mediaItems: mediaResult?.items ?? [],
    };
  } catch {
    return {
      organizationId: org.id,
      orgSlug: org.slug,
      mediaItems: [],
    };
  }
};

/**
 * Studio Content Edit - server load
 *
 * Loads content by ID and available media items for the edit form.
 * Auth is handled by the parent studio layout (redirects to login/join).
 */
import { error } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  parent,
  params,
  platform,
  cookies,
}) => {
  const { org } = await parent();

  try {
    const api = createServerApi(platform, cookies);
    const result = await api.content.get(params.contentId);

    if (!result) {
      error(404, 'Content not found');
    }

    // Load ready media items for the media picker (same pattern as new/+page.server.ts)
    const mediaParams = new URLSearchParams();
    mediaParams.set('organizationId', org.id);
    mediaParams.set('status', 'ready');
    mediaParams.set('limit', '50');
    mediaParams.set('sortBy', 'createdAt');
    mediaParams.set('sortOrder', 'desc');

    const mediaResult = await api.media.list(mediaParams).catch(() => null);

    return {
      content: result,
      organizationId: org.id,
      orgSlug: org.slug,
      mediaItems: mediaResult?.items ?? [],
    };
  } catch (err) {
    // Re-throw SvelteKit errors (404, etc.)
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    error(500, 'Failed to load content');
  }
};

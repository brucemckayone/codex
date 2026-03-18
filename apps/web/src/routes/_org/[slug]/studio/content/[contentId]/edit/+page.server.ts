/**
 * Studio Content Edit - server load
 *
 * Loads content by ID for the edit form.
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

    if (!result?.data) {
      error(404, 'Content not found');
    }

    return {
      content: result.data,
      organizationId: org.id,
    };
  } catch (err) {
    // Re-throw SvelteKit errors (404, etc.)
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    error(500, 'Failed to load content');
  }
};

/**
 * Creator Studio Content Edit - server load
 *
 * Loads content by ID for the edit form. The media picker reads the
 * creator's library itself, on open (Codex-a6ofh.1.8).
 * Auth is handled by the parent studio layout.
 */
import { error } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  params,
  url,
  platform,
  cookies,
}) => {
  // Read, so SvelteKit runs this again whenever the step changes (Next, Back,
  // Forward, a held move sent on): each step's session starts from the piece
  // as the other step left it (Codex-a6ofh.2.3, .2.4).
  url.searchParams.get('step');
  try {
    const api = createServerApi(platform, cookies);
    const result = await api.content.get(params.contentId);

    if (!result) {
      error(404, 'Content not found');
    }

    return {
      content: result,
      organizationId: null,
      orgSlug: null,
    };
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    error(500, 'Failed to load content');
  }
};

import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, cookies, platform }) => {
  const contentId = url.searchParams.get('contentId');
  const sessionId = url.searchParams.get('session_id');

  const api = createServerApi(platform, cookies);

  if (!contentId) {
    return {
      content: null,
      sessionId,
    };
  }

  try {
    const contentResult = await api.content.get(contentId);
    return {
      content: contentResult.data ?? null,
      sessionId,
    };
  } catch {
    return {
      content: null,
      sessionId,
    };
  }
};

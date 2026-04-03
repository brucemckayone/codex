/**
 * Creator Studio Content Management - server load
 *
 * Lists personal content (organizationId = null) with pagination.
 * Auth is handled by the parent studio layout.
 */
import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  url,
  platform,
  cookies,
  depends,
}) => {
  depends('cache:studio-page:content');

  const page = Math.max(
    1,
    parseInt(url.searchParams.get('page') || '1', 10) || 1
  );
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20)
  );

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  params.set('sortBy', 'createdAt');
  params.set('sortOrder', 'desc');
  // No organizationId — returns only personal content scoped by session creatorId

  const fallbackPagination = { page: 1, limit: 20, total: 0, totalPages: 0 };

  try {
    const api = createServerApi(platform, cookies);
    const result = await api.content.list(params);

    return {
      content: {
        items: result?.items ?? [],
        pagination: result?.pagination ?? fallbackPagination,
      },
    };
  } catch {
    return {
      content: {
        items: [],
        pagination: fallbackPagination,
      },
    };
  }
};

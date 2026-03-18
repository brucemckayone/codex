/**
 * Studio Content Management - server load
 *
 * Lists all org content with pagination for the studio content table.
 * Auth is handled by the parent studio layout (redirects to login/join).
 */
import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  parent,
  url,
  platform,
  cookies,
}) => {
  const { org } = await parent();

  // Parse pagination from URL params with validation
  const page = Math.max(
    1,
    parseInt(url.searchParams.get('page') || '1', 10) || 1
  );
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20)
  );

  // Build query parameters
  const params = new URLSearchParams();
  params.set('organizationId', org.id);
  params.set('page', String(page));
  params.set('limit', String(limit));
  params.set('sortBy', 'createdAt');
  params.set('sortOrder', 'desc');

  try {
    const api = createServerApi(platform, cookies);
    const result = await api.content.list(params);

    return {
      content: {
        items: result.items,
        pagination: result.pagination,
      },
    };
  } catch {
    return {
      content: {
        items: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
        },
      },
    };
  }
};

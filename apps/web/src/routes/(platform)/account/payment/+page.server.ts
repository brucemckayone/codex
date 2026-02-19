import { redirect } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  locals,
  url,
  setHeaders,
  platform,
  cookies,
}) => {
  if (!locals.user) {
    redirect(303, '/login?redirect=/account/payment');
  }

  setHeaders({ 'Cache-Control': 'private, no-cache' });

  // Parse pagination and filter parameters from URL
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);
  const status = url.searchParams.get('status') || undefined;

  // Build query parameters
  const params = new URLSearchParams();
  if (page > 1) params.set('page', String(page));
  if (limit !== 20) params.set('limit', String(limit));
  if (status) params.set('status', status);

  try {
    const api = createServerApi(platform, cookies);
    const purchases = await api.account.getPurchaseHistory(params);

    return {
      purchases: {
        items: purchases.items,
        pagination: purchases.pagination,
      },
      filters: {
        status: status || null,
      },
    };
  } catch (error) {
    // Return empty state on error
    return {
      purchases: {
        items: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
        },
      },
      filters: {
        status: status || null,
      },
    };
  }
};

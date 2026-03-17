import { redirect } from '@sveltejs/kit';
import { createServerApi } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  locals,
  url,
  platform,
  cookies,
}) => {
  if (!locals.user) {
    redirect(303, '/login?redirect=/account/payment');
  }

  // Parse pagination and filter parameters from URL with validation
  const page = Math.max(
    1,
    parseInt(url.searchParams.get('page') || '1', 10) || 1
  );
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20)
  );
  const validStatuses = ['completed', 'pending', 'failed', 'refunded'] as const;
  const rawStatus = url.searchParams.get('status');
  const status =
    rawStatus &&
    validStatuses.includes(rawStatus as (typeof validStatuses)[number])
      ? rawStatus
      : undefined;

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
  } catch {
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

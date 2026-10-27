/**
 * Account → Payments: the buyer's purchase history.
 *
 * A failed read is not "no purchases" (Codex-2hxff.22 WEB-05): it is logged
 * and reported as `loadFailed`, and the page says "We couldn't load your
 * purchases." with Retry, which re-runs this load (`account:purchases`).
 */
import { redirect } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import { createServerApi } from '$lib/server/api';
import { ApiError } from '$lib/server/errors';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({
  locals,
  url,
  platform,
  cookies,
  depends,
}) => {
  depends('account:purchases');

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
      loadFailed: false,
    };
  } catch (err) {
    logger.warn('account-payment: purchase history failed', {
      status: err instanceof ApiError ? err.status : undefined,
      error: err instanceof Error ? err.message : String(err),
    });
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
      loadFailed: true,
    };
  }
};

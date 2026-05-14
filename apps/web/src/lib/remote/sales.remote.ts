/**
 * Sales Remote Functions (studio Sales ledger — Codex-1csms)
 *
 * Org-scoped wrappers for `GET /sales` and `GET /sales/stats` on ecom-api.
 * Owner-only at the UI layer; the worker enforces `requireOrgManagement` and
 * re-derives scope from the authenticated session membership.
 *
 * Snapshot query semantics — every filter / page change re-fires. Matches the
 * payouts page; no TanStack DB live collection in Phase 1.
 */

import { z } from 'zod';
import { getRequestEvent, query } from '$app/server';
import { createServerApi } from '$lib/server/api';

const listSalesQueryArgsSchema = z.object({
  organizationId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .enum(['pending', 'completed', 'refunded', 'failed', 'disputed'])
    .optional(),
  contentId: z.string().uuid().optional(),
  customerId: z.string().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

export const listSales = query(
  listSalesQueryArgsSchema,
  async ({
    organizationId,
    page,
    limit,
    status,
    contentId,
    customerId,
    fromDate,
    toDate,
  }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (status) params.set('status', status);
    if (contentId) params.set('contentId', contentId);
    if (customerId) params.set('customerId', customerId);
    if (fromDate) params.set('fromDate', fromDate);
    if (toDate) params.set('toDate', toDate);
    return api.subscription.listSales(organizationId, params);
  }
);

const salesStatsQueryArgsSchema = z.object({
  organizationId: z.string().uuid(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

export const getSalesStats = query(
  salesStatsQueryArgsSchema,
  async ({ organizationId, fromDate, toDate }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    const params = new URLSearchParams();
    if (fromDate) params.set('fromDate', fromDate);
    if (toDate) params.set('toDate', toDate);
    return api.subscription.getSalesStats(organizationId, params);
  }
);

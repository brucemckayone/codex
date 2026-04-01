/**
 * Billing Remote Functions
 *
 * Server-side functions for studio billing page.
 * Uses `form()` for Stripe portal redirect (progressive enhancement).
 * Uses `query()` for revenue and top content analytics.
 */

import { z } from 'zod';
import { getRequestEvent, query } from '$app/server';
import { createServerApi } from '$lib/server/api';

// Re-export portalSessionForm — shared implementation uses url.href as returnUrl
export { portalSessionForm } from './account.remote';

// ─────────────────────────────────────────────────────────────────────────────
// Revenue Query
// ─────────────────────────────────────────────────────────────────────────────

const revenueQuerySchema = z.object({
  organizationId: z.string().uuid(),
});

/**
 * Get organization revenue summary for billing page.
 *
 * Usage:
 * ```svelte
 * <script>
 *   const revenue = await getOrgRevenue({ organizationId: orgId });
 * </script>
 * ```
 */
export const getOrgRevenue = query(revenueQuerySchema, async (params) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  const searchParams = new URLSearchParams();
  searchParams.set('organizationId', params.organizationId);

  return api.analytics.getRevenue(searchParams);
});

// ─────────────────────────────────────────────────────────────────────────────
// Top Content Query
// ─────────────────────────────────────────────────────────────────────────────

const topContentQuerySchema = z.object({
  organizationId: z.string().uuid(),
  limit: z.coerce.number().min(1).max(100).optional().default(5),
});

/**
 * Get top-performing content by revenue for billing page.
 *
 * Usage:
 * ```svelte
 * <script>
 *   const topContent = await getTopContent({ organizationId: orgId, limit: 5 });
 * </script>
 * ```
 */
export const getTopContent = query(topContentQuerySchema, async (params) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);

  const searchParams = new URLSearchParams();
  searchParams.set('organizationId', params.organizationId);
  searchParams.set('limit', String(params.limit));

  return api.analytics.getTopContent(searchParams);
});

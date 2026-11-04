/**
 * Billing Remote Functions
 *
 * Server-side functions for studio billing page.
 * Uses `form()` for Stripe portal redirect (progressive enhancement).
 * Uses `query()` for revenue and top content analytics.
 */

import { upcomingFeesQuerySchema } from '@codex/validation';
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

// ─────────────────────────────────────────────────────────────────────────────
// Upcoming Fees Query (Codex-2hxff.33)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The caller's fee rises that haven't started, for the Studio note
 * (`UpcomingFeeNote`). Billing and Payouts pass `organizationId` (the owner's
 * rows there); Earnings passes `{}` (the caller's creator rows everywhere).
 *
 * Read once per visit: the note's Try again is the only re-read, and nothing
 * re-checks by itself (the cost rule). A person has a handful at most, so the
 * worker answers one page and this returns its items.
 */
export const getUpcomingFees = query(
  upcomingFeesQuerySchema,
  async ({ organizationId }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    const result = await api.fees.upcoming(organizationId);
    return result.items;
  }
);

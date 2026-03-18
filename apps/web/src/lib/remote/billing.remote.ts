/**
 * Billing Remote Functions
 *
 * Server-side functions for studio billing page.
 * Uses `form()` for Stripe portal redirect (progressive enhancement).
 * Uses `query()` for revenue and top content analytics.
 */

import { isRedirect, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { form, getRequestEvent, query } from '$app/server';
import { createServerApi } from '$lib/server/api';

// ─────────────────────────────────────────────────────────────────────────────
// Portal Session Form (Studio Billing)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open Stripe Customer Portal from studio billing page.
 * Return URL points back to /{slug}/studio/billing.
 *
 * Usage:
 * ```svelte
 * <form {...portalSessionForm}>
 *   <button type="submit" disabled={portalSessionForm.pending > 0}>
 *     Manage Billing
 *   </button>
 * </form>
 * ```
 */
export const portalSessionForm = form(z.object({}), async (_data) => {
  const { platform, cookies, url, params } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  const slug = params.slug;

  try {
    const result = await api.checkout.createPortalSession({
      returnUrl: `${url.origin}/${slug}/studio/billing`,
    });

    // Validate the redirect URL to prevent open redirect attacks
    const portalUrl = new URL(result.data.url);
    if (!portalUrl.hostname.endsWith('.stripe.com')) {
      throw new Error('Invalid billing portal URL');
    }

    redirect(303, result.data.url);
  } catch (error) {
    if (isRedirect(error)) throw error;
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to open billing portal',
    };
  }
});

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

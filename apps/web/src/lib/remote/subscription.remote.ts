/**
 * Subscription Remote Functions
 *
 * Server-side functions for subscription management:
 * - Tier browsing (public)
 * - Subscription checkout
 * - Subscription lifecycle (cancel, change tier, reactivate)
 * - Admin: tier CRUD, subscriber stats
 * - Connect account management
 */

import { z } from 'zod';
import { command, form, getRequestEvent, query } from '$app/server';
import { ApiError } from '$lib/api/errors';
import { createServerApi } from '$lib/server/api';

type SubscriptionCommandFailure = {
  success: false;
  code: string | undefined;
  message: string;
  status: number;
};

function toCommandFailure(error: unknown): SubscriptionCommandFailure {
  if (ApiError.isApiError(error)) {
    return {
      success: false,
      code: error.code,
      message: error.message,
      status: error.status,
    };
  }
  return {
    success: false,
    code: undefined,
    message: error instanceof Error ? error.message : 'Unexpected error',
    status: 500,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier Queries (public)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List active subscription tiers for an org (public, no auth required).
 * Used on the org pricing page and content detail modals.
 */
export const listTiers = query(z.string().uuid(), async (orgId) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.tiers.list(orgId);
});

// ─────────────────────────────────────────────────────────────────────────────
// Subscription Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the user's current subscription for an org.
 * Returns null if no active subscription.
 */
export const getCurrentSubscription = query(
  z.string().uuid(),
  async (organizationId) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.subscription.getCurrent(organizationId);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Subscription Checkout (command — SPA style)
// ─────────────────────────────────────────────────────────────────────────────

const subscriptionCheckoutCommandSchema = z.object({
  tierId: z.string().uuid(),
  billingInterval: z.enum(['month', 'year']),
  organizationId: z.string().uuid(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

/**
 * Create subscription checkout session and return URL.
 * For SPA-style checkout with client-side redirect.
 */
export const createSubscriptionCheckoutSession = command(
  subscriptionCheckoutCommandSchema,
  async ({
    tierId,
    billingInterval,
    organizationId,
    successUrl,
    cancelUrl,
  }) => {
    const { platform, cookies, url } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    try {
      const result = await api.subscription.checkout({
        organizationId,
        tierId,
        billingInterval,
        // Stripe expands `{CHECKOUT_SESSION_ID}` to the real session id on
        // redirect. The /subscription/success page polls the verify endpoint
        // until the `checkout.session.completed` webhook has landed, then
        // hands the user off to /library — otherwise they'd land on /library
        // before the subscription row exists and see an empty page.
        successUrl:
          successUrl ||
          `${url.origin}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: cancelUrl || `${url.origin}/pricing`,
      });

      return { success: true as const, sessionUrl: result.sessionUrl };
    } catch (error) {
      return toCommandFailure(error);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Subscription Lifecycle Commands
// ─────────────────────────────────────────────────────────────────────────────

const changeTierCommandSchema = z.object({
  organizationId: z.string().uuid(),
  newTierId: z.string().uuid(),
  billingInterval: z.enum(['month', 'year']),
  /**
   * Unix timestamp (seconds) — pass through from `previewSubscriptionTierChange()`
   * so the commit-time charge matches the dialog preview exactly.
   * Omitted by `previewSubscriptionTierChange` itself (preview computes its own).
   */
  prorationDate: z.number().int().positive().optional(),
});

/**
 * Preview the proration a tier change would produce. Powers the confirmation
 * dialog. The returned `prorationDate` MUST be threaded back into
 * `changeSubscriptionTier()` so the commit-time charge matches the preview.
 */
export const previewSubscriptionTierChange = command(
  changeTierCommandSchema,
  async (input) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    try {
      const result = await api.subscription.previewTierChange(input);
      return { success: true as const, data: result };
    } catch (error) {
      return toCommandFailure(error);
    }
  }
);

/**
 * Change (upgrade/downgrade) subscription tier.
 */
export const changeSubscriptionTier = command(
  changeTierCommandSchema,
  async (input) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    try {
      const result = await api.subscription.changeTier(input);
      return { success: true as const, data: result };
    } catch (error) {
      return toCommandFailure(error);
    }
  }
);

const cancelCommandSchema = z.object({
  organizationId: z.string().uuid(),
  reason: z.string().max(500).optional(),
  churnReason: z
    .enum([
      'too_expensive',
      'not_enough_content',
      'found_alternative',
      'not_using_it',
      'technical_issues',
      'other',
    ])
    .optional(),
});

/**
 * Cancel subscription at end of current billing period.
 */
export const cancelSubscription = command(
  cancelCommandSchema,
  async (input) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    try {
      const result = await api.subscription.cancel(input);
      return { success: true as const, data: result };
    } catch (error) {
      return toCommandFailure(error);
    }
  }
);

const reactivateCommandSchema = z.object({
  organizationId: z.string().uuid(),
});

/**
 * Reactivate a subscription that is set to cancel at period end.
 */
export const reactivateSubscription = command(
  reactivateCommandSchema,
  async (input) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    try {
      const result = await api.subscription.reactivate(input);
      return { success: true as const, data: result };
    } catch (error) {
      return toCommandFailure(error);
    }
  }
);

const resumeCommandSchema = z.object({
  organizationId: z.string().uuid(),
});

/**
 * Resume a PAUSED subscription (user-initiated).
 *
 * Parallel to `reactivateSubscription` but for the `paused → active`
 * transition. The backend calls Stripe's `subscriptions.resume` API and
 * flips the local DB row back to 'active'. See bead Codex-7h4vo.
 */
export const resumeSubscription = command(
  resumeCommandSchema,
  async (input) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    try {
      const result = await api.subscription.resume(input);
      return { success: true as const, data: result };
    } catch (error) {
      return toCommandFailure(error);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Tier CRUD Commands
// ─────────────────────────────────────────────────────────────────────────────

const createTierCommandSchema = z.object({
  orgId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  priceMonthly: z.number().int().min(100),
  priceAnnual: z.number().int().min(100),
  isRecommended: z.boolean().optional(),
});

/**
 * Create a new subscription tier for an org.
 */
export const createTier = command(
  createTierCommandSchema,
  async ({ orgId, ...data }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.tiers.create(orgId, data);
  }
);

const updateTierCommandSchema = z.object({
  orgId: z.string().uuid(),
  tierId: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  priceMonthly: z.number().int().min(100).optional(),
  priceAnnual: z.number().int().min(100).optional(),
  isRecommended: z.boolean().optional(),
});

/**
 * Update an existing subscription tier.
 */
export const updateTier = command(
  updateTierCommandSchema,
  async ({ orgId, tierId, ...data }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.tiers.update(orgId, tierId, data);
  }
);

const deleteTierCommandSchema = z.object({
  orgId: z.string().uuid(),
  tierId: z.string().uuid(),
});

/**
 * Soft-delete a subscription tier.
 */
export const deleteTier = command(
  deleteTierCommandSchema,
  async ({ orgId, tierId }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    await api.tiers.delete(orgId, tierId);
    return { success: true as const };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Feature Toggle
// ─────────────────────────────────────────────────────────────────────────────

const updateSubscriptionFeatureSchema = z.object({
  orgId: z.string().uuid(),
  enabled: z.boolean(),
});

/**
 * Toggle the enableSubscriptions feature flag for an org.
 */
export const updateSubscriptionFeature = command(
  updateSubscriptionFeatureSchema,
  async ({ orgId, enabled }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.org.updateFeatures(orgId, { enableSubscriptions: enabled });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Stats & Subscribers Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get subscription stats for an org (admin).
 */
export const getSubscriptionStats = query(
  z.string().uuid(),
  async (organizationId) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.subscription.getStats(organizationId);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Stripe Connect Commands
// ─────────────────────────────────────────────────────────────────────────────

const connectOnboardCommandSchema = z.object({
  organizationId: z.string().uuid(),
  returnUrl: z.string().url(),
  refreshUrl: z.string().url(),
});

/**
 * Start Stripe Connect onboarding for an org.
 */
export const connectOnboard = command(
  connectOnboardCommandSchema,
  async (input) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.connect.onboard(input);
  }
);

/**
 * Get Connect account status for an org.
 */
export const getConnectStatus = query(
  z.string().uuid(),
  async (organizationId) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.connect.getStatus(organizationId);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Payouts Query (Codex-zqaxo)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Subscribers list (studio Subscribers page — Codex-1csms)
// ─────────────────────────────────────────────────────────────────────────────

const listSubscribersQueryArgsSchema = z.object({
  organizationId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  tierId: z.string().uuid().optional(),
  status: z.string().optional(),
  includeCancelled: z.coerce.boolean().optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

/**
 * List subscribers for the studio Subscribers page (Codex-1csms).
 *
 * Owner-only at the UI layer (the worker route uses requireOrgManagement +
 * the page applies $effect redirect for non-owners — same pattern as
 * /studio/payouts). Returns SubscriberListItem rows joined with user + tier.
 *
 * Re-fires every time any arg changes — snapshot semantics matching the
 * payouts page (no TanStack DB live collection in Phase 1).
 */
export const listSubscribers = query(
  listSubscribersQueryArgsSchema,
  async ({
    organizationId,
    page,
    limit,
    tierId,
    status,
    includeCancelled,
    search,
  }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (tierId) params.set('tierId', tierId);
    if (status) params.set('status', status);
    if (includeCancelled) params.set('includeCancelled', 'true');
    if (search) params.set('search', search);
    return api.subscription.getSubscribers(organizationId, params);
  }
);

const listPayoutsQueryArgsSchema = z.object({
  organizationId: z.string().uuid(),
  status: z.enum(['all', 'pending', 'resolved', 'failed']).default('all'),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * List pending + resolved creator payouts for an org (Codex-zqaxo).
 *
 * Backs the read-only `/studio/payouts` table. Owner-only — the worker
 * route enforces `requireOrgManagement` and re-derives scope from the
 * authenticated session membership; the client-supplied
 * `organizationId` is only used to build the URL.
 *
 * NOT cached as a TanStack DB live collection in Phase 1 — each
 * filter/page is a fresh snapshot query. See epic Codex-kbfe3 design
 * decisions.
 */
export const listPayouts = query(
  listPayoutsQueryArgsSchema,
  async ({ organizationId, status, fromDate, toDate, page, limit }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (fromDate) params.set('fromDate', fromDate);
    if (toDate) params.set('toDate', toDate);
    params.set('page', String(page));
    params.set('limit', String(limit));
    return api.subscription.listPayouts(organizationId, params);
  }
);

const connectDashboardCommandSchema = z.object({
  organizationId: z.string().uuid(),
});

/**
 * Get a Stripe Express dashboard login link.
 */
export const getConnectDashboardLink = command(
  connectDashboardCommandSchema,
  async ({ organizationId }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.connect.getDashboardLink(organizationId);
  }
);

const syncConnectCommandSchema = z.object({
  organizationId: z.string().uuid(),
});

/**
 * Sync Connect account status with Stripe.
 * Polls Stripe's API directly — used when webhooks can't reach the server.
 */
export const syncConnectStatus = command(
  syncConnectCommandSchema,
  async ({ organizationId }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.connect.syncStatus(organizationId);
  }
);

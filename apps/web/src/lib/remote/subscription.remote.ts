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

import { isRedirect, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { command, form, getRequestEvent, query } from '$app/server';
import { createServerApi } from '$lib/server/api';

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

/**
 * Get all of the user's active subscriptions across orgs.
 * Used on the account subscriptions page.
 */
export const getMySubscriptions = query(z.void(), async () => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.subscription.getMine();
});

// ─────────────────────────────────────────────────────────────────────────────
// Subscription Checkout (form — progressive enhancement)
// ─────────────────────────────────────────────────────────────────────────────

const subscriptionCheckoutFormSchema = z.object({
  tierId: z.string().uuid(),
  billingInterval: z.enum(['month', 'year']),
  organizationId: z.string().uuid(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

/**
 * Create subscription checkout session via form submission.
 * Redirects to Stripe Checkout page (works without JS).
 */
export const createSubscriptionCheckout = form(
  subscriptionCheckoutFormSchema,
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
        successUrl: successUrl || `${url.origin}/library?subscription=success`,
        cancelUrl: cancelUrl || `${url.origin}/pricing`,
      });

      redirect(303, result.sessionUrl);
    } catch (error) {
      if (isRedirect(error)) throw error;
      const message =
        error instanceof Error ? error.message : 'Subscription checkout failed';
      return { success: false as const, error: message };
    }
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

    const result = await api.subscription.checkout({
      organizationId,
      tierId,
      billingInterval,
      successUrl: successUrl || `${url.origin}/library?subscription=success`,
      cancelUrl: cancelUrl || `${url.origin}/pricing`,
    });

    return { sessionUrl: result.sessionUrl };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Subscription Lifecycle Commands
// ─────────────────────────────────────────────────────────────────────────────

const changeTierCommandSchema = z.object({
  organizationId: z.string().uuid(),
  newTierId: z.string().uuid(),
  billingInterval: z.enum(['month', 'year']),
});

/**
 * Change (upgrade/downgrade) subscription tier.
 */
export const changeSubscriptionTier = command(
  changeTierCommandSchema,
  async (input) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.subscription.changeTier(input);
  }
);

const cancelCommandSchema = z.object({
  organizationId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

/**
 * Cancel subscription at end of current billing period.
 */
export const cancelSubscription = command(
  cancelCommandSchema,
  async (input) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    return api.subscription.cancel(input);
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
    return api.subscription.reactivate(input);
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

const reorderTiersCommandSchema = z.object({
  orgId: z.string().uuid(),
  tierIds: z.array(z.string().uuid()).min(1),
});

/**
 * Reorder subscription tiers.
 */
export const reorderTiers = command(
  reorderTiersCommandSchema,
  async ({ orgId, tierIds }) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);
    await api.tiers.reorder(orgId, tierIds);
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

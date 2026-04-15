/**
 * Subscription Customer Endpoints
 *
 * Handles subscription checkout, management, and queries for customers.
 *
 * Endpoints:
 * - POST /subscriptions/checkout     - Create subscription checkout session
 * - GET  /subscriptions/current      - Get user's subscription for an org
 * - GET  /subscriptions/mine         - Get all user's subscriptions
 * - POST /subscriptions/change-tier  - Upgrade/downgrade tier
 * - POST /subscriptions/cancel       - Cancel at period end
 * - GET  /subscriptions/stats        - Subscriber stats (admin)
 */

import { CacheType, VersionedCache } from '@codex/cache';
import type { HonoEnv } from '@codex/shared-types';
import {
  cancelSubscriptionSchema,
  changeTierSchema,
  createSubscriptionCheckoutSchema,
  getCurrentSubscriptionQuerySchema,
  getSubscriptionStatsQuerySchema,
  listSubscribersQuerySchema,
  reactivateSubscriptionSchema,
} from '@codex/validation';
import { PaginatedResult, procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

/**
 * Bump subscription version key for cross-device staleness detection.
 * Fire-and-forget via waitUntil — never blocks the mutation response.
 */
function invalidateSubscriptionVersion(
  ctx: {
    env: { CACHE_KV?: import('@cloudflare/workers-types').KVNamespace };
    executionCtx: { waitUntil(p: Promise<unknown>): void };
    user: { id: string };
  },
  organizationId: string
): void {
  if (!ctx.env.CACHE_KV) return;
  const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
  ctx.executionCtx.waitUntil(
    cache
      .invalidate(
        CacheType.COLLECTION_USER_SUBSCRIPTION(ctx.user.id, organizationId)
      )
      .catch(() => {})
  );
}

const subscriptions = new Hono<HonoEnv>();

/**
 * POST /subscriptions/checkout
 * Create a Stripe Checkout session in subscription mode.
 */
subscriptions.post(
  '/checkout',
  procedure({
    policy: { auth: 'required', rateLimit: 'strict' },
    input: { body: createSubscriptionCheckoutSchema },
    successStatus: 201,
    handler: async (ctx) => {
      return await ctx.services.subscription.createCheckoutSession(
        ctx.user.id,
        ctx.input.body.organizationId,
        ctx.input.body.tierId,
        ctx.input.body.billingInterval,
        ctx.input.body.successUrl,
        ctx.input.body.cancelUrl
      );
    },
  })
);

/**
 * GET /subscriptions/current
 * Get the user's current subscription for an org.
 */
subscriptions.get(
  '/current',
  procedure({
    policy: { auth: 'required' },
    input: { query: getCurrentSubscriptionQuerySchema },
    handler: async (ctx) => {
      return await ctx.services.subscription.getSubscription(
        ctx.user.id,
        ctx.input.query.organizationId
      );
    },
  })
);

/**
 * GET /subscriptions/mine
 * Get all active subscriptions for the authenticated user.
 */
subscriptions.get(
  '/mine',
  procedure({
    policy: { auth: 'required' },
    handler: async (ctx) => {
      return await ctx.services.subscription.getUserSubscriptions(ctx.user.id);
    },
  })
);

/**
 * POST /subscriptions/change-tier
 * Upgrade or downgrade the user's subscription tier.
 */
subscriptions.post(
  '/change-tier',
  procedure({
    policy: { auth: 'required', rateLimit: 'strict' },
    input: { body: changeTierSchema },
    handler: async (ctx) => {
      await ctx.services.subscription.changeTier(
        ctx.user.id,
        ctx.input.body.organizationId,
        ctx.input.body.newTierId,
        ctx.input.body.billingInterval
      );
      invalidateSubscriptionVersion(ctx, ctx.input.body.organizationId);
      return await ctx.services.subscription.getSubscription(
        ctx.user.id,
        ctx.input.body.organizationId
      );
    },
  })
);

/**
 * POST /subscriptions/cancel
 * Cancel subscription at period end.
 */
subscriptions.post(
  '/cancel',
  procedure({
    policy: { auth: 'required' },
    input: { body: cancelSubscriptionSchema },
    handler: async (ctx) => {
      await ctx.services.subscription.cancelSubscription(
        ctx.user.id,
        ctx.input.body.organizationId,
        ctx.input.body.reason
      );
      invalidateSubscriptionVersion(ctx, ctx.input.body.organizationId);
      return await ctx.services.subscription.getSubscription(
        ctx.user.id,
        ctx.input.body.organizationId
      );
    },
  })
);

/**
 * POST /subscriptions/reactivate
 * Reactivate a subscription that is set to cancel at period end.
 */
subscriptions.post(
  '/reactivate',
  procedure({
    policy: { auth: 'required' },
    input: { body: reactivateSubscriptionSchema },
    handler: async (ctx) => {
      await ctx.services.subscription.reactivateSubscription(
        ctx.user.id,
        ctx.input.body.organizationId
      );
      invalidateSubscriptionVersion(ctx, ctx.input.body.organizationId);
      return await ctx.services.subscription.getSubscription(
        ctx.user.id,
        ctx.input.body.organizationId
      );
    },
  })
);

/**
 * GET /subscriptions/stats
 * Subscription stats for an org (admin).
 */
subscriptions.get(
  '/stats',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { query: getSubscriptionStatsQuerySchema },
    handler: async (ctx) => {
      return await ctx.services.subscription.getSubscriptionStats(
        ctx.organizationId as string
      );
    },
  })
);

/**
 * GET /subscriptions/subscribers
 * List subscribers for an org (admin). Paginated.
 */
subscriptions.get(
  '/subscribers',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { query: listSubscribersQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.subscription.listSubscribers(
        ctx.organizationId as string,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

export default subscriptions;

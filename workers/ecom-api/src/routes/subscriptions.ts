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

import { createDbClient } from '@codex/database';
import { createStripeClient } from '@codex/purchase';
import type { HonoEnv } from '@codex/shared-types';
import { SubscriptionService } from '@codex/subscription';
import {
  cancelSubscriptionSchema,
  changeTierSchema,
  createSubscriptionCheckoutSchema,
  getCurrentSubscriptionQuerySchema,
  getSubscriptionStatsQuerySchema,
  listSubscribersQuerySchema,
} from '@codex/validation';
import { PaginatedResult, procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

function getSubscriptionService(env: HonoEnv['Bindings']): SubscriptionService {
  const db = createDbClient(env);
  const stripe = createStripeClient(env.STRIPE_SECRET_KEY as string);
  return new SubscriptionService(
    { db, environment: env.ENVIRONMENT ?? 'development' },
    stripe
  );
}

/**
 * POST /subscriptions/checkout
 * Create a Stripe Checkout session in subscription mode.
 */
app.post(
  '/checkout',
  procedure({
    policy: { auth: 'required', rateLimit: 'auth' },
    input: { body: createSubscriptionCheckoutSchema },
    successStatus: 201,
    handler: async (ctx) => {
      const service = getSubscriptionService(ctx.env);
      return await service.createCheckoutSession(
        ctx.user.id,
        ctx.organizationId as string,
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
app.get(
  '/current',
  procedure({
    policy: { auth: 'required' },
    input: { query: getCurrentSubscriptionQuerySchema },
    handler: async (ctx) => {
      const service = getSubscriptionService(ctx.env);
      return await service.getSubscription(
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
app.get(
  '/mine',
  procedure({
    policy: { auth: 'required' },
    handler: async (ctx) => {
      const service = getSubscriptionService(ctx.env);
      const subs = await service.getUserSubscriptions(ctx.user.id);
      return subs;
    },
  })
);

/**
 * POST /subscriptions/change-tier
 * Upgrade or downgrade the user's subscription tier.
 */
app.post(
  '/change-tier',
  procedure({
    policy: { auth: 'required', rateLimit: 'auth' },
    input: { body: changeTierSchema },
    handler: async (ctx) => {
      const service = getSubscriptionService(ctx.env);
      await service.changeTier(
        ctx.user.id,
        ctx.input.body.organizationId,
        ctx.input.body.newTierId,
        ctx.input.body.billingInterval
      );
      return await service.getSubscription(
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
app.post(
  '/cancel',
  procedure({
    policy: { auth: 'required' },
    input: { body: cancelSubscriptionSchema },
    handler: async (ctx) => {
      const service = getSubscriptionService(ctx.env);
      await service.cancelSubscription(
        ctx.user.id,
        ctx.input.body.organizationId,
        ctx.input.body.reason
      );
      return await service.getSubscription(
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
app.get(
  '/stats',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { query: getSubscriptionStatsQuerySchema },
    handler: async (ctx) => {
      const service = getSubscriptionService(ctx.env);
      return await service.getSubscriptionStats(ctx.input.query.organizationId);
    },
  })
);

/**
 * GET /subscriptions/subscribers
 * List subscribers for an org (admin). Paginated.
 */
app.get(
  '/subscribers',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { query: listSubscribersQuerySchema },
    handler: async (ctx) => {
      const service = getSubscriptionService(ctx.env);
      const result = await service.listSubscribers(
        ctx.organizationId as string,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

export default app;

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

import { AccessRevocation } from '@codex/access';
import type { ObservabilityClient } from '@codex/observability';
import type { HonoEnv } from '@codex/shared-types';
import {
  cancelSubscriptionSchema,
  changeTierSchema,
  createSubscriptionCheckoutSchema,
  getCurrentSubscriptionQuerySchema,
  getSubscriptionStatsQuerySchema,
  listSubscribersQuerySchema,
  reactivateSubscriptionSchema,
  resumeSubscriptionSchema,
  verifyCheckoutSessionSchema,
} from '@codex/validation';
import { PaginatedResult, procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

/**
 * Cache invalidation for subscription mutations is owned by
 * `SubscriptionService` itself (see `packages/subscription/src/services/
 * subscription-service.ts` — `invalidateIfConfigured`). The service
 * registry injects a `VersionedCache` + `waitUntil` into the service
 * constructor when `CACHE_KV` is bound, and every public mutation
 * (`cancelSubscription`, `changeTier`, `reactivateSubscription`,
 * `resumeSubscription`, and the webhook `handle*` methods) calls the
 * orchestrator hook at the end of the method on success. Routes are therefore thin pass-throughs and
 * must NOT invalidate on their own — doing so would double-bump the
 * version keys and masks orchestration regressions from tests.
 *
 * The revocation-clear path below is a separate concern and stays here.
 */

/**
 * Fire-and-forget CLEAR of the per-user, per-org KV revocation key after an
 * access-RESTORING subscription mutation (`/reactivate` and `/resume`).
 *
 * Mirrors the `clearAccess` helper in `subscription-webhook.ts` so the
 * client-driven reactivate endpoint and the Stripe-driven
 * `customer.subscription.updated` webhook clear the same key via the same
 * wrapper semantics. KV delete is idempotent — a reactivate before the
 * revocation key was ever written is a free no-op.
 *
 * No-op when `CACHE_KV` binding is absent (dev stub / misconfigured env).
 * Errors are swallowed inside the `waitUntil` promise so a KV hiccup never
 * surfaces as a mutation failure — the DB write has already committed.
 *
 * See bead Codex-13ml3 (clear counterpart to Codex-usgf7 writes).
 */
function clearAccessRevocation(
  ctx: {
    env: { CACHE_KV?: import('@cloudflare/workers-types').KVNamespace };
    executionCtx: { waitUntil(p: Promise<unknown>): void };
    user: { id: string };
    obs?: ObservabilityClient;
  },
  organizationId: string
): void {
  if (!ctx.env.CACHE_KV) return;
  const revocation = new AccessRevocation(ctx.env.CACHE_KV, ctx.obs);
  const userId = ctx.user.id;
  try {
    ctx.executionCtx.waitUntil(
      revocation.clear(userId, organizationId).catch((error) => {
        ctx.obs?.warn('subscriptions-route: AccessRevocation.clear failed', {
          userId,
          orgId: organizationId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
    );
  } catch (error) {
    ctx.obs?.warn(
      'subscriptions-route: waitUntil threw synchronously (clear)',
      {
        userId,
        orgId: organizationId,
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }
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
 * GET /subscriptions/verify
 * Verify a Stripe subscription-mode Checkout session after the user returns
 * from payment. Used by the /subscription/success page to poll until the
 * webhook has written the subscription row, mirroring the purchase path at
 * /checkout/verify.
 */
subscriptions.get(
  '/verify',
  procedure({
    policy: { auth: 'required' },
    input: { query: verifyCheckoutSessionSchema },
    handler: async (ctx) => {
      return await ctx.services.subscription.verifyCheckoutSession(
        ctx.input.query.session_id,
        ctx.user.id
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
      // `changeTier` owns its own cache invalidation via the orchestrator
      // hook in SubscriptionService — route no longer needs to invalidate.
      await ctx.services.subscription.changeTier(
        ctx.user.id,
        ctx.input.body.organizationId,
        ctx.input.body.newTierId,
        ctx.input.body.billingInterval
      );
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
      // `cancelSubscription` owns its own cache invalidation via the
      // orchestrator hook in SubscriptionService.
      await ctx.services.subscription.cancelSubscription(
        ctx.user.id,
        ctx.input.body.organizationId,
        ctx.input.body.reason
      );
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
      // `reactivateSubscription` owns its own cache invalidation via the
      // orchestrator hook in SubscriptionService.
      await ctx.services.subscription.reactivateSubscription(
        ctx.user.id,
        ctx.input.body.organizationId
      );
      // Explicit reactivation restores access — clear any lingering
      // revocation key so `ContentAccessService.getStreamingUrl()` stops
      // rejecting this user's presigned URLs within the KV TTL window.
      // Idempotent: no-op if no key was ever written. This is a separate
      // concern from cache invalidation and stays in the route.
      // See bead Codex-13ml3.
      clearAccessRevocation(ctx, ctx.input.body.organizationId);
      return await ctx.services.subscription.getSubscription(
        ctx.user.id,
        ctx.input.body.organizationId
      );
    },
  })
);

/**
 * POST /subscriptions/resume
 *
 * User-initiated resume of a PAUSED subscription. Mirrors `/reactivate`:
 * - Service method owns cache invalidation (orchestrator hook in
 *   SubscriptionService.resumeSubscription fires with reason
 *   `'subscription_resumed'`).
 * - Route clears the per-user, per-org KV revocation key fire-and-forget
 *   because resume is access-RESTORING (same contract as reactivate —
 *   see bead Codex-13ml3 for the clear counterpart).
 * - Route layer must NOT call `invalidateForUser` — the service owns it.
 *
 * Distinct from the `customer.subscription.resumed` webhook path:
 * webhooks hit `SubscriptionService.handleSubscriptionResumed`; this
 * route is the client-driven flow (see bead Codex-7h4vo).
 */
subscriptions.post(
  '/resume',
  procedure({
    policy: { auth: 'required' },
    input: { body: resumeSubscriptionSchema },
    handler: async (ctx) => {
      // `resumeSubscription` owns its own cache invalidation via the
      // orchestrator hook in SubscriptionService.
      await ctx.services.subscription.resumeSubscription(
        ctx.user.id,
        ctx.input.body.organizationId
      );
      // Explicit resume restores access — clear any lingering revocation
      // key so `ContentAccessService.getStreamingUrl()` stops rejecting
      // this user's presigned URLs within the KV TTL window. Idempotent:
      // no-op if no key was ever written. Separate concern from cache
      // invalidation and stays in the route. Parallel to /reactivate.
      clearAccessRevocation(ctx, ctx.input.body.organizationId);
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

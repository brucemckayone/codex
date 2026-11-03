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
 * - POST /subscriptions/keep-current-plan - Undo a waiting move to a cheaper plan
 * - POST /subscriptions/cancel       - Cancel at period end
 * - GET  /subscriptions/courses/mine - The user's course subscriptions
 * - POST /subscriptions/courses/:courseSubscriptionId/cancel|reactivate
 * - GET  /subscriptions/stats        - Subscriber stats (admin)
 */

import { AccessRevocation } from '@codex/access';
import type { WaitUntilFn } from '@codex/cache';
import type { ObservabilityClient } from '@codex/observability';
import type { HonoEnv } from '@codex/shared-types';
import {
  cancelSubscriptionSchema,
  changeTierSchema,
  courseSubscriptionParamsSchema,
  createSubscriptionCheckoutSchema,
  getCurrentSubscriptionQuerySchema,
  getMyEarningsSummaryQuerySchema,
  getPayoutSummaryQuerySchema,
  getPayoutsByCreatorBreakdownQuerySchema,
  getSubscriptionStatsQuerySchema,
  keepCurrentPlanSchema,
  listMyCourseSubscriptionsQuerySchema,
  listMyPayoutsQuerySchema,
  listPayoutsQuerySchema,
  listSubscribersQuerySchema,
  reactivateSubscriptionSchema,
  resumeSubscriptionSchema,
  verifyCheckoutSessionSchema,
} from '@codex/validation';
import { PaginatedResult, procedure } from '@codex/worker-utils';
import { Hono } from 'hono';
import { refuseDevReturnUrls } from '../utils/return-urls';

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
 * surfaces as a mutation failure — the DB write has already committed. They
 * are logged at error, not warn: the key keeps refusing a subscriber whose
 * access was restored, for up to its TTL (Codex-2hxff.60).
 *
 * See bead Codex-13ml3 (clear counterpart to Codex-usgf7 writes).
 */
function clearAccessRevocation(
  ctx: {
    env: { CACHE_KV?: import('@cloudflare/workers-types').KVNamespace };
    executionCtx: { waitUntil: WaitUntilFn };
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
        ctx.obs?.error('subscriptions-route: AccessRevocation.clear failed', {
          userId,
          orgId: organizationId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
    );
  } catch (error) {
    ctx.obs?.error(
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
 * Create a Stripe Checkout session in subscription mode. In production, a
 * return link on a development host or over plain http is refused
 * (Codex-2hxff.79).
 */
subscriptions.post(
  '/checkout',
  procedure({
    policy: { auth: 'required', rateLimit: 'strict' },
    input: { body: createSubscriptionCheckoutSchema },
    successStatus: 201,
    handler: async (ctx) => {
      const { successUrl, cancelUrl } = ctx.input.body;
      refuseDevReturnUrls(
        ctx.env.ENVIRONMENT,
        { successUrl, cancelUrl },
        ctx.obs
      );
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
 * POST /subscriptions/preview-tier-change
 * Preview the proration that a tier change would produce, without mutating
 * the subscription. Powers the proration confirmation dialog.
 *
 * The returned `prorationDate` MUST be passed back to /change-tier so the
 * commit-time proration matches the preview to the penny. A switch into
 * yearly billing also returns a `quote`, passed back as well: change-tier re-checks it
 * before the write (Codex-2hxff.96).
 */
subscriptions.post(
  '/preview-tier-change',
  procedure({
    policy: { auth: 'required', rateLimit: 'strict' },
    input: { body: changeTierSchema },
    handler: async (ctx) => {
      return await ctx.services.subscription.previewTierChange(
        ctx.user.id,
        ctx.input.body.organizationId,
        ctx.input.body.newTierId,
        ctx.input.body.billingInterval
      );
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
        ctx.input.body.billingInterval,
        ctx.input.body.prorationDate,
        ctx.input.body.quote,
        ctx.input.body.newRecurringAmountCents
      );
      return await ctx.services.subscription.getSubscription(
        ctx.user.id,
        ctx.input.body.organizationId
      );
    },
  })
);

/**
 * POST /subscriptions/keep-current-plan
 * Undo a move to a cheaper plan before it lands at the renewal
 * (Codex-2hxff.16, data design §4): the held Price goes back on the
 * subscription and nothing is charged. Nothing waiting: unchanged. After the
 * renewal it lands on: 409 `MOVE_ALREADY_LANDED`.
 */
subscriptions.post(
  '/keep-current-plan',
  procedure({
    policy: { auth: 'required', rateLimit: 'strict' },
    input: { body: keepCurrentPlanSchema },
    handler: async (ctx) => {
      // `keepCurrentPlan` owns its own cache invalidation.
      await ctx.services.subscription.keepCurrentPlan(
        ctx.user.id,
        ctx.input.body.organizationId
      );
      return await ctx.services.subscription.getSubscription(
        ctx.user.id,
        ctx.input.body.organizationId
      );
    },
  })
);

/**
 * GET /subscriptions/courses/mine
 * The user's own course subscriptions for Account › Subscriptions
 * (Codex-2hxff.52, C1): live, not ended, not a duplicate, newest first.
 */
subscriptions.get(
  '/courses/mine',
  procedure({
    policy: { auth: 'required' },
    input: { query: listMyCourseSubscriptionsQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.courseSubscription.listForUser(
        ctx.user.id,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * POST /subscriptions/courses/:courseSubscriptionId/cancel
 * Cancel one of the user's course subscriptions at period end. Another
 * user's id is a 404.
 */
subscriptions.post(
  '/courses/:courseSubscriptionId/cancel',
  procedure({
    // Each toggle is a fresh Stripe write: the strict preset, as change-tier.
    policy: { auth: 'required', rateLimit: 'strict' },
    input: { params: courseSubscriptionParamsSchema },
    handler: async (ctx) => {
      return await ctx.services.courseSubscription.cancelForUser(
        ctx.user.id,
        ctx.input.params.courseSubscriptionId
      );
    },
  })
);

/**
 * POST /subscriptions/courses/:courseSubscriptionId/reactivate
 * Undo a course subscription's cancel before the period ends. 409
 * `COURSE_NOT_ON_SALE` when the course is no longer offered; a plan only
 * switched off can be reactivated (owner Q6).
 */
subscriptions.post(
  '/courses/:courseSubscriptionId/reactivate',
  procedure({
    // Each toggle is a fresh Stripe write: the strict preset, as change-tier.
    policy: { auth: 'required', rateLimit: 'strict' },
    input: { params: courseSubscriptionParamsSchema },
    handler: async (ctx) => {
      return await ctx.services.courseSubscription.reactivateForUser(
        ctx.user.id,
        ctx.input.params.courseSubscriptionId
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
    // Strict: a waiting change of billing makes this a schedule release and
    // a write at Stripe (Codex-2hxff.97), as the course pair's (9b39d7c4).
    policy: { auth: 'required', rateLimit: 'strict' },
    input: { body: cancelSubscriptionSchema },
    handler: async (ctx) => {
      // `cancelSubscription` owns its own cache invalidation via the
      // orchestrator hook in SubscriptionService.
      await ctx.services.subscription.cancelSubscription(
        ctx.user.id,
        ctx.input.body.organizationId,
        ctx.input.body.reason,
        ctx.input.body.churnReason
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
    // Strict: each one can set a fresh Stripe schedule (Codex-2hxff.97).
    policy: { auth: 'required', rateLimit: 'strict' },
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
        ctx.organizationId
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
        ctx.organizationId,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /subscriptions/payouts
 *
 * Codex-zqaxo: list pending + resolved creator payouts for the org owner's
 * studio payouts table. Owner/admin only via `requireOrgManagement` —
 * mirror of `/stats` and `/subscribers`.
 *
 * SECURITY INVARIANT: the service queries `payouts` filtered by
 * `organizationId = ctx.organizationId`. `ctx.organizationId` is set by
 * `requireOrgManagement` from the user's membership row, so this route
 * cannot leak another org's payouts even if the client forges
 * `query.organizationId`. The Zod schema requires `organizationId` for
 * the URL contract, but the service ignores it in favour of the
 * authenticated `ctx.organizationId`.
 */
subscriptions.get(
  '/payouts',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { query: listPayoutsQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.subscription.listPayoutsByOrg(
        ctx.organizationId,
        {
          page: ctx.input.query.page,
          limit: ctx.input.query.limit,
          status: ctx.input.query.status,
          sourceType: ctx.input.query.source,
          fromDate: ctx.input.query.fromDate,
          toDate: ctx.input.query.toDate,
          transferredFrom: ctx.input.query.transferredFrom,
        }
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /subscriptions/payouts/summary
 *
 * Codex-05vp8: aggregate KPI numbers for the studio payouts page header
 * (earned in period, total earned, in transit, needs-attention count).
 * Owner/admin only via `requireOrgManagement` — same scoping invariant as
 * `/payouts`. `organizationId` is taken from `ctx.organizationId` (set by
 * `requireOrgManagement` from the user's membership row), never from the
 * client.
 */
subscriptions.get(
  '/payouts/summary',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { query: getPayoutSummaryQuerySchema },
    handler: async (ctx) => {
      return ctx.services.subscription.getPayoutSummary(ctx.organizationId, {
        fromDate: ctx.input.query.fromDate,
        toDate: ctx.input.query.toDate,
      });
    },
  })
);

/**
 * GET /subscriptions/payouts/by-creator
 *
 * Codex-6nt4l: per-creator aggregate for the studio payouts right rail.
 * Owner/admin only via `requireOrgManagement` — same scoping invariant as
 * `/payouts` and `/payouts/summary`. The service shares its WHERE-clause
 * helper with `listPayoutsByOrg` so the table and the rail respond to the
 * same filter chips (status / source / date) symmetrically.
 *
 * Returns `{ data: CreatorPayoutBreakdown[] }` via the procedure envelope —
 * a single-item return, not a paginated list, because the rail intentionally
 * surfaces every creator under the current filter rather than paginating.
 */
subscriptions.get(
  '/payouts/by-creator',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: { query: getPayoutsByCreatorBreakdownQuerySchema },
    handler: async (ctx) => {
      return ctx.services.subscription.getPayoutsByCreatorBreakdown(
        ctx.organizationId,
        {
          status: ctx.input.query.status,
          sourceType: ctx.input.query.source,
          fromDate: ctx.input.query.fromDate,
          toDate: ctx.input.query.toDate,
        }
      );
    },
  })
);

/**
 * GET /subscriptions/me/payouts
 *
 * Codex-69t7c.7 (WP7): the acting creator's OWN payouts across every org that
 * paid them. Creator-self-scoped — `policy:{auth:'required'}` only (NO
 * `requireOrgManagement`); the service filters by `ctx.user.id` + personal
 * payout types, so the route cannot read another creator's payouts and accepts
 * NO client-supplied userId/organizationId (IDOR prevention, epic decision D8).
 */
subscriptions.get(
  '/me/payouts',
  procedure({
    policy: { auth: 'required' },
    input: { query: listMyPayoutsQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.subscription.listPayoutsForCreator(
        ctx.user.id,
        {
          page: ctx.input.query.page,
          limit: ctx.input.query.limit,
          status: ctx.input.query.status,
          sourceType: ctx.input.query.source,
          fromDate: ctx.input.query.fromDate,
          toDate: ctx.input.query.toDate,
        }
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /subscriptions/me/earnings-summary
 *
 * Codex-69t7c.7 (WP7): KPI numbers for the creator earnings hub (earned in
 * period, total earned, in transit, needs-attention), userId-scoped across ALL
 * orgs. Same self-scoping invariant as /me/payouts — never client-supplied id.
 */
subscriptions.get(
  '/me/earnings-summary',
  procedure({
    policy: { auth: 'required' },
    input: { query: getMyEarningsSummaryQuerySchema },
    handler: async (ctx) => {
      return ctx.services.subscription.getEarningsSummaryForCreator(
        ctx.user.id,
        {
          fromDate: ctx.input.query.fromDate,
          toDate: ctx.input.query.toDate,
        }
      );
    },
  })
);

export default subscriptions;

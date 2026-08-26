/**
 * Studio course-monetisation routes (Codex-2pryk.2.4.1 · WP-6 · SPEC §7).
 *
 * The WRITE side of the three "one course, three ways in" paths. Before this
 * router, `CourseSubscriptionService.createPlan` and
 * `CourseAccessService.setTierAccess` were fully implemented and unreachable —
 * no worker exposed either. `getCourseOffer` composes its paths by reading
 * `course_subscription_plans` and `course_tier_access ⋈ subscription_tiers`, so
 * with nothing able to write those two tables it could only ever return
 * `paths: ['purchase']`. That is why a creator who configured a membership tier,
 * a course subscription AND a one-off saw only the one-off at checkout.
 *
 *   PUT    /studio/courses/:courseId/subscription-plan  → create or re-price
 *   DELETE /studio/courses/:courseId/subscription-plan  → withdraw from sale
 *   PUT    /studio/courses/:courseId/tier-access        → set the exact tier set
 *
 * The third path (one-off `courses.price_cents`) already has its write path at
 * content-api's `PATCH /studio/journeys/:pageId/offer` and is not duplicated here.
 *
 * WHY ecom-api and not content-api, where the sibling journey-studio routes live:
 * `createPlan` talks to Stripe, and production content-api is never given
 * `STRIPE_SECRET_KEY` (see the content-api block in
 * `.github/scripts/upload-worker-secrets.sh` — content-api's uploaded secret set
 * has no Stripe key). content-api's `.dev.vars` DOES carry the key, so a
 * content-api route would pass every local test and every CI run, then fail in
 * production alone. ecom-api owns Stripe and the commerce webhooks, so plan
 * management belongs here.
 *
 * Codex-1g5lh.1 is that exact failure, realised on a DIFFERENT worker:
 * organization-api owns subscription-tier creation (tiers are org-scoped) and
 * had shipped without the key, so `createTier` returned a bare 500 in
 * production only. organization-api is now provisioned with `STRIPE_SECRET_KEY`
 * too, so ecom-api is no longer the sole Stripe-holding worker — but the rule
 * this comment states still holds: a Stripe-calling route belongs in a worker
 * whose UPLOADED secret set includes the key, and `.dev.vars` is not evidence
 * of that.
 *
 * WHY a separate router from `routes/courses.ts`: that one is the PUBLIC offer
 * read mounted at `/courses` with `auth: 'optional'`. Mounting these mutations at
 * a distinct `/studio/courses` prefix keeps the public and org-guarded surfaces
 * from sharing a path space, so no future public route can be added under a
 * prefix a reader assumes is guarded.
 *
 * AUTH: every route is `requireOrgManagement` (owner/admin) and resolves the org
 * from `?organizationId=`. That proves the caller manages THAT org — it says
 * nothing about the `:courseId` path segment, which is attacker-controlled, so
 * each service method re-resolves the course by `(id, organizationId)`. Without
 * that, an org-A admin could re-price or clear tier access on org B's course.
 *
 * `rateLimit: 'strict'` throughout: these are commerce mutations that create
 * Stripe objects, matching the `/studio/journeys/:pageId/offer` precedent.
 */

import type { HonoEnv } from '@codex/shared-types';
import {
  courseMonetisationOrgQuerySchema,
  courseOfferParamsSchema,
  setCourseTierAccessSchema,
  upsertCourseSubscriptionPlanSchema,
} from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

const courseMonetisation = new Hono<HonoEnv>();

/**
 * PUT /studio/courses/:courseId/subscription-plan?organizationId=
 * Body: `{ priceMonthly, priceAnnual }` (GBP pence)
 *
 * Idempotent by design — a save button must survive being pressed twice. First
 * call creates the Stripe Product + monthly/annual Prices and the
 * `course_subscription_plans` row; later calls re-price the existing plan (new
 * immutable Prices, old ones archived). Re-saving unchanged prices is a no-op.
 *
 * 422 `CONNECT_ACCOUNT_NOT_READY` when the org has no fully-onboarded Connect
 * account — a course subscription pays out to the org, so it cannot be sold
 * before payouts work. The panel should render that as "connect a payout account
 * before selling a subscription", never as a generic failure.
 *
 * The return type is inferred from the service rather than annotated with the
 * Drizzle row type: no ecom-api route imports `@codex/database/schema`, and this
 * one should not be the first to reach past the service layer into it.
 *
 * @returns the live `course_subscription_plans` row
 */
courseMonetisation.put(
  '/:courseId/subscription-plan',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'strict',
    },
    input: {
      params: courseOfferParamsSchema,
      query: courseMonetisationOrgQuerySchema,
      body: upsertCourseSubscriptionPlanSchema,
    },
    handler: async (ctx) => {
      return ctx.services.courseSubscription.upsertPlan(
        ctx.organizationId,
        ctx.input.params.courseId,
        ctx.input.body
      );
    },
  })
);

/**
 * DELETE /studio/courses/:courseId/subscription-plan?organizationId=
 *
 * Withdraw the subscription as a way in: `getCourseOffer` stops offering it and
 * new checkouts are refused. EXISTING subscribers keep their subscription, keep
 * renewing and keep their entitlement — the plan row is retained (their
 * `course_subscriptions.planId` FK points at it), only `isActive` flips. Turning
 * off sales and cancelling current subscribers are deliberately separate acts.
 *
 * Idempotent: no live plan is a 204, not a 404, so the panel's toggle is safe to
 * press twice.
 */
courseMonetisation.delete(
  '/:courseId/subscription-plan',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'strict',
    },
    input: {
      params: courseOfferParamsSchema,
      query: courseMonetisationOrgQuerySchema,
    },
    handler: async (ctx): Promise<null> => {
      await ctx.services.courseSubscription.deactivatePlan(
        ctx.organizationId,
        ctx.input.params.courseId
      );
      return null;
    },
  })
);

/**
 * PUT /studio/courses/:courseId/tier-access?organizationId=
 * Body: `{ tierIds: string[] }`
 *
 * A TOTAL write of the exact tier set (SPEC §7 "not just min-tier"): tiers absent
 * from `tierIds` lose access, and `[]` clears tier access entirely. Total rather
 * than incremental so the panel's checkbox group has one unambiguous meaning and
 * two concurrent saves cannot interleave into a set neither creator chose.
 *
 * 403 when any tier belongs to another org (the N1 guard), 404 when the course is
 * not in `organizationId`.
 */
courseMonetisation.put(
  '/:courseId/tier-access',
  procedure({
    policy: {
      auth: 'required',
      requireOrgManagement: true,
      rateLimit: 'strict',
    },
    input: {
      params: courseOfferParamsSchema,
      query: courseMonetisationOrgQuerySchema,
      body: setCourseTierAccessSchema,
    },
    handler: async (ctx): Promise<null> => {
      await ctx.services.courseAccess.setTierAccess(
        ctx.organizationId,
        ctx.input.params.courseId,
        ctx.input.body.tierIds
      );
      return null;
    },
  })
);

export default courseMonetisation;

/**
 * Admin diagnostic endpoints.
 *
 * Limited to platform_owner role. These compose existing service methods
 * rather than introducing new mutation paths — every reconciliation write
 * pipes through the same webhook handlers (`handleSubscriptionUpdated`,
 * `handleSubscriptionDeleted`) that production traffic exercises.
 *
 * Endpoints:
 * - GET /admin/subscriptions/reconcile?dryRun=true|false  Diff Stripe vs DB
 */

import type { HonoEnv } from '@codex/shared-types';
import { z } from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';

const admin = new Hono<HonoEnv>();

/**
 * Exported for unit testing — the dryRun coercion is the only piece of
 * route logic with a fan-out of behaviours (default, true→true, false→false,
 * invalid→reject). The handler itself is a thin pass-through to the service.
 */
export const reconcileQuerySchema = z.object({
  dryRun: z
    .union([z.literal('true'), z.literal('false')])
    .default('true')
    .transform((v: 'true' | 'false') => v === 'true'),
});

/**
 * GET /admin/subscriptions/reconcile
 *
 * Diff every Stripe subscription against the local `subscriptions` table.
 *
 * Categories returned (see SubscriptionReconcileResult):
 * - orphansInStripe   : Stripe has it, we don't (dashboard-created OR missed create webhook)
 * - missedDeletions   : Stripe says canceled, we still think it's live
 * - missedUpdates     : cancel_at_period_end / past_due drifted
 * - ghosts            : we think it's live, Stripe has no record
 *
 * dryRun=true  (default) : report-only, no DB writes
 * dryRun=false           : pipe missedDeletions/missedUpdates through the
 *                          existing webhook handlers to recover state.
 *                          Orphans and ghosts are reported but NOT
 *                          auto-fixed — operator handles them manually.
 */
admin.get(
  '/subscriptions/reconcile',
  procedure({
    policy: { auth: 'platform_owner' },
    input: { query: reconcileQuerySchema },
    handler: async (ctx) => {
      return await ctx.services.subscription.reconcileFromStripe({
        dryRun: ctx.input.query.dryRun,
      });
    },
  })
);

export default admin;

/**
 * Pending Payouts Sweep Handler (Codex-vv77x)
 *
 * Drains pending payouts rows whose Connect account has since become
 * charges_enabled && payouts_enabled but whose account.updated webhook
 * never fired (webhook drop, capability-ricochet event without the
 * relevant previous_attributes, etc).
 *
 * Hybrid event+sweep resolution per Stripe docs (verified 2026-05-13):
 *   - account.updated webhook is primary (./connect-webhook.ts)
 *   - This sweep is the safety net: webhooks retry for 3 days then drop
 *
 * Consolidated into ecom-api 2026-05-13 so the Stripe cron colocates with
 * Stripe webhooks in a single Worker (no separate payouts-sweep deploy).
 *
 * Error handling: NEVER throws. The function is invoked from
 * `scheduled()` inside a `waitUntil` chain — if we throw, the cron
 * invocation can crash mid-cycle and skip its observability logging.
 * All errors are logged via ObservabilityClient and counted in the
 * per-group `errors` field returned by the service method.
 */

import type { Database } from '@codex/database';
import { ObservabilityClient } from '@codex/observability';
import { createStripeClient } from '@codex/purchase';
import type { Bindings } from '@codex/shared-types';
import { SubscriptionService } from '@codex/subscription';
import type Stripe from 'stripe';

/** Default age threshold — only sweep rows old enough that the
 *  account.updated webhook would already have fired by now if it was
 *  going to. The webhook owns fresh rows; the sweep owns dropped events. */
const DEFAULT_OLDER_THAN_MINUTES = 15;

export interface RunSweepDeps {
  /** Pre-constructed DB client (per-request HTTP client) */
  db: Database;
  /** Pre-constructed Stripe client */
  stripe: Stripe;
  /** Observability client (PII-redacted) */
  obs: ObservabilityClient;
  /** Environment label for service config */
  environment: string;
  /** Optional override for the age threshold (mainly for tests) */
  olderThanMinutes?: number;
}

/**
 * Run the sweep. Returns the aggregate counters from
 * SubscriptionService.sweepUnresolvedPayouts; logs and swallows the
 * top-level error path (so the cron invocation cannot crash).
 */
export async function runPayoutsSweep(deps: RunSweepDeps): Promise<{
  groupsScanned: number;
  groupsResolved: number;
  groupsSkipped: number;
  errors: number;
} | null> {
  const {
    db,
    stripe,
    obs,
    environment,
    olderThanMinutes = DEFAULT_OLDER_THAN_MINUTES,
  } = deps;

  try {
    const service = new SubscriptionService({ db, environment }, stripe);
    const result = await service.sweepUnresolvedPayouts(olderThanMinutes);

    obs.info('payouts-sweep cron completed', {
      olderThanMinutes,
      ...result,
    });

    return result;
  } catch (error) {
    obs.error('payouts-sweep cron failed at top level', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Scheduled-handler entry point. Constructs Database + Stripe + Observability
 * from env, validates required env vars (logs and exits cleanly on missing
 * config), and delegates to `runPayoutsSweep`.
 *
 * Exposed as a function so the test suite can drive it without needing the
 * full `scheduled()` Cloudflare interface.
 */
export async function runScheduledPayoutsSweep(
  env: Bindings,
  deps?: Partial<RunSweepDeps>
): Promise<void> {
  const obs =
    deps?.obs ??
    new ObservabilityClient('ecom-api', env.ENVIRONMENT ?? 'development');

  // Guard against missing env vars — don't throw, log and exit.
  if (!env.DATABASE_URL || !env.STRIPE_SECRET_KEY) {
    obs.error('payouts-sweep: missing required env vars, skipping', {
      hasDatabaseUrl: Boolean(env.DATABASE_URL),
      hasStripeSecret: Boolean(env.STRIPE_SECRET_KEY),
    });
    return;
  }

  const { createDbClient } = await import('@codex/database');
  const db = deps?.db ?? createDbClient(env);
  const stripe = deps?.stripe ?? createStripeClient(env.STRIPE_SECRET_KEY);

  await runPayoutsSweep({
    db,
    stripe,
    obs,
    environment: env.ENVIRONMENT ?? 'development',
    olderThanMinutes: deps?.olderThanMinutes,
  });
}

/**
 * Top-level `scheduled()` dispatcher for the ecom-api Worker.
 *
 * Currently routes all cron invocations to the payouts sweep. If we later
 * add more crons we discriminate by `controller.cron` here.
 *
 * Wraps the sweep in `waitUntil` with `.catch()` so a slow sweep doesn't
 * get killed mid-flight and an unexpected rejection doesn't crash the
 * cron invocation silently.
 */
export function dispatchScheduled(
  _controller: ScheduledController,
  env: Bindings,
  ctx: ExecutionContext
): void {
  ctx.waitUntil(
    runScheduledPayoutsSweep(env).catch((error: unknown) => {
      // runScheduledPayoutsSweep already swallows its own errors and logs
      // via ObservabilityClient — this .catch is the belt-and-braces guard
      // against future refactors that drop the inner try/catch.
      // eslint-disable-next-line no-console
      console.error('ecom-api scheduled waitUntil rejected', error);
    })
  );
}

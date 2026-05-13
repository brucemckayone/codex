/**
 * Payouts Sweep Worker (Codex-vv77x)
 *
 * Cloudflare Worker with a single scheduled handler:
 *   - Every 15min (cron "*\/15 * * * *") it drains pendingPayouts rows whose
 *     Connect account is now charges_enabled && payouts_enabled.
 *
 * No fetch endpoints — pure cron worker. The scheduled handler is the
 * only entry point; tests drive `runScheduledSweep` directly.
 *
 * Architecture:
 *   - SubscriptionService.sweepUnresolvedPayouts owns the business logic
 *   - This worker constructs the DB + Stripe + obs clients from env and
 *     delegates. Per @codex platform rules, business logic lives in the
 *     service layer, not the worker.
 */

import type { Bindings } from '@codex/shared-types';

import { runScheduledSweep } from './handlers/sweep';

export default {
  /**
   * Optional fetch handler for healthcheck only. Returns 200 OK so
   * deployment smoke-tests can verify the worker is reachable. The cron
   * itself doesn't need fetch — Cloudflare invokes `scheduled()` directly.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response(
        JSON.stringify({
          service: 'payouts-sweep',
          ok: true,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      );
    }
    return new Response('Not Found', { status: 404 });
  },

  /**
   * Scheduled handler — invoked by Cloudflare on the cron schedule
   * defined in `wrangler.jsonc → triggers.crons`.
   *
   * Wraps `runScheduledSweep` in `waitUntil` with `.catch()` so a slow
   * sweep doesn't get killed mid-flight and an unexpected rejection
   * doesn't crash the cron invocation silently.
   */
  async scheduled(
    _controller: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      runScheduledSweep(env).catch((error: unknown) => {
        // runScheduledSweep already swallows its own errors and logs via
        // ObservabilityClient — this .catch is the belt-and-braces guard
        // against future refactors that drop the inner try/catch.
        // eslint-disable-next-line no-console
        console.error('payouts-sweep waitUntil rejected', error);
      })
    );
  },
};

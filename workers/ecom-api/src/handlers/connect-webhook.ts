/**
 * Connect Webhook Handlers
 *
 * Processes Stripe Connect account lifecycle events:
 * - account.updated → update local Connect account status
 *
 * Security:
 * - Signature already verified by verifyStripeSignature middleware
 */

import { STRIPE_EVENTS } from '@codex/constants';
import { createWebhookServices } from '@codex/worker-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import type { StripeWebhookEnv } from '../types';

export async function handleConnectWebhook(
  event: Stripe.Event,
  stripe: Stripe,
  c: Context<StripeWebhookEnv>
) {
  const obs = c.get('obs');

  // The registry's services, as routes get them (Codex-2hxff.54).
  const { services, background, release } = await createWebhookServices(
    c.env,
    c.executionCtx,
    { obs, stripe }
  );

  try {
    // The registry's ConnectAccountService carries the VersionedCache the
    // studio's `getStatus(orgId)` reads through, so the service's internal
    // `account.updated` invalidation lands where that read looks. Without
    // it the cache stayed warm with stale requirements for up to 10 min
    // after a Stripe push. Its `waitUntil` sink matters too (Codex-03uh3):
    // `getStatus` writes its data slot without awaiting it, and workerd
    // cancels an un-sunk put.
    const service = services.connect;

    switch (event.type) {
      case STRIPE_EVENTS.ACCOUNT_UPDATED: {
        const account = event.data.object as Stripe.Account;

        // Codex-qigid: detect the active-transition from `data.object`
        // (Stripe's CURRENT state) rather than from `previous_attributes`.
        // Context7-verified 2026-05-13: `account.updated` fires on ANY status
        // or property change and `previous_attributes` may NOT contain the
        // `charges_enabled` / `payouts_enabled` fields on capability-ricochet
        // events (e.g. `requirements.past_due` → `restricted` → re-enabled).
        //
        // `wasActive` is sourced from the CURRENT DB row BEFORE the update,
        // so the transition signal is the persisted state-change rather
        // than Stripe's diff. This also gives idempotency for free: a
        // duplicate `active → active` event finds `wasActive=true` and
        // skips the payout resolution. A ricochet (active → restricted →
        // active) correctly clears `wasActive` to false during the
        // restricted hop and fires payouts again on re-activation.
        const currentRecord = await service.getAccountByStripeId(account.id);
        const wasActive =
          (currentRecord?.chargesEnabled ?? false) &&
          (currentRecord?.payoutsEnabled ?? false);
        const isNowActive = account.charges_enabled && account.payouts_enabled;

        await service.handleAccountUpdated(account);
        obs?.info('Connect account updated', {
          accountId: account.id,
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
        });

        // BUG-014 + Codex-2hxff.13: when an account becomes payable, pay its
        // owner everything they are owed, in every organisation. The account
        // id alone names the payee: accounts are per user and carry only
        // `codex_user_id` metadata, so the old requirement for
        // `codex_organization_id` skipped every drain.
        if (isNowActive && !wasActive) {
          // After the response, on the shared pool: `release` holds the pool
          // open until the drain settles. The registry's SubscriptionService
          // carries the payout-released mailer.
          void background(
            services.subscription
              .resolvePendingPayoutsForAccount(account.id)
              .then((result) => {
                obs?.info('Pending payouts resolved on account activation', {
                  accountId: account.id,
                  ...result,
                });
              })
              .catch((err: unknown) => {
                obs?.error('Failed to resolve pending payouts', {
                  errorId: crypto.randomUUID(),
                  accountId: account.id,
                  error: err instanceof Error ? err.message : String(err),
                });
              })
          );
        }
        break;
      }

      case STRIPE_EVENTS.ACCOUNT_DEAUTHORIZED: {
        // account.application.deauthorized — the connected account
        // has disconnected from our platform. The event object is an
        // Application, but the account ID is in event.account.
        const accountId = event.account;
        if (!accountId) {
          obs?.warn('Connect deauthorized event missing account ID', {
            type: event.type,
          });
          break;
        }
        await service.handleAccountDeauthorized(accountId);
        obs?.info('Connect account deauthorized', {
          accountId,
        });
        break;
      }

      default:
        obs?.info('Unhandled connect webhook event', {
          type: event.type,
        });
    }
  } finally {
    // Errors propagate to createWebhookHandler for transient/permanent classification.
    // Transient errors (DB failures) → 500 (Stripe retries).
    // Permanent errors (business logic) → 200 (acknowledged).
    release();
  }
}

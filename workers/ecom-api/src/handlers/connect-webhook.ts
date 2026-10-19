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
import { uuidSchema, z } from '@codex/validation';
import { createWebhookServices } from '@codex/worker-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import type { StripeWebhookEnv } from '../types';

// Codex-ohjvn: malformed metadata is an operations error, not a silent
// skip. A missing or non-UUID `codex_organization_id` on an active
// transition leaves pending payouts stuck without any signal — WARN
// distinguishes "legit no-org Connect" from "schema/setup drift".
const connectMetadataSchema = z.object({
  codex_organization_id: uuidSchema,
});

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

        // BUG-014: When an account transitions to fully active, resolve any
        // accumulated pending payouts via fire-and-forget (waitUntil).
        if (isNowActive && !wasActive) {
          const parsed = connectMetadataSchema.safeParse(account.metadata);
          if (!parsed.success) {
            obs?.warn(
              'connect-webhook: invalid metadata on active transition; skipping payout resolution',
              {
                accountId: account.id,
                eventId: event.id,
                reason: parsed.error.issues[0]?.message ?? 'unknown',
              }
            );
          } else {
            const orgId = parsed.data.codex_organization_id;
            // After the response, on the shared pool: `release` holds the
            // pool open until the drain settles. The registry's
            // SubscriptionService carries the payout-released mailer
            // (Codex-2hxff.13).
            void background(
              services.subscription
                .resolvePendingPayouts(orgId, account.id)
                .then((result) => {
                  obs?.info('Pending payouts resolved on account activation', {
                    accountId: account.id,
                    organizationId: orgId,
                    ...result,
                  });
                })
                .catch((err) => {
                  obs?.error('Failed to resolve pending payouts', {
                    accountId: account.id,
                    organizationId: orgId,
                    error: (err as Error).message,
                  });
                })
            );
          }
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

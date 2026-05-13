/**
 * Connect Webhook Handlers
 *
 * Processes Stripe Connect account lifecycle events:
 * - account.updated → update local Connect account status
 *
 * Security:
 * - Signature already verified by verifyStripeSignature middleware
 */

import { VersionedCache } from '@codex/cache';
import { STRIPE_EVENTS } from '@codex/constants';
import {
  ConnectAccountService,
  SubscriptionService,
} from '@codex/subscription';
import { createWebhookDbClient } from '@codex/worker-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import type { StripeWebhookEnv } from '../types';

export async function handleConnectWebhook(
  event: Stripe.Event,
  stripe: Stripe,
  c: Context<StripeWebhookEnv>
) {
  const obs = c.get('obs');

  const { db, cleanup } = createWebhookDbClient(c.env);

  try {
    // Wire VersionedCache so the service's internal `account.updated`
    // invalidation runs against the same KV namespace the studio's
    // `getStatus(orgId)` reads from. Without this, the cache would stay
    // warm with stale requirements for up to 10 min after a Stripe push.
    // Idempotent on duplicate webhook delivery — `cache.invalidate` is
    // a single KV PUT of a fresh version timestamp.
    const cache = c.env.CACHE_KV
      ? new VersionedCache({ kv: c.env.CACHE_KV, prefix: 'cache' })
      : undefined;

    const service = new ConnectAccountService(
      {
        db,
        environment: c.env.ENVIRONMENT || 'development',
        cache,
      },
      stripe
    );

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
          const orgId = account.metadata?.codex_organization_id;
          if (orgId) {
            const { db: subDb, cleanup: subCleanup } = createWebhookDbClient(
              c.env
            );
            const subscriptionService = new SubscriptionService(
              { db: subDb, environment: c.env.ENVIRONMENT || 'development' },
              stripe
            );
            c.executionCtx.waitUntil(
              subscriptionService
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
                .finally(() => subCleanup())
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
    await cleanup();
  }
}

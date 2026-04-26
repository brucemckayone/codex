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
    const service = new ConnectAccountService(
      { db, environment: c.env.ENVIRONMENT || 'development' },
      stripe
    );

    switch (event.type) {
      case STRIPE_EVENTS.ACCOUNT_UPDATED: {
        const account = event.data.object as Stripe.Account;
        // Check previous values to detect activation transition
        const previousAttributes = event.data.previous_attributes as
          | Partial<Stripe.Account>
          | undefined;
        const wasChargesEnabled =
          previousAttributes?.charges_enabled !== undefined
            ? previousAttributes.charges_enabled
            : account.charges_enabled;
        const wasPayoutsEnabled =
          previousAttributes?.payouts_enabled !== undefined
            ? previousAttributes.payouts_enabled
            : account.payouts_enabled;
        const wasActive = wasChargesEnabled && wasPayoutsEnabled;
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

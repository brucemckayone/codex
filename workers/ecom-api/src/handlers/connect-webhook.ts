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
import { createPerRequestDbClient } from '@codex/database';
import { ConnectAccountService } from '@codex/subscription';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import type { StripeWebhookEnv } from '../types';

export async function handleConnectWebhook(
  event: Stripe.Event,
  stripe: Stripe,
  c: Context<StripeWebhookEnv>
) {
  const obs = c.get('obs');

  const { db, cleanup } = createPerRequestDbClient({
    DATABASE_URL: c.env.DATABASE_URL,
    DATABASE_URL_LOCAL_PROXY: (c.env as Record<string, string | undefined>)
      .DATABASE_URL_LOCAL_PROXY,
    DB_METHOD: c.env.DB_METHOD,
  });

  try {
    const service = new ConnectAccountService(
      { db, environment: c.env.ENVIRONMENT || 'development' },
      stripe
    );

    switch (event.type) {
      case STRIPE_EVENTS.ACCOUNT_UPDATED: {
        const account = event.data.object as Stripe.Account;
        await service.handleAccountUpdated(account);
        obs?.info('Connect account updated', {
          accountId: account.id,
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
        });
        break;
      }

      default:
        obs?.info('Unhandled connect webhook event', {
          type: event.type,
        });
    }
  } catch (error) {
    const err = error as Error;
    obs?.error('Connect webhook handler error', {
      eventType: event.type,
      eventId: event.id,
      error: err.message,
    });
  } finally {
    await cleanup();
  }
}

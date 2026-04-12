/**
 * Subscription Webhook Handlers
 *
 * Processes Stripe subscription lifecycle events:
 * - checkout.session.completed (mode=subscription) → create subscription record
 * - customer.subscription.updated → handle tier changes, status changes
 * - customer.subscription.deleted → mark cancelled
 * - invoice.payment_succeeded → extend period, execute revenue transfers
 * - invoice.payment_failed → update status to past_due
 *
 * Business logic (DB queries, email composition, tier lookups) lives in
 * SubscriptionService — this handler only orchestrates Stripe event extraction,
 * service calls, cache invalidation, and fire-and-forget email dispatch.
 *
 * Security:
 * - Signature already verified by verifyStripeSignature middleware
 * - Idempotent via stripeSubscriptionId unique constraint
 */

import { CacheType, VersionedCache } from '@codex/cache';
import { STRIPE_EVENTS } from '@codex/constants';
import { createPerRequestDbClient } from '@codex/database';
import type { WebhookHandlerResult } from '@codex/subscription';
import { SubscriptionService } from '@codex/subscription';
import { sendEmailToWorker } from '@codex/worker-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import type { StripeWebhookEnv } from '../types';

/**
 * Invalidate user library cache after subscription changes.
 * Fire-and-forget via waitUntil.
 */
function invalidateUserLibraryCache(
  c: Context<StripeWebhookEnv>,
  userId: string | undefined
): void {
  if (userId && c.env.CACHE_KV) {
    const cache = new VersionedCache({ kv: c.env.CACHE_KV });
    c.executionCtx.waitUntil(
      cache.invalidate(CacheType.COLLECTION_USER_LIBRARY(userId))
    );
  }
}

/**
 * Dispatch email notification from a webhook handler result.
 * Fire-and-forget via sendEmailToWorker (uses waitUntil internally).
 */
function dispatchEmail(
  c: Context<StripeWebhookEnv>,
  result: WebhookHandlerResult | void
): void {
  if (result?.email) {
    sendEmailToWorker(c.env, c.executionCtx, result.email);
  }
}

export async function handleSubscriptionWebhook(
  event: Stripe.Event,
  stripe: Stripe,
  c: Context<StripeWebhookEnv>
) {
  const obs = c.get('obs');
  const webAppUrl = c.env.WEB_APP_URL || '';

  const { db, cleanup } = createPerRequestDbClient({
    DATABASE_URL: c.env.DATABASE_URL,
    DATABASE_URL_LOCAL_PROXY: c.env.DATABASE_URL_LOCAL_PROXY,
    DB_METHOD: c.env.DB_METHOD,
  });

  try {
    const service = new SubscriptionService(
      { db, environment: c.env.ENVIRONMENT || 'development' },
      stripe
    );

    switch (event.type) {
      case STRIPE_EVENTS.CHECKOUT_COMPLETED: {
        const session = event.data.object as Stripe.Checkout.Session;
        // Only handle subscription-mode checkouts
        if (session.mode !== 'subscription') return;

        const subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;

        if (!subscriptionId) {
          obs?.warn('Subscription checkout missing subscription ID', {
            sessionId: session.id,
          });
          return;
        }

        // Retrieve the full subscription object for period dates + metadata
        const subscription =
          await stripe.subscriptions.retrieve(subscriptionId);
        const result = await service.handleSubscriptionCreated(
          subscription,
          webAppUrl
        );

        // Bump user library version so other devices detect the new subscription
        invalidateUserLibraryCache(c, result?.userId);
        dispatchEmail(c, result);

        obs?.info('Subscription created from checkout', {
          sessionId: session.id,
          subscriptionId,
        });
        break;
      }

      case STRIPE_EVENTS.SUBSCRIPTION_UPDATED: {
        const subscription = event.data.object as Stripe.Subscription;
        await service.handleSubscriptionUpdated(subscription);
        obs?.info('Subscription updated', {
          subscriptionId: subscription.id,
        });
        break;
      }

      case STRIPE_EVENTS.SUBSCRIPTION_DELETED: {
        const subscription = event.data.object as Stripe.Subscription;
        const result = await service.handleSubscriptionDeleted(
          subscription,
          webAppUrl
        );

        // Bump user library version so other devices detect the cancelled subscription
        invalidateUserLibraryCache(c, result?.userId);
        dispatchEmail(c, result);

        obs?.info('Subscription deleted', {
          subscriptionId: subscription.id,
        });
        break;
      }

      case STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED: {
        const invoice = event.data.object as Stripe.Invoice;
        const result = await service.handleInvoicePaymentSucceeded(
          invoice,
          webAppUrl
        );

        dispatchEmail(c, result);

        obs?.info('Invoice payment succeeded', {
          invoiceId: invoice.id,
        });
        break;
      }

      case STRIPE_EVENTS.INVOICE_PAYMENT_FAILED: {
        const invoice = event.data.object as Stripe.Invoice;
        obs?.warn('Invoice payment failed', {
          invoiceId: invoice.id,
          amountDue: invoice.amount_due,
        });

        const result = await service.handleInvoicePaymentFailed(
          invoice,
          webAppUrl
        );

        dispatchEmail(c, result);
        break;
      }

      default:
        obs?.info('Unhandled subscription webhook event', {
          type: event.type,
        });
    }
  } finally {
    await cleanup();
  }
}

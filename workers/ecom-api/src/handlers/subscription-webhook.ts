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
 * Security:
 * - Signature already verified by verifyStripeSignature middleware
 * - Idempotent via stripeSubscriptionId unique constraint
 */

import { STRIPE_EVENTS } from '@codex/constants';
import { createPerRequestDbClient } from '@codex/database';
import { SubscriptionService } from '@codex/subscription';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import type { StripeWebhookEnv } from '../types';

export async function handleSubscriptionWebhook(
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
        await service.handleSubscriptionCreated(subscription);

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
        await service.handleSubscriptionDeleted(subscription);
        obs?.info('Subscription deleted', {
          subscriptionId: subscription.id,
        });
        break;
      }

      case STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED: {
        const invoice = event.data.object as Stripe.Invoice;
        await service.handleInvoicePaymentSucceeded(invoice);
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
        // Status update handled by customer.subscription.updated event
        break;
      }

      default:
        obs?.info('Unhandled subscription webhook event', {
          type: event.type,
        });
    }
  } catch (error) {
    const err = error as Error;
    obs?.error('Subscription webhook handler error', {
      eventType: event.type,
      eventId: event.id,
      error: err.message,
    });
    // Don't throw — return 200 to prevent Stripe retries
  } finally {
    await cleanup();
  }
}

/**
 * Payment Webhook Handlers
 *
 * Processes Stripe payment lifecycle events:
 * - charge.refunded → update purchase status, revoke content access
 *
 * Security:
 * - Signature already verified by verifyStripeSignature middleware
 * - Idempotent: processRefund checks status before updating
 */

import { STRIPE_EVENTS } from '@codex/constants';
import { createPerRequestDbClient } from '@codex/database';
import { PurchaseService } from '@codex/purchase';
import { sendEmailToWorker } from '@codex/worker-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import type { StripeWebhookEnv } from '../types';

export async function handlePaymentWebhook(
  event: Stripe.Event,
  stripe: Stripe,
  c: Context<StripeWebhookEnv>
) {
  const obs = c.get('obs');

  const { db, cleanup } = createPerRequestDbClient({
    DATABASE_URL: c.env.DATABASE_URL,
    DATABASE_URL_LOCAL_PROXY: c.env.DATABASE_URL_LOCAL_PROXY,
    DB_METHOD: c.env.DB_METHOD,
  });

  try {
    const service = new PurchaseService(
      { db, environment: c.env.ENVIRONMENT || 'development' },
      stripe
    );

    switch (event.type) {
      case STRIPE_EVENTS.CHARGE_REFUNDED: {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId =
          typeof charge.payment_intent === 'string'
            ? charge.payment_intent
            : charge.payment_intent?.id;

        if (!paymentIntentId) {
          obs?.warn('Refund event missing payment_intent', {
            chargeId: charge.id,
          });
          return;
        }

        // Extract refund details from the Stripe charge object
        const latestRefund = charge.refunds?.data?.[0];
        await service.processRefund(paymentIntentId, {
          stripeRefundId: latestRefund?.id,
          refundAmountCents: charge.amount_refunded,
          refundReason: latestRefund?.reason ?? undefined,
        });
        obs?.info('Charge refund processed', {
          chargeId: charge.id,
          paymentIntentId,
          amountRefunded: charge.amount_refunded,
          stripeRefundId: latestRefund?.id,
        });

        // Send refund-processed email
        const refundEmail =
          charge.billing_details?.email || charge.receipt_email;
        if (refundEmail) {
          sendEmailToWorker(c.env, c.executionCtx, {
            to: refundEmail,
            templateName: 'refund-processed',
            category: 'transactional',
            data: {
              userName: charge.billing_details?.name || 'there',
              contentTitle: charge.metadata?.contentTitle || 'Content',
              refundAmount: `£${(charge.amount_refunded / 100).toFixed(2)}`,
              originalAmount: `£${(charge.amount / 100).toFixed(2)}`,
              refundDate: new Date().toLocaleDateString('en-GB'),
            },
          });
        }
        break;
      }

      default:
        obs?.info('Unhandled payment webhook event', {
          type: event.type,
        });
    }
  } finally {
    await cleanup();
  }
}

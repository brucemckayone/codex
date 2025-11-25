/**
 * Checkout Webhook Handlers
 *
 * Processes Stripe checkout.session.completed events to record purchases
 * and grant content access.
 *
 * Key Responsibilities:
 * - Extract payment metadata from Stripe checkout session
 * - Call PurchaseService.completePurchase() to record purchase atomically
 * - Handle idempotency (duplicate webhook events)
 * - Log all operations for debugging
 *
 * Security:
 * - Signature already verified by verifyStripeSignature middleware
 * - Idempotent by stripePaymentIntentId (prevents duplicate purchases)
 * - Transaction safety ensures purchase + access grant atomicity
 */

import { dbHttp } from '@codex/database';
import { PurchaseService } from '@codex/purchase';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import type { StripeWebhookEnv } from '../types';

/**
 * Handle checkout.session.completed event
 *
 * Called when Stripe checkout session successfully completes payment.
 *
 * Flow:
 * 1. Extract checkout session data
 * 2. Extract payment metadata (userId, contentId, priceCents)
 * 3. Call PurchaseService.completePurchase()
 * 4. Log success or failure
 *
 * Idempotency:
 * - Uses stripePaymentIntentId as unique constraint
 * - Duplicate events are handled gracefully (no error thrown)
 *
 * Error Handling:
 * - All errors logged via observability client
 * - Returns 200 OK even on failure (prevents Stripe retries)
 * - Manual investigation required for failed purchases
 */
export async function handleCheckoutCompleted(
  event: Stripe.Event,
  stripe: Stripe,
  c: Context<StripeWebhookEnv>
) {
  const obs = c.get('obs');
  const session = event.data.object as Stripe.Checkout.Session;

  obs.info('Processing checkout.session.completed', {
    sessionId: session.id,
    paymentIntentId: session.payment_intent,
    customerId: session.customer,
  });

  try {
    // Extract payment intent ID
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

    if (!paymentIntentId) {
      obs.error('Missing payment intent ID', { sessionId: session.id });
      return;
    }

    // Extract metadata (userId, contentId, priceCents from checkout creation)
    const metadata = session.metadata;
    if (!metadata?.userId || !metadata?.contentId) {
      obs.error('Missing required metadata', {
        sessionId: session.id,
        metadata,
      });
      return;
    }

    // Extract amount paid (in cents)
    const amountTotal = session.amount_total; // Already in cents from Stripe
    if (typeof amountTotal !== 'number') {
      obs.error('Invalid amount_total', {
        sessionId: session.id,
        amountTotal,
      });
      return;
    }

    // Extract customer ID
    const customerId =
      typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id;

    if (!customerId) {
      obs.error('Missing customer ID', { sessionId: session.id });
      return;
    }

    // Initialize purchase service
    const purchaseService = new PurchaseService(
      {
        db: dbHttp,
        environment: c.env.ENVIRONMENT || 'development',
      },
      stripe
    );

    // Complete purchase (atomic transaction: purchase + content access)
    // Note: organizationId will be fetched from content record inside completePurchase
    const purchase = await purchaseService.completePurchase(paymentIntentId, {
      customerId,
      contentId: metadata.contentId,
      organizationId: null, // Fetched from content in service layer
      amountPaidCents: amountTotal,
      currency: 'usd',
    });

    obs.info('Purchase completed successfully', {
      purchaseId: purchase.id,
      userId: metadata.userId,
      contentId: metadata.contentId,
      amountCents: amountTotal,
    });
  } catch (error) {
    const err = error as Error;
    obs.error('Failed to complete purchase', {
      error: err.message,
      sessionId: session.id,
      stack: err.stack,
    });
    // Don't throw - return 200 to Stripe to prevent retries
    // Manual investigation required for failed purchases
  }
}

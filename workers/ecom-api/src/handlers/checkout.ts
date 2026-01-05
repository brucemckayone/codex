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

import { createPerRequestDbClient } from '@codex/database';
import { PurchaseService } from '@codex/purchase';
import { checkoutSessionMetadataSchema } from '@codex/validation';
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

  obs?.info('Processing checkout.session.completed', {
    sessionId: session.id,
    paymentIntentId: session.payment_intent,
    customerId: session.customer,
  });

  // Declare variables in outer scope for error logging
  let validatedMetadata:
    | ReturnType<typeof checkoutSessionMetadataSchema.parse>
    | undefined;
  let amountTotal: number | null | undefined;

  try {
    // Extract payment intent ID
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

    if (!paymentIntentId) {
      obs?.error('Missing payment intent ID', { sessionId: session.id });
      return;
    }

    // Extract and validate metadata (customerId, contentId from checkout creation)
    const metadata = session.metadata;
    try {
      validatedMetadata = checkoutSessionMetadataSchema.parse(metadata);
    } catch (validationError) {
      obs?.error('Invalid checkout session metadata', {
        sessionId: session.id,
        error:
          validationError instanceof Error
            ? validationError.message
            : 'Unknown validation error',
        metadata,
      });
      return;
    }

    // Extract amount paid (in cents)
    amountTotal = session.amount_total; // Already in cents from Stripe
    if (typeof amountTotal !== 'number') {
      obs?.error('Invalid amount_total', {
        sessionId: session.id,
        amountTotal,
      });
      return;
    }

    // Create per-request db client for transaction support
    // DATABASE_URL_LOCAL_PROXY is optional and set only in test environments
    const { db, cleanup } = createPerRequestDbClient({
      DATABASE_URL: c.env.DATABASE_URL,
      DATABASE_URL_LOCAL_PROXY: (c.env as Record<string, string | undefined>)
        .DATABASE_URL_LOCAL_PROXY,
      DB_METHOD: c.env.DB_METHOD,
    });

    try {
      // Initialize purchase service with transaction-capable db
      const purchaseService = new PurchaseService(
        {
          db,
          environment: c.env.ENVIRONMENT || 'development',
        },
        stripe
      );

      // Complete purchase (atomic transaction: purchase + content access)
      // organizationId already transformed to null by schema if empty/undefined
      const purchase = await purchaseService.completePurchase(paymentIntentId, {
        customerId: validatedMetadata.customerId,
        contentId: validatedMetadata.contentId,
        organizationId: validatedMetadata.organizationId,
        amountPaidCents: amountTotal,
        currency: 'usd',
      });

      obs?.info('Purchase completed successfully', {
        purchaseId: purchase.id,
        customerId: validatedMetadata.customerId,
        contentId: validatedMetadata.contentId,
        amountCents: amountTotal,
      });
    } finally {
      await cleanup();
    }
  } catch (error) {
    const err = error as Error;

    // Provide detailed error context for debugging
    obs?.error('Failed to complete purchase from Stripe webhook', {
      sessionId: session.id,
      customerId: validatedMetadata?.customerId,
      contentId: validatedMetadata?.contentId,
      amountCents: amountTotal,
      errorType: err.name,
      errorMessage: err.message,
    });

    // Don't throw - return 200 to Stripe to prevent retries
    // Manual investigation required - check error logs and database state
  }
}

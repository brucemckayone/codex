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

import { invalidateUserLibrary } from '@codex/cache';
import type { ObservabilityClient } from '@codex/observability';
import { isDuplicatePayment } from '@codex/purchase';
import {
  checkoutSessionMetadataSchema,
  courseCheckoutSessionMetadataSchema,
} from '@codex/validation';
import { createWebhookServices, sendEmailToWorker } from '@codex/worker-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import type { StripeWebhookEnv } from '../types';
import {
  describeRootCause,
  isTransientError,
  rethrowIfTransient,
  settleAfterCommit,
} from '../utils/error-classification';

/**
 * Retrieve the charge id + Stripe-collected application fee for a PaymentIntent.
 * The payouts pipeline uses the charge as `source_transaction`; the app fee is
 * reconciled against the calculated split. Best-effort — a miss degrades the
 * payouts write to a no-op but the purchase + grant still complete.
 */
async function resolvePaymentIntentCharge(
  stripe: Stripe,
  paymentIntentId: string,
  obs: ObservabilityClient | undefined
): Promise<{
  stripeChargeId: string | null;
  stripeApplicationFeeCents: number | null;
}> {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return {
      stripeApplicationFeeCents: paymentIntent.application_fee_amount ?? null,
      stripeChargeId:
        typeof paymentIntent.latest_charge === 'string'
          ? paymentIntent.latest_charge
          : (paymentIntent.latest_charge?.id ?? null),
    };
  } catch (piError) {
    // The charge id is what every payout slice is paid from. A temporary
    // failure is rethrown so the webhook answers 500 and Stripe retries —
    // carrying on without it completed the sale with no slices at all
    // (Codex-2hxff.11, PAY-08).
    if (isTransientError(piError)) throw piError;
    obs?.warn('Could not retrieve PaymentIntent for fee reconciliation', {
      paymentIntentId,
      error: piError instanceof Error ? piError.message : String(piError),
    });
    return { stripeChargeId: null, stripeApplicationFeeCents: null };
  }
}

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

  // Only handle payment-mode checkouts (one-time purchases).
  // Subscription-mode checkouts are handled by handleSubscriptionWebhook.
  if (session.mode !== 'payment') {
    obs?.info('Skipping non-payment checkout session', {
      sessionId: session.id,
      mode: session.mode,
    });
    return;
  }

  // Only a paid session completes a purchase (Codex-2hxff.14). Checkout is
  // card-only, and a card session is always `paid` by the time it completes,
  // so this guards the future: a delayed method (a bank debit) completes
  // `unpaid` and is paid later, on `checkout.session.async_payment_succeeded`,
  // which nothing handles yet. Adding one means handling that event first.
  if (session.payment_status !== 'paid') {
    // Loud: with card-only checkout this should never happen, and if a
    // delayed method was ever enabled the buyer will be charged with nothing
    // here to grant what they paid for.
    obs?.error('Skipping unpaid checkout session', {
      sessionId: session.id,
      paymentStatus: session.payment_status,
    });
    return;
  }

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

  // Extract payment intent ID
  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;

  if (!paymentIntentId) {
    obs?.error('Missing payment intent ID', { sessionId: session.id });
    return;
  }

  // The payment time: the event's `created`, which Stripe keeps on every
  // redelivery. The org payee and the agreements resolve at this instant, so a
  // retry after an ownership transfer still pays the owner at the sale
  // (Codex-2hxff.2) — processing time would pay the new one.
  const paidAt = Number.isFinite(event.created)
    ? new Date(event.created * 1000)
    : undefined;
  // The checkout's start. The creator's agreement resolves at it, so a
  // checkout opened before a creator's removal and paid after keeps the split
  // they held when it started (owner decision 2026-10-21, Codex-2hxff.64 Q1).
  const offerAt = Number.isFinite(session.created)
    ? new Date(session.created * 1000)
    : undefined;

  // Codex-2pryk WP-6: a `kind: 'course'` session targets a COURSE, not content.
  // Route to the course completion path and return — the content metadata schema
  // below does not apply to it.
  if (session.metadata?.kind === 'course') {
    await handleCourseCheckoutCompleted(
      session,
      paymentIntentId,
      paidAt,
      stripe,
      c
    );
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

  // Extract the application fee Stripe was told to collect (for reconciliation),
  // plus the charge id (PaymentIntent.latest_charge) which the payouts pipeline
  // uses as `source_transaction` for the secondary org-fee transfer and as the
  // Stripe correlation for every payouts ledger row.
  let stripeApplicationFeeCents: number | null = null;
  let stripeChargeId: string | null = null;
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    stripeApplicationFeeCents = paymentIntent.application_fee_amount ?? null;
    stripeChargeId =
      typeof paymentIntent.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : (paymentIntent.latest_charge?.id ?? null);
  } catch (piError) {
    // A temporary failure is rethrown so Stripe retries: without the charge
    // id no payout slice can be recorded (Codex-2hxff.11, PAY-08). A
    // permanent one leaves it missing — the purchase + access grant still
    // complete, and completePurchase logs the unpaid slices as an error.
    if (isTransientError(piError)) throw piError;
    obs?.warn('Could not retrieve PaymentIntent for fee reconciliation', {
      paymentIntentId,
      error: piError instanceof Error ? piError.message : String(piError),
    });
  }

  // The registry's PurchaseService, as routes get it: configured fees, the
  // creator-connect-needed mailer, the web-app URL (Codex-2hxff.54).
  const { services, release } = await createWebhookServices(
    c.env,
    c.executionCtx,
    { obs, stripe }
  );

  try {
    const purchaseService = services.purchase;

    // Complete purchase (atomic transaction: purchase + content access)
    // organizationId already transformed to null by schema if empty/undefined.
    // A clawback that failed after the commit (Codex-2hxff.67) cancels
    // nothing that follows from the purchase: the session record and the
    // library bump run anyway; a transient failure is rethrown before the
    // receipt, which the redelivery sends once; any other after it. A
    // duplicate pays no one, so it never fails after its commit.
    const { value: purchase, failure } = await settleAfterCommit(() =>
      purchaseService.completePurchase(paymentIntentId, {
        customerId: validatedMetadata.customerId,
        contentId: validatedMetadata.contentId,
        organizationId: validatedMetadata.organizationId,
        amountPaidCents: amountTotal,
        // What the buyer actually paid in. completePurchase refuses anything
        // but GBP before it writes (Codex-2hxff.23 PAY-25).
        currency: session.currency ?? undefined,
        stripeApplicationFeeCents,
        stripeChargeId,
        paidAt,
        offerAt,
      })
    );
    await recordSessionPaid(purchaseService, session.id, obs);

    // A second payment for content the buyer owns was refunded, not sold.
    // Its refund email tells them; a receipt would say they bought it again.
    if (isDuplicatePayment(purchase)) {
      obs?.warn('Duplicate payment refunded instead of completed', {
        purchaseId: purchase.id,
        customerId: validatedMetadata.customerId,
        contentId: validatedMetadata.contentId,
      });
      return;
    }

    obs?.info('Purchase completed successfully', {
      purchaseId: purchase.id,
      customerId: validatedMetadata.customerId,
      contentId: validatedMetadata.contentId,
      amountCents: amountTotal,
    });

    // Bump user library version so other devices detect the new purchase on next load.
    // Guard against a missing executionCtx (mock contexts in tests omit it).
    if (c.executionCtx) {
      invalidateUserLibrary({
        kv: c.env.CACHE_KV,
        waitUntil: c.executionCtx.waitUntil.bind(c.executionCtx),
        userId: validatedMetadata.customerId,
        logger: obs,
      });
    }
    rethrowIfTransient(failure);

    // Send purchase receipt email (fire-and-forget), once per purchase.
    const customerEmail = session.customer_details?.email;
    const customerName = session.customer_details?.name || 'there';
    if (
      customerEmail &&
      (await claimReceipt(purchaseService, purchase.id, obs))
    ) {
      // Resolve content title from metadata or use fallback
      const contentTitle =
        metadata?.contentTitle || metadata?.contentName || 'Content purchase';
      const penceAmount = amountTotal ?? 0;
      const formatted = `£${(penceAmount / 100).toFixed(2)}`;
      sendEmailToWorker(c.env, c.executionCtx, {
        to: customerEmail,
        toName: customerName,
        templateName: 'purchase-receipt',
        category: 'transactional',
        userId: validatedMetadata.customerId,
        data: {
          userName: customerName,
          contentTitle,
          priceFormatted: formatted,
          purchaseDate: new Date().toLocaleDateString('en-GB'),
          contentUrl: `${c.env.WEB_APP_URL || ''}/content/${validatedMetadata.contentId}`,
        },
      });
    }
    if (failure) throw failure;
  } finally {
    release();
  }
}

/**
 * Mark the paid checkout session completed (Codex-2hxff.14). A record, not a
 * gate: the buyer's next checkout is refused because they own the item. So a
 * failure here is logged, not thrown: thrown after the purchase committed, a
 * permanent one would skip the receipt for good.
 */
async function recordSessionPaid(
  purchaseService: { markCheckoutSessionCompleted(id: string): Promise<void> },
  sessionId: string,
  obs: ObservabilityClient | undefined
): Promise<void> {
  try {
    await purchaseService.markCheckoutSessionCompleted(sessionId);
  } catch (error) {
    obs?.error('Paid checkout session could not be marked completed', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Claim the purchase's one receipt (Codex-mat01; owner decision 2026-10-25).
 * The first delivery to find the purchase live sends it, whether or not it
 * created the purchase: the redelivery after a transient failure, or after a
 * partial refund that arrived first, still sends it once. A purchase refunded
 * in full first gets none. A failed claim a retry can fix is rethrown, so
 * Stripe redelivers and the redelivery claims it; any other is logged and
 * the receipt is not sent. That line is the receipt's only trace, so it
 * carries the root cause: the service's wrap says only "An unexpected error
 * occurred", and handleError's own line has no purchaseId.
 */
async function claimReceipt(
  purchaseService: { claimReceipt(purchaseId: string): Promise<boolean> },
  purchaseId: string,
  obs: ObservabilityClient | undefined
): Promise<boolean> {
  try {
    const claimed = await purchaseService.claimReceipt(purchaseId);
    if (!claimed) {
      obs?.info('Purchase receipt already sent or not due', { purchaseId });
    }
    return claimed;
  } catch (error) {
    if (isTransientError(error)) throw error;
    obs?.error('Purchase receipt could not be claimed, so it was not sent', {
      errorId: crypto.randomUUID(),
      purchaseId,
      error: error instanceof Error ? error.message : String(error),
      cause: describeRootCause(error),
    });
    return false;
  }
}

/**
 * Complete a one-off COURSE purchase from a `kind: 'course'` checkout session
 * (Codex-2pryk WP-6). Mirrors the content path but calls
 * `PurchaseService.completeCoursePurchase`, which writes a `course_purchase`
 * entitlement + auto-enrolls and reuses the Option-B payout fan-out.
 * Idempotent by `stripePaymentIntentId`; returns 200 even on failure so Stripe
 * does not retry a poisoned event (failures are logged for manual triage).
 */
async function handleCourseCheckoutCompleted(
  session: Stripe.Checkout.Session,
  paymentIntentId: string,
  paidAt: Date | undefined,
  stripe: Stripe,
  c: Context<StripeWebhookEnv>
): Promise<void> {
  const obs = c.get('obs');

  let metadata: ReturnType<typeof courseCheckoutSessionMetadataSchema.parse>;
  try {
    metadata = courseCheckoutSessionMetadataSchema.parse(session.metadata);
  } catch (validationError) {
    obs?.error('Invalid course checkout session metadata', {
      sessionId: session.id,
      error:
        validationError instanceof Error
          ? validationError.message
          : 'Unknown validation error',
    });
    return;
  }

  const amountTotal = session.amount_total;
  if (typeof amountTotal !== 'number') {
    obs?.error('Invalid amount_total on course checkout', {
      sessionId: session.id,
      amountTotal,
    });
    return;
  }

  const { stripeChargeId, stripeApplicationFeeCents } =
    await resolvePaymentIntentCharge(stripe, paymentIntentId, obs);

  const { services, release } = await createWebhookServices(
    c.env,
    c.executionCtx,
    { obs, stripe }
  );
  try {
    const purchaseService = services.purchase;

    // As for content: a clawback that failed after the commit is rethrown
    // before the receipt when transient, after it otherwise.
    const { value: purchase, failure } = await settleAfterCommit(() =>
      purchaseService.completeCoursePurchase(paymentIntentId, {
        customerId: metadata.customerId,
        courseId: metadata.courseId,
        amountPaidCents: amountTotal,
        // Refused unless GBP, as for content.
        currency: session.currency ?? undefined,
        stripeApplicationFeeCents,
        stripeChargeId,
        paidAt,
        offerAt: Number.isFinite(session.created)
          ? new Date(session.created * 1000)
          : undefined,
      })
    );
    await recordSessionPaid(purchaseService, session.id, obs);

    if (isDuplicatePayment(purchase)) {
      obs?.warn('Duplicate course payment refunded instead of completed', {
        purchaseId: purchase.id,
        customerId: metadata.customerId,
        courseId: metadata.courseId,
      });
      return;
    }

    obs?.info('Course purchase completed successfully', {
      purchaseId: purchase.id,
      customerId: metadata.customerId,
      courseId: metadata.courseId,
      amountCents: amountTotal,
    });

    // Bump the buyer's library version so the new course entitlement + enrollment
    // surface on their other devices.
    if (c.executionCtx) {
      invalidateUserLibrary({
        kv: c.env.CACHE_KV,
        waitUntil: c.executionCtx.waitUntil.bind(c.executionCtx),
        userId: metadata.customerId,
        logger: obs,
      });
    }
    rethrowIfTransient(failure);

    const customerEmail = session.customer_details?.email;
    const customerName = session.customer_details?.name || 'there';
    if (
      customerEmail &&
      (await claimReceipt(purchaseService, purchase.id, obs))
    ) {
      const formatted = `£${(amountTotal / 100).toFixed(2)}`;
      sendEmailToWorker(c.env, c.executionCtx, {
        to: customerEmail,
        toName: customerName,
        templateName: 'purchase-receipt',
        category: 'transactional',
        userId: metadata.customerId,
        data: {
          userName: customerName,
          contentTitle: metadata.courseTitle || 'Course purchase',
          priceFormatted: formatted,
          purchaseDate: new Date().toLocaleDateString('en-GB'),
          contentUrl: `${c.env.WEB_APP_URL || ''}/courses/${metadata.courseId}`,
        },
      });
    }
    if (failure) throw failure;
  } finally {
    release();
  }
}

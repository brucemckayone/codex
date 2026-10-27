/**
 * Checkout Completion
 *
 * Records the purchase a paid Stripe Checkout Session stands for and grants
 * its access. Two callers run the same completion (owner decision 2026-10-26,
 * "Unlock on arrival"; Stripe's "trigger fulfillment on your landing page"):
 * - the `checkout.session.completed` webhook (`handleCheckoutCompleted`), the
 *   backstop, which always arrives;
 * - the success page, through `POST /checkout/complete` (`routes/checkout.ts`),
 *   so the buyer need not wait for the webhook.
 *
 * Key Responsibilities:
 * - Extract payment metadata from Stripe checkout session
 * - Call PurchaseService.completePurchase() to record purchase atomically
 * - Handle idempotency (duplicate webhook events, the page and the webhook at
 *   once, two tabs)
 * - Log all operations for debugging
 *
 * Security:
 * - Webhook: signature already verified by verifyStripeSignature middleware
 * - Page: the route retrieves the session from Stripe itself and refuses
 *   another buyer's or another environment's
 * - Idempotent by stripePaymentIntentId (prevents duplicate purchases)
 * - Transaction safety ensures purchase + access grant atomicity
 */

import { invalidateUserLibrary } from '@codex/cache';
import type { ObservabilityClient } from '@codex/observability';
import {
  isDuplicatePayment,
  type PaymentIntentCharge,
  type Purchase,
  type PurchaseService,
} from '@codex/purchase';
import type { AfterCommitError } from '@codex/service-errors';
import type { Bindings } from '@codex/shared-types';
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
  settleAfterCommit,
} from '../utils/error-classification';

/** What completing a session asks of the PurchaseService. */
type CompletionPurchaseService = Pick<
  PurchaseService,
  | 'completePurchase'
  | 'completeCoursePurchase'
  | 'markCheckoutSessionCompleted'
  | 'claimReceipt'
>;

export interface CheckoutCompletionDeps {
  env: Bindings;
  executionCtx: ExecutionContext;
  obs: ObservabilityClient | undefined;
  /** Which caller: carried on the log lines. */
  trigger: 'webhook' | 'landing';
  /**
   * The payment time. The webhook passes its event's `created`, which Stripe
   * keeps on every redelivery; the page passes nothing, and the charge's own
   * `created` is used.
   */
  paidAt?: Date;
  /** Look up the charge: rejects when a retry can fix the failure. */
  resolveCharge(paymentIntentId: string): Promise<PaymentIntentCharge>;
  /**
   * Run the completion with a PurchaseService. The webhook opens its
   * services' pool here, after every skip and the charge lookup, and closes
   * it when `run` settles.
   */
  withPurchaseService<T>(
    run: (purchaseService: CompletionPurchaseService) => Promise<T>
  ): Promise<T>;
}

export type CheckoutSkipReason =
  | 'not_payment_mode'
  | 'unpaid'
  | 'no_payment_intent'
  | 'bad_metadata'
  | 'no_amount';

export type CheckoutCompletion =
  | { kind: 'skipped'; reason: CheckoutSkipReason }
  | {
      kind: 'completed';
      /** A duplicate payment's row is refunded, not sold (`isDuplicatePayment`). */
      purchase: Purchase;
      /**
       * A step after the commit failed (a clawback, Codex-2hxff.67). The
       * purchase and its access stand. When a retry can fix it the receipt
       * was not sent, and the webhook's redelivery sends it.
       */
      failure?: AfterCommitError;
    };

/** One kind of checkout (content or course), read from its session. */
interface Sale {
  customerId: string;
  amountCents: number;
  /** The item, as the log lines name it. */
  item: { contentId: string } | { courseId: string };
  complete(
    purchaseService: CompletionPurchaseService,
    paymentIntentId: string,
    payment: { charge: PaymentIntentCharge; paidAt?: Date; offerAt?: Date }
  ): Promise<Purchase>;
  logs: { duplicate: string; completed: string };
  receipt: { title: string; path: string };
}

/**
 * Retrieve the charge id + Stripe-collected application fee for a PaymentIntent.
 * The payouts pipeline uses the charge as `source_transaction`; the app fee is
 * reconciled against the calculated split. Best-effort — a miss degrades the
 * payouts write to a no-op but the purchase + grant still complete.
 *
 * `lookup` reads it: the webhook with its own verified Stripe client, the
 * success page through `PurchaseService.retrievePaymentIntentCharge`. Both
 * get the same rule for a failure.
 */
export async function resolvePaymentIntentCharge(
  lookup: () => Promise<PaymentIntentCharge>,
  paymentIntentId: string,
  obs: ObservabilityClient | undefined
): Promise<PaymentIntentCharge> {
  try {
    return await lookup();
  } catch (piError) {
    // The charge id is what every payout slice is paid from. A temporary
    // failure is rethrown so the webhook answers 500 and Stripe retries —
    // carrying on without it completed the sale with no slices at all
    // (Codex-2hxff.11, PAY-08). A permanent one leaves it missing — the
    // purchase + access grant still complete, and completePurchase logs the
    // unpaid slices as an error.
    if (isTransientError(piError)) throw piError;
    obs?.warn('Could not retrieve PaymentIntent for fee reconciliation', {
      paymentIntentId,
      error: piError instanceof Error ? piError.message : String(piError),
    });
    return { stripeChargeId: null, stripeApplicationFeeCents: null };
  }
}

/** The webhook's lookup: the PaymentIntent, read with the verified client. */
async function retrieveWebhookCharge(
  stripe: Stripe,
  paymentIntentId: string
): Promise<PaymentIntentCharge> {
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  return {
    stripeApplicationFeeCents: paymentIntent.application_fee_amount ?? null,
    stripeChargeId:
      typeof paymentIntent.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : (paymentIntent.latest_charge?.id ?? null),
  };
}

/**
 * Handle checkout.session.completed event
 *
 * Called when Stripe checkout session successfully completes payment. Runs
 * `completeCheckoutSession` with the webhook's verified Stripe client and the
 * registry's services from `createWebhookServices`.
 *
 * Idempotency:
 * - Uses stripePaymentIntentId as unique constraint
 * - Duplicate events are handled gracefully (no error thrown)
 *
 * Error Handling:
 * - Errors propagate, so createWebhookHandler answers 500 for a transient one
 *   (Stripe retries) and 200 for a permanent one
 * - A failure after the purchase committed is thrown after what follows from
 *   the commit has run
 */
export async function handleCheckoutCompleted(
  event: Stripe.Event,
  stripe: Stripe,
  c: Context<StripeWebhookEnv>
) {
  const obs = c.get('obs');
  const completion = await completeCheckoutSession(
    event.data.object as Stripe.Checkout.Session,
    {
      env: c.env,
      executionCtx: c.executionCtx,
      obs,
      trigger: 'webhook',
      // The payment time: the event's `created`, which Stripe keeps on every
      // redelivery. The org payee and the agreements resolve at this instant,
      // so a retry after an ownership transfer still pays the owner at the
      // sale (Codex-2hxff.2) — processing time would pay the new one.
      paidAt: Number.isFinite(event.created)
        ? new Date(event.created * 1000)
        : undefined,
      resolveCharge: (paymentIntentId) =>
        resolvePaymentIntentCharge(
          () => retrieveWebhookCharge(stripe, paymentIntentId),
          paymentIntentId,
          obs
        ),
      // The registry's PurchaseService, as routes get it: configured fees, the
      // creator-connect-needed mailer, the web-app URL (Codex-2hxff.54).
      withPurchaseService: async (run) => {
        const { services, release } = await createWebhookServices(
          c.env,
          c.executionCtx,
          { obs, stripe }
        );
        try {
          return await run(services.purchase);
        } finally {
          release();
        }
      },
    }
  );
  if (completion.kind === 'completed' && completion.failure) {
    throw completion.failure;
  }
}

/**
 * Complete the purchase a paid checkout session stands for: the one
 * completion both the webhook and the success page run.
 *
 * Safe to run twice at once, for the same session: the purchase row is keyed
 * by its PaymentIntent and taken under a per-buyer, per-item lock; each payout
 * slice is reserved by a unique key before any money moves; the receipt is an
 * atomic claim (docs/payments/purchases.md, "Concurrency").
 *
 * Skips, logged, with nothing written: a non-payment session, an unpaid one,
 * one with no PaymentIntent, bad metadata or no amount. A failure before the
 * commit is thrown. One after it is returned as `failure` once what follows
 * from the commit has run, and the caller decides what to do with it.
 */
export async function completeCheckoutSession(
  session: Stripe.Checkout.Session,
  deps: CheckoutCompletionDeps
): Promise<CheckoutCompletion> {
  const { obs, trigger } = deps;

  // Only handle payment-mode checkouts (one-time purchases).
  // Subscription-mode checkouts are handled by handleSubscriptionWebhook.
  if (session.mode !== 'payment') {
    obs?.info('Skipping non-payment checkout session', {
      sessionId: session.id,
      mode: session.mode,
    });
    return { kind: 'skipped', reason: 'not_payment_mode' };
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
    return { kind: 'skipped', reason: 'unpaid' };
  }

  obs?.info('Processing checkout.session.completed', {
    sessionId: session.id,
    paymentIntentId: session.payment_intent,
    customerId: session.customer,
    trigger,
  });

  // Extract payment intent ID
  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;

  if (!paymentIntentId) {
    obs?.error('Missing payment intent ID', { sessionId: session.id });
    return { kind: 'skipped', reason: 'no_payment_intent' };
  }

  // The checkout's start. The creator's agreement resolves at it, so a
  // checkout opened before a creator's removal and paid after keeps the split
  // they held when it started (owner decision 2026-10-21, Codex-2hxff.64 Q1).
  const offerAt = Number.isFinite(session.created)
    ? new Date(session.created * 1000)
    : undefined;

  const sale = readSale(session, obs);
  if ('skipped' in sale) return { kind: 'skipped', reason: sale.skipped };

  // The application fee Stripe was told to collect (for reconciliation), plus
  // the charge id (PaymentIntent.latest_charge) which the payouts pipeline
  // uses as `source_transaction` for the secondary org-fee transfer and as the
  // Stripe correlation for every payouts ledger row.
  const charge = await deps.resolveCharge(paymentIntentId);
  const paidAt = deps.paidAt ?? charge.chargedAt;

  return deps.withPurchaseService(async (purchaseService) => {
    // A clawback that failed after the commit (Codex-2hxff.67) cancels
    // nothing that follows from the purchase: the session record and the
    // library bump run anyway; a transient failure skips the receipt, which
    // the redelivery sends once; any other is returned after it. A duplicate
    // pays no one, so it never fails after its commit.
    const { value: purchase, failure } = await settleAfterCommit(() =>
      sale.complete(purchaseService, paymentIntentId, {
        charge,
        paidAt,
        offerAt,
      })
    );
    await recordSessionPaid(purchaseService, session.id, obs);

    // A second payment for an item the buyer owns was refunded, not sold.
    // Its refund email tells them; a receipt would say they bought it again.
    if (isDuplicatePayment(purchase)) {
      obs?.warn(sale.logs.duplicate, {
        purchaseId: purchase.id,
        customerId: sale.customerId,
        ...sale.item,
      });
      return { kind: 'completed', purchase };
    }

    obs?.info(sale.logs.completed, {
      purchaseId: purchase.id,
      customerId: sale.customerId,
      ...sale.item,
      amountCents: sale.amountCents,
      trigger,
    });

    // Bump the buyer's library version so their other devices detect the new
    // purchase on next load. Both paths bump: when the webhook is slow or
    // failing — the case the page's completion exists for — its retry can be
    // hours away, and the buyer's other tabs and devices would keep a stale
    // library until then. A second bump costs one KV write and one refetch.
    // Guard against a missing executionCtx (mock contexts in tests omit it).
    if (deps.executionCtx) {
      invalidateUserLibrary({
        kv: deps.env.CACHE_KV,
        waitUntil: deps.executionCtx.waitUntil.bind(deps.executionCtx),
        userId: sale.customerId,
        logger: obs,
      });
    }
    if (failure && isTransientError(failure)) {
      return { kind: 'completed', purchase, failure };
    }

    // Send purchase receipt email (fire-and-forget), once per purchase.
    const customerEmail = session.customer_details?.email;
    const customerName = session.customer_details?.name || 'there';
    if (
      customerEmail &&
      (await claimReceipt(purchaseService, purchase.id, obs))
    ) {
      sendEmailToWorker(deps.env, deps.executionCtx, {
        to: customerEmail,
        toName: customerName,
        templateName: 'purchase-receipt',
        category: 'transactional',
        userId: sale.customerId,
        data: {
          userName: customerName,
          contentTitle: sale.receipt.title,
          priceFormatted: `£${(sale.amountCents / 100).toFixed(2)}`,
          purchaseDate: new Date().toLocaleDateString('en-GB'),
          contentUrl: `${deps.env.WEB_APP_URL || ''}${sale.receipt.path}`,
        },
      });
    }
    return { kind: 'completed', purchase, failure };
  });
}

/**
 * Read the sale from the session: a `kind: 'course'` session targets a
 * COURSE (Codex-2pryk WP-6), any other one content. Bad metadata or a
 * missing amount is logged and skipped.
 */
function readSale(
  session: Stripe.Checkout.Session,
  obs: ObservabilityClient | undefined
): Sale | { skipped: CheckoutSkipReason } {
  if (session.metadata?.kind === 'course') {
    return readCourseSale(session, obs);
  }

  // Extract and validate metadata (customerId, contentId from checkout creation)
  const metadata = session.metadata;
  let validated: ReturnType<typeof checkoutSessionMetadataSchema.parse>;
  try {
    validated = checkoutSessionMetadataSchema.parse(metadata);
  } catch (validationError) {
    obs?.error('Invalid checkout session metadata', {
      sessionId: session.id,
      error:
        validationError instanceof Error
          ? validationError.message
          : 'Unknown validation error',
      metadata,
    });
    return { skipped: 'bad_metadata' };
  }

  // Extract amount paid (in cents)
  const amountTotal = session.amount_total; // Already in cents from Stripe
  if (typeof amountTotal !== 'number') {
    obs?.error('Invalid amount_total', {
      sessionId: session.id,
      amountTotal,
    });
    return { skipped: 'no_amount' };
  }

  return {
    customerId: validated.customerId,
    amountCents: amountTotal,
    item: { contentId: validated.contentId },
    // Complete purchase (atomic transaction: purchase + content access)
    // organizationId already transformed to null by schema if empty/undefined.
    complete: (purchaseService, paymentIntentId, { charge, paidAt, offerAt }) =>
      purchaseService.completePurchase(paymentIntentId, {
        customerId: validated.customerId,
        contentId: validated.contentId,
        organizationId: validated.organizationId,
        amountPaidCents: amountTotal,
        // What the buyer actually paid in. completePurchase refuses anything
        // but GBP before it writes (Codex-2hxff.23 PAY-25).
        currency: session.currency ?? undefined,
        stripeApplicationFeeCents: charge.stripeApplicationFeeCents,
        stripeChargeId: charge.stripeChargeId,
        paidAt,
        offerAt,
      }),
    logs: {
      duplicate: 'Duplicate payment refunded instead of completed',
      completed: 'Purchase completed successfully',
    },
    receipt: {
      // Resolve content title from metadata or use fallback
      title:
        metadata?.contentTitle || metadata?.contentName || 'Content purchase',
      path: `/content/${validated.contentId}`,
    },
  };
}

/**
 * A one-off COURSE purchase (Codex-2pryk WP-6). Mirrors the content path but
 * calls `PurchaseService.completeCoursePurchase`, which writes a
 * `course_purchase` entitlement + auto-enrolls and reuses the Option-B payout
 * fan-out.
 */
function readCourseSale(
  session: Stripe.Checkout.Session,
  obs: ObservabilityClient | undefined
): Sale | { skipped: CheckoutSkipReason } {
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
    return { skipped: 'bad_metadata' };
  }

  const amountTotal = session.amount_total;
  if (typeof amountTotal !== 'number') {
    obs?.error('Invalid amount_total on course checkout', {
      sessionId: session.id,
      amountTotal,
    });
    return { skipped: 'no_amount' };
  }

  return {
    customerId: metadata.customerId,
    amountCents: amountTotal,
    item: { courseId: metadata.courseId },
    complete: (purchaseService, paymentIntentId, { charge, paidAt, offerAt }) =>
      purchaseService.completeCoursePurchase(paymentIntentId, {
        customerId: metadata.customerId,
        courseId: metadata.courseId,
        amountPaidCents: amountTotal,
        // Refused unless GBP, as for content.
        currency: session.currency ?? undefined,
        stripeApplicationFeeCents: charge.stripeApplicationFeeCents,
        stripeChargeId: charge.stripeChargeId,
        paidAt,
        offerAt,
      }),
    logs: {
      duplicate: 'Duplicate course payment refunded instead of completed',
      completed: 'Course purchase completed successfully',
    },
    receipt: {
      title: metadata.courseTitle || 'Course purchase',
      path: `/courses/${metadata.courseId}`,
    },
  };
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
 * The first completion to find the purchase live sends it, whether or not it
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

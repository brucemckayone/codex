/**
 * Payment Webhook Handlers
 *
 * Processes Stripe payment lifecycle events:
 * - charge.refunded → record each refund; a full refund ends access, a
 *   partial one keeps it (P-1); email each refund once
 * - refund.updated, refund.failed → record the refund's status; claw back a
 *   refund that was pending at charge.refunded; a failed one is support's
 * - charge.dispute.* → record the dispute; a chargeback pauses access and
 *   claws back paid slices, won pays them back, lost refunds the purchase
 *   (Codex-sxu5a, Codex-2hxff.9). `processDispute` is shared with the hourly
 *   reconcile, which settles disputes whose events were missed
 *   (./dispute-reconcile.ts, Codex-2hxff.58)
 *
 * Cache invalidation uses the shared `invalidateForUser` helper from
 * `@codex/subscription` so a refund/dispute bumps COLLECTION_USER_LIBRARY
 * for the affected user (their newly-revoked content must disappear from the
 * library view on the next fetch). One-time purchases are content-scoped,
 * not org-scoped, so COLLECTION_USER_SUBSCRIPTION is not touched here.
 * See docs/payments/access.md ("Keeping caches in step", "Streaming revocation").
 *
 * Security:
 * - Signature already verified by verifyStripeSignature middleware
 * - Idempotent: processRefund / processDispute check state before mutating
 */

import { AccessRevocation, type RevocationReason } from '@codex/access';
import { VersionedCache } from '@codex/cache';
import {
  DISPUTE_CHARGEBACK_OPEN_STATUSES,
  DISPUTE_CLOSED_STATUSES,
  isForeignStripeEnvironment,
  STRIPE_EVENTS,
} from '@codex/constants';
import type { ObservabilityClient } from '@codex/observability';
import type { PurchaseService } from '@codex/purchase';
import type { Bindings } from '@codex/shared-types';
import {
  type CourseSubscriptionService,
  invalidateForUser,
  type SubscriptionService,
} from '@codex/subscription';
import { createWebhookServices, sendEmailToWorker } from '@codex/worker-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import type { StripeWebhookEnv } from '../types';
import { isTransientError } from '../utils/error-classification';

/** The reasons a refund or a dispute writes into the streaming block. */
type PaymentBlockReason = Extract<
  RevocationReason,
  'refund' | 'purchase_dispute' | 'subscription_dispute'
>;

/**
 * What a refund or dispute does outside the database: the buyer's library
 * cache and the per-org streaming block. Every effect is fire-and-forget and a
 * no-op without `CACHE_KV` (dev stub / misconfigured env), so a KV hiccup never
 * surfaces as a 500. Built from the webhook's context (`accessEffectsFor`), or
 * by the hourly dispute reconcile from the scheduled handler's bindings
 * (Codex-2hxff.58).
 */
export interface AccessEffects {
  /**
   * Bump the user's library collection version, so the next library fetch
   * omits the newly-revoked content. A no-op without a userId.
   */
  invalidateLibrary(userId: string | undefined): void;
  /**
   * Write the per-user, per-org KV revocation key. Only for an event that
   * reduces access AND names both: one-time purchase refunds return
   * `{ userId }` only and deliberately skip it (the library bump is enough,
   * because `processRefund` soft-deletes `contentAccess`). Mirror of
   * `revokeAccess` in `subscription-webhook.ts`.
   *
   * `reason` is what the content page shows while the key lives: an opened
   * chargeback pauses access (`'purchase_dispute'`, `'subscription_dispute'`,
   * Codex-2hxff.60); a refund or a lost dispute ends it (`'refund'`).
   */
  revokeAccess(userId: string, orgId: string, reason: PaymentBlockReason): void;
  /**
   * Clear that key once a won dispute has restored the access the chargeback
   * paused (Codex-2hxff.9). The stream endpoint still checks access before
   * signing, so over-clearing never grants anything; it only lets the
   * restored access stream again before the key's TTL. Mirror of
   * `clearAccess` in `subscription-webhook.ts`.
   */
  clearRevocation(userId: string, orgId: string): void;
}

export function createAccessEffects(deps: {
  kv: Bindings['CACHE_KV'];
  waitUntil: (promise: Promise<unknown>) => void;
  obs: ObservabilityClient | undefined;
}): AccessEffects {
  const { kv, waitUntil, obs } = deps;

  /** Errors are swallowed inside the promise, and around `waitUntil` too. */
  function inBackground(
    run: () => Promise<unknown>,
    failure: string,
    fields: Record<string, unknown>
  ): void {
    try {
      waitUntil(
        run().catch((error: unknown) => {
          obs?.warn(failure, {
            ...fields,
            error: error instanceof Error ? error.message : String(error),
          });
        })
      );
    } catch (error) {
      obs?.warn(`${failure}: waitUntil threw synchronously`, {
        ...fields,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    invalidateLibrary(userId) {
      if (!userId || !kv) return;
      // `waitUntil` goes into the CONFIG, not only to `invalidateForUser`
      // below. The helper's copy sinks the invalidation; only the instance's
      // own copy can sink a data-slot put from `get`/`getWithResult`. Nothing
      // reads through this cache today, which is exactly how Codex-03uh3
      // stayed invisible next door.
      const cache = new VersionedCache({ kv, waitUntil, obs });
      try {
        invalidateForUser(
          cache,
          waitUntil,
          { userId, reason: 'refund' },
          obs ? { logger: obs } : undefined
        );
      } catch (error) {
        obs?.warn('payment-webhook: invalidateForUser threw synchronously', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    revokeAccess(userId, orgId, reason) {
      if (!kv) return;
      const revocation = new AccessRevocation(kv, obs);
      inBackground(
        () => revocation.revoke(userId, orgId, reason),
        'payment-webhook: AccessRevocation.revoke failed',
        { userId, orgId, reason }
      );
    },
    clearRevocation(userId, orgId) {
      if (!kv) return;
      const revocation = new AccessRevocation(kv, obs);
      inBackground(
        () => revocation.clear(userId, orgId),
        'payment-webhook: AccessRevocation.clear failed',
        { userId, orgId }
      );
    },
  };
}

/** The webhook's effects: its bindings, and its request's `waitUntil`. */
function accessEffectsFor(c: Context<StripeWebhookEnv>): AccessEffects {
  return createAccessEffects({
    kv: c.env.CACHE_KV,
    // Read when an effect runs, as before: one without CACHE_KV never does.
    waitUntil: (promise) => c.executionCtx.waitUntil(promise),
    obs: c.get('obs'),
  });
}

/** A refunded purchase, as `processRefund` returns it. */
interface RefundedPurchase {
  accessEnded: boolean;
  duplicatePayment?: boolean;
  itemTitle?: string | null;
}

type RefundCancellation = NonNullable<
  Awaited<ReturnType<SubscriptionService['cancelForFullRefund']>>
>;
/** A duplicate subscription's refund, as `cancelForFullRefund` describes it. */
type DuplicateSubscriptionRefund = NonNullable<RefundCancellation['duplicate']>;
/** An ended old subscription's refund beside the one that stands, likewise. */
type SupersededSubscriptionRefund = NonNullable<
  RefundCancellation['superseded']
>;

/**
 * A subscription charge's refund that ends nothing of the buyer's, and what
 * its email says instead (Codex-2hxff.15).
 */
type SubscriptionRefundNote =
  | { duplicate: DuplicateSubscriptionRefund; superseded?: never }
  | { superseded: SupersededSubscriptionRefund; duplicate?: never };

/**
 * Email the payer about each refund of the charge not yet emailed, once per
 * refund, with that refund's amount (owner decision 2026-10-19, "One per
 * refund"). `claimRefundEmails` marks them first, so a redelivery sends
 * nothing. For a purchase, the email says whether the buyer keeps access
 * (P-1); a subscription charge's says neither, unless it paid for a second
 * subscription the buyer already had, or for an old one ended beside the one
 * that stands (Codex-2hxff.15).
 */
async function sendRefundEmails(
  c: Context<StripeWebhookEnv>,
  service: PurchaseService,
  charge: Stripe.Charge,
  purchase: RefundedPurchase | undefined,
  subscriptionNote?: SubscriptionRefundNote
): Promise<void> {
  const to = charge.billing_details?.email || charge.receipt_email;
  if (!to) return;

  const claimed = await service.claimRefundEmails(charge.id);
  const { contentTitle, accessNote } = subscriptionNote?.duplicate
    ? duplicateSubscriptionNote(subscriptionNote.duplicate)
    : subscriptionNote?.superseded
      ? supersededSubscriptionNote(subscriptionNote.superseded)
      : purchaseNote(charge, purchase);
  for (const refund of claimed) {
    sendEmailToWorker(c.env, c.executionCtx, {
      to,
      templateName: 'refund-processed',
      category: 'transactional',
      data: {
        userName: charge.billing_details?.name || 'there',
        contentTitle,
        refundAmount: `£${(refund.amountCents / 100).toFixed(2)}`,
        originalAmount: `£${(charge.amount / 100).toFixed(2)}`,
        refundDate: new Date().toLocaleDateString('en-GB'),
        accessNote,
      },
    });
  }
}

function purchaseNote(
  charge: Stripe.Charge,
  purchase: RefundedPurchase | undefined
): { contentTitle: string; accessNote: string } {
  // The purchase's own title: a charge carries none of ours.
  const contentTitle =
    purchase?.itemTitle || charge.metadata?.contentTitle || 'Content';
  // A second payment for an item the buyer owned was refunded automatically
  // (Codex-2hxff.14): say why, and that the first purchase stands.
  const accessNote = !purchase
    ? ''
    : purchase.duplicatePayment
      ? `You still have ${contentTitle}. This refunds a second payment for it.`
      : purchase.accessEnded
        ? `Your access to ${contentTitle} has ended.`
        : `You keep access to ${contentTitle}.`;
  return { contentTitle, accessNote };
}

/**
 * A second subscription the buyer already had was cancelled and refunded
 * (owner decision 2026-10-22): say so, and for another tier than the one that
 * stands, that Change plan switches to it.
 */
function duplicateSubscriptionNote(duplicate: DuplicateSubscriptionRefund): {
  contentTitle: string;
  accessNote: string;
} {
  const settled = 'We cancelled the second subscription and refunded it.';
  if (duplicate.kind === 'course') {
    return {
      contentTitle: `${duplicate.courseTitle} subscription`,
      accessNote: `You were already subscribed to ${duplicate.courseTitle}. ${settled}`,
    };
  }
  const switchTo = duplicate.otherTier
    ? ` You can switch to ${duplicate.tierName} with Change plan.`
    : '';
  return {
    contentTitle: `${duplicate.tierName} subscription to ${duplicate.organizationName}`,
    accessNote: `You were already subscribed to ${duplicate.organizationName}. ${settled}${switchTo}`,
  };
}

/**
 * An old subscription, revived next to the newer one that stands, was ended
 * and the payment that revived it refunded (owner decision 7): say the buyer
 * still subscribes, and what this refunds.
 */
function supersededSubscriptionNote(superseded: SupersededSubscriptionRefund): {
  contentTitle: string;
  accessNote: string;
} {
  const refunds =
    'This refunds a payment on your old subscription, which has ended.';
  if (superseded.kind === 'course') {
    return {
      contentTitle: `${superseded.courseTitle} subscription`,
      accessNote: `You still subscribe to ${superseded.courseTitle}. ${refunds}`,
    };
  }
  return {
    contentTitle: `${superseded.tierName} subscription to ${superseded.organizationName}`,
    accessNote: `You still subscribe to ${superseded.organizationName}. ${refunds}`,
  };
}

function extractPaymentIntentId(
  ref: string | Stripe.PaymentIntent | null | undefined
): string | undefined {
  if (!ref) return undefined;
  return typeof ref === 'string' ? ref : ref.id;
}

/**
 * A Stripe `created` (seconds) as a Date. A charge's is the payment time: a
 * purchase rebuilt by a refund that beat its checkout is dated by it
 * (Codex-2hxff.68), so its organisation slice goes to the owner at the sale.
 */
function stripeTime(seconds: number | undefined): Date | undefined {
  return seconds !== undefined && Number.isFinite(seconds)
    ? new Date(seconds * 1000)
    : undefined;
}

async function handleChargeRefunded(
  event: Stripe.Event,
  service: PurchaseService,
  subscriptionService: SubscriptionService,
  courseSubscriptionService: CourseSubscriptionService,
  c: Context<StripeWebhookEnv>
): Promise<void> {
  const obs = c.get('obs');
  const charge = event.data.object as Stripe.Charge;
  const paymentIntentId = extractPaymentIntentId(charge.payment_intent);

  // Every refund of the charge, recorded first (owner decision 2026-10-19,
  // "One refunds table"). The event names none: charge.refunds is no longer
  // sent (API 2022-11-15).
  const [latestRefund] = await service.recordChargeRefunds({
    id: charge.id,
    paymentIntentId: paymentIntentId ?? null,
  });

  // The charge's amount is every source's clawback denominator (D1); each
  // refund's share is read from Stripe (Codex-2hxff.8).
  const clawbackCharge = { id: charge.id, amountCents: charge.amount };

  // Subscription-invoice clawback (Codex-13v21): reverse the creator/org
  // transfers made at invoice.payment_succeeded for this charge. Keyed by
  // charge.id + sourceType='subscription', so it no-ops for one-time-purchase
  // charges (those are handled by processRefund below) — calling both never
  // double-reverses. Runs regardless of payment_intent presence because
  // subscription payouts are keyed by charge, not payment_intent.
  await subscriptionService.reverseSubscriptionPayoutsForCharge(clawbackCharge);

  if (!paymentIntentId) {
    obs?.warn('Refund event missing payment_intent', { chargeId: charge.id });
    return;
  }

  // A partial refund keeps access (P-1): processRefund decides from the
  // charge's cumulative amount refunded.
  const refundResult = await service.processRefund(paymentIntentId, {
    charge: clawbackCharge,
    stripeRefundId: latestRefund?.id,
    refundAmountCents: charge.amount_refunded,
    refundReason: latestRefund?.reason ?? undefined,
    paidAt: stripeTime(charge.created),
  });
  obs?.info('Charge refund processed', {
    chargeId: charge.id,
    paymentIntentId,
    amountRefunded: charge.amount_refunded,
    stripeRefundId: latestRefund?.id,
    accessEnded: refundResult?.accessEnded ?? null,
  });

  // Library cache bump is always safe once we have a userId. A purchase's
  // access ends through its entitlement; the streaming block is written for
  // a cancelled subscription below.
  accessEffectsFor(c).invalidateLibrary(refundResult?.userId);

  // After the clawback and the purchase, so a Stripe failure here never holds
  // those up, and before the emails, so a refund that ends nothing of the
  // buyer's says why it was made (Codex-2hxff.15). A transient failure is
  // rethrown before any email: the redelivery sends the one email, worded
  // right. A permanent one still lets the generic email go, then is rethrown.
  // A redelivery repeats only steps that are safe to repeat.
  let subscriptionNote: SubscriptionRefundNote | undefined;
  let endFailure: unknown;
  try {
    subscriptionNote = await endSubscriptionForFullRefund(
      c,
      subscriptionService,
      courseSubscriptionService,
      {
        chargeId: charge.id,
        paymentIntentId,
        amountCents: charge.amount,
        amountRefundedCents: charge.amount_refunded,
      }
    );
  } catch (error) {
    if (isTransientError(error)) throw error;
    endFailure = error;
  }

  await sendRefundEmails(c, service, charge, refundResult, subscriptionNote);
  if (endFailure) throw endFailure;
}

/**
 * A full refund of the current period's subscription payment cancels the
 * subscription and ends access now (owner decision P-4; a partial refund, or
 * one of another payment, leaves it running). It is cancelled at Stripe, then
 * ended here as `customer.subscription.deleted` would end it, cancellation
 * email included: this is its first end, so that event finds it already ended
 * when it lands and sends nothing (Codex-2hxff.15).
 *
 * A tier subscription's streaming block is written too, from the deletion's
 * own result: only when this was the user's current subscription for the
 * org, so an old one ending never blocks the one they still pay for. A
 * course plan's grant is revoked instead, as on deletion: the org-wide block
 * would also stop the subscriber's purchases and tier content (owner
 * decision 2026-10-20).
 *
 * A refund of a second subscription the user already had, or of an old one
 * ended beside the one that stands (owner decision 7), ends nothing of
 * theirs (Codex-2hxff.15): no block, no ending. What its email says is
 * returned.
 *
 * A failure is alerted with what support needs, then rethrown: a transient one
 * makes Stripe redeliver, and a permanent one would otherwise end as a quiet
 * 200 while the customer, refunded in full, goes on being billed.
 */
async function endSubscriptionForFullRefund(
  c: Context<StripeWebhookEnv>,
  subscriptionService: SubscriptionService,
  courseSubscriptionService: CourseSubscriptionService,
  charge: Parameters<SubscriptionService['cancelForFullRefund']>[0]
): Promise<SubscriptionRefundNote | undefined> {
  try {
    const ended = await subscriptionService.cancelForFullRefund(charge);
    if (!ended) return undefined;
    if (ended.duplicate) return { duplicate: ended.duplicate };
    if (ended.superseded) return { superseded: ended.superseded };
    const { subscription, cancelled } = ended;
    if (subscription.kind === 'course') {
      await courseSubscriptionService.handleCourseSubscriptionDeleted(
        cancelled
      );
      accessEffectsFor(c).invalidateLibrary(subscription.userId);
      return undefined;
    }
    const webAppUrl = c.env.WEB_APP_URL;
    if (!webAppUrl) {
      // The cancellation email's links are built from it: without it they
      // point nowhere, or the email is refused.
      c.get('obs')?.error(
        'WEB_APP_URL is not set: the cancellation email after a full refund has no working links',
        { errorId: crypto.randomUUID(), chargeId: charge.chargeId }
      );
    }
    const deleted = await subscriptionService.handleSubscriptionDeleted(
      cancelled,
      webAppUrl || ''
    );
    const effects = accessEffectsFor(c);
    effects.invalidateLibrary(subscription.userId);
    if (deleted?.userId && deleted.orgId) {
      effects.revokeAccess(deleted.userId, deleted.orgId, 'refund');
    }
    if (deleted?.email) {
      sendEmailToWorker(c.env, c.executionCtx, deleted.email);
    }
    return undefined;
  } catch (error) {
    c.get('obs')?.error(
      "A subscription payment was refunded in full but the subscription could not be ended: check it at Stripe and the subscriber's access by hand",
      {
        errorId: crypto.randomUUID(),
        chargeId: charge.chargeId,
        paymentIntentId: charge.paymentIntentId,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    throw error;
  }
}

/**
 * A refund's status changed (`refund.updated`, `refund.failed`). Each change is
 * recorded in `refunds`. A refund is emailed once, usually at
 * `charge.refunded`; one not emailed by then is emailed once it succeeds.
 *
 * - `succeeded`: a refund still pending when `charge.refunded` arrived is
 *   clawed back now (owner decision Q1, 2026-10-19).
 * - `failed`, possibly after it succeeded: Stripe returns the money, but the
 *   customer must still be refunded some other way, so the clawback stands
 *   (one that failed straight from pending is clawed back now). The row is
 *   support's to settle: they refund the customer elsewhere or re-pay the
 *   creators (owner decision 2026-10-19, "Hold it for support").
 * - `canceled`: nothing was paid out and nothing is clawed back.
 */
async function handleRefundUpdated(
  event: Stripe.Event,
  stripe: Stripe,
  service: PurchaseService,
  subscriptionService: SubscriptionService,
  c: Context<StripeWebhookEnv>
): Promise<void> {
  const obs = c.get('obs');
  const refund = event.data.object as Stripe.Refund;
  const chargeId =
    typeof refund.charge === 'string' ? refund.charge : refund.charge?.id;
  if (!chargeId) {
    obs?.warn('Refund event names no charge', { refundId: refund.id });
    return;
  }

  // A refund carries no codex_env tag; its charge does. Production and local
  // development share one Stripe sandbox (Codex-2hxff.5).
  const charge = await stripe.charges.retrieve(chargeId);
  const environment = c.env.ENVIRONMENT || 'development';
  if (isForeignStripeEnvironment(charge.metadata, environment)) {
    obs?.info(`${event.type} ignored: another environment's charge`, {
      refundId: refund.id,
      chargeId,
      objectEnvironment: charge.metadata?.codex_env,
      environment,
    });
    return;
  }
  const paymentIntentId = extractPaymentIntentId(charge.payment_intent);

  // First, so support sees a failure while a clawback step is still retrying.
  const changed = await service.recordRefund({
    stripeRefundId: refund.id,
    stripeChargeId: charge.id,
    paymentIntentId: paymentIntentId ?? null,
    amountCents: refund.amount,
    currency: refund.currency,
    status: refund.status,
    reason: refund.reason ?? null,
    failureReason: refund.failure_reason ?? null,
    stripeCreatedAt: new Date(refund.created * 1000),
  });

  if (refund.status === 'canceled') {
    if (changed) {
      // charge.refunded handled it when it was created, as for any refund.
      obs?.error(
        "A refund was canceled after charge.refunded handled it; check the buyer's access by hand",
        { errorId: crypto.randomUUID(), refundId: refund.id, chargeId }
      );
    }
    return;
  }
  if (refund.status === 'failed' && changed) {
    obs?.error(
      "A refund failed at Stripe: support must refund the customer another way, or re-pay the creators. A subscription whose current period's payment it refunded in full has already been cancelled",
      {
        errorId: crypto.randomUUID(),
        refundId: refund.id,
        chargeId,
        amountCents: refund.amount,
        failureReason: refund.failure_reason ?? null,
      }
    );
  }
  if (refund.status !== 'succeeded' && refund.status !== 'failed') return;

  const clawbackCharge = { id: charge.id, amountCents: charge.amount };
  await subscriptionService.reverseSubscriptionPayoutsForCharge(clawbackCharge);
  const purchase = paymentIntentId
    ? // An already-refunded purchase runs only its clawback.
      await service.processRefund(paymentIntentId, {
        charge: clawbackCharge,
        stripeRefundId: refund.id,
        refundAmountCents: charge.amount_refunded,
        refundReason: refund.reason ?? undefined,
        paidAt: stripeTime(charge.created),
      })
    : undefined;
  // Usually emailed at charge.refunded already; one that was waiting on the
  // customer then is emailed now. A failed refund is never emailed.
  if (refund.status === 'succeeded') {
    await sendRefundEmails(c, service, charge, purchase);
  }
}

/** What a dispute's handling acts through (Codex-2hxff.58). */
export interface DisputeDeps {
  stripe: Stripe;
  purchase: PurchaseService;
  subscription: SubscriptionService;
  /** The worker's `ENVIRONMENT`: another environment's dispute is ignored. */
  environment: string;
  obs: ObservabilityClient | undefined;
  effects: AccessEffects;
}

/** What `processDispute` did with a dispute. */
export type DisputeOutcome =
  /** It names no charge, or the charge is another environment's. */
  | 'ignored'
  /** Recorded only: its outcome was applied already, or Stripe added its status since. */
  | 'recorded'
  /** Recorded, then acted on. */
  | 'acted';

/**
 * A dispute's status changed (`charge.dispute.created`, `.updated`, `.closed`,
 * `.funds_withdrawn`, `.funds_reinstated`; Codex-2hxff.9, design in
 * docs/payments/dispute-record.md). The webhook passes the event's dispute;
 * the hourly reconcile passes one whose events were missed (Codex-2hxff.58).
 */
async function handleDispute(
  event: Stripe.Event,
  stripe: Stripe,
  service: PurchaseService,
  subscriptionService: SubscriptionService,
  c: Context<StripeWebhookEnv>
): Promise<void> {
  await processDispute(
    event.data.object as Stripe.Dispute,
    {
      stripe,
      purchase: service,
      subscription: subscriptionService,
      environment: c.env.ENVIRONMENT || 'development',
      obs: c.get('obs'),
      effects: accessEffectsFor(c),
    },
    event.type
  );
}

/**
 * Record a dispute, forward only, then act on the status the record now has,
 * not the one passed in: Stripe does not deliver events in order. Owner
 * decisions P-2 and Q1–Q3.
 *
 * - **Inquiry** (`warning_*`): no money taken. The open record holds the
 *   sale's unpaid payouts; the buyer keeps access.
 * - **Chargeback open**: the purchase is marked disputed and its access
 *   paused; paid slices are reversed by the dispute's share, unpaid ones held.
 * - **Won**: access restored; what was reversed is paid back by new pending
 *   payouts; held slices released.
 * - **Lost**: the purchase becomes refunded; reversals stand; held slices are
 *   cancelled (`cancelled_by_dispute`).
 * - **Closed inquiry** (`warning_closed`, and `prevented`, which Stripe
 *   defines as a dispute "prevented from becoming a formal chargeback"):
 *   nothing to undo; the held slices are released. A `prevented` dispute that
 *   has a reversal step anyway is alerted (Codex-2hxff.59).
 *
 * A subscription invoice's dispute moves the same money (the clawback acts on
 * both sources), and acts on its subscription (docs/payments/
 * subscription-disputes.md): a chargeback pauses its access, then its billing;
 * a win restores both; a loss ends its access, then cancels it at Stripe.
 * Each Stripe call that changes the subscription comes after the clawback, so
 * a Stripe failure cannot stop the money moving. (Finding the subscription can
 * ask Stripe first, but only for a charge with no payout rows: nothing to
 * claw back.)
 *
 * `trigger` names the caller in the log: the event type, or the reconcile.
 */
export async function processDispute(
  dispute: Stripe.Dispute,
  deps: DisputeDeps,
  trigger: string
): Promise<DisputeOutcome> {
  const { stripe, purchase, subscription, environment, obs, effects } = deps;
  const chargeId =
    typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  if (!chargeId) {
    obs?.warn('Dispute event names no charge', { disputeId: dispute.id });
    return 'ignored';
  }

  // A dispute carries no codex_env tag; its charge does. Production and local
  // development share one Stripe sandbox (Codex-2hxff.5).
  const charge = await stripe.charges.retrieve(chargeId);
  if (isForeignStripeEnvironment(charge.metadata, environment)) {
    obs?.info(`${trigger} ignored: another environment's charge`, {
      disputeId: dispute.id,
      chargeId,
      objectEnvironment: charge.metadata?.codex_env,
      environment,
    });
    return 'ignored';
  }
  const paymentIntentId =
    extractPaymentIntentId(charge.payment_intent) ??
    extractPaymentIntentId(dispute.payment_intent);

  const recorded = await purchase.recordDispute({
    stripeDisputeId: dispute.id,
    stripeChargeId: charge.id,
    paymentIntentId: paymentIntentId ?? null,
    amountCents: dispute.amount,
    currency: dispute.currency,
    status: dispute.status,
    reason: dispute.reason ?? null,
    stripeCreatedAt: new Date(dispute.created * 1000),
  });
  if (!recorded || recorded.outcomeAppliedAt) return 'recorded';

  const status = recorded.status;
  const disputeInput = {
    stripeDisputeId: dispute.id,
    chargeId: charge.id,
    paymentIntentId: paymentIntentId ?? null,
  };
  const clawbackCharge = { id: charge.id, amountCents: charge.amount };
  const clawBack = async () => {
    await subscription.reverseSubscriptionPayoutsForCharge(clawbackCharge);
    if (paymentIntentId) {
      await purchase.clawBackPurchaseCharge(paymentIntentId, clawbackCharge);
    }
  };
  // Every step is idempotent, so a redelivery or the reconcile can run it again.
  const openChargeback = async () => {
    if (paymentIntentId) {
      // Org-scoped purchases revoke access within their org; orgless
      // creator-direct purchases (`purchases.organizationId` nullable,
      // Codex-69t7c) have no org, so the guard below skips org-scoped
      // revocation. The reason says access is paused, not ended, so the
      // content page shows the dispute notice (Codex-2hxff.60).
      const paused = await purchase.processDispute(paymentIntentId, {
        stripeDisputeId: dispute.id,
        disputeReason: dispute.reason ?? undefined,
      });
      effects.invalidateLibrary(paused?.userId);
      // Not when the buyer keeps the item through another purchase (a dispute
      // of a duplicate payment): the block would stop every stream in the
      // org, including the copy they own (Codex-2hxff.14).
      if (paused?.userId && paused.orgId && paused.accessEnded) {
        effects.revokeAccess(paused.userId, paused.orgId, 'purchase_dispute');
      }
    }
    const pausedSubscription = await subscription.pauseForDispute(disputeInput);
    blockSubscriber(effects, pausedSubscription, 'subscription_dispute');
    await clawBack();
    if (pausedSubscription) {
      await subscription.pauseBillingForDispute(pausedSubscription, dispute.id);
    }
  };

  if (isOneOf(status, DISPUTE_CHARGEBACK_OPEN_STATUSES)) {
    try {
      await openChargeback();
    } catch (error) {
      // Nothing marks an open chargeback done, so this is the signal: the
      // buyer may still have access, the subscription may still bill them,
      // and paid slices may not be reversed. A transient failure is
      // redelivered by Stripe, and the hourly reconcile re-runs an open
      // chargeback while its events are in its window (Codex-2hxff.58).
      obs?.error(
        'A chargeback was recorded but opening it failed: access may not be paused, billing may not be paused, or paid slices may not be clawed back. It is retried; if this repeats, check them by hand',
        {
          errorId: crypto.randomUUID(),
          disputeId: dispute.id,
          chargeId,
          purchaseId: recorded.purchaseId,
          subscriptionId: recorded.subscriptionId,
          courseSubscriptionId: recorded.courseSubscriptionId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
    obs?.info('Chargeback opened: access paused, paid slices clawed back', {
      disputeId: dispute.id,
      chargeId,
      status,
      amountCents: recorded.amountCents,
    });
    return 'acted';
  }

  if (status === 'won') {
    if (paymentIntentId) {
      const restored = await purchase.restoreDisputedPurchase(paymentIntentId);
      effects.invalidateLibrary(restored?.userId);
      if (restored?.userId && restored.orgId) {
        effects.clearRevocation(restored.userId, restored.orgId);
      }
    }
    // Before the outcome is marked: a Stripe failure here is redelivered.
    const restoredSubscription =
      await subscription.restoreAfterDispute(disputeInput);
    if (restoredSubscription?.restored) {
      const { userId, organizationId } = restoredSubscription.subscription;
      effects.invalidateLibrary(userId);
      if (organizationId) effects.clearRevocation(userId, organizationId);
    }
    await purchase.settleWonDispute(dispute.id);
    obs?.info('Dispute won: access restored, the clawback paid back', {
      disputeId: dispute.id,
      chargeId,
    });
    return 'acted';
  }

  if (status === 'lost') {
    if (paymentIntentId) {
      const ended = await purchase.processLostDispute(
        paymentIntentId,
        recorded.amountCents
      );
      effects.invalidateLibrary(ended?.userId);
      // Written when it opened, unless it opened already lost: again here.
      // Not when the buyer keeps the item through another purchase.
      if (ended?.userId && ended.orgId && ended.accessEnded) {
        effects.revokeAccess(ended.userId, ended.orgId, 'refund');
      }
    }
    // A subscription's access ends now; it is cancelled at Stripe after the
    // clawback, so the cancel cannot keep the held slices from being cut.
    // `customer.subscription.deleted` then overwrites the reason with
    // `'subscription_deleted'`: the later reason wins.
    const endedSubscription = await subscription.pauseForDispute(disputeInput);
    blockSubscriber(effects, endedSubscription, 'refund');
    // The clawback now cancels or reduces the held slices like a refund.
    await clawBack();
    if (endedSubscription) {
      await subscription.cancelForLostDispute(disputeInput);
    }
    await purchase.markDisputeOutcomeApplied(dispute.id);
    obs?.info('Dispute lost: purchase refunded, held slices cancelled', {
      disputeId: dispute.id,
      chargeId,
    });
    return 'acted';
  }

  // An inquiry, open or closed: no money moved. Its record holds or releases
  // the sale's unpaid payouts.
  if (isOneOf(status, DISPUTE_CLOSED_STATUSES)) {
    if (status === 'prevented') {
      await alertPreventedAfterClawback(purchase, obs, {
        disputeId: dispute.id,
        chargeId,
        purchaseId: recorded.purchaseId,
        subscriptionId: recorded.subscriptionId,
        courseSubscriptionId: recorded.courseSubscriptionId,
      });
    }
    await purchase.markDisputeOutcomeApplied(dispute.id);
  }
  obs?.info('Dispute inquiry recorded', {
    disputeId: dispute.id,
    chargeId,
    status,
  });
  return 'acted';
}

/**
 * A `prevented` dispute never became a chargeback, so nothing should have
 * been clawed back for it, and nothing is paid back (Codex-2hxff.59 item 5).
 * Stripe's own definition rules it out. A reversal step means the chargeback
 * handling ran too, so its money stays with the platform, and the buyer's
 * access and the subscription's billing may still be paused, until a person
 * settles them.
 */
async function alertPreventedAfterClawback(
  purchase: PurchaseService,
  obs: ObservabilityClient | undefined,
  ids: {
    disputeId: string;
    chargeId: string;
    purchaseId: string | null;
    subscriptionId: string | null;
    courseSubscriptionId: string | null;
  }
): Promise<void> {
  const steps = await purchase.countDisputeReversalSteps(ids.disputeId);
  if (steps === 0) return;
  obs?.error(
    "A dispute ended 'prevented' after money was clawed back for it: its reversals stand and nothing pays them back, and the buyer's access and the subscription's billing may still be paused. Re-pay the creators and restore access and billing by hand",
    { errorId: crypto.randomUUID(), ...ids, reversalSteps: steps }
  );
}

/**
 * A subscription a dispute paused or ended: its library caches cleared, and
 * the streaming block written for its organisation, with `reason`
 * (`'subscription_dispute'` while paused, `'refund'` once lost).
 */
function blockSubscriber(
  effects: AccessEffects,
  subscription: { userId: string; organizationId: string | null } | undefined,
  reason: PaymentBlockReason
): void {
  if (!subscription) return;
  effects.invalidateLibrary(subscription.userId);
  if (subscription.organizationId) {
    effects.revokeAccess(
      subscription.userId,
      subscription.organizationId,
      reason
    );
  }
}

function isOneOf(status: string, statuses: readonly string[]): boolean {
  return statuses.includes(status);
}

export async function handlePaymentWebhook(
  event: Stripe.Event,
  stripe: Stripe,
  c: Context<StripeWebhookEnv>
) {
  const obs = c.get('obs');

  // The registry's services, as routes get them (Codex-2hxff.54).
  const { services, release } = await createWebhookServices(
    c.env,
    c.executionCtx,
    { obs, stripe }
  );

  try {
    const service = services.purchase;
    const subscriptionService = services.subscription;

    switch (event.type) {
      case STRIPE_EVENTS.CHARGE_REFUNDED:
        await handleChargeRefunded(
          event,
          service,
          subscriptionService,
          services.courseSubscription,
          c
        );
        break;

      case STRIPE_EVENTS.REFUND_UPDATED:
      case STRIPE_EVENTS.REFUND_FAILED:
        await handleRefundUpdated(
          event,
          stripe,
          service,
          subscriptionService,
          c
        );
        break;

      case STRIPE_EVENTS.CHARGE_DISPUTE_CREATED:
      case STRIPE_EVENTS.CHARGE_DISPUTE_UPDATED:
      case STRIPE_EVENTS.CHARGE_DISPUTE_CLOSED:
      case STRIPE_EVENTS.CHARGE_DISPUTE_FUNDS_WITHDRAWN:
      case STRIPE_EVENTS.CHARGE_DISPUTE_FUNDS_REINSTATED:
        await handleDispute(event, stripe, service, subscriptionService, c);
        break;

      default:
        obs?.info('Unhandled payment webhook event', { type: event.type });
    }
  } finally {
    release();
  }
}

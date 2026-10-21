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
 *   (Codex-sxu5a, Codex-2hxff.9)
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

import { AccessRevocation } from '@codex/access';
import { VersionedCache } from '@codex/cache';
import {
  DISPUTE_CHARGEBACK_OPEN_STATUSES,
  DISPUTE_CLOSED_STATUSES,
  isForeignStripeEnvironment,
  STRIPE_EVENTS,
} from '@codex/constants';
import type { PurchaseService } from '@codex/purchase';
import {
  type CourseSubscriptionService,
  invalidateForUser,
  type SubscriptionService,
} from '@codex/subscription';
import { createWebhookServices, sendEmailToWorker } from '@codex/worker-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import type { StripeWebhookEnv } from '../types';

/**
 * Fire-and-forget bump of the user's library collection version. Called
 * after a successful refund or dispute so the next library fetch omits
 * the newly-revoked content.
 *
 * Guards: no-op without CACHE_KV (dev stub / misconfigured env) or userId.
 * Errors are caught on both the synchronous `waitUntil` path (via
 * `invalidateForUser`'s internal wiring) and the defensive try/catch
 * around the helper itself — a KV hiccup must never surface as a 500.
 */
function invalidateLibrary(
  c: Context<StripeWebhookEnv>,
  userId: string | undefined
): void {
  if (!userId || !c.env.CACHE_KV) return;

  const obs = c.get('obs');
  // `waitUntil` goes into the CONFIG, not only to `invalidateForUser` below.
  // The helper's copy sinks the invalidation; only the instance's own copy can
  // sink a data-slot put from `get`/`getWithResult`. Nothing reads through this
  // cache today, which is exactly how Codex-03uh3 stayed invisible next door.
  const cache = new VersionedCache({
    kv: c.env.CACHE_KV,
    waitUntil: (promise) => c.executionCtx.waitUntil(promise),
    obs,
  });
  try {
    invalidateForUser(
      cache,
      c.executionCtx.waitUntil.bind(c.executionCtx),
      { userId, reason: 'refund' },
      obs ? { logger: obs } : undefined
    );
  } catch (error) {
    obs?.warn('payment-webhook: invalidateForUser threw synchronously', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Fire-and-forget write of a per-user, per-org KV revocation key. Only
 * called when the Stripe event reduces access AND the caller has both
 * userId + orgId — one-time purchase refunds return `{ userId }` only
 * and deliberately skip this path (library invalidation above is
 * sufficient because `processRefund` soft-deletes `contentAccess`).
 *
 * Mirror of `revokeAccess` in `subscription-webhook.ts` — kept local here
 * to avoid a cross-handler import while the helper surface stabilises.
 * Errors are swallowed inside the `waitUntil` promise so a KV failure
 * never surfaces as a webhook 500 (Stripe would retry unnecessarily).
 */
function revokeAccess(
  c: Context<StripeWebhookEnv>,
  userId: string,
  orgId: string
): void {
  if (!c.env.CACHE_KV) return;

  const obs = c.get('obs');
  const revocation = new AccessRevocation(c.env.CACHE_KV, obs);

  try {
    c.executionCtx.waitUntil(
      revocation.revoke(userId, orgId, 'refund').catch((error) => {
        obs?.warn('payment-webhook: AccessRevocation.revoke failed', {
          userId,
          orgId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
    );
  } catch (error) {
    obs?.warn('payment-webhook: waitUntil threw synchronously', {
      userId,
      orgId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Fire-and-forget clear of the per-user, per-org KV revocation key, once a won
 * dispute has restored the access the chargeback paused (Codex-2hxff.9). The
 * stream endpoint still checks access before signing, so over-clearing never
 * grants anything; it only lets the restored access stream again before the
 * key's TTL. Mirror of `clearAccess` in `subscription-webhook.ts`.
 */
function clearRevocation(
  c: Context<StripeWebhookEnv>,
  userId: string,
  orgId: string
): void {
  if (!c.env.CACHE_KV) return;

  const obs = c.get('obs');
  const revocation = new AccessRevocation(c.env.CACHE_KV, obs);

  try {
    c.executionCtx.waitUntil(
      revocation.clear(userId, orgId).catch((error) => {
        obs?.warn('payment-webhook: AccessRevocation.clear failed', {
          userId,
          orgId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
    );
  } catch (error) {
    obs?.warn('payment-webhook: waitUntil threw synchronously (clear)', {
      userId,
      orgId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Email the payer about each refund of the charge not yet emailed, once per
 * refund, with that refund's amount (owner decision 2026-10-19, "One per
 * refund"). `claimRefundEmails` marks them first, so a redelivery sends
 * nothing. For a purchase, the email says whether the buyer keeps access
 * (P-1); a subscription charge's says neither.
 */
async function sendRefundEmails(
  c: Context<StripeWebhookEnv>,
  service: PurchaseService,
  charge: Stripe.Charge,
  purchase: { accessEnded: boolean } | undefined
): Promise<void> {
  const to = charge.billing_details?.email || charge.receipt_email;
  if (!to) return;

  const claimed = await service.claimRefundEmails(charge.id);
  const contentTitle = charge.metadata?.contentTitle || 'Content';
  const accessNote = !purchase
    ? ''
    : purchase.accessEnded
      ? `Your access to ${contentTitle} has ended.`
      : `You keep access to ${contentTitle}.`;
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

function extractPaymentIntentId(
  ref: string | Stripe.PaymentIntent | null | undefined
): string | undefined {
  if (!ref) return undefined;
  return typeof ref === 'string' ? ref : ref.id;
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
  invalidateLibrary(c, refundResult?.userId);

  await sendRefundEmails(c, service, charge, refundResult);

  // Last, so a Stripe failure here never holds up the clawback, the purchase
  // or the emails; a redelivery repeats only steps that are safe to repeat.
  await endSubscriptionForFullRefund(
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
}

/**
 * A full refund of the current period's subscription payment cancels the
 * subscription and ends access now (owner decision P-4; a partial refund, or
 * one of another payment, leaves it running). It is cancelled at Stripe, then
 * ended here as `customer.subscription.deleted` ends it — that event
 * re-applies the same state when it lands, and sends the cancellation email.
 *
 * A tier subscription's streaming block is written too. A course plan's grant
 * is revoked instead, as on deletion: the org-wide block would also stop the
 * subscriber's purchases and tier content (owner decision 2026-10-20).
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
): Promise<void> {
  try {
    const ended = await subscriptionService.cancelForFullRefund(charge);
    if (!ended) return;
    const { subscription, cancelled } = ended;
    if (subscription.kind === 'course') {
      await courseSubscriptionService.handleCourseSubscriptionDeleted(
        cancelled
      );
      invalidateLibrary(c, subscription.userId);
      return;
    }
    await subscriptionService.handleSubscriptionDeleted(cancelled);
    invalidateLibrary(c, subscription.userId);
    if (subscription.organizationId) {
      revokeAccess(c, subscription.userId, subscription.organizationId);
    }
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
      })
    : undefined;
  // Usually emailed at charge.refunded already; one that was waiting on the
  // customer then is emailed now. A failed refund is never emailed.
  if (refund.status === 'succeeded') {
    await sendRefundEmails(c, service, charge, purchase);
  }
}

/**
 * A dispute's status changed (`charge.dispute.created`, `.updated`, `.closed`,
 * `.funds_withdrawn`, `.funds_reinstated`; Codex-2hxff.9, design in
 * docs/payments/dispute-record.md). Each event records the dispute, forward
 * only, then acts on the status the record now has, not the event's: Stripe
 * does not deliver events in order. Owner decisions P-2 and Q1–Q3.
 *
 * - **Inquiry** (`warning_*`): no money taken. The open record holds the
 *   sale's unpaid payouts; the buyer keeps access.
 * - **Chargeback open**: the purchase is marked disputed and its access
 *   paused; paid slices are reversed by the dispute's share, unpaid ones held.
 * - **Won**: access restored; what was reversed is paid back by new pending
 *   payouts; held slices released.
 * - **Lost**: the purchase becomes refunded; reversals stand; held slices are
 *   cancelled (`cancelled_by_dispute`).
 *
 * A subscription invoice's dispute moves the same money (the clawback acts on
 * both sources), and acts on its subscription (docs/payments/
 * subscription-disputes.md): a chargeback pauses its access, then its billing;
 * a win restores both; a loss ends its access, then cancels it at Stripe.
 * Each Stripe call that changes the subscription comes after the clawback, so
 * a Stripe failure cannot stop the money moving. (Finding the subscription can
 * ask Stripe first, but only for a charge with no payout rows: nothing to
 * claw back.)
 */
async function handleDispute(
  event: Stripe.Event,
  stripe: Stripe,
  service: PurchaseService,
  subscriptionService: SubscriptionService,
  c: Context<StripeWebhookEnv>
): Promise<void> {
  const obs = c.get('obs');
  const dispute = event.data.object as Stripe.Dispute;
  const chargeId =
    typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  if (!chargeId) {
    obs?.warn('Dispute event names no charge', { disputeId: dispute.id });
    return;
  }

  // A dispute carries no codex_env tag; its charge does. Production and local
  // development share one Stripe sandbox (Codex-2hxff.5).
  const charge = await stripe.charges.retrieve(chargeId);
  const environment = c.env.ENVIRONMENT || 'development';
  if (isForeignStripeEnvironment(charge.metadata, environment)) {
    obs?.info(`${event.type} ignored: another environment's charge`, {
      disputeId: dispute.id,
      chargeId,
      objectEnvironment: charge.metadata?.codex_env,
      environment,
    });
    return;
  }
  const paymentIntentId =
    extractPaymentIntentId(charge.payment_intent) ??
    extractPaymentIntentId(dispute.payment_intent);

  const recorded = await service.recordDispute({
    stripeDisputeId: dispute.id,
    stripeChargeId: charge.id,
    paymentIntentId: paymentIntentId ?? null,
    amountCents: dispute.amount,
    currency: dispute.currency,
    status: dispute.status,
    reason: dispute.reason ?? null,
    stripeCreatedAt: new Date(dispute.created * 1000),
  });
  if (!recorded || recorded.outcomeAppliedAt) return;

  const status = recorded.status;
  const disputeInput = {
    stripeDisputeId: dispute.id,
    chargeId: charge.id,
    paymentIntentId: paymentIntentId ?? null,
  };
  const clawbackCharge = { id: charge.id, amountCents: charge.amount };
  const clawBack = async () => {
    await subscriptionService.reverseSubscriptionPayoutsForCharge(
      clawbackCharge
    );
    if (paymentIntentId) {
      await service.clawBackPurchaseCharge(paymentIntentId, clawbackCharge);
    }
  };

  if (isOneOf(status, DISPUTE_CHARGEBACK_OPEN_STATUSES)) {
    if (paymentIntentId) {
      // Org-scoped purchases revoke access within their org; orgless
      // creator-direct purchases (`purchases.organizationId` nullable,
      // Codex-69t7c) have no org, so the guard below skips org-scoped
      // revocation. Revocation reason reuses 'refund' because the
      // AccessRevocation reason enum is observability-only and disputes are
      // the same access-reducing class.
      const paused = await service.processDispute(paymentIntentId, {
        stripeDisputeId: dispute.id,
        disputeReason: dispute.reason ?? undefined,
      });
      invalidateLibrary(c, paused?.userId);
      if (paused?.userId && paused.orgId) {
        revokeAccess(c, paused.userId, paused.orgId);
      }
    }
    const pausedSubscription =
      await subscriptionService.pauseForDispute(disputeInput);
    blockSubscriber(c, pausedSubscription);
    await clawBack();
    if (pausedSubscription) {
      await subscriptionService.pauseBillingForDispute(
        pausedSubscription,
        dispute.id
      );
    }
    obs?.info('Chargeback opened: access paused, paid slices clawed back', {
      disputeId: dispute.id,
      chargeId,
      status,
      amountCents: recorded.amountCents,
    });
    return;
  }

  if (status === 'won') {
    if (paymentIntentId) {
      const restored = await service.restoreDisputedPurchase(paymentIntentId);
      invalidateLibrary(c, restored?.userId);
      if (restored?.userId && restored.orgId) {
        clearRevocation(c, restored.userId, restored.orgId);
      }
    }
    // Before the outcome is marked: a Stripe failure here is redelivered.
    const subscription =
      await subscriptionService.restoreAfterDispute(disputeInput);
    if (subscription?.restored) {
      const { userId, organizationId } = subscription.subscription;
      invalidateLibrary(c, userId);
      if (organizationId) clearRevocation(c, userId, organizationId);
    }
    await service.settleWonDispute(dispute.id);
    obs?.info('Dispute won: access restored, the clawback paid back', {
      disputeId: dispute.id,
      chargeId,
    });
    return;
  }

  if (status === 'lost') {
    if (paymentIntentId) {
      const ended = await service.processLostDispute(
        paymentIntentId,
        recorded.amountCents
      );
      invalidateLibrary(c, ended?.userId);
      // Written when it opened, unless it opened already lost: again here.
      if (ended?.userId && ended.orgId) {
        revokeAccess(c, ended.userId, ended.orgId);
      }
    }
    // A subscription's access ends now; it is cancelled at Stripe after the
    // clawback, so the cancel cannot keep the held slices from being cut.
    const endedSubscription =
      await subscriptionService.pauseForDispute(disputeInput);
    blockSubscriber(c, endedSubscription);
    // The clawback now cancels or reduces the held slices like a refund.
    await clawBack();
    if (endedSubscription) {
      await subscriptionService.cancelForLostDispute(disputeInput);
    }
    await service.markDisputeOutcomeApplied(dispute.id);
    obs?.info('Dispute lost: purchase refunded, held slices cancelled', {
      disputeId: dispute.id,
      chargeId,
    });
    return;
  }

  // An inquiry, open or closed: no money moved. Its record holds or releases
  // the sale's unpaid payouts.
  if (isOneOf(status, DISPUTE_CLOSED_STATUSES)) {
    await service.markDisputeOutcomeApplied(dispute.id);
  }
  obs?.info('Dispute inquiry recorded', {
    disputeId: dispute.id,
    chargeId,
    status,
  });
}

/**
 * A subscription a dispute paused or ended: its library caches cleared, and
 * the streaming block written for its organisation.
 */
function blockSubscriber(
  c: Context<StripeWebhookEnv>,
  subscription: { userId: string; organizationId: string | null } | undefined
): void {
  if (!subscription) return;
  invalidateLibrary(c, subscription.userId);
  if (subscription.organizationId) {
    revokeAccess(c, subscription.userId, subscription.organizationId);
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

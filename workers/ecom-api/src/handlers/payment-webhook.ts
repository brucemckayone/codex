/**
 * Payment Webhook Handlers
 *
 * Processes Stripe payment lifecycle events:
 * - charge.refunded → record each refund; a full refund ends access, a
 *   partial one keeps it (P-1); email each refund once
 * - refund.updated, refund.failed → record the refund's status; claw back a
 *   refund that was pending at charge.refunded; a failed one is support's
 * - charge.dispute.created → mark purchase disputed, revoke access (Codex-sxu5a)
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
import { isForeignStripeEnvironment, STRIPE_EVENTS } from '@codex/constants';
import type { PurchaseService } from '@codex/purchase';
import {
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

  // Library cache bump is always safe once we have a userId. Revocation
  // is org-scoped and only fires when the refund is subscription-linked
  // (service returns `{ userId, orgId }`). This conditional is wired ahead
  // of time so that when subscription-linked refunds start returning orgId
  // (see Codex-sxu5a for dispute work), revocation fires without another
  // round of plumbing.
  invalidateLibrary(c, refundResult?.userId);
  const result = refundResult as { userId: string; orgId?: string } | undefined;
  if (result?.userId && result.orgId) {
    revokeAccess(c, result.userId, result.orgId);
  }

  await sendRefundEmails(c, service, charge, refundResult);
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
      'A refund failed at Stripe: support must refund the customer another way, or re-pay the creators',
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

async function handleChargeDisputeCreated(
  event: Stripe.Event,
  service: PurchaseService,
  c: Context<StripeWebhookEnv>
): Promise<void> {
  // charge.dispute.created — the user has filed a chargeback. For access
  // purposes we treat this identically to a refund: revoke content access,
  // mark the purchase `disputedAt`, invalidate the library cache, and
  // write an AccessRevocation KV entry so any in-flight presigned R2 URLs
  // expire within the TTL window.
  //
  // `status` on the purchase is NOT mutated (still 'completed' — the
  // actual refund, if the dispute is lost, fires a separate
  // `charge.refunded` event that will move the status). The
  // `check_purchase_status` DB CHECK constraint only allows
  // ('pending', 'completed', 'refunded', 'failed') so we cannot add a new
  // 'disputed' status without breaking existing data; the `disputedAt`
  // column is the authoritative signal instead.
  const obs = c.get('obs');
  const dispute = event.data.object as Stripe.Dispute;
  const paymentIntentId = extractPaymentIntentId(dispute.payment_intent);

  if (!paymentIntentId) {
    obs?.warn('Dispute event missing payment_intent', {
      disputeId: dispute.id,
    });
    return;
  }

  const disputeResult = await service.processDispute(paymentIntentId, {
    stripeDisputeId: dispute.id,
    disputeReason: dispute.reason ?? undefined,
  });
  obs?.info('Charge dispute processed', {
    disputeId: dispute.id,
    paymentIntentId,
    reason: dispute.reason,
    amount: dispute.amount,
  });

  // Org-scoped purchases revoke access within their org; orgless
  // creator-direct purchases (`purchases.organizationId` nullable, Codex-69t7c)
  // have no org, so `orgId` may be null — the guard below skips org-scoped
  // revocation in that case. Revocation reason reuses 'refund' because the
  // AccessRevocation reason enum is observability-only and disputes are the
  // same access-reducing class.
  invalidateLibrary(c, disputeResult?.userId);
  if (disputeResult?.userId && disputeResult.orgId) {
    revokeAccess(c, disputeResult.userId, disputeResult.orgId);
  }

  // Admin notification email is intentionally NOT sent from this handler —
  // deferred to a follow-up task for a dedicated `dispute-opened` template
  // with the right operational fields (dispute.evidence_due_by,
  // dispute.amount, recommended next-steps) rather than reusing the refund
  // template.
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
        await handleChargeRefunded(event, service, subscriptionService, c);
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
        await handleChargeDisputeCreated(event, service, c);
        break;

      default:
        obs?.info('Unhandled payment webhook event', { type: event.type });
    }
  } finally {
    release();
  }
}

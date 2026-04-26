/**
 * Payment Webhook Handlers
 *
 * Processes Stripe payment lifecycle events:
 * - charge.refunded → update purchase status, revoke content access
 * - charge.dispute.created → mark purchase disputed, revoke access (Codex-sxu5a)
 *
 * Cache invalidation uses the shared `invalidateForUser` helper from
 * `@codex/subscription` so a refund/dispute bumps COLLECTION_USER_LIBRARY
 * for the affected user (their newly-revoked content must disappear from the
 * library view on the next fetch). One-time purchases are content-scoped,
 * not org-scoped, so COLLECTION_USER_SUBSCRIPTION is not touched here.
 * See docs/subscription-cache-audit/phase-1-p0.md and phase-2-followup.md.
 *
 * Security:
 * - Signature already verified by verifyStripeSignature middleware
 * - Idempotent: processRefund / processDispute check state before mutating
 */

import { AccessRevocation } from '@codex/access';
import { VersionedCache } from '@codex/cache';
import { STRIPE_EVENTS } from '@codex/constants';
import { PurchaseService } from '@codex/purchase';
import { invalidateForUser } from '@codex/subscription';
import { createWebhookDbClient, sendEmailToWorker } from '@codex/worker-utils';
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
  const cache = new VersionedCache({ kv: c.env.CACHE_KV });
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
 * Fire-and-forget `refund-processed` email to the payer. The branch runs
 * regardless of the service result — we always acknowledge a refund to the
 * payer; whether the DB side found a matching purchase row is a separate
 * concern (and the service logs that case).
 */
function sendRefundEmail(
  c: Context<StripeWebhookEnv>,
  charge: Stripe.Charge
): void {
  const to = charge.billing_details?.email || charge.receipt_email;
  if (!to) return;

  sendEmailToWorker(c.env, c.executionCtx, {
    to,
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

function extractPaymentIntentId(
  ref: string | Stripe.PaymentIntent | null | undefined
): string | undefined {
  if (!ref) return undefined;
  return typeof ref === 'string' ? ref : ref.id;
}

async function handleChargeRefunded(
  event: Stripe.Event,
  service: PurchaseService,
  c: Context<StripeWebhookEnv>
): Promise<void> {
  const obs = c.get('obs');
  const charge = event.data.object as Stripe.Charge;
  const paymentIntentId = extractPaymentIntentId(charge.payment_intent);

  if (!paymentIntentId) {
    obs?.warn('Refund event missing payment_intent', { chargeId: charge.id });
    return;
  }

  const latestRefund = charge.refunds?.data?.[0];
  const refundResult = await service.processRefund(paymentIntentId, {
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

  sendRefundEmail(c, charge);
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

  // Unlike one-time-purchase refunds, purchases are ALWAYS org-scoped
  // (`purchases.organizationId` is NOT NULL), so `processDispute` always
  // returns `orgId` when a matching purchase exists. Revocation reason
  // reuses 'refund' because the AccessRevocation reason enum is
  // observability-only and disputes are the same access-reducing class.
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

  const { db, cleanup } = createWebhookDbClient(c.env);

  try {
    const service = new PurchaseService(
      { db, environment: c.env.ENVIRONMENT || 'development' },
      stripe
    );

    switch (event.type) {
      case STRIPE_EVENTS.CHARGE_REFUNDED:
        await handleChargeRefunded(event, service, c);
        break;

      case STRIPE_EVENTS.CHARGE_DISPUTE_CREATED:
        await handleChargeDisputeCreated(event, service, c);
        break;

      default:
        obs?.info('Unhandled payment webhook event', { type: event.type });
    }
  } finally {
    await cleanup();
  }
}

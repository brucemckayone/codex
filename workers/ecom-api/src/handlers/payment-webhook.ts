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
import { createPerRequestDbClient } from '@codex/database';
import { PurchaseService } from '@codex/purchase';
import { invalidateForUser } from '@codex/subscription';
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

        // Bump the user's library cache so the refunded content disappears
        // from their library on the next fetch. Fire-and-forget via waitUntil.
        // No orgId: one-time purchases don't map to a subscription cache.
        if (refundResult?.userId && c.env.CACHE_KV) {
          const cache = new VersionedCache({ kv: c.env.CACHE_KV });
          try {
            invalidateForUser(
              cache,
              c.executionCtx.waitUntil.bind(c.executionCtx),
              {
                userId: refundResult.userId,
                reason: 'refund',
              },
              obs ? { logger: obs } : undefined
            );
          } catch (error) {
            obs?.warn(
              'payment-webhook: invalidateForUser threw synchronously',
              {
                userId: refundResult.userId,
                error: error instanceof Error ? error.message : String(error),
              }
            );
          }

          // Revocation list write — only fires when the refund is
          // subscription-linked AND both userId + orgId are present.
          //
          // One-time purchase refunds (the common case today) return
          // `{ userId }` WITHOUT `orgId`: revocation is an org-scoped
          // per-user block list and does not model content-level access,
          // so we deliberately skip it for those. The library cache bump
          // above is sufficient — the next library fetch will omit the
          // refunded content, and access checks for that specific content
          // already soft-delete via `contentAccess` in `processRefund`.
          //
          // This conditional is wired ahead of time so that when
          // subscription-linked refunds start returning `orgId` (see
          // Codex-sxu5a for dispute work), the revocation fires without
          // needing another round of plumbing.
          const result = refundResult as { userId: string; orgId?: string };
          if (result.orgId) {
            const revocation = new AccessRevocation(c.env.CACHE_KV, obs);
            const userId = result.userId;
            const orgId = result.orgId;
            try {
              c.executionCtx.waitUntil(
                revocation.revoke(userId, orgId, 'refund').catch((error) => {
                  obs?.warn('payment-webhook: AccessRevocation.revoke failed', {
                    userId,
                    orgId,
                    error:
                      error instanceof Error ? error.message : String(error),
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
        }

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

      case STRIPE_EVENTS.CHARGE_DISPUTE_CREATED: {
        // charge.dispute.created — the user has filed a chargeback. For
        // access purposes we treat this identically to a refund: revoke
        // content access, mark the purchase `disputedAt`, invalidate the
        // library cache, and write an AccessRevocation KV entry so any
        // in-flight presigned R2 URLs expire within the TTL window.
        //
        // `status` on the purchase is NOT mutated (still 'completed' —
        // the actual refund, if the dispute is lost, fires a separate
        // `charge.refunded` event that will move the status). The
        // `check_purchase_status` DB CHECK constraint only allows
        // ('pending', 'completed', 'refunded', 'failed') so we cannot add
        // a new 'disputed' status without breaking existing data; the
        // `disputedAt` column is the authoritative signal instead.
        const dispute = event.data.object as Stripe.Dispute;
        const paymentIntentId =
          typeof dispute.payment_intent === 'string'
            ? dispute.payment_intent
            : dispute.payment_intent?.id;

        if (!paymentIntentId) {
          obs?.warn('Dispute event missing payment_intent', {
            disputeId: dispute.id,
          });
          break;
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

        if (disputeResult?.userId && c.env.CACHE_KV) {
          const cache = new VersionedCache({ kv: c.env.CACHE_KV });
          try {
            invalidateForUser(
              cache,
              c.executionCtx.waitUntil.bind(c.executionCtx),
              {
                userId: disputeResult.userId,
                reason: 'refund',
              },
              obs ? { logger: obs } : undefined
            );
          } catch (error) {
            obs?.warn(
              'payment-webhook: dispute invalidateForUser threw synchronously',
              {
                userId: disputeResult.userId,
                error: error instanceof Error ? error.message : String(error),
              }
            );
          }

          // Unlike one-time-purchase refunds, purchases are ALWAYS
          // org-scoped (the `purchases.organizationId` column is NOT NULL),
          // so `processDispute` always returns `orgId` when a matching
          // purchase exists. Write the revocation with reason='refund' —
          // the AccessRevocation reason enum intentionally doesn't model
          // 'dispute' because the enum is observability-only and disputes
          // are the same access-reducing class as refunds.
          const revocation = new AccessRevocation(c.env.CACHE_KV, obs);
          const userId = disputeResult.userId;
          const orgId = disputeResult.orgId;
          try {
            c.executionCtx.waitUntil(
              revocation.revoke(userId, orgId, 'refund').catch((error) => {
                obs?.warn(
                  'payment-webhook: dispute AccessRevocation.revoke failed',
                  {
                    userId,
                    orgId,
                    error:
                      error instanceof Error ? error.message : String(error),
                  }
                );
              })
            );
          } catch (error) {
            obs?.warn(
              'payment-webhook: dispute waitUntil threw synchronously',
              {
                userId,
                orgId,
                error: error instanceof Error ? error.message : String(error),
              }
            );
          }
        }

        // Admin notification email is intentionally NOT sent from this
        // handler — the bead defers that to a follow-up task so we can
        // ship a dedicated `dispute-opened` template with the right
        // operational fields (dispute.evidence_due_by, dispute.amount,
        // recommended next-steps) rather than reusing the refund template.
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

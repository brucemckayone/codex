/**
 * Refunding a payment the platform decides to give back (architecture C5,
 * docs/payments/architecture.md §5). Its first caller is a duplicate payment
 * for an item the buyer already owns (Codex-2hxff.14, owner decision "Block,
 * then refund").
 *
 * This only asks Stripe for the refund. What a refund does to the purchase,
 * its payout slices and the buyer's email happens when Stripe's
 * `charge.refunded` arrives, exactly as for a refund made in the dashboard, so
 * there is one path for both.
 */

import { stripeEnvMetadata } from '@codex/constants';
import type Stripe from 'stripe';

export interface IssueRefundInput {
  paymentIntentId: string;
  /** Stripe's own reason enum; `duplicate` for a second payment. */
  reason: Stripe.RefundCreateParams.Reason;
  /**
   * Stable per refund decision, so a retried webhook asks Stripe once. Stripe
   * forgets a key after 24 hours; a later retry is then answered by
   * `charge_already_refunded`, which is treated as done.
   */
  idempotencyKey: string;
  /** Tags the refund with `codex_env`, so its own events pass the filter. */
  environment: string;
}

export interface IssueRefundResult {
  /** The refund Stripe made, or null when the charge was already refunded. */
  refundId: string | null;
  alreadyRefunded: boolean;
}

/**
 * Refund a PaymentIntent's charge in full. A charge already refunded in full
 * is success, not an error: whichever refund got there first did the job.
 * Any other failure is thrown for the caller to retry.
 */
export async function issueRefund(
  stripe: Stripe,
  input: IssueRefundInput
): Promise<IssueRefundResult> {
  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: input.paymentIntentId,
        reason: input.reason,
        metadata: stripeEnvMetadata(input.environment),
      },
      { idempotencyKey: input.idempotencyKey }
    );
    return { refundId: refund.id, alreadyRefunded: false };
  } catch (error) {
    if (
      (error as { code?: unknown } | null)?.code === 'charge_already_refunded'
    ) {
      return { refundId: null, alreadyRefunded: true };
    }
    throw error;
  }
}

/**
 * Refunding a payment the platform decides to give back (architecture C5,
 * docs/payments/architecture.md §5). Its first caller is a duplicate payment
 * for an item the buyer already owns (Codex-2hxff.14, owner decision "Block,
 * then refund").
 *
 * This only asks Stripe for the refund. What a refund does to the purchase,
 * its payout slices and the buyer's email happens when Stripe's
 * `charge.refunded` arrives, exactly as for a refund made in the dashboard, so
 * there is one path for both. Support's refunds (Codex-2hxff.28) take the same
 * path, in part or in full, inside `refundWindow`.
 */

import { REFUND_WINDOW_DAYS, stripeEnvMetadata } from '@codex/constants';
import type Stripe from 'stripe';

/**
 * What to refund: a one-off checkout's PaymentIntent, or a subscription
 * invoice's charge (Codex-2hxff.15), which is what an invoice resolves to.
 */
type RefundTarget =
  | { paymentIntentId: string; chargeId?: never }
  | { chargeId: string; paymentIntentId?: never };

export type IssueRefundInput = RefundTarget & {
  /** Stripe's own reason enum; `duplicate` for a second payment. */
  reason: Stripe.RefundCreateParams.Reason;
  /** Stripe's `amount`, in pence, for a partial refund. Omitted: in full. */
  amountCents?: number;
  /**
   * Stable per refund decision, so a retried webhook asks Stripe once. Stripe
   * forgets a key after 24 hours; a later retry is then answered by
   * `charge_already_refunded`, which is treated as done.
   */
  idempotencyKey: string;
  /** Tags the refund with `codex_env`, so its own events pass the filter. */
  environment: string;
  /**
   * More of the refund's metadata, such as support's `codex_support_key` and
   * `codex_requested_by`. The `codex_env` tag is merged after it, so an entry
   * here can never change the environment the refund's events are filed under.
   */
  metadata?: Record<string, string>;
};

export type IssueRefundResult =
  | {
      /** The refund Stripe made. */
      refundId: string;
      alreadyRefunded: false;
      /** Stripe's `status`: pending, requires_action, succeeded, failed, canceled. */
      status: Stripe.Refund['status'];
      /** Stripe's `amount`, in pence. */
      amountCents: number;
      /** Stripe's `created`, in seconds. */
      createdAt: number;
    }
  | {
      /** The charge was already refunded in full, so no refund was made. */
      refundId: null;
      alreadyRefunded: true;
      status: null;
      amountCents: null;
      createdAt: null;
    };

/**
 * Refund a payment, in full or for `amountCents`. A charge already refunded in
 * full is success, not an error: whichever refund got there first did the job.
 * Any other failure is thrown for the caller to retry or report.
 */
export async function issueRefund(
  stripe: Stripe,
  input: IssueRefundInput
): Promise<IssueRefundResult> {
  try {
    const refund = await stripe.refunds.create(
      {
        ...(input.chargeId
          ? { charge: input.chargeId }
          : { payment_intent: input.paymentIntentId }),
        ...(input.amountCents === undefined
          ? {}
          : { amount: input.amountCents }),
        reason: input.reason,
        metadata: {
          ...input.metadata,
          ...stripeEnvMetadata(input.environment),
        },
      },
      { idempotencyKey: input.idempotencyKey }
    );
    return {
      refundId: refund.id,
      alreadyRefunded: false,
      status: refund.status,
      amountCents: refund.amount,
      createdAt: refund.created,
    };
  } catch (error) {
    if (
      (error as { code?: unknown } | null)?.code === 'charge_already_refunded'
    ) {
      return {
        refundId: null,
        alreadyRefunded: true,
        status: null,
        amountCents: null,
        createdAt: null,
      };
    }
    throw error;
  }
}

/** Support's refund window for one payment. */
export interface RefundWindow {
  /** 14 × 24 hours after the charge was created. */
  closesAt: Date;
  /** `now` is before `closesAt`. */
  isOpen: boolean;
}

/**
 * Whether support can still refund a payment (Codex-2hxff.28, Q1). The window
 * runs from Stripe's `charge.created`, for a purchase and an invoice alike, so
 * a renewal is measured from its own charge. Never from a time the client
 * sends: the refund route passes the server's clock as `now`. Search, the
 * charge detail, the preview and the route all read it, so the page and the
 * route cannot disagree.
 */
export function refundWindow(
  chargeCreatedSeconds: number,
  now: Date
): RefundWindow {
  const closesAt = new Date(
    (chargeCreatedSeconds + REFUND_WINDOW_DAYS * 24 * 60 * 60) * 1000
  );
  return { closesAt, isOpen: now.getTime() < closesAt.getTime() };
}

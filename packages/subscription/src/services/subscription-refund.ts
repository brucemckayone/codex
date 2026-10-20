/**
 * A refunded subscription payment (owner decision P-4, "Cancel + end access";
 * docs/payments/subscriptions.md#refunds):
 *
 * - a FULL refund of the LATEST payment cancels the subscription at Stripe,
 *   at once and without proration, and access ends;
 * - a partial refund, or a refund of an earlier payment, leaves it running.
 *
 * The money is not handled here: the creator and organisation slices are
 * reversed from the charge, as for any refund. Tier and course subscriptions
 * are handled alike. Safe to run again: Stripe is asked first whether the
 * subscription is still live, and the cancel carries an idempotency key.
 */

import type Stripe from 'stripe';
import {
  type ChargedSubscription,
  invoiceForPaymentIntent,
  type SubscriptionChargeDeps,
  subscriptionForStripeId,
} from './subscription-charge';

type SubscriptionRefundDeps = SubscriptionChargeDeps & {
  obs: SubscriptionChargeDeps['obs'] & {
    info(message: string, metadata?: Record<string, unknown>): void;
  };
};

export interface RefundedCharge {
  chargeId: string;
  paymentIntentId: string | null;
  /** The charge's amount, in pence. */
  amountCents: number;
  /** Everything refunded on the charge so far, in pence (cumulative). */
  amountRefundedCents: number;
}

export interface RefundCancellation {
  subscription: ChargedSubscription;
  /** The subscription as Stripe returned it from the cancel. */
  cancelled: Stripe.Subscription;
}

/** A refund is full once everything charged has been refunded. */
export function isFullRefund(
  charge: Pick<RefundedCharge, 'amountCents' | 'amountRefundedCents'>
): boolean {
  return (
    charge.amountCents > 0 && charge.amountRefundedCents >= charge.amountCents
  );
}

/**
 * Cancels the subscription a fully refunded charge paid for, when that charge
 * paid its latest invoice. Undefined when nothing is cancelled: a partial
 * refund, a one-off purchase, an earlier invoice, or a subscription that has
 * already ended (its `customer.subscription.deleted` ends it here).
 */
export async function cancelForFullRefund(
  deps: SubscriptionRefundDeps,
  charge: RefundedCharge
): Promise<RefundCancellation | undefined> {
  if (!isFullRefund(charge)) return undefined;

  const paid = await invoiceForPaymentIntent(deps, charge.paymentIntentId);
  if (!paid?.stripeSubscriptionId) return undefined;
  const subscription = await subscriptionForStripeId(
    deps,
    paid.stripeSubscriptionId
  );
  if (!subscription) return undefined;

  const live = await deps.stripe.subscriptions.retrieve(
    paid.stripeSubscriptionId
  );
  if (live.status === 'canceled' || live.status === 'incomplete_expired') {
    return undefined;
  }
  const latestInvoiceId =
    typeof live.latest_invoice === 'string'
      ? live.latest_invoice
      : (live.latest_invoice?.id ?? null);
  if (latestInvoiceId !== paid.invoiceId) {
    deps.obs.info(
      'Full refund of an earlier subscription payment; kept running',
      {
        chargeId: charge.chargeId,
        stripeSubscriptionId: paid.stripeSubscriptionId,
      }
    );
    return undefined;
  }

  const cancelled = await deps.stripe.subscriptions.cancel(
    paid.stripeSubscriptionId,
    {
      prorate: false,
      cancellation_details: {
        comment: 'Latest payment refunded in full',
      },
    },
    { idempotencyKey: `${charge.chargeId}_refund_cancel` }
  );
  deps.obs.info('Subscription cancelled: latest payment refunded in full', {
    chargeId: charge.chargeId,
    stripeSubscriptionId: paid.stripeSubscriptionId,
    kind: subscription.kind,
  });
  return { subscription, cancelled };
}

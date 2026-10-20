/**
 * A refunded subscription payment (owner decision P-4, "Cancel + end access";
 * docs/payments/subscriptions.md#refunds):
 *
 * - a FULL refund of the payment for the CURRENT billing period cancels the
 *   subscription at Stripe, at once and without proration, and access ends;
 * - a partial refund, a refund of an earlier period's payment, or of a
 *   payment that bought no period (an upgrade's proration invoice) leaves it
 *   running (owner decision 2026-10-20, "Current period's payment").
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

/** Invoices that buy a billing period: the first one, and each renewal. */
const PERIOD_BILLING_REASONS: readonly string[] = [
  'subscription_create',
  'subscription_cycle',
];

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
 * paid for the current billing period: the newest paid invoice raised for a
 * period, so an upgrade's proration invoice, a dispute's voided ones and a
 * renewal still being retried never count as "latest". Undefined when nothing
 * is cancelled: a partial refund, a one-off purchase, another payment, or a
 * subscription that has already ended (its `customer.subscription.deleted`
 * ends it here).
 */
export async function cancelForFullRefund(
  deps: SubscriptionRefundDeps,
  charge: RefundedCharge
): Promise<RefundCancellation | undefined> {
  if (!isFullRefund(charge)) return undefined;

  const paid = await invoiceForPaymentIntent(deps, charge.paymentIntentId);
  if (!paid?.stripeSubscriptionId) return undefined;
  const stripeSubscriptionId = paid.stripeSubscriptionId;
  const context = { chargeId: charge.chargeId, stripeSubscriptionId };

  const subscription = await subscriptionForStripeId(
    deps,
    stripeSubscriptionId
  );
  if (!subscription) {
    // Stripe goes on billing it: nothing here can cancel what we hold no row for.
    deps.obs.error(
      'A subscription payment was refunded in full but we hold no subscription for it; cancel it at Stripe by hand',
      { ...context, errorId: crypto.randomUUID() }
    );
    return undefined;
  }
  if (!PERIOD_BILLING_REASONS.includes(paid.billingReason ?? '')) {
    deps.obs.info(
      'Full refund of a payment that bought no period; kept running',
      {
        ...context,
        billingReason: paid.billingReason,
      }
    );
    return undefined;
  }

  const live = await deps.stripe.subscriptions.retrieve(stripeSubscriptionId);
  if (live.status === 'canceled' || live.status === 'incomplete_expired') {
    // Already ended at Stripe: its customer.subscription.deleted ends it here.
    deps.obs.info(
      'Full refund of an ended subscription; nothing to cancel',
      context
    );
    return undefined;
  }
  const periodInvoiceId = await currentPeriodInvoiceId(
    deps,
    stripeSubscriptionId
  );
  if (periodInvoiceId !== paid.invoiceId) {
    deps.obs.info("Full refund of an earlier period's payment; kept running", {
      ...context,
      refundedInvoiceId: paid.invoiceId,
      currentPeriodInvoiceId: periodInvoiceId,
    });
    return undefined;
  }

  const cancelled = await deps.stripe.subscriptions.cancel(
    stripeSubscriptionId,
    {
      prorate: false,
      cancellation_details: {
        comment: "Current period's payment refunded in full",
      },
    },
    { idempotencyKey: `${charge.chargeId}_refund_cancel` }
  );
  deps.obs.info(
    "Subscription cancelled: the current period's payment refunded in full",
    { ...context, kind: subscription.kind }
  );
  return { subscription, cancelled };
}

/** The newest paid invoice that bought a billing period, newest first. */
async function currentPeriodInvoiceId(
  deps: SubscriptionRefundDeps,
  stripeSubscriptionId: string
): Promise<string | null> {
  const page = await deps.stripe.invoices.list({
    subscription: stripeSubscriptionId,
    status: 'paid',
    limit: 20,
  });
  const current = page.data.find((invoice) =>
    PERIOD_BILLING_REASONS.includes(invoice.billing_reason ?? '')
  );
  return current?.id ?? null;
}

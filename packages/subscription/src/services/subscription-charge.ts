/**
 * Which subscription a charge paid for, shared by the dispute
 * (subscription-dispute.ts) and refund (subscription-refund.ts) paths. Tier
 * and course subscriptions are resolved alike.
 */

import {
  courseSubscriptions,
  payouts,
  subscriptions,
} from '@codex/database/schema';
import type { LedgerDeps } from '@codex/payments';
import { and, eq, isNotNull, or } from 'drizzle-orm';

export type SubscriptionChargeDeps = Pick<LedgerDeps, 'db' | 'stripe' | 'obs'>;

export interface ChargedSubscription {
  kind: 'tier' | 'course';
  id: string;
  stripeSubscriptionId: string | null;
  userId: string;
  organizationId: string | null;
  status: string;
}

export async function loadSubscription(
  deps: SubscriptionChargeDeps,
  kind: ChargedSubscription['kind'],
  id: string
): Promise<ChargedSubscription | undefined> {
  const table = kind === 'tier' ? subscriptions : courseSubscriptions;
  const [row] = await deps.db
    .select({
      id: table.id,
      stripeSubscriptionId: table.stripeSubscriptionId,
      userId: table.userId,
      organizationId: table.organizationId,
      status: table.status,
    })
    .from(table)
    .where(eq(table.id, id))
    .limit(1);
  return row ? { kind, ...row } : undefined;
}

/** From the charge's payout rows: every invoice writes at least its platform-fee row. */
export async function subscriptionFromPayoutRows(
  deps: SubscriptionChargeDeps,
  chargeId: string
): Promise<ChargedSubscription | undefined> {
  const [row] = await deps.db
    .select({
      subscriptionId: payouts.subscriptionId,
      courseSubscriptionId: payouts.courseSubscriptionId,
    })
    .from(payouts)
    .where(
      and(
        eq(payouts.stripeChargeId, chargeId),
        or(
          isNotNull(payouts.subscriptionId),
          isNotNull(payouts.courseSubscriptionId)
        )
      )
    )
    .limit(1);
  if (row?.subscriptionId) {
    return loadSubscription(deps, 'tier', row.subscriptionId);
  }
  if (row?.courseSubscriptionId) {
    return loadSubscription(deps, 'course', row.courseSubscriptionId);
  }
  return undefined;
}

export interface PaidInvoice {
  invoiceId: string;
  stripeSubscriptionId: string | null;
  /** Why Stripe raised it: `subscription_cycle`, `subscription_update`, … */
  billingReason: string | null;
}

/**
 * The invoice a payment intent paid, and the Stripe subscription it bills.
 * Undefined when the payment intent paid no invoice (a one-off purchase).
 */
export async function invoiceForPaymentIntent(
  deps: SubscriptionChargeDeps,
  paymentIntentId: string | null
): Promise<PaidInvoice | undefined> {
  if (!paymentIntentId) return undefined;
  const page = await deps.stripe.invoicePayments.list({
    payment: { type: 'payment_intent', payment_intent: paymentIntentId },
    limit: 1,
  });
  const invoiceRef = page.data[0]?.invoice;
  const invoiceId =
    typeof invoiceRef === 'string' ? invoiceRef : invoiceRef?.id;
  if (!invoiceId) return undefined;
  const invoice = await deps.stripe.invoices.retrieve(invoiceId);
  const subscriptionRef = invoice.parent?.subscription_details?.subscription;
  const stripeSubscriptionId =
    typeof subscriptionRef === 'string'
      ? subscriptionRef
      : (subscriptionRef?.id ?? null);
  return {
    invoiceId,
    stripeSubscriptionId,
    billingReason: invoice.billing_reason ?? null,
  };
}

/** Our tier or course subscription for a Stripe subscription id. */
export async function subscriptionForStripeId(
  deps: SubscriptionChargeDeps,
  stripeSubscriptionId: string
): Promise<ChargedSubscription | undefined> {
  for (const kind of ['tier', 'course'] as const) {
    const table = kind === 'tier' ? subscriptions : courseSubscriptions;
    const [row] = await deps.db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1);
    if (row) return loadSubscription(deps, kind, row.id);
  }
  return undefined;
}

/** Stripe still bills it: not cancelled, and not an expired first invoice. */
export async function isLiveAtStripe(
  deps: SubscriptionChargeDeps,
  stripeId: string
): Promise<boolean> {
  const live = await deps.stripe.subscriptions.retrieve(stripeId);
  return live.status !== 'canceled' && live.status !== 'incomplete_expired';
}

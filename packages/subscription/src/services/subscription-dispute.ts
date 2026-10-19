/**
 * A disputed subscription invoice (Codex-2hxff.9; design in
 * docs/payments/subscription-disputes.md, owner decisions Q-A and Q-B):
 *
 * - a chargeback pauses the subscription. `disputed_at` is set, which every
 *   granting query reads, and billing is paused at Stripe (`pause_collection`
 *   `void`), so no renewal is charged for access the subscriber cannot use;
 * - a win restores both, unless another chargeback on it is still open;
 * - a loss cancels it at Stripe, at once and without proration: the bank has
 *   already returned the money. `customer.subscription.deleted` then ends it
 *   here, as for any cancellation.
 *
 * Tier and course subscriptions are handled alike. The money is not handled
 * here: the clawback acts on the invoice's charge. Each step is safe to run
 * again, and each Stripe call first asks Stripe whether the subscription is
 * still live, so a redelivery never fails on one that has ended.
 */

import { DISPUTE_CHARGEBACK_OPEN_STATUSES } from '@codex/constants';
import {
  courseSubscriptions,
  disputes,
  payouts,
  subscriptions,
} from '@codex/database/schema';
import type { LedgerDeps } from '@codex/payments';
import { and, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';

type SubscriptionDisputeDeps = Pick<LedgerDeps, 'db' | 'stripe' | 'obs'>;

export interface DisputedSubscription {
  kind: 'tier' | 'course';
  id: string;
  stripeSubscriptionId: string | null;
  userId: string;
  organizationId: string | null;
  status: string;
}

export interface DisputeInput {
  stripeDisputeId: string;
  chargeId: string;
  paymentIntentId: string | null;
}

/**
 * The subscription a dispute's invoice belongs to. The dispute's link is read
 * first; without one, the charge's payout rows (every invoice writes at least
 * its platform-fee row), then Stripe (the invoice the payment intent paid).
 * A link found is written, so later events read it directly. Undefined for a
 * purchase's dispute.
 */
async function resolveDisputedSubscription(
  deps: SubscriptionDisputeDeps,
  input: DisputeInput
): Promise<DisputedSubscription | undefined> {
  const [dispute] = await deps.db
    .select({
      purchaseId: disputes.purchaseId,
      subscriptionId: disputes.subscriptionId,
      courseSubscriptionId: disputes.courseSubscriptionId,
    })
    .from(disputes)
    .where(eq(disputes.stripeDisputeId, input.stripeDisputeId))
    .limit(1);
  if (!dispute || dispute.purchaseId) return undefined;
  if (dispute.subscriptionId) {
    return loadSubscription(deps, 'tier', dispute.subscriptionId);
  }
  if (dispute.courseSubscriptionId) {
    return loadSubscription(deps, 'course', dispute.courseSubscriptionId);
  }

  const found =
    (await fromPayoutRows(deps, input.chargeId)) ??
    (await fromStripeInvoice(deps, input.paymentIntentId));
  if (!found) return undefined;
  await deps.db
    .update(disputes)
    .set(
      found.kind === 'tier'
        ? { subscriptionId: found.id }
        : { courseSubscriptionId: found.id }
    )
    .where(
      and(
        eq(disputes.stripeDisputeId, input.stripeDisputeId),
        isNull(disputes.purchaseId),
        isNull(disputes.subscriptionId),
        isNull(disputes.courseSubscriptionId)
      )
    );
  return found;
}

/** A chargeback opened: access paused. No Stripe call (see pauseBilling). */
export async function pauseDisputedSubscription(
  deps: SubscriptionDisputeDeps,
  input: DisputeInput
): Promise<DisputedSubscription | undefined> {
  const subscription = await resolveDisputedSubscription(deps, input);
  if (!subscription) return undefined;
  await setDisputedAt(deps, subscription, new Date());
  return subscription;
}

/**
 * Billing paused while the chargeback is open (owner decision Q-A): the
 * subscription stays `active` at Stripe and every invoice is voided. Run
 * after the clawback, so a Stripe failure here cannot hold it up.
 */
export async function pauseBilling(
  deps: SubscriptionDisputeDeps,
  subscription: DisputedSubscription,
  stripeDisputeId: string
): Promise<void> {
  const stripeId = subscription.stripeSubscriptionId;
  if (!stripeId || !(await isLiveAtStripe(deps, stripeId))) return;
  await deps.stripe.subscriptions.update(
    stripeId,
    { pause_collection: { behavior: 'void' } },
    { idempotencyKey: `${stripeDisputeId}_pause_collection` }
  );
}

/**
 * A won dispute: access and billing restored, unless another chargeback on
 * the same subscription is still open. Undefined when there is nothing to
 * restore; `restored: false` while another chargeback keeps it paused.
 */
export async function restoreDisputedSubscription(
  deps: SubscriptionDisputeDeps,
  input: DisputeInput
): Promise<
  { subscription: DisputedSubscription; restored: boolean } | undefined
> {
  const subscription = await resolveDisputedSubscription(deps, input);
  if (!subscription) return undefined;
  if (await hasOtherOpenChargeback(deps, subscription, input.stripeDisputeId)) {
    return { subscription, restored: false };
  }
  await setDisputedAt(deps, subscription, null);
  // Not tied to the column changing: a redelivery after a Stripe failure
  // finds the column already cleared and must still resume billing.
  const stripeId = subscription.stripeSubscriptionId;
  if (stripeId && (await isLiveAtStripe(deps, stripeId))) {
    await deps.stripe.subscriptions.update(
      stripeId,
      { pause_collection: '' },
      { idempotencyKey: `${input.stripeDisputeId}_resume_collection` }
    );
  }
  return { subscription, restored: true };
}

/**
 * A lost dispute: access ended now (a dispute can open already lost, never
 * paused), then the subscription cancelled at Stripe, at once and without
 * proration. Our cancellation follows from `customer.subscription.deleted`.
 */
export async function cancelLostDisputeSubscription(
  deps: SubscriptionDisputeDeps,
  input: DisputeInput
): Promise<DisputedSubscription | undefined> {
  const subscription = await resolveDisputedSubscription(deps, input);
  if (!subscription) return undefined;
  await setDisputedAt(deps, subscription, new Date());
  const stripeId = subscription.stripeSubscriptionId;
  if (stripeId && (await isLiveAtStripe(deps, stripeId))) {
    await deps.stripe.subscriptions.cancel(
      stripeId,
      {
        prorate: false,
        cancellation_details: { comment: 'Payment dispute lost' },
      },
      { idempotencyKey: `${input.stripeDisputeId}_cancel` }
    );
  }
  return subscription;
}

async function loadSubscription(
  deps: SubscriptionDisputeDeps,
  kind: DisputedSubscription['kind'],
  id: string
): Promise<DisputedSubscription | undefined> {
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

async function fromPayoutRows(
  deps: SubscriptionDisputeDeps,
  chargeId: string
): Promise<DisputedSubscription | undefined> {
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

async function fromStripeInvoice(
  deps: SubscriptionDisputeDeps,
  paymentIntentId: string | null
): Promise<DisputedSubscription | undefined> {
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
  const stripeId =
    typeof subscriptionRef === 'string' ? subscriptionRef : subscriptionRef?.id;
  if (!stripeId) return undefined;

  for (const kind of ['tier', 'course'] as const) {
    const table = kind === 'tier' ? subscriptions : courseSubscriptions;
    const [row] = await deps.db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.stripeSubscriptionId, stripeId))
      .limit(1);
    if (row) return loadSubscription(deps, kind, row.id);
  }
  return undefined;
}

/** Set (pause) or clear (restore) `disputed_at`; a no-op if already so. */
async function setDisputedAt(
  deps: SubscriptionDisputeDeps,
  subscription: DisputedSubscription,
  at: Date | null
): Promise<void> {
  const table =
    subscription.kind === 'tier' ? subscriptions : courseSubscriptions;
  await deps.db
    .update(table)
    .set({ disputedAt: at, updatedAt: new Date() })
    .where(
      and(
        eq(table.id, subscription.id),
        at ? isNull(table.disputedAt) : isNotNull(table.disputedAt)
      )
    );
}

async function hasOtherOpenChargeback(
  deps: SubscriptionDisputeDeps,
  subscription: DisputedSubscription,
  stripeDisputeId: string
): Promise<boolean> {
  const link =
    subscription.kind === 'tier'
      ? eq(disputes.subscriptionId, subscription.id)
      : eq(disputes.courseSubscriptionId, subscription.id);
  const [other] = await deps.db
    .select({ id: disputes.id })
    .from(disputes)
    .where(
      and(
        link,
        ne(disputes.stripeDisputeId, stripeDisputeId),
        inArray(disputes.status, [...DISPUTE_CHARGEBACK_OPEN_STATUSES])
      )
    )
    .limit(1);
  return other !== undefined;
}

/** Stripe still bills it: not cancelled, and not an expired first invoice. */
async function isLiveAtStripe(
  deps: SubscriptionDisputeDeps,
  stripeId: string
): Promise<boolean> {
  const live = await deps.stripe.subscriptions.retrieve(stripeId);
  return live.status !== 'canceled' && live.status !== 'incomplete_expired';
}

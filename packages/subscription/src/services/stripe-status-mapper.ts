/**
 * Shared mapper from Stripe subscription shape to the Codex internal
 * representation. Used by every webhook handler that writes to the
 * `subscriptions` row so status / cancelAtPeriodEnd / billingInterval /
 * amountCents / tierId derive from one interpretation — previously each
 * handler reimplemented the mapping and they drifted (V1, V2, V4, V5, V11
 * in docs/subscription-audit).
 */

import { SUBSCRIPTION_STATUS } from '@codex/constants';
import type Stripe from 'stripe';
import { scheduleIdOf } from './billing-change';
import { readWaitingMove } from './tier-move';

type SubscriptionStatus =
  (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];
type BillingInterval = 'month' | 'year';

// Internal shape — `mapStripeSubscriptionStatus` returns this and the only
// caller (subscription-service.ts) destructures by property name, so the
// type does not need to be exported. If a future consumer needs to reference
// the shape, promote back to `export interface` and add to the package barrel.
interface MappedStripeSubscription {
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  billingInterval: BillingInterval | null;
  amountCents: number | null;
  tierId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  /**
   * A move to a cheaper tier that waits for the renewal (Codex-2hxff.16),
   * from `codex_move_*` / `codex_hold_*`: all three, or all null.
   */
  pendingTierId: string | null;
  pendingTierFrom: Date | null;
  heldAmountCents: number | null;
  /**
   * A waiting change of billing (Codex-2hxff.97), from `codex_move_interval`
   * / `codex_move_amount`: both, or both null; only beside a waiting move.
   */
  pendingBillingInterval: BillingInterval | null;
  pendingAmountCents: number | null;
  /** `subscription.schedule`, by id. */
  stripeScheduleId: string | null;
}

/**
 * Deterministic Stripe-status → Codex-status resolution. `cancel_at_period_end
 * === true` shadows status='active' into CANCELLING (Stripe continues to
 * report 'active' for the remainder of the paid period). `unpaid` — Stripe
 * gave up retrying a failed renewal — ends access exactly as `canceled` does
 * (docs/payments/subscriptions.md#failed-payments), because `past_due` now
 * grants access and an `unpaid` row left `past_due` would keep it for ever.
 * `incomplete_expired` — a first payment never completed — has ended too.
 * Unknown Stripe strings (e.g. 'trialing') fall through to the `fallback` so
 * callers can pass the prior DB status and not silently discard state — the
 * audit's V2 regression.
 */
export function resolveStatus(
  stripeStatus: Stripe.Subscription.Status,
  cancelAtPeriodEnd: boolean,
  fallback: SubscriptionStatus
): SubscriptionStatus {
  switch (stripeStatus) {
    case 'active':
      return cancelAtPeriodEnd
        ? SUBSCRIPTION_STATUS.CANCELLING
        : SUBSCRIPTION_STATUS.ACTIVE;
    case 'past_due':
      return SUBSCRIPTION_STATUS.PAST_DUE;
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired':
      return SUBSCRIPTION_STATUS.CANCELLED;
    case 'incomplete':
      return SUBSCRIPTION_STATUS.INCOMPLETE;
    case 'paused':
      return SUBSCRIPTION_STATUS.PAUSED;
    // trialing — a Stripe status with no direct
    // Codex counterpart today. Returning the fallback preserves the prior
    // DB state rather than silently coercing to 'active' / 'cancelled'.
    default:
      return fallback;
  }
}

/**
 * A price's recurring interval as ours: `month` or `year`, else null. It
 * returns the literals, not `interval`: stripe-node 22+ types enums as open
 * unions (`| OtherString`), which an equality check does not narrow away.
 */
function billingIntervalOf(
  interval: string | undefined
): BillingInterval | null {
  switch (interval) {
    case 'month':
      return 'month';
    case 'year':
      return 'year';
    default:
      return null;
  }
}

/**
 * Extract all fields that ever need to be mirrored from Stripe into the
 * Codex subscriptions row. `fallbackStatus` is the current DB status so the
 * mapper never silently discards state on an unmapped Stripe enum.
 */
export function mapStripeSubscriptionStatus(
  stripeSubscription: Stripe.Subscription,
  fallbackStatus: SubscriptionStatus
): MappedStripeSubscription {
  const item = stripeSubscription.items?.data?.[0];
  const price = item?.price;
  const billingInterval = billingIntervalOf(price?.recurring?.interval);

  const periodStart = item?.current_period_start ?? 0;
  const periodEnd = item?.current_period_end ?? 0;
  const read = readWaitingMove(stripeSubscription.metadata);
  // A change of billing whose item is already on its interval has landed;
  // only its flip metadata is missing, which `applyDueTierMove` writes. It is
  // not mirrored as waiting: the row would hold a change onto the interval it
  // is billed on (`check_subscription_pending_billing`).
  const move =
    read?.billing && billingInterval === read.billing.interval ? null : read;

  return {
    status: resolveStatus(
      stripeSubscription.status,
      stripeSubscription.cancel_at_period_end,
      fallbackStatus
    ),
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
    billingInterval,
    amountCents: price?.unit_amount ?? null,
    tierId: stripeSubscription.metadata?.codex_tier_id ?? null,
    currentPeriodStart: periodStart > 0 ? new Date(periodStart * 1000) : null,
    currentPeriodEnd: periodEnd > 0 ? new Date(periodEnd * 1000) : null,
    pendingTierId: move?.tierId ?? null,
    pendingTierFrom: move ? new Date(move.at * 1000) : null,
    heldAmountCents: move?.holdAmountCents ?? null,
    pendingBillingInterval: move?.billing?.interval ?? null,
    pendingAmountCents: move?.billing?.amountCents ?? null,
    stripeScheduleId: scheduleIdOf(stripeSubscription),
  };
}

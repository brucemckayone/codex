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

type SubscriptionStatus =
  (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];
type BillingInterval = 'month' | 'year';

export interface MappedStripeSubscription {
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  billingInterval: BillingInterval | null;
  amountCents: number | null;
  tierId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

/**
 * Deterministic Stripe-status → Codex-status resolution. `cancel_at_period_end
 * === true` shadows status='active' into CANCELLING (Stripe continues to
 * report 'active' for the remainder of the paid period). Unknown Stripe
 * strings (e.g. 'trialing', 'unpaid', 'incomplete_expired') fall through to
 * the `fallback` so callers can pass the prior DB status and not silently
 * discard state — the audit's V2 regression.
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
      return SUBSCRIPTION_STATUS.CANCELLED;
    case 'incomplete':
      return SUBSCRIPTION_STATUS.INCOMPLETE;
    case 'paused':
      return SUBSCRIPTION_STATUS.PAUSED;
    // trialing, incomplete_expired, unpaid — Stripe statuses with no direct
    // Codex counterpart today. Returning the fallback preserves the prior
    // DB state rather than silently coercing to 'active' / 'cancelled'.
    default:
      return fallback;
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
  const rawInterval = price?.recurring?.interval;
  const billingInterval: BillingInterval | null =
    rawInterval === 'month' || rawInterval === 'year' ? rawInterval : null;

  const periodStart = item?.current_period_start ?? 0;
  const periodEnd = item?.current_period_end ?? 0;

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
  };
}

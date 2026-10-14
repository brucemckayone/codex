/**
 * Pending price changes — how a Studio price change reaches EXISTING
 * subscribers (Codex-2hxff.3; docs/payments/subscriptions.md → Price changes).
 *
 * The rule: a subscriber on the changed interval moves to the new price at
 * their FIRST renewal at least 30 days after they were emailed about it. No
 * immediate charge, no proration; increases and decreases alike. A later change
 * replaces a pending one ("latest wins"): one move, to the newest price, at the
 * first renewal at least 30 days after the newest notice.
 *
 * The mechanism is a DEFERRED SWAP, not a Stripe subscription schedule (owner
 * decision 2026-10-13). A same-interval price swap with
 * `proration_behavior: 'none'` keeps the billing dates and charges nothing — the
 * NEXT renewal simply bills the new price. So the swap may happen at any moment
 * during the period whose end is the target renewal:
 *
 *   - at notice time, if the next renewal is already ≥ 30 days away; otherwise
 *   - the pending price is written onto the Stripe subscription's metadata, and
 *     `applyDuePendingPriceChange` swaps it from the `customer.subscription.updated`
 *     event Stripe sends at each renewal, once the next renewal is far enough out.
 *
 * Keeping the state on the Stripe subscription (not in our database) means
 * cancel, reactivate and the billing portal need no changes, and there is no
 * migration. `changeTier` clears it (a new tier supersedes the old tier's price).
 */

import type Stripe from 'stripe';

/** Metadata key: the Price the subscription moves to at a later renewal. */
export const PENDING_PRICE_ID_KEY = 'codex_pending_price_id';
/** Metadata key: unix seconds — the earliest renewal that may bill the pending Price. */
export const PENDING_PRICE_FROM_KEY = 'codex_pending_price_from';

/** Subscribers get at least this much notice before a new price is billed. */
export const PRICE_CHANGE_NOTICE_SECONDS = 30 * 24 * 60 * 60;

/** Setting a metadata key to '' deletes it in Stripe. */
export const CLEAR_PENDING_PRICE_METADATA: Record<string, string> = {
  [PENDING_PRICE_ID_KEY]: '',
  [PENDING_PRICE_FROM_KEY]: '',
};

export interface PriceChangeTarget {
  stripeSubscriptionId: string;
  newPriceId: string;
  /** The new price's amount in pence — equal to today's means "no change to notify". */
  newAmountCents: number;
  /** The interval being repriced. A subscription on the other interval is never touched. */
  interval: 'month' | 'year';
  /** When the subscriber is emailed. One value for a whole fan-out. */
  noticeAt: Date;
}

export type PriceChangeOutcome =
  /** Swapped now: the next renewal is already ≥ 30 days away and bills the new price. */
  | { kind: 'applied'; effectiveAt: Date }
  /** Marked pending: a later renewal swaps it. `effectiveAt` is our estimate, for the email. */
  | { kind: 'pending'; effectiveAt: Date }
  /** Same amount (e.g. a price set back): price id swapped silently, any pending change dropped. */
  | { kind: 'unchanged' }
  /** Not on the repriced interval, or nothing to bill. Left untouched. */
  | { kind: 'skipped'; reason: string };

/**
 * Stripe statuses where an item swap is safe. A paused subscription is never
 * swapped (it can trigger a reactivation path); a past-due one is retrying an
 * invoice. Both get the pending marker instead, and move when they are active.
 */
function canSwapNow(status: Stripe.Subscription.Status): boolean {
  return status === 'active' || status === 'trialing';
}

/**
 * Schedule a subscription's move to `newPriceId` under the 30-day rule.
 *
 * Idempotent: replaying the same target yields the same Stripe state (keys are
 * deterministic per subscription + price).
 */
export async function schedulePriceChange(
  stripe: Stripe,
  target: PriceChangeTarget
): Promise<PriceChangeOutcome> {
  const subscription = await stripe.subscriptions.retrieve(
    target.stripeSubscriptionId
  );
  const item = subscription.items.data[0];
  if (!item) {
    return { kind: 'skipped', reason: 'subscription has no items' };
  }
  if (item.price.recurring?.interval !== target.interval) {
    // An interval change resets the billing cycle and charges at once — the
    // bug this replaces. Never cross intervals.
    return { kind: 'skipped', reason: 'subscription is on another interval' };
  }

  // Same amount as today (a price set back to what they pay): keep the
  // subscription on the tier's current Price id, drop any pending change, and
  // tell nobody — nothing they pay changes.
  if (item.price.unit_amount === target.newAmountCents) {
    if (
      item.price.id !== target.newPriceId &&
      canSwapNow(subscription.status)
    ) {
      await stripe.subscriptions.update(
        subscription.id,
        {
          items: [{ id: item.id, price: target.newPriceId }],
          proration_behavior: 'none',
          metadata: CLEAR_PENDING_PRICE_METADATA,
        },
        {
          idempotencyKey: `price-change-same:${subscription.id}:${target.newPriceId}`,
        }
      );
    } else if (subscription.metadata?.[PENDING_PRICE_ID_KEY]) {
      await stripe.subscriptions.update(
        subscription.id,
        { metadata: CLEAR_PENDING_PRICE_METADATA },
        {
          idempotencyKey: `price-change-clear:${subscription.id}:${target.newPriceId}`,
        }
      );
    }
    return { kind: 'unchanged' };
  }

  const earliest =
    Math.floor(target.noticeAt.getTime() / 1000) + PRICE_CHANGE_NOTICE_SECONDS;
  const nextRenewal = item.current_period_end;

  if (nextRenewal >= earliest && canSwapNow(subscription.status)) {
    await stripe.subscriptions.update(
      subscription.id,
      {
        items: [{ id: item.id, price: target.newPriceId }],
        proration_behavior: 'none',
        metadata: CLEAR_PENDING_PRICE_METADATA,
      },
      {
        idempotencyKey: `price-change-now:${subscription.id}:${target.newPriceId}`,
      }
    );
    return { kind: 'applied', effectiveAt: new Date(nextRenewal * 1000) };
  }

  // Latest wins: this overwrites any earlier pending change. No idempotency
  // key: a metadata write is idempotent by itself, and `from` depends on the
  // notice time, so a re-run fan-out within Stripe's 24h key window would
  // reuse a key with different parameters and be refused.
  await stripe.subscriptions.update(subscription.id, {
    metadata: {
      [PENDING_PRICE_ID_KEY]: target.newPriceId,
      [PENDING_PRICE_FROM_KEY]: String(earliest),
    },
  });
  return {
    kind: 'pending',
    effectiveAt: new Date(
      firstRenewalOnOrAfter({
        nextRenewal,
        anchor: subscription.billing_cycle_anchor,
        interval: target.interval,
        earliest,
      }) * 1000
    ),
  };
}

/**
 * Swap a pending price in when it is due — called for every
 * `customer.subscription.updated` (Stripe sends one at each renewal).
 *
 * Due means: the subscription's next renewal is at or after the pending
 * `from`, so swapping now (no proration) makes that renewal the first billed at
 * the new price. Returns true when it swapped. Safe to call on any event: the
 * swap's own `customer.subscription.updated` finds nothing pending.
 *
 * The event's copy is only a filter. When it carries a marker, the decision is
 * made on the LIVE subscription: Stripe delivers events late and out of order,
 * and a stale copy racing a newer change (or `changeTier`) would swap to a
 * superseded Price and clear the newer marker. An event without a marker costs
 * no Stripe call — a stale one only defers the swap to the next renewal event.
 */
export async function applyDuePendingPriceChange(
  stripe: Stripe,
  eventSubscription: Stripe.Subscription
): Promise<boolean> {
  if (!eventSubscription.metadata?.[PENDING_PRICE_ID_KEY]) return false;
  const subscription = await stripe.subscriptions.retrieve(
    eventSubscription.id
  );
  const pendingPriceId = subscription.metadata?.[PENDING_PRICE_ID_KEY];
  const from = Number(subscription.metadata?.[PENDING_PRICE_FROM_KEY]);
  if (!pendingPriceId || !Number.isFinite(from) || from <= 0) return false;

  const item = subscription.items.data[0];
  if (!item) return false;

  if (item.price.id === pendingPriceId) {
    // Already on it (e.g. a replayed event) — just tidy the marker.
    await stripe.subscriptions.update(
      subscription.id,
      { metadata: CLEAR_PENDING_PRICE_METADATA },
      {
        idempotencyKey: `price-change-tidy:${subscription.id}:${pendingPriceId}`,
      }
    );
    return false;
  }

  if (!canSwapNow(subscription.status)) return false;
  if (item.current_period_end < from) return false;

  await stripe.subscriptions.update(
    subscription.id,
    {
      items: [{ id: item.id, price: pendingPriceId }],
      proration_behavior: 'none',
      metadata: CLEAR_PENDING_PRICE_METADATA,
    },
    {
      idempotencyKey: `price-change-apply:${subscription.id}:${pendingPriceId}`,
    }
  );
  return true;
}

/**
 * The first renewal at or after `earliest`, in unix seconds — the date the
 * notice email quotes when a change is left pending.
 *
 * Renewals fall on the billing-cycle anchor's day of month (clamped to the
 * month's length — an anchor on the 31st renews on 28 Feb, then 31 Mar), at
 * the anchor's time of day: Stripe's own rule. Stepping from the anchor rather
 * than from the current period end keeps the clamp from drifting.
 */
export function firstRenewalOnOrAfter(args: {
  nextRenewal: number;
  anchor: number | null | undefined;
  interval: 'month' | 'year';
  earliest: number;
}): number {
  const { nextRenewal, interval, earliest } = args;
  const anchor = args.anchor && args.anchor > 0 ? args.anchor : nextRenewal;
  const monthsPerStep = interval === 'year' ? 12 : 1;
  const floor = Math.max(nextRenewal, earliest);

  // Start near `nextRenewal` rather than at the anchor, which can be years back.
  const anchorDate = new Date(anchor * 1000);
  const renewalDate = new Date(nextRenewal * 1000);
  const monthsBetween =
    (renewalDate.getUTCFullYear() - anchorDate.getUTCFullYear()) * 12 +
    (renewalDate.getUTCMonth() - anchorDate.getUTCMonth());
  let step = Math.max(0, Math.floor(monthsBetween / monthsPerStep) - 1);

  for (let guard = 0; guard < 1000; guard++, step++) {
    const candidate = addMonthsClamped(anchor, step * monthsPerStep);
    if (candidate >= floor) return candidate;
  }
  return floor;
}

/** `unixSeconds` plus `months`, clamping the day to the target month's length. */
function addMonthsClamped(unixSeconds: number, months: number): number {
  const date = new Date(unixSeconds * 1000);
  const totalMonths = date.getUTCMonth() + months;
  const year = date.getUTCFullYear() + Math.floor(totalMonths / 12);
  const month = ((totalMonths % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDay);
  return (
    Date.UTC(
      year,
      month,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds()
    ) / 1000
  );
}

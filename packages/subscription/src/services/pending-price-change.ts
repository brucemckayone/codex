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
 * Keeping the move's state on the Stripe subscription means cancel,
 * reactivate and the billing portal need no changes. `changeTier` clears it
 * (a new tier supersedes the old tier's price).
 *
 * Notice first, then move (owner decision D-P3, Codex-2hxff.43): nothing is
 * written to a subscription whose price changes until notifications-api has
 * accepted its notice. A notice that is not accepted leaves the subscriber on
 * today's price.
 *
 * WHO IS DUE is a durable record (Codex-2hxff.85, .86; batch C1 Part B data
 * design §2): a Studio save writes one `price_changes` row per interval that
 * changed and one `subscription_price_moves` row per subscriber, in the save's
 * own transaction (`recordTierPriceChange`, `recordPlanPriceChange`).
 * ecom-api's hourly step works the rows (`./price-moves-sweep.ts`): each
 * person's notice, then their Stripe write, through `schedulePriceChange`.
 */

import { SUBSCRIPTION_STATUS } from '@codex/constants';
import {
  courseSubscriptions,
  type PriceMoveSkipReason,
  priceChanges,
  subscriptionPriceMoves,
  subscriptions,
} from '@codex/database/schema';
import { InternalServiceError } from '@codex/service-errors';
import { type SQL, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { type PriceChangeStage, PriceChangeStageError } from '../errors';

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
  /**
   * When this subscriber is emailed: their own notice, so their own 30 days
   * (owner decision M2). A write retried after an accepted notice passes that
   * notice's time, so the date is the one they were told, or the next renewal
   * if it has passed: later, never earlier (Q5).
   */
  noticeAt: Date;
  /**
   * Set for a member waiting to move TO the repriced tier (Codex-2hxff.16,
   * Part A rule 2): `pending_tier_from` + 1 s. The new price never bills
   * before it, and the move is always left pending, never swapped now: they
   * move at the price they confirmed, and the new one starts at a later
   * renewal.
   */
  floorFrom?: Date | null;
  /**
   * Checks the live subscription before anything is sent or written, and
   * names why it is left alone, or null. The tier step passes Part A rule 1:
   * a live `codex_move_tier_id` naming another tier means the member is
   * leaving the repriced one (`moving_away`).
   */
  skipLive?: (live: Stripe.Subscription) => PriceMoveSkipReason | null;
  /**
   * The last try's outcome is unknown: the email may have gone, or a run may
   * have stopped after its Stripe write. A live subscription already carrying
   * this change then counts as moved, and nothing is sent or written again:
   * on the new Price (`applied`), or marked pending for it (`pending`, from
   * the renewal the marker allows). Both outcomes say `landed`.
   */
  mayBeTold?: boolean;
}

/**
 * The move a subscriber is about to be told about, and what their notice
 * quotes. `currentAmountCents` is what they are billed today: the live item's
 * `unit_amount`. It is the notice's "from" figure, because a grandfathered
 * subscriber does not pay the plan's previous list price (Codex-2hxff.40). Null
 * only for a Price with no unit amount (tiered or custom), which the platform
 * never creates.
 */
export interface PriceChangeNotice {
  /** `applied`: the next renewal is already ≥ 30 days away, so the swap is made now. */
  kind: 'applied' | 'pending';
  /** The renewal that first bills the new price. Our estimate for `pending`. */
  effectiveAt: Date;
  currentAmountCents: number | null;
  /**
   * An earlier change this subscription already carries (its pending marker),
   * or null. If this notice is not accepted, or the move then fails, that
   * earlier change still lands: the subscriber is not simply "on the old
   * price" (review A, correctness #6).
   */
  currentPending: { priceId: string; from: Date } | null;
}

/**
 * Sends one subscriber's notice and resolves true only once notifications-api
 * has accepted it. The caller raises the alert for a notice that was not.
 */
export type SendPriceChangeNotice = (
  notice: PriceChangeNotice
) => Promise<boolean>;

export type PriceChangeOutcome =
  /** Notified, then swapped now: the next renewal bills the new price. */
  | {
      kind: 'applied';
      effectiveAt: Date;
      currentAmountCents: number | null;
      /** Found already done (`mayBeTold`): nothing sent or written now. */
      landed?: true;
    }
  /** Notified, then marked pending: a later renewal swaps it. */
  | {
      kind: 'pending';
      effectiveAt: Date;
      currentAmountCents: number | null;
      landed?: true;
    }
  /** The notice was not accepted: nothing written, today's price stays. */
  | { kind: 'unnotified' }
  /** Same amount (e.g. a price set back): price id swapped silently, any pending change dropped. */
  | { kind: 'unchanged' }
  /** Ended, on another interval, no items, or `skipLive` said so. Left untouched. */
  | { kind: 'skipped'; reason: PriceMoveSkipReason };

/** What became of a notice handed to the mailer. Matches worker-utils' `EmailSendResult`. */
export type NoticeDelivery =
  | { accepted: true }
  | { accepted: false; status: number }
  | { accepted: false; skipped: string }
  | { accepted: false; error: string };

/**
 * Sends the `subscription-tier-price-change` notice (tiers and course plans)
 * and reports notifications-api's answer. The registry wires
 * `sendEmailToWorkerAwaited`, which never throws.
 */
export type PriceChangeNoticeMailer = (params: {
  to: string;
  toName?: string;
  templateName: 'subscription-tier-price-change';
  category: 'transactional';
  userId?: string;
  organizationId?: string | null;
  data: Record<string, string | number | boolean>;
}) => Promise<NoticeDelivery>;

/**
 * Why a notice was not accepted. Either way the move is not made, but only
 * the first three are certain the email did not go out:
 *
 * - `no_address`, `refused` (a 4xx: notifications-api refused before sending)
 *   and `skipped` (it answered 2xx without sending): NOT sent.
 * - `unknown`: a 5xx (notifications-api can fail after the provider took the
 *   email, writing its audit row), a timeout, a transport failure or a 2xx
 *   without a readable result. The email MAY have gone out (review A,
 *   silent #8): support checks notifications' email audit log before re-sending.
 */
export type NoticeFailure =
  | { reason: 'no_address' }
  | { reason: 'refused'; status: number }
  | { reason: 'skipped'; skipped: string }
  | { reason: 'unknown'; status?: number; error?: string };

/**
 * Hand one notice to the mailer and classify the answer. Resolves `null` when
 * it was accepted, otherwise the failure for the caller's alert. Never
 * throws: a mailer that throws or rejects counts as `unknown`.
 */
export async function sendPriceChangeNotice(
  mailer: PriceChangeNoticeMailer,
  params: Omit<Parameters<PriceChangeNoticeMailer>[0], 'to'> & {
    to: string | null;
  }
): Promise<NoticeFailure | null> {
  const { to, ...rest } = params;
  if (!to) return { reason: 'no_address' };
  try {
    const delivery = await mailer({ ...rest, to });
    if (delivery.accepted) return null;
    if ('skipped' in delivery) {
      return { reason: 'skipped', skipped: delivery.skipped };
    }
    if ('status' in delivery) {
      return delivery.status < 500
        ? { reason: 'refused', status: delivery.status }
        : { reason: 'unknown', status: delivery.status };
    }
    return { reason: 'unknown', error: delivery.error };
  } catch (error) {
    return {
      reason: 'unknown',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Stripe answered and refused: a 4xx other than a conflict (409) or a rate
 * limit (429), so the write did not happen. Anything else (a 5xx, a timeout, a
 * connection failure, a 409 or a 429) may have applied it: the outcome is
 * unknown (review A, silent #8). The same rule as `@codex/payments`'
 * clawback.
 */
export function isDefinitiveStripeRefusal(error: unknown): boolean {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    status !== 409 &&
    status !== 429
  );
}

/**
 * Where a subscriber whose move was not made stands: on today's price, or on
 * an earlier accepted change that is still pending, and still lands
 * (correctness #6).
 */
function heldAt(currentPending: PriceChangeNotice['currentPending']): string {
  return currentPending
    ? `stays on their earlier accepted change to ${currentPending.priceId}, due from ${currentPending.from.toISOString()}`
    : 'is kept on the old price';
}

/** The ids-only fields every price-change alert carries about a pending change. */
function pendingFields(currentPending: PriceChangeNotice['currentPending']) {
  return {
    currentPendingPriceId: currentPending?.priceId ?? null,
    currentPendingFrom: currentPending?.from.toISOString() ?? null,
  };
}

/**
 * The alert for a notice that was not accepted. The move was not made either
 * way; only a definite refusal may say the notice was not sent (silent #8).
 * `prefix` names the path ("Price moves: ").
 */
export function noticeFailureAlert(
  prefix: string,
  failure: NoticeFailure,
  notice: PriceChangeNotice
): { message: string; data: Record<string, unknown> } {
  const unknown = failure.reason === 'unknown';
  return {
    message: unknown
      ? `${prefix}price-change notice outcome unknown (it may have been delivered); the move was not made (support: check the email audit log before retrying)`
      : `${prefix}price-change notice not sent; the move was not made and the subscriber ${heldAt(notice.currentPending)} (support: retry)`,
    data: {
      ...failure,
      outcome: unknown ? 'notice_unknown' : 'notice_not_sent',
      kind: notice.kind,
      effectiveAt: notice.effectiveAt.toISOString(),
      ...pendingFields(notice.currentPending),
    },
  };
}

/** The same-amount path's writes, as an alert names them. */
const SAME_AMOUNT_WRITE: Record<Exclude<PriceChangeStage, 'read'>, string> = {
  same_amount_swap: 'item swap',
  same_amount_clear: 'pending-marker clear',
};

/**
 * The alert for a Stripe failure during one subscriber's move. `notice` is set
 * when their notice had been accepted: the failure is then the write, and a
 * non-definitive one may have applied it (silent #7, #8). Before any notice,
 * the alert names the stage that threw (`PriceChangeStageError`): the read,
 * or a same-amount write, which may leave an earlier pending change to land
 * (review A round 2, correctness #2).
 */
export function moveFailureAlert(
  prefix: string,
  error: unknown,
  notice: PriceChangeNotice | undefined,
  noticeAt: Date
): { message: string; data: Record<string, unknown> } {
  // A stage error wraps Stripe's: report and judge Stripe's.
  const stripeError =
    error instanceof PriceChangeStageError ? error.cause : error;
  const errorText =
    stripeError instanceof Error ? stripeError.message : String(stripeError);
  if (!notice) {
    if (error instanceof PriceChangeStageError && error.stage !== 'read') {
      const { stage, currentPending } = error;
      const definitive = isDefinitiveStripeRefusal(stripeError);
      const write = `${SAME_AMOUNT_WRITE[stage]}, ${definitive ? 'refused by Stripe' : 'outcome unknown'}`;
      return {
        message: currentPending
          ? `${prefix}same-amount write failed; an earlier pending change may still land: ${currentPending.priceId}, due from ${currentPending.from.toISOString()} (${write}; not notified, as the amount does not change; support: check the Stripe subscription and clear the pending change if it is still there)`
          : `${prefix}same-amount write failed (${write}); not notified, as the amount does not change, and no earlier change is pending (support: check the Stripe subscription)`,
        data: {
          outcome: 'same_amount_write_failed',
          notified: false,
          stage,
          definitive,
          ...pendingFields(currentPending),
          error: errorText,
        },
      };
    }
    if (error instanceof PriceChangeStageError) {
      return {
        message: `${prefix}could not read the Stripe subscription; not notified and not moved (support: retry)`,
        data: {
          outcome: 'not_moved',
          notified: false,
          stage: 'read',
          error: errorText,
        },
      };
    }
    // Not a Stripe call: the caller's notice step threw before accepting.
    return {
      message: `${prefix}failed before the notice was accepted; not moved (support: retry)`,
      data: { outcome: 'not_moved', notified: false, error: errorText },
    };
  }
  const definitive = isDefinitiveStripeRefusal(error);
  return {
    message: definitive
      ? `${prefix}notice sent, but Stripe refused the move; the subscriber ${heldAt(notice.currentPending)} (support: retry the move)`
      : `${prefix}notice sent; the move's outcome is unknown (support: check the Stripe subscription before retrying)`,
    data: {
      outcome: definitive ? 'move_refused' : 'move_unknown',
      notified: true,
      kind: notice.kind,
      noticeAt: noticeAt.toISOString(),
      effectiveAt: notice.effectiveAt.toISOString(),
      ...pendingFields(notice.currentPending),
      error: errorText,
    },
  };
}

/**
 * Each Stripe call of a subscriber's move gives up after 3 s, and is not
 * retried (review A round 2, silent R2): the hourly step retries the person
 * next hour instead, and the SDK's defaults (an 80 s timeout and two retries)
 * would let one slow call hold up a whole batch. stripe-node starts the timer
 * when the call is made, so time spent queued behind the runtime's
 * six-connection limit counts against it too.
 */
export const FAN_OUT_STRIPE_TIMEOUT_MS = 3_000;

/**
 * The options every Stripe call of a subscriber's move passes (with its
 * idempotency key, if it has one).
 */
export const FAN_OUT_STRIPE_REQUEST = {
  timeout: FAN_OUT_STRIPE_TIMEOUT_MS,
  maxNetworkRetries: 0,
} as const satisfies Stripe.RequestOptions;

/**
 * How long the hourly step waits for notifications-api to accept one notice.
 * The registry passes it to worker-utils' `sendEmailToWorkerAwaited`; a send
 * still running then is not accepted (`unknown`), so that person is checked
 * against the email log before the next try.
 */
export const PRICE_NOTICE_TIMEOUT_MS = 5_000;

/**
 * Stripe statuses where an item swap is safe. A paused subscription is never
 * swapped (it can trigger a reactivation path); a past-due one is retrying an
 * invoice. Both get the pending marker instead, and move when they are active.
 */
function canSwapNow(status: Stripe.Subscription.Status): boolean {
  return status === 'active' || status === 'trialing';
}

/** Run one Stripe call of a subscriber's path, naming `stage` if it throws. */
async function atStage<T>(
  stage: PriceChangeStage,
  currentPending: PriceChangeNotice['currentPending'],
  call: () => Promise<T>
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new PriceChangeStageError(stage, currentPending, error);
  }
}

/**
 * Schedule a subscription's move to `newPriceId` under the 30-day rule.
 *
 * Reads the live subscription, works out the move, and calls `notify` with
 * what the notice quotes. The move is written only once `notify` resolves
 * true; otherwise nothing is written and the outcome is `unnotified`. A
 * subscriber whose amount does not change is not notified (`unchanged`).
 *
 * Every Stripe call passes `FAN_OUT_STRIPE_REQUEST`. One that throws before
 * the notice rejects with a `PriceChangeStageError` naming it; a write after
 * an accepted notice rejects with Stripe's own error.
 *
 * A write retried after an accepted notice passes a `notify` that resolves
 * true at once (no second email, M1) and that notice's `noticeAt`.
 *
 * Idempotent: replaying the same target yields the same Stripe state (keys are
 * deterministic per subscription + price).
 */
export async function schedulePriceChange(
  stripe: Stripe,
  target: PriceChangeTarget,
  notify: SendPriceChangeNotice
): Promise<PriceChangeOutcome> {
  const subscription = await atStage('read', null, () =>
    stripe.subscriptions.retrieve(
      target.stripeSubscriptionId,
      FAN_OUT_STRIPE_REQUEST
    )
  );
  // Ended at Stripe: there is no renewal to reprice, and Stripe refuses
  // writes to a cancelled subscription.
  if (
    subscription.status === 'canceled' ||
    subscription.status === 'incomplete_expired'
  ) {
    return { kind: 'skipped', reason: 'ended' };
  }
  const item = subscription.items.data[0];
  if (!item) {
    return { kind: 'skipped', reason: 'no_items' };
  }
  if (item.price.recurring?.interval !== target.interval) {
    // An interval change resets the billing cycle and charges at once — the
    // bug this replaces. Never cross intervals.
    return { kind: 'skipped', reason: 'other_interval' };
  }
  const skip = target.skipLive?.(subscription) ?? null;
  if (skip) return { kind: 'skipped', reason: skip };

  // An earlier change this subscription already carries, if any.
  const pendingPriceId = subscription.metadata?.[PENDING_PRICE_ID_KEY];
  const pendingFrom = Number(subscription.metadata?.[PENDING_PRICE_FROM_KEY]);
  const currentPending =
    pendingPriceId && Number.isFinite(pendingFrom) && pendingFrom > 0
      ? { priceId: pendingPriceId, from: new Date(pendingFrom * 1000) }
      : null;

  // Before the same-amount path: a subscription already on the new Price
  // would read as "same amount", and one already told would be told again.
  if (target.mayBeTold && item.price.id === target.newPriceId) {
    return {
      kind: 'applied',
      effectiveAt: new Date(item.current_period_end * 1000),
      currentAmountCents: item.price.unit_amount,
      landed: true,
    };
  }
  if (target.mayBeTold && currentPending?.priceId === target.newPriceId) {
    return {
      kind: 'pending',
      effectiveAt: new Date(
        firstRenewalOnOrAfter({
          nextRenewal: item.current_period_end,
          anchor: subscription.billing_cycle_anchor,
          interval: target.interval,
          earliest: Math.floor(currentPending.from.getTime() / 1000),
        }) * 1000
      ),
      currentAmountCents: item.price.unit_amount,
      landed: true,
    };
  }

  // Same amount as today (a price set back to what they pay): keep the
  // subscription on the tier's current Price id, drop any pending change, and
  // tell nobody — nothing they pay changes. A failed write here leaves that
  // pending change in place, so the error carries it.
  if (item.price.unit_amount === target.newAmountCents) {
    if (
      item.price.id !== target.newPriceId &&
      canSwapNow(subscription.status)
    ) {
      await atStage('same_amount_swap', currentPending, () =>
        stripe.subscriptions.update(
          subscription.id,
          {
            items: [{ id: item.id, price: target.newPriceId }],
            proration_behavior: 'none',
            metadata: CLEAR_PENDING_PRICE_METADATA,
          },
          {
            ...FAN_OUT_STRIPE_REQUEST,
            idempotencyKey: `price-change-same:${subscription.id}:${target.newPriceId}`,
          }
        )
      );
    } else if (pendingPriceId) {
      await atStage('same_amount_clear', currentPending, () =>
        stripe.subscriptions.update(
          subscription.id,
          { metadata: CLEAR_PENDING_PRICE_METADATA },
          {
            ...FAN_OUT_STRIPE_REQUEST,
            idempotencyKey: `price-change-clear:${subscription.id}:${target.newPriceId}`,
          }
        )
      );
    }
    return { kind: 'unchanged' };
  }

  // 30 days from their own notice, and for a member moving onto the tier,
  // never before the move lands (Part A rule 2): max(noticeAt + 30 d, floor).
  const earliest = Math.max(
    Math.floor(target.noticeAt.getTime() / 1000) + PRICE_CHANGE_NOTICE_SECONDS,
    target.floorFrom ? Math.ceil(target.floorFrom.getTime() / 1000) : 0
  );
  const nextRenewal = item.current_period_end;
  const move =
    !target.floorFrom &&
    nextRenewal >= earliest &&
    canSwapNow(subscription.status)
      ? {
          kind: 'applied' as const,
          effectiveAt: new Date(nextRenewal * 1000),
          currentAmountCents: item.price.unit_amount,
        }
      : {
          kind: 'pending' as const,
          effectiveAt: new Date(
            firstRenewalOnOrAfter({
              nextRenewal,
              anchor: subscription.billing_cycle_anchor,
              interval: target.interval,
              earliest,
            }) * 1000
          ),
          currentAmountCents: item.price.unit_amount,
        };

  // Notice first, then move (D-P3): no write until the notice is accepted.
  if (!(await notify({ ...move, currentPending }))) {
    return { kind: 'unnotified' };
  }

  if (move.kind === 'applied') {
    await stripe.subscriptions.update(
      subscription.id,
      {
        items: [{ id: item.id, price: target.newPriceId }],
        proration_behavior: 'none',
        metadata: CLEAR_PENDING_PRICE_METADATA,
      },
      {
        ...FAN_OUT_STRIPE_REQUEST,
        idempotencyKey: `price-change-now:${subscription.id}:${target.newPriceId}`,
      }
    );
    return move;
  }

  // Latest wins: this overwrites any earlier pending change. No idempotency
  // key: a metadata write is idempotent by itself, and `from` depends on the
  // notice time, so a newer change within Stripe's 24h key window would
  // reuse a key with different parameters and be refused.
  await stripe.subscriptions.update(
    subscription.id,
    {
      metadata: {
        [PENDING_PRICE_ID_KEY]: target.newPriceId,
        [PENDING_PRICE_FROM_KEY]: String(earliest),
      },
    },
    FAN_OUT_STRIPE_REQUEST
  );
  return move;
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

/**
 * `unixSeconds` plus `months`, clamping the day to the target month's length.
 * Exported for the tier-change preview's next-bill date (Codex-2hxff.16).
 */
export function addMonthsClamped(unixSeconds: number, months: number): number {
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

// ─── Recording who is due (Codex-2hxff.85, .86; data design §2.3) ──────────

/**
 * What the recorders need of the save's transaction: raw statements. Every
 * driver's transaction has it, so the tier save (`dbWs`) and the course plan
 * save (the service's `db`) pass theirs as they are.
 */
export interface PriceChangeTx {
  execute(query: SQL): PromiseLike<{ rows: unknown[] }>;
}

/** The subscription statuses a price change reaches; the old fan-out's. */
const REPRICED_STATUSES = [
  SUBSCRIPTION_STATUS.ACTIVE,
  SUBSCRIPTION_STATUS.CANCELLING,
  SUBSCRIPTION_STATUS.PAST_DUE,
  SUBSCRIPTION_STATUS.PAUSED,
] as const;

const repricedStatusList = () =>
  sql.join(
    REPRICED_STATUSES.map((status) => sql`${status}`),
    sql`, `
  );

/** What a Studio save records for one interval whose price it changed. */
export interface RecordPriceChangeInput {
  organizationId: string;
  interval: 'month' | 'year';
  /** The list price before the save. */
  fromAmountCents: number;
  newAmountCents: number;
  newStripePriceId: string;
  /** The owner who saved it; null when the system wrote it. */
  createdByUserId: string | null;
  now: Date;
}

export interface RecordedPriceChange {
  changeId: string;
  /** Rows written: everyone the change has to tell. */
  total: number;
  /** The change this one replaced (latest wins), or null. */
  supersededId: string | null;
}

type PriceChangeSubject =
  | { kind: 'tier'; tierId: string }
  | { kind: 'course_plan'; planId: string };

/**
 * Latest wins (docs/payments/subscriptions.md → Price changes).
 *
 * 1. Every older change for the same subject and interval that isn't
 *    superseded is locked first: the lock order everywhere is the
 *    `price_changes` row, then its `subscription_price_moves` rows.
 * 2. The live (running or stopped) one becomes `superseded`, pointing at the
 *    new one, and the new one is inserted, in ONE statement. It has to be
 *    one: the partial unique index allows a single running or stopped
 *    change, so the old one must stop being live before the insert, while
 *    its `superseded_by_id` must name a row that exists, which a foreign key
 *    checks at the end of the statement. The insert reads the update's whole
 *    result (`count(*)`) before it writes, so the update has run first.
 * 3. Every `due`, `notified` and unresolved `held` row of those older changes
 *    becomes `superseded`, a `done` change's included (the change itself
 *    stays `done`). Nobody hears about a replaced price, its held people
 *    leave support's list, and a row support retried on an old change is
 *    never worked: the new change's rows reach the same people.
 */
async function insertPriceChange(
  tx: PriceChangeTx,
  subject: PriceChangeSubject,
  input: RecordPriceChangeInput
): Promise<{ changeId: string; supersededId: string | null }> {
  const changeId = crypto.randomUUID();
  const tierId = subject.kind === 'tier' ? subject.tierId : null;
  const planId = subject.kind === 'course_plan' ? subject.planId : null;
  const sameSubject =
    subject.kind === 'tier'
      ? sql`${priceChanges.tierId} = ${subject.tierId}::uuid`
      : sql`${priceChanges.courseSubscriptionPlanId} = ${subject.planId}::uuid`;
  const older = await tx.execute(sql`
    SELECT "id" FROM ${priceChanges}
     WHERE ${sameSubject}
       AND ${priceChanges.interval} = ${input.interval}
       AND ${priceChanges.state} <> 'superseded'
     ORDER BY "id"
     FOR UPDATE
  `);
  const olderIds = (older.rows as Array<{ id: string }>).map((r) => r.id);
  const result = await tx.execute(sql`
    WITH superseded AS (
      UPDATE ${priceChanges}
         SET "state" = 'superseded',
             "superseded_at" = ${input.now}::timestamptz,
             "superseded_by_id" = ${changeId}::uuid
       WHERE ${sameSubject}
         AND ${priceChanges.interval} = ${input.interval}
         AND ${priceChanges.state} IN ('running', 'stopped')
      RETURNING "id"
    ), inserted AS (
      INSERT INTO ${priceChanges} ("id", "organization_id", "kind", "tier_id",
        "course_subscription_plan_id", "interval", "from_amount_cents",
        "new_amount_cents", "new_stripe_price_id", "created_by_user_id",
        "created_at")
      SELECT ${changeId}::uuid, ${input.organizationId}::uuid, ${subject.kind},
        ${tierId}::uuid, ${planId}::uuid, ${input.interval},
        ${input.fromAmountCents}::int, ${input.newAmountCents}::int,
        ${input.newStripePriceId}, ${input.createdByUserId}::text,
        ${input.now}::timestamptz
        FROM (SELECT count(*) FROM superseded) AS waited
      RETURNING "id"
    )
    SELECT (SELECT "id" FROM superseded LIMIT 1) AS superseded_id,
           (SELECT count(*) FROM inserted)::int AS inserted
  `);
  const [row] = result.rows as Array<{
    superseded_id: string | null;
    inserted: number;
  }>;
  if (row?.inserted !== 1) {
    throw new InternalServiceError('Price change insert wrote no row', {
      kind: subject.kind,
    });
  }
  const supersededId = row.superseded_id ?? null;
  if (olderIds.length > 0) {
    await tx.execute(sql`
      UPDATE ${subscriptionPriceMoves}
         SET "state" = 'superseded', "updated_at" = ${input.now}::timestamptz
       WHERE "price_change_id" IN (${sql.join(
         olderIds.map((id) => sql`${id}::uuid`),
         sql`, `
       )})
         AND ("state" IN ('due', 'notified')
              OR ("state" = 'held' AND "resolved_at" IS NULL))
    `);
  }
  return { changeId, supersededId };
}

/**
 * Count the rows just written onto the change. A change with nobody to tell
 * is `done` at once: the hourly step only finishes changes it has rows for.
 */
async function settleTotal(
  tx: PriceChangeTx,
  changeId: string,
  inserted: SQL,
  now: Date
): Promise<number> {
  const result = await tx.execute(sql`
    WITH inserted AS (${inserted})
    UPDATE ${priceChanges}
       SET "total_count" = (SELECT count(*) FROM inserted),
           "state" = CASE WHEN (SELECT count(*) FROM inserted) = 0
                          THEN 'done' ELSE "state" END,
           "done_at" = CASE WHEN (SELECT count(*) FROM inserted) = 0
                            THEN ${now}::timestamptz ELSE "done_at" END
     WHERE ${priceChanges.id} = ${changeId}::uuid
    RETURNING "total_count"
  `);
  const [row] = result.rows as Array<{ total_count: number }>;
  return Number(row?.total_count ?? 0);
}

/**
 * Record a tier's new price for one interval, in the tier save's own
 * transaction (data design §2.3): latest wins over the live change, then one
 * `due` row per subscription the change reaches, by `INSERT … SELECT`.
 *
 * Who it reaches: the tier's live subscriptions on the interval (active,
 * cancelling, past due, paused; not ended, not a duplicate), with Part A's
 * rules for waiting moves (Codex-2hxff.16):
 * 1. someone waiting to move AWAY from the tier is left out. The hourly step
 *    checks again before it writes, as a move can start after this;
 * 2. someone waiting to move TO it is included, with `floor_from` =
 *    `pending_tier_from` + 1 s: they move at the price they confirmed, and
 *    the new one starts at a later renewal.
 */
export async function recordTierPriceChange(
  tx: PriceChangeTx,
  tierId: string,
  input: RecordPriceChangeInput
): Promise<RecordedPriceChange> {
  const { changeId, supersededId } = await insertPriceChange(
    tx,
    { kind: 'tier', tierId },
    input
  );
  const total = await settleTotal(
    tx,
    changeId,
    sql`
      INSERT INTO ${subscriptionPriceMoves} ("price_change_id",
        "subscription_id", "stripe_subscription_id", "organization_id",
        "user_id", "floor_from", "created_at", "updated_at")
      SELECT ${changeId}::uuid, s."id", s."stripe_subscription_id",
             s."organization_id", s."user_id",
             CASE WHEN s."pending_tier_id" = ${tierId}::uuid
                  THEN s."pending_tier_from" + interval '1 second' END,
             ${input.now}::timestamptz, ${input.now}::timestamptz
        FROM ${subscriptions} s
       WHERE s."organization_id" = ${input.organizationId}::uuid
         AND s."billing_interval" = ${input.interval}
         AND s."status" IN (${repricedStatusList()})
         AND s."ended_at" IS NULL
         AND s."duplicate_of_subscription_id" IS NULL
         AND ((s."tier_id" = ${tierId}::uuid AND s."pending_tier_id" IS NULL)
              OR s."pending_tier_id" = ${tierId}::uuid)
      RETURNING 1
    `,
    input.now
  );
  return { changeId, total, supersededId };
}

/**
 * Record a course plan's new price for one interval, in the plan save's own
 * transaction: as {@link recordTierPriceChange}, over the plan's live course
 * subscriptions on the interval. A course subscription has no waiting move.
 */
export async function recordPlanPriceChange(
  tx: PriceChangeTx,
  planId: string,
  input: RecordPriceChangeInput
): Promise<RecordedPriceChange> {
  const { changeId, supersededId } = await insertPriceChange(
    tx,
    { kind: 'course_plan', planId },
    input
  );
  const total = await settleTotal(
    tx,
    changeId,
    sql`
      INSERT INTO ${subscriptionPriceMoves} ("price_change_id",
        "course_subscription_id", "stripe_subscription_id", "organization_id",
        "user_id", "created_at", "updated_at")
      SELECT ${changeId}::uuid, cs."id", cs."stripe_subscription_id",
             ${input.organizationId}::uuid, cs."user_id",
             ${input.now}::timestamptz, ${input.now}::timestamptz
        FROM ${courseSubscriptions} cs
       WHERE cs."plan_id" = ${planId}::uuid
         AND cs."billing_interval" = ${input.interval}
         AND cs."status" IN (${repricedStatusList()})
         AND cs."ended_at" IS NULL
         AND cs."duplicate_of_course_subscription_id" IS NULL
      RETURNING 1
    `,
    input.now
  );
  return { changeId, total, supersededId };
}

/** One member who pressed Keep current plan on a tier repriced while they waited. */
export interface RejoinPriceChangeInput {
  subscriptionId: string;
  stripeSubscriptionId: string;
  organizationId: string;
  userId: string;
  tierId: string;
  interval: 'month' | 'year';
  /** The tier's current Price for the interval, and its amount. */
  currentPriceId: string;
  currentAmountCents: number;
  /** What they pay now: the held Price Keep put back. */
  heldAmountCents: number;
  now: Date;
}

export type RejoinPriceChangeResult =
  /** A row now waits for the hourly step: written, or re-opened from `skipped`. */
  | { outcome: 'due'; changeId: string; moveId: string }
  /** The change already has them as due, told or held: nothing written. */
  | { outcome: 'already_on_it'; changeId: string }
  /**
   * The live change is for another Price than the tier's current one, so no
   * row can hang off it, and a second live change would break the one-live
   * rule. The caller alerts.
   */
  | { outcome: 'live_change_mismatch'; changeId: string };

/**
 * Keep current plan, on a tier repriced while the member was moving away
 * (Part A rule 3; data design §2.3): they are back at the old price and
 * nobody has told them the new one, so the change gets one `due` row for
 * them, `source = 'keep_current_plan'`. It hangs off the tier and interval's
 * latest change that isn't superseded, if that change's new Price is the
 * tier's current one; a `done` change goes back to `running`. With no such
 * change (the price was set before price moves were recorded), Keep writes a
 * change of its own for the current Price. The hourly step then treats the
 * row like any other: notice first, 30 days from their own email. A row the
 * change already has for them is re-opened only from `skipped` (the step
 * found them moving away): as `due`, or as `notified` if they had been told
 * before they left (the write only, from that email). Any other row is left
 * alone, or they would get a second email.
 */
export async function rejoinTierPriceChange(
  tx: PriceChangeTx,
  input: RejoinPriceChangeInput
): Promise<RejoinPriceChangeResult> {
  const latest = await tx.execute(sql`
    SELECT "id", "state", "new_stripe_price_id"
      FROM ${priceChanges}
     WHERE ${priceChanges.tierId} = ${input.tierId}::uuid
       AND ${priceChanges.interval} = ${input.interval}
       AND ${priceChanges.state} <> 'superseded'
     ORDER BY "created_at" DESC, "id" DESC
     LIMIT 1
     FOR UPDATE
  `);
  const [found] = latest.rows as Array<{
    id: string;
    state: string;
    new_stripe_price_id: string;
  }>;

  let changeId: string;
  if (found && found.new_stripe_price_id === input.currentPriceId) {
    changeId = found.id;
  } else if (
    found &&
    (found.state === 'running' || found.state === 'stopped')
  ) {
    return { outcome: 'live_change_mismatch', changeId: found.id };
  } else {
    changeId = crypto.randomUUID();
    await tx.execute(sql`
      INSERT INTO ${priceChanges} ("id", "organization_id", "kind", "tier_id",
        "interval", "from_amount_cents", "new_amount_cents",
        "new_stripe_price_id", "created_at")
      VALUES (${changeId}::uuid, ${input.organizationId}::uuid, 'tier',
        ${input.tierId}::uuid, ${input.interval},
        ${input.heldAmountCents}::int, ${input.currentAmountCents}::int,
        ${input.currentPriceId}, ${input.now}::timestamptz)
    `);
  }

  const upserted = await tx.execute(sql`
    INSERT INTO ${subscriptionPriceMoves} ("price_change_id", "subscription_id",
      "stripe_subscription_id", "organization_id", "user_id", "source",
      "created_at", "updated_at")
    VALUES (${changeId}::uuid, ${input.subscriptionId}::uuid,
      ${input.stripeSubscriptionId}, ${input.organizationId}::uuid,
      ${input.userId}, 'keep_current_plan', ${input.now}::timestamptz,
      ${input.now}::timestamptz)
    ON CONFLICT ("price_change_id", "subscription_id")
      WHERE "subscription_id" IS NOT NULL
    DO UPDATE SET "state" = CASE WHEN ${subscriptionPriceMoves.noticeAt} IS NULL
                                 THEN 'due' ELSE 'notified' END,
      "source" = 'keep_current_plan',
      "skip_reason" = NULL, "attempts" = 0, "attempted_at" = NULL,
      "next_attempt_at" = NULL, "last_error" = NULL,
      "updated_at" = EXCLUDED."updated_at"
      WHERE ${subscriptionPriceMoves.state} = 'skipped'
    RETURNING "id", (xmax = 0) AS inserted
  `);
  const [row] = upserted.rows as Array<{ id: string; inserted: boolean }>;
  if (!row) return { outcome: 'already_on_it', changeId };

  await tx.execute(sql`
    UPDATE ${priceChanges}
       SET "total_count" = "total_count" + ${row.inserted ? 1 : 0}::int,
           "state" = CASE WHEN "state" = 'done' THEN 'running' ELSE "state" END,
           "done_at" = CASE WHEN "state" = 'done' THEN NULL ELSE "done_at" END
     WHERE ${priceChanges.id} = ${changeId}::uuid
  `);
  return { outcome: 'due', changeId, moveId: row.id };
}

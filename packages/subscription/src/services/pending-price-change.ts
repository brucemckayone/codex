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
 *
 * Notice first, then move (owner decision D-P3, Codex-2hxff.43): nothing is
 * written to a subscription whose price changes until notifications-api has
 * accepted its notice. A notice that is not accepted leaves the subscriber on
 * today's price, and the caller raises an alert for support to retry.
 */

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
  /** When the subscriber is emailed. One value for a whole fan-out. */
  noticeAt: Date;
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
  | { kind: 'applied'; effectiveAt: Date; currentAmountCents: number | null }
  /** Notified, then marked pending: a later renewal swaps it. */
  | { kind: 'pending'; effectiveAt: Date; currentAmountCents: number | null }
  /** The notice was not accepted: nothing written, today's price stays. */
  | { kind: 'unnotified' }
  /** Same amount (e.g. a price set back): price id swapped silently, any pending change dropped. */
  | { kind: 'unchanged' }
  /** Not on the repriced interval, or nothing to bill. Left untouched. */
  | { kind: 'skipped'; reason: string };

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
 * `prefix` names the path ("Tier price propagation: ").
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

/** Cloudflare cancels a request's `waitUntil` work this long after the response. */
export const WAIT_UNTIL_LIMIT_MS = 30_000;

/**
 * A fan-out's last batch is done by this point, leaving the last 2 s of
 * `WAIT_UNTIL_LIMIT_MS` for its end summary and alert lines.
 */
export const FAN_OUT_DEADLINE_MS = 28_000;

/**
 * Each Stripe call a fan-out makes gives up after 3 s, and is not retried
 * (review A round 2, silent R2). The SDK's defaults (an 80 s timeout and two
 * retries) would let one slow call outlast the whole `waitUntil` budget.
 * stripe-node starts the timer when the call is made, so time spent queued
 * behind the runtime's six-connection limit counts against it too.
 */
export const FAN_OUT_STRIPE_TIMEOUT_MS = 3_000;

/**
 * The options every fan-out Stripe call passes (with its idempotency key, if
 * it has one).
 */
export const FAN_OUT_STRIPE_REQUEST = {
  timeout: FAN_OUT_STRIPE_TIMEOUT_MS,
  maxNetworkRetries: 0,
} as const satisfies Stripe.RequestOptions;

/**
 * The most Stripe calls one subscriber's path through `schedulePriceChange`
 * makes: the read, then one write (the swap, the pending marker, or a
 * same-amount swap or clear). Never two writes.
 */
export const FAN_OUT_STRIPE_CALLS_PER_SUBSCRIBER = 2;

/**
 * How long a fan-out waits for notifications-api to accept one notice. The
 * registry passes it to worker-utils' `sendEmailToWorkerAwaited`; a send
 * still running then is not accepted, so that subscriber is held back.
 */
export const PRICE_NOTICE_TIMEOUT_MS = 5_000;

/**
 * How long a price fan-out keeps STARTING batches (review A, silent #1 /
 * correctness #1).
 *
 * The fan-out runs after the response, on the request's `waitUntil`, and
 * Cloudflare gives ALL of a request's `waitUntil` work 30 s, then cancels what
 * is left with no record of which subscribers it reached. A batch's
 * subscribers run side by side, so the last batch, started just before the
 * budget runs out, needs at most one subscriber's worst-case path:
 *
 *     PRICE_FAN_OUT_BUDGET_MS                       17 s  (its latest start)
 *   + FAN_OUT_STRIPE_CALLS_PER_SUBSCRIBER
 *       x FAN_OUT_STRIPE_TIMEOUT_MS            2 x 3 s  =  6 s
 *   + PRICE_NOTICE_TIMEOUT_MS                            5 s
 *   = FAN_OUT_DEADLINE_MS                               28 s  (< 30 s)
 *
 * The clock starts before the subscribers are read, and before the response
 * goes, so the real margin is larger. Every subscriber not reached is named
 * in ONE alert (`alertFanOutOutOfTime`). The durable fix is to move the
 * fan-out off `waitUntil` (Codex-2hxff.86).
 */
export const PRICE_FAN_OUT_BUDGET_MS =
  FAN_OUT_DEADLINE_MS -
  FAN_OUT_STRIPE_CALLS_PER_SUBSCRIBER * FAN_OUT_STRIPE_TIMEOUT_MS -
  PRICE_NOTICE_TIMEOUT_MS;

/** At most this many subscribers per line of the out-of-time alert. */
export const FAN_OUT_ALERT_CHUNK = 200;

/**
 * Cloudflare records at most 256 KB of logs per invocation, then drops the
 * rest without a word ("Log size", Workers platform limits).
 */
export const WORKER_LOG_LIMIT_BYTES = 256 * 1024;

/**
 * An upper bound on one named subscriber in the out-of-time alert: four ids
 * (a row uuid, a Stripe subscription id, a user id, an organisation uuid)
 * and, on a course plan, the interval. About 210 to 240 bytes.
 */
export const FAN_OUT_ALERT_NAME_BYTES = 250;

/**
 * The out-of-time alert names at most this many subscribers, then points to
 * the Stripe query for the rest (review A round 2, silent R1). A tier's
 * monthly and annual fan-outs run in ONE invocation, so they share
 * `WORKER_LOG_LIMIT_BYTES`:
 *
 *     2 fan-outs x 300 names x FAN_OUT_ALERT_NAME_BYTES (250 B)  =  150 KB
 *
 * That leaves over 100 KB of the 256 KB for the start lines, the summaries
 * and the per-subscriber alerts.
 */
export const FAN_OUT_ALERT_MAX_NAMED = 300;

/**
 * Report every subscriber a fan-out did not reach, in ONE error alert: one
 * errorId on every line. Call it once per fan-out, after the end summary.
 *
 * 1. The count, first, so a log cut short still says how many and where to
 *    look.
 * 2. Up to `FAN_OUT_ALERT_MAX_NAMED` subscribers, `FAN_OUT_ALERT_CHUNK` to a
 *    line.
 * 3. For any beyond that: "and N more", pointing to the Stripe query in
 *    docs/payments/subscriptions.md.
 */
export function alertFanOutOutOfTime(
  logError: (message: string, data: Record<string, unknown>) => void,
  args: {
    errorId: string;
    context: Record<string, unknown>;
    subscribers: ReadonlyArray<Record<string, unknown>>;
  }
): void {
  const { errorId, context, subscribers } = args;
  if (subscribers.length === 0) return;
  const named = subscribers.slice(0, FAN_OUT_ALERT_MAX_NAMED);
  const more = subscribers.length - named.length;
  const chunks = Math.ceil(named.length / FAN_OUT_ALERT_CHUNK);
  logError(
    `Price fan-out ran out of time; ${subscribers.length} subscribers were not notified or moved (support: retry)`,
    {
      errorId,
      ...context,
      unhandled: subscribers.length,
      named: named.length,
      more,
      chunks,
    }
  );
  for (let chunk = 0; chunk < chunks; chunk++) {
    logError(
      'Price fan-out ran out of time; these subscribers were not notified or moved (support: retry)',
      {
        errorId,
        ...context,
        chunk: chunk + 1,
        chunks,
        subscribers: named.slice(
          chunk * FAN_OUT_ALERT_CHUNK,
          (chunk + 1) * FAN_OUT_ALERT_CHUNK
        ),
      }
    );
  }
  if (more > 0) {
    logError(
      `Price fan-out ran out of time: and ${more} more: find them with the Stripe query in docs/payments/subscriptions.md ("Held and unreached subscribers")`,
      { errorId, ...context, more }
    );
  }
}

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
  const item = subscription.items.data[0];
  if (!item) {
    return { kind: 'skipped', reason: 'subscription has no items' };
  }
  if (item.price.recurring?.interval !== target.interval) {
    // An interval change resets the billing cycle and charges at once — the
    // bug this replaces. Never cross intervals.
    return { kind: 'skipped', reason: 'subscription is on another interval' };
  }

  // An earlier change this subscription already carries, if any.
  const pendingPriceId = subscription.metadata?.[PENDING_PRICE_ID_KEY];
  const pendingFrom = Number(subscription.metadata?.[PENDING_PRICE_FROM_KEY]);
  const currentPending =
    pendingPriceId && Number.isFinite(pendingFrom) && pendingFrom > 0
      ? { priceId: pendingPriceId, from: new Date(pendingFrom * 1000) }
      : null;

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

  const earliest =
    Math.floor(target.noticeAt.getTime() / 1000) + PRICE_CHANGE_NOTICE_SECONDS;
  const nextRenewal = item.current_period_end;
  const move =
    nextRenewal >= earliest && canSwapNow(subscription.status)
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
  // notice time, so a re-run fan-out within Stripe's 24h key window would
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

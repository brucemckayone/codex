/**
 * Waiting changes of billing period (Codex-2hxff.97; data design §1-§2).
 *
 * Leaving yearly billing waits for the end of the paid year, with nothing
 * charged or credited today: a switch's credit for the unused year would sit
 * on the member's one Stripe customer and pay their next bill from ANY
 * organisation. The downgrade mechanism (a no-proration swap now) cannot
 * carry it: under flexible billing a monthly Price on the item makes the
 * current period a month, cutting the paid year short (proof P0). So a
 * change of billing rides a Stripe subscription schedule, and only while one
 * waits: phase 1 is the paid year unchanged, phase 2 the monthly Price from
 * the renewal with no proration, `end_behavior: 'release'`.
 *
 * Our own record of the change is the waiting move's metadata (tier-move.ts)
 * plus the three keys here, written to the subscription BEFORE the schedule
 * so every later event snapshot carries it. The schedule is tagged
 * `codex_billing_change` by its first update: Stripe refuses metadata at
 * `from_subscription` create, so `subscription_schedule.created` always
 * arrives untagged.
 *
 * No imports from tier-move.ts or pending-price-change.ts: both read these
 * keys, and tier-move.ts imports pending-price-change.ts.
 */

import { InternalServiceError } from '@codex/service-errors';
import type Stripe from 'stripe';

/** Metadata key: the interval a waiting change of billing lands on. */
export const MOVE_INTERVAL_KEY = 'codex_move_interval';
/** Metadata key: phase 2's Price, billed from the renewal. */
export const MOVE_PRICE_ID_KEY = 'codex_move_price_id';
/** Metadata key: that Price's amount in pence, the next bill (no schedule read). */
export const MOVE_AMOUNT_KEY = 'codex_move_amount';

/** Clears a waiting change of billing's own keys ('' deletes a key). */
export const CLEAR_BILLING_METADATA: Record<string, string> = {
  [MOVE_INTERVAL_KEY]: '',
  [MOVE_PRICE_ID_KEY]: '',
  [MOVE_AMOUNT_KEY]: '',
};

/** Schedule metadata key: the schedule is ours, carrying a waiting change of billing. */
const BILLING_CHANGE_KEY = 'codex_billing_change';

/** The part of a waiting move that changes the billing period. */
export interface WaitingBilling {
  interval: 'month' | 'year';
  /** Phase 2's Price. */
  priceId: string;
  /** Its amount: the first bill after the change. */
  amountCents: number;
}

/**
 * The waiting change of billing a subscription's metadata describes, or
 * null. All three keys or none, as the row's CHECK holds them.
 */
export function readWaitingBilling(
  metadata: Record<string, string> | null | undefined
): WaitingBilling | null {
  const interval = metadata?.[MOVE_INTERVAL_KEY];
  const priceId = metadata?.[MOVE_PRICE_ID_KEY];
  const amount = metadata?.[MOVE_AMOUNT_KEY];
  if (
    (interval !== 'month' && interval !== 'year') ||
    !priceId ||
    amount === undefined ||
    !/^\d+$/.test(amount)
  ) {
    return null;
  }
  return { interval, priceId, amountCents: Number(amount) };
}

/** The metadata writing a waiting change of billing adds to a waiting move's. */
export function billingMetadata(
  billing: WaitingBilling
): Record<string, string> {
  return {
    [MOVE_INTERVAL_KEY]: billing.interval,
    [MOVE_PRICE_ID_KEY]: billing.priceId,
    [MOVE_AMOUNT_KEY]: String(billing.amountCents),
  };
}

/** The schedule a subscription is attached to, by id, or null. */
export function scheduleIdOf(
  subscription: Pick<Stripe.Subscription, 'schedule'>
): string | null {
  const { schedule } = subscription;
  if (!schedule) return null;
  return typeof schedule === 'string' ? schedule : schedule.id;
}

/**
 * The schedule is ours: tagged by our update, or untagged beside our own
 * record of a waiting change of billing (we write the record first, so an
 * untagged schedule next to it is ours, half made: created, then the update
 * that tags it failed or never ran). Any other schedule is someone else's,
 * one made in the Stripe Dashboard for example, and we never write through
 * it (`SUBSCRIPTION_SCHEDULED_ELSEWHERE`).
 */
export function isOurSchedule(
  schedule: Pick<Stripe.SubscriptionSchedule, 'metadata'>,
  subscriptionMetadata: Record<string, string> | null | undefined
): boolean {
  if (schedule.metadata?.[BILLING_CHANGE_KEY]) return true;
  return isHalfMadeSchedule(schedule, subscriptionMetadata);
}

/**
 * Ours and half made: untagged, beside our record. Never one with a tag of
 * any kind, ours included.
 */
export function isHalfMadeSchedule(
  schedule: Pick<Stripe.SubscriptionSchedule, 'metadata'>,
  subscriptionMetadata: Record<string, string> | null | undefined
): boolean {
  const untagged = Object.keys(schedule.metadata ?? {}).length === 0;
  return untagged && readWaitingBilling(subscriptionMetadata) !== null;
}

/**
 * Our schedule does not carry the waiting change its record describes
 * (review C1 cycle 2, L2): half made (untagged, the paid year only, so it
 * lets go at the year's end and the year renews yearly), or phase 2 an
 * earlier choice's (an update in place that failed, its record not put
 * back). Finished reads as our update writes it: tagged, two phases, and
 * phase 2 `priceId` with `flip` as its metadata. So the event that update
 * fires finds nothing to do.
 */
export function scheduleNeedsFinishing(
  schedule: Pick<Stripe.SubscriptionSchedule, 'metadata' | 'phases'>,
  priceId: string,
  flip: Record<string, string>
): boolean {
  if (!schedule.metadata?.[BILLING_CHANGE_KEY]) return true;
  const [, next, ...more] = schedule.phases;
  if (!next || more.length > 0) return true;
  const price = next.items[0]?.price;
  if (!price || priceIdOf(price) !== priceId) return true;
  // '' deletes a key, so a missing key reads as ''.
  return Object.entries(flip).some(
    ([key, value]) => (next.metadata?.[key] ?? '') !== value
  );
}

/** Phase 2's Price, or null for a schedule with the paid year only. */
export function phaseTwoPriceId(
  schedule: Pick<Stripe.SubscriptionSchedule, 'phases'>
): string | null {
  const price = schedule.phases[1]?.items[0]?.price;
  return price ? priceIdOf(price) : null;
}

/**
 * The schedule is in its last phase: the change of billing has landed at the
 * renewal, and releasing it frees the subscription now rather than a month on
 * (when the one-month phase releases it anyway, proof P6).
 */
export function onLastPhase(
  schedule: Pick<Stripe.SubscriptionSchedule, 'current_phase' | 'phases'>
): boolean {
  const last = schedule.phases[schedule.phases.length - 1];
  return (
    schedule.current_phase !== null &&
    last !== undefined &&
    schedule.current_phase.start_date === last.start_date
  );
}

const priceIdOf = (
  price: string | Stripe.Price | Stripe.DeletedPrice
): string => (typeof price === 'string' ? price : price.id);

/**
 * The schedule update that carries a change of billing (§2.2 step 3): the
 * current phase exactly as it stands (the paid year: its items and dates,
 * no proration), then the new Price for one month from its end with `flip`
 * as phase metadata (the tier becomes the target and the move's keys go, in
 * the same update as the price, proof P6). One month, then `release`: the
 * subscription carries on monthly by itself. Phases are re-sent whole: Stripe
 * unsets what an update leaves out.
 */
export function billingScheduleUpdate(args: {
  schedule: Pick<Stripe.SubscriptionSchedule, 'current_phase' | 'phases'>;
  priceId: string;
  flip: Record<string, string>;
  environment: string;
  envKey: string;
  subscriptionId: string;
}): Stripe.SubscriptionScheduleUpdateParams {
  const { schedule } = args;
  const current =
    schedule.phases.find(
      (phase) => phase.start_date === schedule.current_phase?.start_date
    ) ?? schedule.phases[0];
  if (!current) {
    throw new InternalServiceError('A subscription schedule has no phase', {
      subscriptionId: args.subscriptionId,
    });
  }
  return {
    end_behavior: 'release',
    proration_behavior: 'none',
    metadata: {
      [args.envKey]: args.environment,
      [BILLING_CHANGE_KEY]: 'waiting',
      codex_subscription_id: args.subscriptionId,
    },
    phases: [
      {
        items: current.items.map((item) => ({
          price: priceIdOf(item.price),
          quantity: item.quantity ?? 1,
        })),
        start_date: current.start_date,
        end_date: current.end_date,
        proration_behavior: 'none',
      },
      {
        items: [{ price: args.priceId, quantity: 1 }],
        duration: { interval: 'month', interval_count: 1 },
        proration_behavior: 'none',
        metadata: args.flip,
      },
    ],
  };
}

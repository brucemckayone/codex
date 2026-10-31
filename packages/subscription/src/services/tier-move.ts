/**
 * Waiting tier moves — a move to a cheaper plan waits for the end of the
 * period the member has paid for (Codex-2hxff.16, owner decisions T1-T6 and
 * Q1-Q4; docs/payments/subscriptions.md → Changing tier).
 *
 * The mechanism is the price-change machinery's IMMEDIATE path, not a Stripe
 * subscription schedule (owner decision T1): a same-interval swap with
 * `proration_behavior: 'none'` puts the cheaper Price on the item now, so the
 * renewal Stripe drafts at the period end bills it, and nothing is charged or
 * credited today. Access must not move early, so `codex_tier_id` stays on the
 * current tier and a hold marker records what the period was paid at:
 *
 *   - `codex_move_tier_id` / `codex_move_at`: where the member goes, and the
 *     renewal (unix seconds) it lands on;
 *   - `codex_hold_price_id` / `codex_hold_amount`: the exact Price the period
 *     was paid at, which Keep current plan puts back (never the tier's
 *     current Price: a grandfathered member stays grandfathered);
 *   - `codex_hold_pending_price_*`: a price change on the tier they leave,
 *     parked while the move waits.
 *
 * The first move writes the hold keys; a replacement (latest wins, T2) keeps
 * them, or Keep would put the member on the first target's price. The renewal
 * flips `codex_tier_id` and clears every key (`applyDueTierMove` in
 * SubscriptionService). Our `subscriptions` row mirrors the move in
 * `pending_tier_id`, `pending_tier_from` and `held_amount_cents`, all three
 * or none.
 *
 * `codex_pending_price_*` (pending-price-change.ts) keeps its own meaning,
 * "swap at a later renewal", and is never used for the move itself.
 */

import {
  PENDING_PRICE_FROM_KEY,
  PENDING_PRICE_ID_KEY,
} from './pending-price-change';

/** Metadata key: the tier the member moves to at the renewal. */
export const MOVE_TIER_ID_KEY = 'codex_move_tier_id';
/** Metadata key: unix seconds — the renewal the move lands on. */
const MOVE_AT_KEY = 'codex_move_at';
/** Metadata key: the Price the current period was paid at. */
const HOLD_PRICE_ID_KEY = 'codex_hold_price_id';
/** Metadata key: that Price's amount, in pence. */
const HOLD_AMOUNT_KEY = 'codex_hold_amount';
/** Metadata key: a `codex_pending_price_id` parked while the move waits. */
const HOLD_PENDING_PRICE_ID_KEY = 'codex_hold_pending_price_id';
/** Metadata key: its `codex_pending_price_from`. */
const HOLD_PENDING_PRICE_FROM_KEY = 'codex_hold_pending_price_from';

/** Setting a metadata key to '' deletes it in Stripe. */
export const CLEAR_MOVE_METADATA: Record<string, string> = {
  [MOVE_TIER_ID_KEY]: '',
  [MOVE_AT_KEY]: '',
};

/** Clears the hold marker, parked price change included. */
export const CLEAR_HOLD_METADATA: Record<string, string> = {
  [HOLD_PRICE_ID_KEY]: '',
  [HOLD_AMOUNT_KEY]: '',
  [HOLD_PENDING_PRICE_ID_KEY]: '',
  [HOLD_PENDING_PRICE_FROM_KEY]: '',
};

/** A move to a cheaper plan that waits for the renewal, as the metadata holds it. */
export interface WaitingMove {
  tierId: string;
  /** Unix seconds: the renewal it lands on (the period end when it was chosen). */
  at: number;
  holdPriceId: string;
  holdAmountCents: number;
  /** A price change on the tier being left, parked until Keep or the flip. */
  parkedPendingPrice: { priceId: string; from: string } | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Digits only: `Number('')` is 0, which would read a missing amount as £0. */
function wholeNumber(value: string | undefined): number | null {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : null;
}

/**
 * The waiting move a subscription's metadata describes, or null. Half a move
 * (a key missing or unreadable) reads as none: the row can only hold all
 * three columns or none (`check_subscription_pending_move`), and only our
 * own single writes set these keys.
 */
export function readWaitingMove(
  metadata: Record<string, string> | null | undefined
): WaitingMove | null {
  const tierId = metadata?.[MOVE_TIER_ID_KEY];
  const at = wholeNumber(metadata?.[MOVE_AT_KEY]);
  const holdPriceId = metadata?.[HOLD_PRICE_ID_KEY];
  const holdAmountCents = wholeNumber(metadata?.[HOLD_AMOUNT_KEY]);
  if (
    !tierId ||
    !UUID.test(tierId) ||
    at === null ||
    at <= 0 ||
    !holdPriceId ||
    holdAmountCents === null
  ) {
    return null;
  }
  const parkedId = metadata?.[HOLD_PENDING_PRICE_ID_KEY];
  const parkedFrom = metadata?.[HOLD_PENDING_PRICE_FROM_KEY];
  return {
    tierId,
    at,
    holdPriceId,
    holdAmountCents,
    parkedPendingPrice:
      parkedId && parkedFrom ? { priceId: parkedId, from: parkedFrom } : null,
  };
}

/**
 * The metadata a move writes (§2.1). The first move also writes the hold
 * marker: the Price and amount the period was paid at, and copies of any
 * `codex_pending_price_*` (parked: a price change on the tier being left
 * stops being live). A replacement (latest wins) writes only the new target
 * and leaves the hold keys as they are. Either way the live
 * `codex_pending_price_*` is cleared: one on the tier being left is parked,
 * and one on an earlier target belonged to that target.
 */
export function moveMetadata(args: {
  currentTierId: string;
  userId: string;
  organizationId: string;
  targetTierId: string;
  moveAt: number;
  /** Set on the first move; absent on a replacement. */
  hold?: {
    priceId: string;
    amountCents: number;
    metadata: Record<string, string> | null | undefined;
  };
}): Record<string, string> {
  const { hold } = args;
  return {
    codex_tier_id: args.currentTierId,
    codex_user_id: args.userId,
    codex_organization_id: args.organizationId,
    [MOVE_TIER_ID_KEY]: args.targetTierId,
    [MOVE_AT_KEY]: String(args.moveAt),
    ...(hold && {
      [HOLD_PRICE_ID_KEY]: hold.priceId,
      [HOLD_AMOUNT_KEY]: String(hold.amountCents),
      [HOLD_PENDING_PRICE_ID_KEY]: hold.metadata?.[PENDING_PRICE_ID_KEY] ?? '',
      [HOLD_PENDING_PRICE_FROM_KEY]:
        hold.metadata?.[PENDING_PRICE_FROM_KEY] ?? '',
    }),
    [PENDING_PRICE_ID_KEY]: '',
    [PENDING_PRICE_FROM_KEY]: '',
  };
}

/**
 * Keep current plan's metadata (§4): the move and the hold marker go, and a
 * price change parked from the held tier is live again. One on the target
 * (T6) belonged to the target, so it is cleared.
 */
export function keepMetadata(move: WaitingMove): Record<string, string> {
  return {
    ...CLEAR_MOVE_METADATA,
    ...CLEAR_HOLD_METADATA,
    [PENDING_PRICE_ID_KEY]: move.parkedPendingPrice?.priceId ?? '',
    [PENDING_PRICE_FROM_KEY]: move.parkedPendingPrice?.from ?? '',
  };
}

/**
 * The flip's metadata (§5.1): the tier becomes the target and the move and
 * hold keys go (a parked price change belonged to the tier they left).
 * `codex_pending_price_*` is left alone: a price change on the target (T6)
 * lands later through `applyDuePendingPriceChange`, as usual.
 */
export function flipMetadata(move: WaitingMove): Record<string, string> {
  return {
    codex_tier_id: move.tierId,
    ...CLEAR_MOVE_METADATA,
    ...CLEAR_HOLD_METADATA,
  };
}

// ─── Which change happens when (data design §1) ────────────────────────────

/** What a change of plan does, once it is allowed. */
export type TierChangeKind =
  /** Another tier on the same billing, dearer: now, the part-period difference charged. */
  | 'upgrade'
  /** The same tier on the other billing period: now, as today (credit or charge). */
  | 'interval_switch'
  /** Another tier on the other billing period, not cheaper (Q1): now, Stripe's proration across periods. */
  | 'cross_period_change'
  /** Another tier on the same billing at the same price (Q4): now, nothing charged or credited. */
  | 'lateral'
  /** Another tier on the same billing, cheaper (T1): waits for the period end. */
  | 'downgrade';

/** Why a change of plan is refused before Stripe is written to. */
export type TierChangeRefusal =
  /** Set to cancel (Q2): reactivate first. */
  | 'cancelling'
  /** A dearer change while a move waits (T2): keep the current plan first. */
  | 'keep_first'
  /** A switch of billing on the same tier while a move waits (Q3). */
  | 'interval_while_moving'
  /** A cheaper tier on another billing period (T1, Q1): the plan first. */
  | 'two_steps';

export interface TierChangeFacts {
  currentTierId: string;
  currentInterval: 'month' | 'year';
  /**
   * What the member pays now for the current tier: the held amount while a
   * move waits (the item then carries the cheaper Price), else the
   * subscription's amount (§2.2 trap 2).
   */
  currentAmountCents: number;
  targetTierId: string;
  targetInterval: 'month' | 'year';
  /**
   * The target tier's price on the member's CURRENT billing period: "cheaper"
   * compares plans on the same period, as the pricing page's buttons do (Q1).
   */
  targetAmountOnCurrentIntervalCents: number;
  moveWaiting: boolean;
  cancelling: boolean;
}

/**
 * Classify a change of plan (data design §1, every row). "Up or down" is
 * judged by price, on the member's current billing period (Q1). A dispute is
 * refused before this (`assertNotDisputed`).
 */
export function classifyTierChange(
  facts: TierChangeFacts
): { kind: TierChangeKind } | { refused: TierChangeRefusal } {
  if (facts.cancelling) return { refused: 'cancelling' };

  const sameBilling = facts.targetInterval === facts.currentInterval;
  const target = facts.targetAmountOnCurrentIntervalCents;
  const paid = facts.currentAmountCents;

  if (!sameBilling) {
    if (facts.targetTierId === facts.currentTierId) {
      return facts.moveWaiting
        ? { refused: 'interval_while_moving' }
        : { kind: 'interval_switch' };
    }
    if (target < paid) return { refused: 'two_steps' };
    // Money moves at once, worked out from the item, which carries the
    // cheaper Price while a move waits.
    return facts.moveWaiting
      ? { refused: 'keep_first' }
      : { kind: 'cross_period_change' };
  }

  // The plan they are on while a move waits is Keep current plan, which
  // puts back the exact Price paid and any parked price change; a switch
  // now would put the tier's current Price on and lose both.
  if (facts.moveWaiting && facts.targetTierId === facts.currentTierId) {
    return { refused: 'keep_first' };
  }
  if (target > paid) {
    return facts.moveWaiting ? { refused: 'keep_first' } : { kind: 'upgrade' };
  }
  if (target < paid) return { kind: 'downgrade' };
  return { kind: 'lateral' };
}

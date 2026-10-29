/**
 * Money owed TO a payee after a late take-back: support's actions on a
 * `payee_credits` row (Codex-2hxff.73; owner decisions Q8-Q11, OQ3, OQ4; data
 * design §7). The rows are written where the late take-back is found
 * (`claimLost` and `recordPayeeCredit` in clawback.ts, and a stranded
 * cancellation's decision in repay.ts); these settle them.
 *
 * - Re-pay writes one pending re-pay payout for what Stripe took, linked on
 *   the step (`repaid_by_payout_id`), so the engine reads it as the slice's
 *   re-pay (§7.5); the next drain pays it. Nothing moves money here.
 * - Count it against this debt settles the step's own open debt with the
 *   credit, re-paying nothing (Q11), only when Stripe took exactly the debt.
 * - Not owed closes it with support's note.
 * - Check Stripe again asks Stripe what an unverified row's step took.
 * - A cancellation the ledger cannot attribute to its step is support's to
 *   decide after checking in Stripe: Re-pay (the cancelled share) or Not
 *   owed, both with a note (owner decision 2026-10-28, review MED-3).
 */

import {
  type PayeeCredit,
  type Payout,
  type PayoutReversal,
  payeeCredits,
  payoutReversals,
  payouts,
  refundReviews,
} from '@codex/database/schema';
import {
  BusinessLogicError,
  ConflictError,
  InternalServiceError,
  NotFoundError,
} from '@codex/service-errors';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  type ClawbackDeps,
  cancellationAttribution,
  cancellationAttributionOf,
  cancelledShareOf,
  findLandedReversal,
  isDefinitiveStripeError,
  MAX_CLAWBACK_ATTEMPTS,
  type SliceTaken,
} from './clawback';
import { lateTransferOf } from './payout-ledger';
import { insertRepayRow, PAYEE_PAID_RESOLUTIONS } from './repay';

/**
 * The codes a refused credit action carries in its context. Each tells
 * support something different to do. Not exported: admin passes the errors
 * through as they are, and the web matches the strings, as for
 * `REFUND_REPAY_CODES` (repay.ts).
 */
const CREDIT_CODES = {
  /** Re-pay refused: the take-back paid the step's own open debt; count it against that instead. */
  DEBT_STILL_OPEN: 'CREDIT_DEBT_STILL_OPEN',
  /** Count against refused: the debt was settled meanwhile; re-pay instead. */
  DEBT_ALREADY_CLOSED: 'CREDIT_DEBT_ALREADY_CLOSED',
  /** Count against refused: not its own open debt of the same amount (OQ4); re-pay instead. */
  NOT_COUNTABLE: 'CREDIT_NOT_COUNTABLE',
  /** Stripe never said it took anything: check Stripe again first. */
  NEEDS_CHECK: 'CREDIT_NEEDS_CHECK',
  /** A needs-person row's Re-pay: say what Stripe showed (MED-3). */
  NOTE_REQUIRED: 'CREDIT_NOTE_REQUIRED',
  /** The step was already paid back by another path: settle it by hand. */
  SETTLE_BY_HAND: 'CREDIT_SETTLE_BY_HAND',
  /** A sibling step on the slice can still finish: try again later. */
  SIBLING_UNFINISHED: 'CREDIT_SIBLING_UNFINISHED',
  /** Settled already, another way. */
  ALREADY_SETTLED: 'ALREADY_SETTLED',
} as const;

type Tx = Parameters<Parameters<ClawbackDeps['db']['transaction']>[0]>[0];
/** The database, or a transaction on it. */
type Client = ClawbackDeps['db'] | Tx;

/** What support may do with an open credit (`supportResolveCreditSchema`). */
export type PayeeCreditAction = 'repay' | 'count_against_debt' | 'not_owed';

const RESOLUTION_OF = {
  repay: 'repaid',
  count_against_debt: 'debt_collected',
  not_owed: 'not_owed',
} as const satisfies Record<PayeeCreditAction, string>;

export interface ResolvePayeeCreditInput {
  creditId: string;
  action: PayeeCreditAction;
  /**
   * Support's note: required for `not_owed` (the schema refuses ''), and for
   * a needs-person row's `repay` (refused here); else optional.
   */
  note: string;
  resolvedByUserId: string;
}

export interface ResolvedPayeeCredit {
  credit: PayeeCredit;
  /** `repaid`: the pending re-pay payout. */
  repayPayout: Payout | null;
  /** The same action, repeated: nothing was written. */
  repeated: boolean;
}

/**
 * Settle an open credit, in one transaction with the credit locked
 * (data design §7.4), so two clicks write one re-pay at most:
 *
 * - `repay`: only a confirmed credit. One whose take-back paid the step's own
 *   open debt (same amount) is refused, 409 `CREDIT_DEBT_STILL_OPEN`: the
 *   one action is Count against. A `done` step, or one another path already
 *   re-paid, is refused, 422 `CREDIT_SETTLE_BY_HAND`, with an alert. Else a
 *   pending re-pay row for `amount_cents` (what Stripe took), linked on the
 *   step, and the credit `repaid`. A debt of another amount stays open (OQ4).
 * - `count_against_debt`: only while the step's own debt is open and Stripe
 *   took exactly its amount (Q11, OQ4). The review closes `creator_absorbed`
 *   and the credit `debt_collected`; nothing is re-paid. A later won dispute
 *   still re-pays the payee, as for any debt they paid (`repayDispute`).
 * - `not_owed`: closed with support's note.
 *
 * An unverified credit is refused Re-pay, 422 `CREDIT_NEEDS_CHECK`, except a
 * needs-person one (`needsAPersonOf`: a cancellation the ledger cannot
 * attribute to its step): support checked in Stripe, so Re-pay pays the
 * cancelled share, as for `slice_cancelled`, and needs a note saying what
 * Stripe showed (422 `CREDIT_NOTE_REQUIRED`); it cannot be counted against a
 * debt (422 `CREDIT_NOT_COUNTABLE`). Owner decision 2026-10-28, review MED-3.
 *
 * The same action repeated returns the row as it stands; another is 409
 * `ALREADY_SETTLED`, as `resolveCreatorDebt` answers.
 */
export async function resolvePayeeCredit(
  deps: Pick<ClawbackDeps, 'db' | 'obs'>,
  input: ResolvePayeeCreditInput
): Promise<ResolvedPayeeCredit> {
  const resolution = RESOLUTION_OF[input.action];
  const result = await deps.db.transaction(async (tx) => {
    const [credit] = await tx
      .select()
      .from(payeeCredits)
      .where(eq(payeeCredits.id, input.creditId))
      .limit(1)
      .for('update');
    if (!credit) {
      throw new NotFoundError('No payee credit with this id', {
        creditId: input.creditId,
      });
    }
    if (credit.resolvedAt) {
      if (credit.resolution !== resolution) {
        throw new ConflictError('This was already settled another way.', {
          code: CREDIT_CODES.ALREADY_SETTLED,
          resolution: credit.resolution,
        });
      }
      const [repayPayout] = credit.repayPayoutId
        ? await tx
            .select()
            .from(payouts)
            .where(eq(payouts.id, credit.repayPayoutId))
            .limit(1)
        : [];
      return { credit, repayPayout: repayPayout ?? null, repeated: true };
    }

    const now = new Date();
    const settle = async (extra: Partial<PayeeCredit> = {}) => {
      const [settled] = await tx
        .update(payeeCredits)
        .set({
          resolution,
          resolvedAt: now,
          resolvedByUserId: input.resolvedByUserId,
          resolutionNote: input.note === '' ? null : input.note,
          ...extra,
        })
        .where(
          and(eq(payeeCredits.id, credit.id), isNull(payeeCredits.resolvedAt))
        )
        .returning();
      // Locked and open above: missing it would commit half a settle.
      if (!settled) {
        throw new InternalServiceError(
          'The payee credit could not be settled',
          {
            creditId: credit.id,
          }
        );
      }
      return settled;
    };

    if (input.action === 'not_owed') {
      return { credit: await settle(), repayPayout: null, repeated: false };
    }
    let amountCents = credit.amountCents;
    // A needs-person row's Re-pay confirms it, in the same write: the
    // cancelled share is owed, as support saw in Stripe.
    let confirmed: Partial<PayeeCredit> = {};
    if (credit.effect === 'unverified') {
      const person = await needsAPersonOf(tx, credit, true);
      if (!person) {
        throw new BusinessLogicError(
          'Stripe has not said it took this yet. Check Stripe again first.',
          { code: CREDIT_CODES.NEEDS_CHECK }
        );
      }
      if (input.action !== 'repay') {
        throw new BusinessLogicError(
          'Only a take-back of exactly its own open debt can be counted against it. Re-pay what Stripe took instead.',
          { code: CREDIT_CODES.NOT_COUNTABLE }
        );
      }
      if (input.note === '') {
        throw new BusinessLogicError(
          'Say what you saw in Stripe before re-paying this.',
          { code: CREDIT_CODES.NOTE_REQUIRED }
        );
      }
      // Another step on the slice is done or re-paid: the ledger already
      // has that step taking the share, and its cause re-pays it. Re-paid
      // here too, it would be paid twice (round 2 MED-1).
      if (person.siblingTook) {
        deps.obs.error(
          'A needs-person payee credit was not re-paid: another step on its slice is done or already re-paid, so the share may be paid back twice. Settle it by hand',
          {
            errorId: crypto.randomUUID(),
            creditId: credit.id,
            payoutReversalId: credit.payoutReversalId,
            payoutId: credit.payoutId,
          }
        );
        throw new BusinessLogicError(
          'This was already paid back another way. Settle it by hand.',
          { code: CREDIT_CODES.SETTLE_BY_HAND }
        );
      }
      // A sibling can still finish: its retry would mark it done, and its
      // cause would re-pay that share too (round 3 LOW-1).
      if (person.siblingRunning) {
        throw new BusinessLogicError(
          'Another take-back on this share is still running. Try again once it has finished.',
          { code: CREDIT_CODES.SIBLING_UNFINISHED }
        );
      }
      amountCents = await cancelledShareOf(tx, person.slice);
      confirmed = { effect: 'slice_cancelled', amountCents };
    }
    if (
      (credit.effect !== 'reversal_landed' &&
        credit.effect !== 'slice_cancelled' &&
        credit.effect !== 'unverified') ||
      amountCents === null
    ) {
      throw new BusinessLogicError(
        'Stripe has not said it took this yet. Check Stripe again first.',
        { code: CREDIT_CODES.NEEDS_CHECK }
      );
    }
    // Locked, as `resolveCreatorDebt` and a won dispute's `settleDebt` lock
    // it: a debt settled at the same moment waits for this.
    const [review] =
      credit.settledAs === 'debt'
        ? await tx
            .select()
            .from(refundReviews)
            .where(eq(refundReviews.payoutReversalId, credit.payoutReversalId))
            .limit(1)
            .for('update')
        : [];
    const ownOpenDebt =
      review !== undefined &&
      review.resolvedAt === null &&
      review.attemptedReversalCents === amountCents;

    if (input.action === 'count_against_debt') {
      if (review?.resolvedAt) {
        throw new ConflictError(
          'That debt was settled meanwhile. Re-pay what Stripe took instead.',
          { code: CREDIT_CODES.DEBT_ALREADY_CLOSED }
        );
      }
      if (!review || !ownOpenDebt) {
        throw new BusinessLogicError(
          'Only a take-back of exactly its own open debt can be counted against it. Re-pay what Stripe took instead.',
          { code: CREDIT_CODES.NOT_COUNTABLE }
        );
      }
      await tx
        .update(refundReviews)
        .set({
          resolution: 'creator_absorbed',
          resolvedAt: now,
          resolvedByUserId: input.resolvedByUserId,
          resolutionNote: credit.stripeReversalId
            ? `Collected by a late take-back ${credit.stripeReversalId}`
            : 'Collected by a late take-back',
        })
        .where(
          and(eq(refundReviews.id, review.id), isNull(refundReviews.resolvedAt))
        );
      return { credit: await settle(), repayPayout: null, repeated: false };
    }

    if (ownOpenDebt) {
      throw new ConflictError(
        "This take-back paid the share's own open debt. Count it against that debt instead.",
        { code: CREDIT_CODES.DEBT_STILL_OPEN }
      );
    }
    const [step] = await tx
      .select()
      .from(payoutReversals)
      .where(eq(payoutReversals.id, credit.payoutReversalId))
      .limit(1)
      .for('update');
    if (!step) {
      throw new InternalServiceError('The payee credit names no step', {
        creditId: credit.id,
      });
    }
    // The step's link is a payee-paid debt's own re-pay (owner decision
    // 2026-10-28 on review MED-4, "Still re-pay the £10": the two re-pays
    // are independent, round 2 LOW-3). This one then goes ahead unlinked,
    // carried by `repay_payout_id` alone, as in the other order
    // (`repayDebtStep`).
    const besideDebtRepay =
      step.repaidByPayoutId !== null &&
      step.status === 'debt' &&
      review?.resolvedAt != null &&
      review.resolution !== null &&
      PAYEE_PAID_RESOLUTIONS.has(review.resolution) &&
      !(await isCreditRepay(tx, step.repaidByPayoutId));
    // Nothing left of a needs-person row's share (`check_payee_credits_amount`
    // needs more than zero): a person settles it too.
    if (
      credit.settledAs === 'done' ||
      (step.repaidByPayoutId !== null && !besideDebtRepay) ||
      amountCents <= 0
    ) {
      // A second re-pay could not be linked on the step, and the engine
      // reads the link as the slice's re-pay (§7.5): a person settles it.
      deps.obs.error(
        'A payee credit is on a step another path has already paid back: not re-paid; settle it by hand',
        {
          errorId: crypto.randomUUID(),
          creditId: credit.id,
          payoutReversalId: step.id,
          payoutId: step.payoutId,
          repaidByPayoutId: step.repaidByPayoutId,
          settledAs: credit.settledAs,
          stripeReversalId: credit.stripeReversalId,
          amountCents,
        }
      );
      throw new BusinessLogicError(
        'This was already paid back another way. Settle it by hand.',
        { code: CREDIT_CODES.SETTLE_BY_HAND }
      );
    }
    const [slice] = await tx
      .select()
      .from(payouts)
      .where(eq(payouts.id, step.payoutId))
      .limit(1);
    if (!slice) {
      throw new InternalServiceError("The payee credit's payout is missing", {
        creditId: credit.id,
      });
    }
    const repayPayout = await insertRepayRow(tx, slice, amountCents);
    if (besideDebtRepay) {
      return {
        credit: await settle({ ...confirmed, repayPayoutId: repayPayout.id }),
        repayPayout,
        repeated: false,
      };
    }
    const [linked] = await tx
      .update(payoutReversals)
      .set({ repaidByPayoutId: repayPayout.id })
      .where(
        and(
          eq(payoutReversals.id, step.id),
          isNull(payoutReversals.repaidByPayoutId)
        )
      )
      .returning();
    // The step is locked and was unlinked: missing it rolls the re-pay back.
    if (!linked) {
      throw new InternalServiceError(
        'The re-pay could not be linked on its step',
        {
          creditId: credit.id,
        }
      );
    }
    return {
      credit: await settle({ ...confirmed, repayPayoutId: repayPayout.id }),
      repayPayout,
      repeated: false,
    };
  });
  if (!result.repeated) {
    deps.obs.info('A payee credit was settled', {
      creditId: result.credit.id,
      resolution: result.credit.resolution,
      repayPayoutId: result.repayPayout?.id ?? null,
      amountCents: result.credit.amountCents,
    });
  }
  return result;
}

/**
 * What "Check Stripe again" found (§7.4). `needs_person`: the ledger cannot
 * attribute the cancellation to this step, so Stripe was not asked (MED-3).
 */
export type PayeeCreditCheck =
  | 'owed'
  | 'not_owed'
  | 'still_unknown'
  | 'needs_person';

export interface RecheckedPayeeCredit {
  credit: PayeeCredit;
  outcome: PayeeCreditCheck;
}

/** The system's notes on a credit a check closes as not owed. */
const NOTHING_TAKEN_NOTE = 'Stripe shows nothing was taken';
const TRANSFER_KEPT_NOTE = 'The payee kept the transfer';

/** What Stripe says an unverified credit's step took. */
type Finding =
  | {
      kind: 'owed';
      effect: 'reversal_landed' | 'slice_cancelled';
      amountCents: number;
      stripeReversalId?: string;
      stripeTransferId?: string;
    }
  | {
      kind: 'not_owed';
      effect: 'unverified' | 'transfer_kept';
      note: string;
      stripeTransferId?: string;
    }
  | { kind: 'unknown' }
  /** A cancellation the ledger cannot attribute to this step. */
  | { kind: 'needs_person' };

/**
 * "Check Stripe again" on an unverified credit (owner decision OQ3; data
 * design §7.4), from admin-api. It asks Stripe outside any transaction, then
 * writes with a compare-and-set on the row still being open and unverified,
 * and stamps `checked_at`:
 *
 * 1. a reversal naming the step on its transfer: owed what Stripe took;
 * 2. a cancelled slice: with no known transfer, `lateTransferOf` first; none
 *    went out, owed the share; one went out and is reversed in full, owed the
 *    share; one went out and is not reversed, closed not owed by the system
 *    ("The payee kept the transfer"). A slice the drain marked `reversed`
 *    since (Codex-2hxff.88) is asked about the transfer it records: reversed
 *    in full, owed the share;
 * 3. a transfer step with no reversal found: closed not owed by the system
 *    ("Stripe shows nothing was taken").
 *
 * Stripe failing changes nothing but `checked_at`. A cancellation the ledger
 * cannot attribute to this step (`sliceTakenBy` fails: another cancellation
 * is on the slice) is never confirmed owed by a check, so a share another
 * cause took is never paid twice: it is `needs_person`, with an error alert,
 * and Stripe is not asked. Support checks in Stripe, then decides
 * (`resolvePayeeCredit`; owner decision 2026-10-28, review MED-3). A
 * `reversed` slice whose recorded transfer Stripe says is not reversed in
 * full is `needs_person` too: the ledger and Stripe disagree. A row no longer
 * unverified is returned as it stands.
 *
 * Stripe: `transfers.listReversals`, `transfers.retrieve`, and
 * `transfers.list` by destination for each account the payee has had.
 */
export async function recheckPayeeCredit(
  deps: ClawbackDeps,
  input: { creditId: string }
): Promise<RecheckedPayeeCredit> {
  const [row] = await deps.db
    .select({ credit: payeeCredits, step: payoutReversals, slice: payouts })
    .from(payeeCredits)
    .innerJoin(
      payoutReversals,
      eq(payoutReversals.id, payeeCredits.payoutReversalId)
    )
    .innerJoin(payouts, eq(payouts.id, payoutReversals.payoutId))
    .where(eq(payeeCredits.id, input.creditId))
    .limit(1);
  if (!row) {
    throw new NotFoundError('No payee credit with this id', {
      creditId: input.creditId,
    });
  }
  if (row.credit.resolvedAt || row.credit.effect !== 'unverified') {
    return { credit: row.credit, outcome: outcomeOf(row.credit) };
  }

  const finding = await findTaken(deps, row.credit, row.step, row.slice);
  const now = new Date();
  const set =
    finding.kind === 'owed'
      ? {
          effect: finding.effect,
          amountCents: finding.amountCents,
          stripeReversalId:
            finding.stripeReversalId ?? row.credit.stripeReversalId,
          stripeTransferId:
            finding.stripeTransferId ?? row.credit.stripeTransferId,
          checkedAt: now,
        }
      : finding.kind === 'not_owed'
        ? {
            effect: finding.effect,
            stripeTransferId:
              finding.stripeTransferId ?? row.credit.stripeTransferId,
            resolution: 'not_owed' as const,
            resolvedAt: now,
            resolvedByUserId: null,
            resolutionNote: finding.note,
            checkedAt: now,
          }
        : { checkedAt: now };
  const [updated] = await deps.db
    .update(payeeCredits)
    .set(set)
    .where(
      and(
        eq(payeeCredits.id, row.credit.id),
        eq(payeeCredits.effect, 'unverified'),
        isNull(payeeCredits.resolvedAt)
      )
    )
    .returning();
  if (!updated) {
    // Another check or a confirmed finding got there first: as it stands.
    const [current] = await deps.db
      .select()
      .from(payeeCredits)
      .where(eq(payeeCredits.id, row.credit.id))
      .limit(1);
    const credit = current ?? row.credit;
    return { credit, outcome: outcomeOf(credit) };
  }
  if (finding.kind === 'not_owed') {
    deps.obs.info('A payee credit was settled', {
      creditId: updated.id,
      resolution: 'not_owed',
      repayPayoutId: null,
      amountCents: null,
    });
  }
  return {
    credit: updated,
    outcome: finding.kind === 'unknown' ? 'still_unknown' : finding.kind,
  };
}

/** A settled or confirmed credit, as a check reads it. */
function outcomeOf(credit: PayeeCredit): PayeeCreditCheck {
  if (credit.resolution === 'not_owed') return 'not_owed';
  if (credit.effect === 'unverified' && !credit.resolvedAt) {
    return 'still_unknown';
  }
  return 'owed';
}

async function findTaken(
  deps: ClawbackDeps,
  credit: PayeeCredit,
  step: PayoutReversal,
  slice: Payout
): Promise<Finding> {
  const cancelled = step.kind === 'cancellation';
  const ids = {
    creditId: credit.id,
    payoutReversalId: step.id,
    payoutId: slice.id,
  };
  // Only an ambiguous sibling on a cancelled or reversed slice needs a
  // person; a slice the cancel never took is read as a transfer step's
  // would be (round 2 MED-1).
  const attribution = cancelled
    ? await cancellationAttributionOf(deps.db, step, slice)
    : 'not_cancelled';
  const found =
    attribution === 'ambiguous'
      ? ({ kind: 'needs_person' } as const)
      : await askStripe(
          deps,
          credit,
          step,
          slice,
          ids,
          attribution === 'not_cancelled' ? undefined : attribution
        );
  if (found.kind === 'needs_person') {
    deps.obs.error(
      'A payee credit cannot be confirmed by a check: the ledger cannot tell whether its cancellation took the slice. Check in Stripe, then re-pay or mark it not owed, with a note',
      {
        errorId: crypto.randomUUID(),
        ...ids,
        sliceStatus: slice.status,
        stripeTransferId: credit.stripeTransferId ?? slice.stripeTransferId,
      }
    );
    return found;
  }
  if (found.kind !== 'share') return found;
  // The ledger's own read, outside the Stripe catch: a database error is
  // never "Stripe could not say".
  return {
    kind: 'owed',
    effect: 'slice_cancelled',
    amountCents: await cancelledShareOf(deps.db, slice),
    ...(found.stripeTransferId
      ? { stripeTransferId: found.stripeTransferId }
      : {}),
  };
}

/**
 * What Stripe says the step took: a `share` means the cancelled slice's share
 * is owed, which the caller reads from the ledger. A failure is `unknown`;
 * a definitive refusal, which a retry can never turn, is an error alert.
 */
async function askStripe(
  deps: ClawbackDeps,
  credit: PayeeCredit,
  step: PayoutReversal,
  slice: Payout,
  ids: Record<string, string>,
  /**
   * A cancellation that took its slice (`cancellationAttribution`);
   * undefined for any other step, and for a cancellation whose slice it never
   * took, which reads as a transfer step.
   */
  taken: SliceTaken | undefined
): Promise<
  | Exclude<Finding, { effect: 'slice_cancelled' }>
  | { kind: 'share'; stripeTransferId?: string }
> {
  const cancelled = taken !== undefined;
  try {
    // A `reversed` slice: the transfer it records (Codex-2hxff.88).
    let transferId =
      credit.stripeTransferId ??
      (taken?.by === 'reversed'
        ? taken.transferId
        : cancelled
          ? null
          : slice.stripeTransferId);
    if (!transferId && cancelled) {
      const late = await lateTransferOf(deps, slice);
      if (late.kind === 'unknown') return { kind: 'unknown' };
      if (late.kind === 'none') return { kind: 'share' };
      transferId = late.transferId;
    }
    if (!transferId) {
      return {
        kind: 'not_owed',
        effect: 'unverified',
        note: NOTHING_TAKEN_NOTE,
      };
    }
    const landed = await findLandedReversal(deps, transferId, step.id);
    if (landed) {
      return {
        kind: 'owed',
        effect: 'reversal_landed',
        amountCents: landed.amount,
        stripeReversalId: landed.id,
        stripeTransferId: transferId,
      };
    }
    if (!cancelled) {
      return {
        kind: 'not_owed',
        effect: 'unverified',
        note: NOTHING_TAKEN_NOTE,
        stripeTransferId: transferId,
      };
    }
    const transfer = await deps.stripe.transfers.retrieve(transferId);
    if (transfer.reversed) {
      return { kind: 'share', stripeTransferId: transferId };
    }
    // The ledger says the drain reversed it in full; Stripe says not. Left
    // for a check, as resolve reads it (round 2 LOW-4), and alerted.
    if (taken?.by === 'reversed') {
      deps.obs.error(
        "Check Stripe again: the ledger says the drain reversed this slice's transfer in full, and Stripe says it is not. Check it by hand",
        { errorId: crypto.randomUUID(), ...ids, stripeTransferId: transferId }
      );
      return { kind: 'unknown' };
    }
    return {
      kind: 'not_owed',
      effect: 'transfer_kept',
      note: TRANSFER_KEPT_NOTE,
      stripeTransferId: transferId,
    };
  } catch (error) {
    const fields = {
      ...ids,
      stripeTransferId: credit.stripeTransferId,
      error: error instanceof Error ? error.message : String(error),
    };
    if (isDefinitiveStripeError(error)) {
      deps.obs.error(
        'Check Stripe again: Stripe refused to say what this step took, and asking again will not help. Check it by hand',
        { errorId: crypto.randomUUID(), ...fields }
      );
    } else {
      deps.obs.warn('Check Stripe again: Stripe could not say', fields);
    }
    return { kind: 'unknown' };
  }
}

/** The steps `sliceTakenBy` weighs on a slice: its cancellations and transfer reversals. */
const ATTRIBUTING_KINDS = ['cancellation', 'transfer_reversal'];

/**
 * A needs-person credit (review MED-3, scoped by round 2 MED-1): an open
 * unverified credit whose step is a cancellation on a slice cancelled by its
 * cause type, or `reversed`, where a sibling makes it unclear which step took
 * it (`cancellationAttribution` is `ambiguous`). `siblingTook`: another
 * such step on the slice is `done` or re-paid, so the ledger already has it
 * taking the share and Re-pay is refused (settle by hand).
 */
export interface NeedsAPerson {
  siblingTook: boolean;
  /**
   * Another such step on the slice can still finish: `pending`, or `failed`
   * with retries left. Its retry would mark it `done` and its cause re-pay
   * it, so Re-pay waits (round 3 LOW-1).
   */
  siblingRunning: boolean;
}

type SiblingStep = Pick<
  PayoutReversal,
  'id' | 'kind' | 'causeType' | 'status' | 'repaidByPayoutId' | 'attempt'
>;

function needsAPersonFrom(
  step: PayoutReversal,
  slice: Payout,
  siblings: readonly SiblingStep[]
): NeedsAPerson | null {
  if (cancellationAttribution(step, slice, siblings) !== 'ambiguous') {
    return null;
  }
  const others = siblings.filter((other) => other.id !== step.id);
  return {
    siblingTook: others.some(
      (other) => other.status === 'done' || other.repaidByPayoutId !== null
    ),
    siblingRunning: others.some(
      (other) =>
        other.status === 'pending' ||
        (other.status === 'failed' && other.attempt < MAX_CLAWBACK_ATTEMPTS)
    ),
  };
}

/**
 * `needsAPerson` for one credit, with its step and slice. Only the ledger is
 * read: a check never turns such a row (`recheckPayeeCredit`), so support
 * decides it. `lock`: the step AND its siblings are read FOR UPDATE in ONE
 * id-ordered read, so two Re-pays on sibling credits queue in the same order
 * instead of each holding the other's step (round 3 LOW-2), and a Re-pay
 * decides on them as they stand.
 */
async function needsAPersonOf(
  db: Client,
  credit: PayeeCredit,
  lock: boolean
): Promise<(NeedsAPerson & { step: PayoutReversal; slice: Payout }) | null> {
  if (credit.effect !== 'unverified' || credit.resolvedAt) return null;
  const [row] = await db
    .select({ step: payoutReversals, slice: payouts })
    .from(payoutReversals)
    .innerJoin(payouts, eq(payouts.id, payoutReversals.payoutId))
    .where(eq(payoutReversals.id, credit.payoutReversalId))
    .limit(1);
  if (!row || row.step.kind !== 'cancellation') return null;
  const read = db
    .select()
    .from(payoutReversals)
    .where(
      and(
        eq(payoutReversals.payoutId, row.slice.id),
        or(
          eq(payoutReversals.id, row.step.id),
          inArray(payoutReversals.kind, ATTRIBUTING_KINDS)
        )
      )
    )
    .orderBy(asc(payoutReversals.id));
  const steps = lock ? await read.for('update') : await read;
  // The step as it stands under the lock, not as first read.
  const step = steps.find((one) => one.id === row.step.id) ?? row.step;
  const person = needsAPersonFrom(
    step,
    row.slice,
    steps.filter((one) => one.id !== step.id)
  );
  return person ? { ...person, step, slice: row.slice } : null;
}

/**
 * Which of these credits are needs-person rows (`needsAPersonOf`), by
 * credit id, for a queue page: two reads, whatever the number of credits.
 */
export async function payeeCreditsNeedingAPerson(
  db: ClawbackDeps['db'],
  credits: readonly Pick<
    PayeeCredit,
    'id' | 'effect' | 'resolvedAt' | 'payoutReversalId'
  >[]
): Promise<Map<string, NeedsAPerson>> {
  const open = credits.filter(
    (credit) => credit.effect === 'unverified' && !credit.resolvedAt
  );
  if (open.length === 0) return new Map();
  const rows = await db
    .select({ step: payoutReversals, slice: payouts })
    .from(payoutReversals)
    .innerJoin(payouts, eq(payouts.id, payoutReversals.payoutId))
    .where(
      and(
        inArray(
          payoutReversals.id,
          open.map((credit) => credit.payoutReversalId)
        ),
        eq(payoutReversals.kind, 'cancellation')
      )
    );
  if (rows.length === 0) return new Map();
  const others = await db
    .select({
      id: payoutReversals.id,
      payoutId: payoutReversals.payoutId,
      kind: payoutReversals.kind,
      causeType: payoutReversals.causeType,
      status: payoutReversals.status,
      repaidByPayoutId: payoutReversals.repaidByPayoutId,
      attempt: payoutReversals.attempt,
    })
    .from(payoutReversals)
    .where(
      and(
        inArray(
          payoutReversals.payoutId,
          rows.map(({ slice }) => slice.id)
        ),
        inArray(payoutReversals.kind, ATTRIBUTING_KINDS)
      )
    );
  const byStep = new Map(
    rows.flatMap(({ step, slice }) => {
      const person = needsAPersonFrom(
        step,
        slice,
        others.filter((other) => other.payoutId === slice.id)
      );
      return person ? [[step.id, person] as const] : [];
    })
  );
  return new Map(
    open.flatMap((credit) => {
      const person = byStep.get(credit.payoutReversalId);
      return person ? [[credit.id, person] as const] : [];
    })
  );
}

/** Whether a payout is a payee credit's re-pay (`repay_payout_id`). */
async function isCreditRepay(db: Client, payoutId: string): Promise<boolean> {
  const [credit] = await db
    .select({ id: payeeCredits.id })
    .from(payeeCredits)
    .where(eq(payeeCredits.repayPayoutId, payoutId))
    .limit(1);
  return credit !== undefined;
}

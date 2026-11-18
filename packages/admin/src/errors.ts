/**
 * Admin Service Errors
 *
 * Domain-specific error classes for admin operations.
 * Extends base errors from @codex/service-errors.
 *
 * Note: Admin services primarily use base error classes since
 * most admin operations reuse existing domain errors (NotFoundError, etc.)
 */

import type { ShortLossStage } from '@codex/constants';
import type { BlockedPaymentKind } from '@codex/purchase';
import {
  BusinessLogicError,
  ConflictError,
  PreconditionFailedError,
  ValidationError,
} from '@codex/service-errors';

// Re-export base error classes for convenience
export {
  BusinessLogicError,
  ConflictError,
  ForbiddenError,
  InternalServiceError,
  isServiceError as isAdminServiceError,
  NotFoundError,
  ServiceError as AdminServiceError,
  ValidationError,
  wrapError,
} from '@codex/service-errors';

/**
 * A support grant was asked for content a grant cannot open (422): free,
 * followers-only, team-only or course-only content, where the access decision
 * never reads an entitlement (`isGrantableContent`, `@codex/constants`;
 * Codex-2hxff.21). The context is client-facing — the error mapper serialises
 * it — so it carries the content id only.
 */
export class ContentNotGrantableError extends BusinessLogicError {
  constructor(contentId: string) {
    super(
      "This item can't be granted: a grant only opens paid or subscriber content.",
      { contentId }
    );
  }
}

// ============================================================================
// Support refunds (Codex-2hxff.28; data design §1's error table)
//
// Each context reaches the client verbatim (the error mapper sends it as
// `details`), so it holds a code and ids, counts or amounts only: never
// Stripe's message, an email, or anything about a connected account.
// ============================================================================

/** The refund route's 14 × 24 hours from Stripe's `charge.created` are up. */
export class RefundWindowClosedError extends BusinessLogicError {
  constructor(closesAt: Date) {
    super('The 14-day refund window for this payment has closed.', {
      code: 'REFUND_WINDOW_CLOSED',
      closesAt: closesAt.toISOString(),
    });
  }
}

/**
 * An open or lost chargeback: Stripe does not refund outside the dispute
 * (data design §12). The status is the dispute's current one.
 */
export class ChargeHasChargebackError extends BusinessLogicError {
  constructor(disputeStatus: string) {
    super(
      'This payment has a chargeback, so it cannot be refunded here. Answer it in the Stripe Dashboard.',
      { code: 'CHARGE_HAS_CHARGEBACK', disputeStatus }
    );
  }
}

/**
 * A chargeback on this charge was won and the creators' pay-back is not yet
 * applied (Codex-2hxff.70; late-win data design §4.7, §6): a refund now
 * would race it. The hourly reconcile applies it, and retries a step that
 * failed every hour; one Stripe will never make is settled by hand
 * (docs/payments/operations.md). So the message promises no time (review
 * cycle 1, M3).
 */
export class ChargebackSettlingError extends BusinessLogicError {
  constructor() {
    super(
      "This payment's chargeback was decided for us, and the creators are still being paid back. Refunds wait until that finishes; a step that fails is retried every hour.",
      { code: 'CHARGEBACK_SETTLING' }
    );
  }
}

/**
 * The buyer of this charge was refunded outside Stripe
 * (`disputes.refunded_outside_stripe_at`): support settled a late-win refund
 * Stripe won't make by hand (docs/payments/operations.md, "Settling a
 * late-win refund Stripe won't make"), settled the late win's own failed
 * refund as refunded elsewhere, or recorded a refund another way by hand
 * (release-checklist.md, R19 (b)). A refund through Stripe now would pay the
 * buyer twice, so it is refused for good (owner decision 2026-11-08, "Block
 * it in code").
 */
export class RefundedOutsideStripeError extends BusinessLogicError {
  constructor(refundedAt: Date) {
    super(
      "This payment was refunded outside Stripe, so it can't be refunded here.",
      {
        code: 'REFUNDED_OUTSIDE_STRIPE',
        refundedOutsideStripeAt: refundedAt.toISOString(),
      }
    );
  }
}

/** The charge's standing refunds already cover all of it. */
export class NothingLeftToRefundError extends BusinessLogicError {
  constructor() {
    super('Nothing is left to refund on this payment.', {
      code: 'NOTHING_LEFT_TO_REFUND',
    });
  }
}

/**
 * More than the charge less its standing refunds and those settled as
 * refunded elsewhere (400).
 */
export class RefundAmountTooLargeError extends ValidationError {
  constructor(maxCents: number) {
    super('The amount is more than is left to refund.', {
      code: 'REFUND_AMOUNT_TOO_LARGE',
      maxCents,
    });
  }
}

/**
 * The charge has more refunds than the page showed (412): someone refunded
 * it meanwhile. The page reloads it.
 */
export class ChargeChangedError extends PreconditionFailedError {
  constructor(refundCount: number) {
    super('This payment changed since it was loaded. Reload it and check.', {
      code: 'CHARGE_CHANGED',
      refundCount,
    });
  }
}

/**
 * Stripe holds an earlier answer for this exact refund (409): the same key
 * was refused or failed in the last 24 hours, and Stripe repeats that answer
 * for this charge, count and amount (silent F1). No refund was made: the
 * charge's list was read again and holds none with this key. Another amount
 * makes another key.
 *
 * The text says to reload the charge FIRST (review round 3 LOW-G). Stripe
 * doesn't document whether a request with other parameters (another
 * `reason`, another person), sent while the first is still running, gets a
 * 409 or a 400 `idempotency_error`. If it is a 400, the first refund may
 * still land, and a new amount or the Dashboard would then refund the buyer
 * twice. A reload shows it if it did.
 */
export class RefundKeySpentError extends ConflictError {
  constructor() {
    super(
      'Reload the charge first: a refund for this amount may still be landing. If none shows, this exact refund was refused or failed in the last 24 hours: change the amount, or use the Stripe Dashboard.',
      { code: 'REFUND_KEY_SPENT' }
    );
  }
}

/**
 * Another request with this refund's key is still running at Stripe (409,
 * `idempotency_key_in_use`; review round 2 MED-A): two tabs, or two people,
 * sent the same decision. It may still succeed, so nothing else may be tried
 * until the charge is reloaded: a new amount or the Dashboard would refund
 * the buyer twice.
 */
export class RefundInFlightError extends ConflictError {
  constructor() {
    super(
      'A refund for this exact amount is still being processed. Reload the charge in a minute.',
      { code: 'REFUND_IN_FLIGHT' }
    );
  }
}

/** Stripe answered and refused (`charge_disputed`, `amount_too_large`, …). */
export class StripeRefusedRefundError extends BusinessLogicError {
  constructor(stripeCode: string) {
    super('Stripe refused the refund.', {
      code: 'STRIPE_REFUSED',
      stripeCode,
    });
  }
}

/** A failed refund or a creator debt support already settled another way (409). */
export class AlreadySettledError extends ConflictError {
  constructor(resolution: string) {
    super('This was already settled another way.', {
      code: 'ALREADY_SETTLED',
      resolution,
    });
  }
}

/**
 * A "creators re-paid" settlement of a failed refund that a late win made
 * (`disputes.late_win_refund_id`, or the refund's own metadata
 * `codex_late_win_dispute` at Stripe; owner decision 6, 2026-11-08, "Block
 * it in code"). That refund pays back a buyer who paid twice, so the buyer is
 * still owed it, and what its clawback took from the creators stays taken:
 * re-paying them, then refunding the buyer, would pay the same money out
 * twice. It is refused for good. Support refunds the buyer another way, or
 * first refunds the charge again through Stripe, then settles it as refunded
 * elsewhere (docs/payments/purchases.md#refunds). The context is the dispute's
 * Stripe id only.
 */
export class LateWinRefundNotRepayableError extends BusinessLogicError {
  constructor(stripeDisputeId: string) {
    super(
      "This refund pays back a buyer who paid twice, so the creators can't be re-paid for it. Refund the buyer another way, then settle it as refunded elsewhere.",
      { code: 'LATE_WIN_REFUND_NOT_REPAYABLE', disputeId: stripeDisputeId }
    );
  }
}

/** Why there is no access to give back, per kind of blocked payment. */
const NO_ACCESS_TO_GIVE_BACK: Record<BlockedPaymentKind, string> = {
  duplicate: 'this was a second payment for something the buyer already has',
  unavailable: 'the item was no longer available',
};

/**
 * A "creators re-paid" settlement of a blocked payment's failed refund (owner
 * D55; widened to duplicates by D57): a duplicate, a second payment for an
 * item the buyer already has (Codex-2hxff.14), or a blocked sale of an item
 * its buyer could no longer open when it landed (Codex-z1t3c). Either paid no
 * one and granted nothing, so there is nothing to re-pay and no access to
 * give back, and the buyer is still owed the refund: settling it so would
 * close the row with the buyer charged. Refused for good, as a late win's own
 * refund is (`LateWinRefundNotRepayableError`). Support refunds the buyer
 * another way, then settles it as refunded elsewhere. Its message says why by
 * kind: a duplicate's buyer kept the item. The context is the purchase's id
 * and the kind as `reason` (`duplicate` or `unavailable`), which support's
 * dialog reads for its words, as it reads `REPAY_BLOCKED_BY_LATER_CAUSE`'s.
 */
export class BlockedPaymentRefundNotRepayableError extends BusinessLogicError {
  constructor(purchaseId: string, kind: BlockedPaymentKind) {
    super(
      `There's no access to give back: ${NO_ACCESS_TO_GIVE_BACK[kind]}. The buyer is still owed this refund. Refund them another way, then settle it as refunded elsewhere.`,
      { code: 'BLOCKED_PAYMENT_REFUND_NOT_REPAYABLE', purchaseId, reason: kind }
    );
  }
}

/** Why a failed refund is its chargeback's to decide (`RefundDecidedByChargebackError`). */
export type RefundDecidedByChargebackReason =
  | 'chargeback_open'
  | 'chargeback_lost';

/**
 * A failed refund of a blocked payment that its chargeback decides (422;
 * owner D66, D67), settled from the queue:
 * - `chargeback_open`: the bank hasn't decided. Stripe won't refund the
 *   charge meanwhile, and the decision changes what the buyer is owed, so
 *   nothing is settled yet. Won in time, it is settled as before;
 * - `chargeback_lost`: lost, or lost then won late. The bank returned some or
 *   all of the payment, and what is still owed lives on the charge page
 *   alone, marked there "Paid another way": settling this refund as well
 *   would pay it twice.
 * The queue offers neither, so a call is a stale page or a direct one.
 * Nothing is written. The context is the reason and the charge, which the
 * page's notice links to.
 */
export class RefundDecidedByChargebackError extends BusinessLogicError {
  constructor(reason: RefundDecidedByChargebackReason, chargeId: string) {
    super(DECIDED_BY_CHARGEBACK[reason], {
      code: 'REFUND_DECIDED_BY_CHARGEBACK',
      reason,
      chargeId,
    });
  }
}

const DECIDED_BY_CHARGEBACK: Record<RefundDecidedByChargebackReason, string> = {
  chargeback_open:
    "This refund is waiting for the buyer's chargeback, so nothing was settled. If the chargeback is won, settle it then.",
  chargeback_lost:
    "The buyer's chargeback was lost, so what's still owed is settled on the charge page. Nothing was settled here.",
};

/**
 * What the charge's blocked payment is owed is not what the page showed
 * (412): the dispute named is not the one owed, it is owed at another stage
 * (a late win since, owner D63), what is owed changed (a refund stood or
 * stopped standing since, or the dispute's amount moved), or what was paid
 * another way moved while more is owed (another mark since, owner D66).
 * Nothing is marked; the page reloads and support checks it again (owner
 * D61). The context is what is owed now and at which stage.
 */
export class ShortLossChangedError extends PreconditionFailedError {
  constructor(now: { owedCents: number; stage: ShortLossStage }) {
    super(
      "What's owed on this payment changed since it was loaded. Reload it and check.",
      { code: 'SHORT_LOSS_CHANGED', owedCents: now.owedCents, stage: now.stage }
    );
  }
}

/** Why a charge can't be marked paid another way (`NotOwedAfterLossError`). */
export type NotOwedAfterLossReason =
  | 'not_blocked'
  | 'no_lost_dispute'
  | 'not_short';

/**
 * "Paid another way" asked of a charge with nothing owed after a lost
 * chargeback (422; owner D60, D61, D63): its payment isn't a blocked one (a
 * sale keeps the bank's decision), it has no lost chargeback (open, won, or
 * won late with no first mark), or nothing is owed on it now. Nothing is
 * marked. The context's `reason` says which, for support's notice.
 */
export class NotOwedAfterLossError extends BusinessLogicError {
  constructor(reason: NotOwedAfterLossReason) {
    super(NOT_OWED_AFTER_LOSS[reason], {
      code: 'NOT_OWED_AFTER_LOSS',
      reason,
    });
  }
}

const NOT_OWED_AFTER_LOSS: Record<NotOwedAfterLossReason, string> = {
  not_blocked:
    'Only a blocked payment is owed the rest of a lost chargeback, so nothing was marked.',
  no_lost_dispute:
    'This payment has no lost chargeback, so nothing was marked.',
  not_short: 'Nothing is owed on this payment any more, so nothing was marked.',
};

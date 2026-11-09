/**
 * Admin Service Errors
 *
 * Domain-specific error classes for admin operations.
 * Extends base errors from @codex/service-errors.
 *
 * Note: Admin services primarily use base error classes since
 * most admin operations reuse existing domain errors (NotFoundError, etc.)
 */

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

/** More than the charge less its standing refunds (400). */
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

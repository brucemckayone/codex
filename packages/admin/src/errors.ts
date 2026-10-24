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

/**
 * An admin publish of content that earns money (`requiresPayoutsToPublish`,
 * `@codex/constants`) whose creator can't be paid yet (422, Codex-2hxff.14).
 *
 * The twin of `@codex/content`'s `CreatorPayoutsRequiredError`, which this
 * package cannot import (admin depends on Foundation packages only). The
 * message and `code: 'CREATOR_CONNECT_REQUIRED'` are copied verbatim so the
 * Studio shows the same "set up payouts" text whichever route refused — keep
 * the two in step.
 */
export class CreatorPayoutsRequiredError extends BusinessLogicError {
  constructor(creatorId: string, accessType: string) {
    super(
      'Set up payouts before publishing paid or subscriber content. Complete Stripe Connect onboarding to receive payments.',
      {
        creatorId,
        accessType,
        code: 'CREATOR_CONNECT_REQUIRED',
      }
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
 * Stripe holds a refund for this idempotency key with other parameters (409):
 * the same decision was submitted with another reason, or is still in flight.
 */
export class RefundAlreadySubmittedError extends ConflictError {
  constructor() {
    super('This refund was already submitted.', {
      code: 'REFUND_ALREADY_SUBMITTED',
    });
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

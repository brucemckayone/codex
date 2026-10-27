/**
 * @codex/agreements — Domain errors
 *
 * Typed `ServiceError` subclasses for the revenue-share state machine.
 * `procedure()` maps these to HTTP via `mapErrorToResponse()`.
 *
 * Per memory `feedback_service_error_test_instanceof`, tests assert on
 * either `toBeInstanceOf(...)` or `err.name === '...'` — NEVER on
 * `err.constructor.name`, which Vite/esbuild collapse to single letters.
 */

import { BusinessLogicError, NotFoundError } from '@codex/service-errors';

// Re-export base error classes for callers who only want the agreements barrel
export {
  BusinessLogicError,
  ConflictError,
  ForbiddenError,
  InternalServiceError,
  isServiceError as isAgreementServiceError,
  NotFoundError,
  ServiceError as AgreementServiceError,
  ValidationError,
  wrapError,
} from '@codex/service-errors';

/**
 * Thrown when a proposal or active agreement is referenced by id but not
 * found (or has been hard-pruned, which today is impossible — agreements
 * are append-only). Context: the id we tried to resolve.
 */
export class AgreementNotFoundError extends NotFoundError {
  constructor(
    message: string,
    context?: { proposalId?: string; agreementId?: string }
  ) {
    super(message, context);
    this.name = 'AgreementNotFoundError';
  }
}

/**
 * Thrown when a state-machine transition is rejected:
 *   - accepting/declining/withdrawing an already-terminal proposal
 *   - countering a non-open proposal
 *   - terminating an already-terminated agreement
 *   - proposing into a thread that already has an open proposal
 *
 * Context carries the offending id + the observed status so the UI / API
 * caller can render a meaningful "you can't do that now" message.
 *
 * Maps to 422 Unprocessable Entity (BusinessLogicError) — the request is
 * well-formed but violates the lifecycle.
 */
export class InvalidProposalStateError extends BusinessLogicError {
  constructor(
    message: string,
    context?: {
      proposalId?: string;
      agreementId?: string;
      currentStatus?: string;
      attemptedAction?: string;
    }
  ) {
    super(message, context);
    this.name = 'InvalidProposalStateError';
  }
}

/**
 * Thrown when a proposed creator share, combined with currently-active
 * sibling agreements and the current platform fee, would exceed 100% of
 * gross revenue. Surfaced at both `proposeAgreement` and `acceptProposal`
 * — the world between propose and accept can shift, so we re-check at
 * acceptance time per the WP-2 brief.
 *
 * Maps to 422 (BusinessLogicError). Context carries the numeric breakdown
 * so the UI can render which slice would have to shrink.
 */
export class ShareExceedsAvailableError extends BusinessLogicError {
  constructor(
    message: string,
    context?: {
      proposedSharePercent?: number;
      existingActiveSharePercent?: number;
      platformFeePercent?: number;
      maxAllowedSharePercent?: number;
    }
  ) {
    super(message, context);
    this.name = 'ShareExceedsAvailableError';
  }
}

/**
 * Thrown when an agreement would start in the future (owner decision
 * 2026-10-21, "Refuse a future start", Codex-2hxff.63). Accepting ends the
 * creator's current agreement at once, so a later start would leave them
 * unpaid until it began. Refused when proposed, and again when accepted, for
 * a proposal made before the rule.
 *
 * Maps to 422 (BusinessLogicError). The context is sent to the client, so it
 * carries the date only.
 */
export class FutureStartNotAllowedError extends BusinessLogicError {
  constructor(context: { effectiveFrom: string }) {
    super('An agreement cannot start in the future', context);
    this.name = 'FutureStartNotAllowedError';
  }
}

/** Why a proposal's recipient cannot hold an agreement. */
export type AgreementRecipientRefusal =
  | 'self'
  | 'subscriber'
  | 'no_creator_account';

const RECIPIENT_REFUSAL_MESSAGES: Record<AgreementRecipientRefusal, string> = {
  self: 'You cannot propose an agreement to yourself',
  subscriber: 'A subscriber cannot hold a revenue-share agreement',
  no_creator_account:
    'This member needs a creator account before they can hold an agreement',
};

/**
 * Thrown when a new proposal names someone who cannot hold an agreement
 * (owner decisions 2026-10-27, Codex-2hxff.76 and .77):
 *   - `self`: the owner proposing to themselves. An owner selling their own
 *     content already gets the creator slice and the organisation slice, and
 *     with no subscription agreements the whole pool too
 *     (docs/payments/fees-and-splits.md), so such an agreement changes nothing;
 *   - `subscriber`: a subscriber is audience, not team;
 *   - `no_creator_account`: a platform role that cannot enter the creators'
 *     Studio, where a creator negotiates, so every link in the agreement's
 *     emails would open a refusal.
 *
 * Maps to 422 (BusinessLogicError). The context is sent to the client, so it
 * carries the reason only.
 */
export class RecipientCannotHoldAgreementError extends BusinessLogicError {
  constructor(reason: AgreementRecipientRefusal) {
    super(RECIPIENT_REFUSAL_MESSAGES[reason], { reason });
    this.name = 'RecipientCannotHoldAgreementError';
  }
}

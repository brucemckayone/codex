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

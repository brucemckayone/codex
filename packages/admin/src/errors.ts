/**
 * Admin Service Errors
 *
 * Domain-specific error classes for admin operations.
 * Extends base errors from @codex/service-errors.
 *
 * Note: Admin services primarily use base error classes since
 * most admin operations reuse existing domain errors (NotFoundError, etc.)
 */

import { BusinessLogicError } from '@codex/service-errors';

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

/**
 * Identity Service Errors
 *
 * Domain-specific error classes for identity management.
 * Extends base errors from @codex/service-errors.
 */

import { NotFoundError, ServiceError } from '@codex/service-errors';

// Re-export base error classes for convenience
export {
  BusinessLogicError,
  ConflictError,
  ForbiddenError,
  InternalServiceError,
  isServiceError as isIdentityServiceError,
  NotFoundError,
  ServiceError as IdentityServiceError,
  ValidationError,
  wrapError,
} from '@codex/service-errors';

/**
 * Identity-specific errors
 */
export class OrganizationNotFoundError extends NotFoundError {
  constructor(organizationId: string) {
    super('Organization not found', { organizationId });
  }
}

export class MemberNotFoundError extends NotFoundError {
  constructor(userId: string) {
    super('Member not found', { userId });
  }
}

/**
 * Ownership transfer (Codex-2hxff.2). An organisation has exactly one owner;
 * these are the refusals around moving it.
 */

/** The owner's role cannot be changed, nor the owner removed — transfer first. */
export class OwnershipTransferRequiredError extends ServiceError {
  constructor(context?: Record<string, unknown>) {
    super(
      'Transfer ownership before changing the owner’s role or removing them',
      'OWNERSHIP_TRANSFER_REQUIRED',
      409,
      context
    );
  }
}

/**
 * The typed confirmation does not match the organisation's name. Its own code
 * (not VALIDATION_ERROR, which schema failures also use) so the dialog can say
 * exactly that — and suggest a reload, in case the organisation was renamed.
 */
export class OwnershipConfirmationMismatchError extends ServiceError {
  constructor() {
    super(
      "The name you typed doesn't match the organisation's name",
      'CONFIRM_NAME_MISMATCH',
      400,
      { field: 'confirmName' }
    );
  }
}

/** The offer was accepted, declined, withdrawn or has expired. */
export class OwnershipOfferNotOpenError extends ServiceError {
  constructor(context?: Record<string, unknown>) {
    super(
      'This ownership offer is no longer open',
      'OWNERSHIP_OFFER_NOT_OPEN',
      409,
      context
    );
  }
}

/** Ownership can only go to an active admin or creator who is not the owner. */
export class IneligibleOwnershipRecipientError extends ServiceError {
  constructor(context?: Record<string, unknown>) {
    super(
      'Ownership can only be offered to an active admin or creator',
      'INELIGIBLE_OWNERSHIP_RECIPIENT',
      422,
      context
    );
  }
}

/** Only the organisation's owner can offer or withdraw ownership. */
export class NotOrganisationOwnerError extends ServiceError {
  constructor(context?: Record<string, unknown>) {
    super(
      'Only the organisation’s owner can do this',
      'NOT_ORGANISATION_OWNER',
      403,
      context
    );
  }
}

/**
 * Identity Service Errors
 *
 * Domain-specific error classes for identity management.
 * Extends base errors from @codex/service-errors.
 */

import { BusinessLogicError, NotFoundError } from '@codex/service-errors';

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

export class LastOwnerError extends BusinessLogicError {
  constructor() {
    super('Cannot remove or demote the last owner of the organization');
  }
}

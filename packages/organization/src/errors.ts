/**
 * Identity Service Errors
 *
 * Domain-specific error classes for identity management.
 * Extends base errors from @codex/service-errors.
 */

import { NotFoundError } from '@codex/service-errors';

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

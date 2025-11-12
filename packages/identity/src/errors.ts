/**
 * Custom Error Classes for Identity Service
 *
 * These error classes provide clear, context-rich error handling for the
 * identity service layer. They follow the principle of never exposing internal
 * database details to callers.
 *
 * Usage:
 * ```typescript
 * if (!organization) {
 *   throw new NotFoundError('Organization not found', { organizationId: id });
 * }
 * ```
 */

/**
 * Base error class for all identity service errors
 * Provides consistent structure and context tracking
 */
export abstract class IdentityServiceError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;
  public readonly statusCode: number;

  constructor(
    message: string,
    code: string,
    statusCode: number,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Resource not found error (404)
 * Thrown when querying for a resource that doesn't exist
 */
export class NotFoundError extends IdentityServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'NOT_FOUND', 404, context);
  }
}

/**
 * Validation error (400)
 * Thrown when input validation fails
 */
export class ValidationError extends IdentityServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, context);
  }
}

/**
 * Authorization error (403)
 * Thrown when user doesn't have permission to perform action
 */
export class ForbiddenError extends IdentityServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'FORBIDDEN', 403, context);
  }
}

/**
 * Conflict error (409)
 * Thrown when operation conflicts with existing state (e.g., duplicate slug)
 */
export class ConflictError extends IdentityServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFLICT', 409, context);
  }
}

/**
 * Business logic error (422)
 * Thrown when operation violates business rules
 */
export class BusinessLogicError extends IdentityServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BUSINESS_LOGIC_ERROR', 422, context);
  }
}

/**
 * Internal service error (500)
 * Thrown when unexpected errors occur
 * Should be logged and wrapped to prevent detail exposure
 */
export class InternalServiceError extends IdentityServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'INTERNAL_ERROR', 500, context);
  }
}

/**
 * Specific error: Organization not found
 */
export class OrganizationNotFoundError extends NotFoundError {
  constructor(organizationId: string) {
    super('Organization not found', { organizationId });
  }
}

/**
 * Type guard to check if error is an IdentityServiceError
 */
export function isIdentityServiceError(
  error: unknown
): error is IdentityServiceError {
  return error instanceof IdentityServiceError;
}

/**
 * Wrap unknown errors to prevent internal detail exposure
 */
export function wrapError(
  error: unknown,
  context?: Record<string, unknown>
): IdentityServiceError {
  if (isIdentityServiceError(error)) {
    return error;
  }

  // Database unique constraint violation
  if (error instanceof Error && error.message.includes('unique constraint')) {
    return new ConflictError('Resource already exists', context);
  }

  // Generic fallback - never expose internal details
  return new InternalServiceError('An unexpected error occurred', context);
}

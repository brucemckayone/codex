/**
 * Base Service Error Classes
 *
 * Shared error classes for all service layers in the Codex platform.
 * These provide consistent error handling with HTTP status codes and context.
 */

// V8-specific Error extension (Node.js, Cloudflare Workers)
interface ErrorConstructorWithStackTrace {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  captureStackTrace?(targetObject: object, constructorOpt?: Function): void;
}

/**
 * Valid HTTP error status codes for API responses
 */
export type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 422 | 500;

/**
 * Base error class for all service errors
 * Provides consistent structure and context tracking
 *
 * @example
 * ```typescript
 * class MyServiceError extends ServiceError {
 *   constructor(message: string, context?: Record<string, unknown>) {
 *     super(message, 'MY_ERROR_CODE', 400, context);
 *   }
 * }
 * ```
 */
export abstract class ServiceError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;
  public readonly statusCode: ErrorStatusCode;

  constructor(
    message: string,
    code: string,
    statusCode: ErrorStatusCode,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;

    // captureStackTrace is V8-specific (Node.js, Cloudflare Workers)
    // Gracefully handle its absence in other runtimes
    const ErrorWithStackTrace = Error as ErrorConstructorWithStackTrace;
    if (typeof ErrorWithStackTrace.captureStackTrace === 'function') {
      ErrorWithStackTrace.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Resource not found error (404)
 * Thrown when querying for a resource that doesn't exist
 */
export class NotFoundError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'NOT_FOUND', 404, context);
  }
}

/**
 * Validation error (400)
 * Thrown when input validation fails
 */
export class ValidationError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, context);
  }
}

/**
 * Authorization error (403)
 * Thrown when user doesn't have permission to perform action
 */
export class ForbiddenError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'FORBIDDEN', 403, context);
  }
}

/**
 * Conflict error (409)
 * Thrown when operation conflicts with existing state (e.g., duplicate slug)
 */
export class ConflictError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFLICT', 409, context);
  }
}

/**
 * Business logic error (422)
 * Thrown when operation violates business rules
 */
export class BusinessLogicError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BUSINESS_LOGIC_ERROR', 422, context);
  }
}

/**
 * Internal service error (500)
 * Thrown when unexpected errors occur
 * Should be logged and wrapped to prevent detail exposure
 */
export class InternalServiceError extends ServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'INTERNAL_ERROR', 500, context);
  }
}

/**
 * Type guard to check if error is a ServiceError
 */
export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}

/**
 * Wrap unknown errors to prevent internal detail exposure
 *
 * @param error - The error to wrap
 * @param context - Additional context to include
 * @returns ServiceError instance
 *
 * @example
 * ```typescript
 * try {
 *   await database.query(...)
 * } catch (error) {
 *   throw wrapError(error, { operation: 'database query' });
 * }
 * ```
 */
export function wrapError(
  error: unknown,
  context?: Record<string, unknown>
): ServiceError {
  if (isServiceError(error)) {
    return error;
  }

  // Database unique constraint violation
  if (error instanceof Error && error.message.includes('unique constraint')) {
    return new ConflictError('Resource already exists', context);
  }

  // Generic fallback - never expose internal details
  return new InternalServiceError('An unexpected error occurred', context);
}

/**
 * Custom Error Classes for Content Management Service
 *
 * These error classes provide clear, context-rich error handling for the
 * content service layer. They follow the principle of never exposing internal
 * database details to callers.
 *
 * Usage:
 * ```typescript
 * if (!content) {
 *   throw new NotFoundError('Content not found', { contentId: id });
 * }
 * ```
 */

/**
 * Base error class for all content service errors
 * Provides consistent structure and context tracking
 */
export abstract class ContentServiceError extends Error {
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
export class NotFoundError extends ContentServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'NOT_FOUND', 404, context);
  }
}

/**
 * Validation error (400)
 * Thrown when input validation fails
 */
export class ValidationError extends ContentServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, context);
  }
}

/**
 * Authorization error (403)
 * Thrown when user doesn't have permission to perform action
 */
export class ForbiddenError extends ContentServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'FORBIDDEN', 403, context);
  }
}

/**
 * Conflict error (409)
 * Thrown when operation conflicts with existing state (e.g., duplicate slug)
 */
export class ConflictError extends ContentServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFLICT', 409, context);
  }
}

/**
 * Business logic error (422)
 * Thrown when operation violates business rules
 */
export class BusinessLogicError extends ContentServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BUSINESS_LOGIC_ERROR', 422, context);
  }
}

/**
 * Internal service error (500)
 * Thrown when unexpected errors occur
 * Should be logged and wrapped to prevent detail exposure
 */
export class InternalServiceError extends ContentServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'INTERNAL_ERROR', 500, context);
  }
}

/**
 * Specific error: Media not found
 */
export class MediaNotFoundError extends NotFoundError {
  constructor(mediaItemId: string) {
    super('Media item not found', { mediaItemId });
  }
}

/**
 * Specific error: Media not ready
 */
export class MediaNotReadyError extends BusinessLogicError {
  constructor(mediaItemId: string, currentStatus: string) {
    super('Media item is not ready for use', {
      mediaItemId,
      currentStatus,
    });
  }
}

/**
 * Specific error: Content type mismatch
 */
export class ContentTypeMismatchError extends ValidationError {
  constructor(contentType: string, mediaType: string) {
    super('Content type must match media type', {
      contentType,
      mediaType,
    });
  }
}

/**
 * Specific error: Content not found
 */
export class ContentNotFoundError extends NotFoundError {
  constructor(contentId: string) {
    super('Content not found', { contentId });
  }
}

/**
 * Specific error: Slug already exists
 */
export class SlugConflictError extends ConflictError {
  constructor(slug: string, organizationId: string | null) {
    super('Slug already exists for this organization', {
      slug,
      organizationId: organizationId || 'personal',
    });
  }
}

/**
 * Specific error: Content already published
 */
export class ContentAlreadyPublishedError extends BusinessLogicError {
  constructor(contentId: string) {
    super('Content is already published', { contentId });
  }
}

/**
 * Specific error: Media ownership violation
 */
export class MediaOwnershipError extends ForbiddenError {
  constructor(mediaItemId: string, creatorId: string) {
    super('Media item does not belong to creator', {
      mediaItemId,
      creatorId,
    });
  }
}

/**
 * Type guard to check if error is a ContentServiceError
 */
export function isContentServiceError(
  error: unknown
): error is ContentServiceError {
  return error instanceof ContentServiceError;
}

/**
 * Wrap unknown errors to prevent internal detail exposure
 */
export function wrapError(
  error: unknown,
  context?: Record<string, unknown>
): ContentServiceError {
  if (isContentServiceError(error)) {
    return error;
  }

  // Database unique constraint violation
  if (error instanceof Error && error.message.includes('unique constraint')) {
    return new ConflictError('Resource already exists', context);
  }

  // Generic fallback - never expose internal details
  return new InternalServiceError('An unexpected error occurred', context);
}

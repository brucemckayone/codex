/**
 * Content Service Errors
 *
 * Domain-specific error classes for content management.
 * Extends base errors from @codex/service-errors.
 */

import {
  NotFoundError,
  BusinessLogicError,
  ConflictError,
  ForbiddenError,
} from '@codex/service-errors';

// Re-export base error classes for convenience
export {
  ServiceError as ContentServiceError,
  NotFoundError,
  ValidationError,
  ForbiddenError,
  ConflictError,
  BusinessLogicError,
  InternalServiceError,
  isServiceError as isContentServiceError,
  wrapError,
} from '@codex/service-errors';

/**
 * Content-specific errors
 */

export class ContentNotFoundError extends NotFoundError {
  constructor(contentId: string) {
    super('Content not found', { contentId });
  }
}

export class MediaNotFoundError extends NotFoundError {
  constructor(mediaItemId: string) {
    super('Media item not found', { mediaItemId });
  }
}

export class MediaNotReadyError extends BusinessLogicError {
  constructor(mediaItemId: string) {
    super('Media item not ready for publishing', { mediaItemId });
  }
}

export class ContentTypeMismatchError extends BusinessLogicError {
  constructor(expectedType: string, actualType: string) {
    super('Content type does not match media type', {
      expectedType,
      actualType,
    });
  }
}

export class SlugConflictError extends ConflictError {
  constructor(slug: string) {
    super('Content with this slug already exists', { slug });
  }
}

export class ContentAlreadyPublishedError extends BusinessLogicError {
  constructor(contentId: string) {
    super('Content is already published', { contentId });
  }
}

export class MediaOwnershipError extends ForbiddenError {
  constructor(mediaItemId: string, userId: string) {
    super('User does not own this media item', { mediaItemId, userId });
  }
}

/**
 * Content Service Errors
 *
 * Domain-specific error classes for content management.
 * Extends base errors from @codex/service-errors.
 */

import {
  BusinessLogicError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '@codex/service-errors';

// Re-export base error classes for convenience
export {
  BusinessLogicError,
  ConflictError,
  ForbiddenError,
  InternalServiceError,
  isServiceError as isContentServiceError,
  NotFoundError,
  ServiceError as ContentServiceError,
  ValidationError,
  wrapError,
} from '@codex/service-errors';

/**
 * Content-specific errors
 */

export class ContentNotFoundError extends NotFoundError {
  constructor(contentId: string, context?: Record<string, unknown>) {
    super('Content not found', {
      contentId,
      code: 'CONTENT_NOT_FOUND',
      ...context,
    });
  }
}

export class MediaNotFoundError extends NotFoundError {
  constructor(
    mediaItemIdOrR2Key: string,
    contentId?: string,
    context?: Record<string, unknown>
  ) {
    // Support both old signature (mediaItemId) and new signature (r2Key, contentId)
    const isOldSignature = contentId === undefined;
    const message = isOldSignature
      ? 'Media item not found'
      : 'Media file not found in storage';

    const contextData = isOldSignature
      ? { mediaItemId: mediaItemIdOrR2Key, ...context }
      : {
          r2Key: mediaItemIdOrR2Key,
          contentId,
          code: 'MEDIA_NOT_FOUND',
          ...context,
        };

    super(message, contextData);
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

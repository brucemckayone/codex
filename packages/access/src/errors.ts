import { InternalServiceError, ServiceError } from '@codex/service-errors';

// Re-export error classes from @codex/content (canonical source)
export {
  ContentNotFoundError,
  MediaNotFoundError,
} from '@codex/content';

/**
 * Access denied error
 * Thrown when user doesn't have permission to access paid content
 */
export class AccessDeniedError extends ServiceError {
  constructor(
    userIdOrMessage: string,
    contentId?: string,
    context?: Record<string, unknown>
  ) {
    // Support both single-message and (userId, contentId) signatures
    const isMessageOnly = contentId === undefined;
    let message = isMessageOnly
      ? userIdOrMessage
      : 'User does not have access to this content';

    // Allow message override via context
    if (context?.message && typeof context.message === 'string') {
      message = context.message;
    }

    const contextData = isMessageOnly
      ? context || {}
      : {
          userId: userIdOrMessage,
          contentId,
          code: 'ACCESS_DENIED',
          ...context,
        };

    super(message, 'ACCESS_DENIED', 403, contextData);
  }
}

/**
 * R2 signing error
 * Thrown when R2 presigned URL generation fails
 */
export class R2SigningError extends InternalServiceError {
  constructor(r2Key: string, cause: unknown) {
    super('Failed to generate R2 signed URL', {
      r2Key,
      cause,
      code: 'R2_SIGNING_ERROR',
    });
  }
}

/**
 * Invalid content type error
 * Thrown when content type is not valid for streaming
 */
export class InvalidContentTypeError extends InternalServiceError {
  constructor(contentId: string, mediaType: string | null) {
    super('Invalid media type for streaming', {
      contentId,
      mediaType,
      code: 'INVALID_CONTENT_TYPE',
    });
  }
}

/**
 * Organization mismatch error
 * Thrown when content belongs to a different organization than expected
 */
export class OrganizationMismatchError extends ServiceError {
  constructor(
    contentId: string,
    expectedOrgId: string,
    actualOrgId: string | null
  ) {
    super(
      'Content does not belong to the specified organization',
      'ORGANIZATION_MISMATCH',
      403,
      {
        contentId,
        expectedOrganizationId: expectedOrgId,
        actualOrganizationId: actualOrgId,
      }
    );
  }
}

/**
 * Media not ready for streaming error
 * Thrown when media item is not in 'ready' status (still uploading, transcoding, or failed)
 * HTTP 422 - Business rule violation (content exists but media not ready)
 */
export class MediaNotReadyForStreamingError extends ServiceError {
  constructor(mediaId: string, status: string) {
    super(
      `Media item is not ready for streaming (status: ${status})`,
      'MEDIA_NOT_READY',
      422,
      {
        mediaId,
        status,
      }
    );
  }
}

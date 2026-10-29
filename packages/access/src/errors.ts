import { ERROR_CODES } from '@codex/constants';
import { InternalServiceError, ServiceError } from '@codex/service-errors';

// Re-export error classes from @codex/content (canonical source)
export { ContentNotFoundError, MediaNotFoundError } from '@codex/content';

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
          code: ERROR_CODES.ACCESS_DENIED,
          ...context,
        };

    super(message, ERROR_CODES.ACCESS_DENIED, 403, contextData);
  }
}

/**
 * R2 signing error
 * Thrown when R2 presigned URL generation fails
 *
 * Carries no context: the R2 key names the creator and media
 * (`{creatorId}/hls/{mediaId}/...`) and the cause can name internal config, so
 * neither goes in a field the response layer serialises. The failure stays on
 * `cause`, which is never sent. The streaming-URL sites log the key and the
 * cause themselves; the HLS proxies have no logger and end in app.onError,
 * whose line logs the cause (createErrorHandler, Codex-7ed5z).
 */
export class R2SigningError extends InternalServiceError {
  constructor(cause: unknown) {
    super('Failed to generate R2 signed URL', undefined, { cause });
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
      code: ERROR_CODES.INVALID_CONTENT_TYPE,
    });
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
      ERROR_CODES.MEDIA_NOT_READY,
      422,
      {
        mediaId,
        status,
      }
    );
  }
}

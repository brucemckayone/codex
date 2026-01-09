/**
 * Transcoding Service Errors
 *
 * Domain-specific error classes for media transcoding operations.
 * Extends base errors from @codex/service-errors.
 */

import {
  BusinessLogicError,
  ForbiddenError,
  InternalServiceError,
  NotFoundError,
  ValidationError,
} from '@codex/service-errors';

// Re-export base error classes for convenience
export {
  BusinessLogicError,
  ForbiddenError,
  InternalServiceError,
  isServiceError as isTranscodingServiceError,
  NotFoundError,
  ServiceError as TranscodingServiceError,
  ValidationError,
  wrapError,
} from '@codex/service-errors';

/**
 * Media item not found for transcoding operations
 */
export class TranscodingMediaNotFoundError extends NotFoundError {
  constructor(mediaId: string, context?: Record<string, unknown>) {
    super('Media item not found', {
      mediaId,
      code: 'TRANSCODING_MEDIA_NOT_FOUND',
      ...context,
    });
  }
}

/**
 * Media is not in correct state for requested operation
 */
export class InvalidMediaStateError extends BusinessLogicError {
  constructor(
    mediaId: string,
    currentStatus: string,
    requiredStatus: string | string[],
    context?: Record<string, unknown>
  ) {
    const required = Array.isArray(requiredStatus)
      ? requiredStatus.join(' or ')
      : requiredStatus;
    super(`Media must be in '${required}' status to perform this operation`, {
      mediaId,
      currentStatus,
      requiredStatus,
      code: 'INVALID_MEDIA_STATE',
      ...context,
    });
  }
}

/**
 * Maximum retry attempts reached for transcoding
 */
export class MaxRetriesExceededError extends BusinessLogicError {
  constructor(
    mediaId: string,
    attempts: number,
    context?: Record<string, unknown>
  ) {
    super('Maximum transcoding retry attempts exceeded', {
      mediaId,
      attempts,
      maxAttempts: 1,
      code: 'MAX_RETRIES_EXCEEDED',
      ...context,
    });
  }
}

/**
 * RunPod API call failed
 */
export class RunPodApiError extends InternalServiceError {
  constructor(
    operation: string,
    statusCode?: number,
    context?: Record<string, unknown>
  ) {
    super(`RunPod API error during ${operation}`, {
      operation,
      statusCode,
      code: 'RUNPOD_API_ERROR',
      ...context,
    });
  }
}

/**
 * Invalid webhook signature
 */
export class InvalidWebhookSignatureError extends ForbiddenError {
  constructor(context?: Record<string, unknown>) {
    super('Invalid webhook signature', {
      code: 'INVALID_WEBHOOK_SIGNATURE',
      ...context,
    });
  }
}

/**
 * Media not owned by the requesting user
 */
export class MediaOwnershipError extends ForbiddenError {
  constructor(
    mediaId: string,
    userId: string,
    context?: Record<string, unknown>
  ) {
    super('User does not own this media item', {
      mediaId,
      userId,
      code: 'MEDIA_OWNERSHIP_ERROR',
      ...context,
    });
  }
}

/**
 * Transcoding job not found (by runpodJobId)
 */
export class TranscodingJobNotFoundError extends NotFoundError {
  constructor(jobId: string, context?: Record<string, unknown>) {
    super('Transcoding job not found', {
      jobId,
      code: 'TRANSCODING_JOB_NOT_FOUND',
      ...context,
    });
  }
}

/**
 * Invalid media type for transcoding
 */
export class InvalidMediaTypeError extends ValidationError {
  constructor(
    mediaType: string,
    allowedTypes: string[] = ['video', 'audio'],
    context?: Record<string, unknown>
  ) {
    super(
      `Invalid media type '${mediaType}'. Allowed: ${allowedTypes.join(', ')}`,
      {
        mediaType,
        allowedTypes,
        code: 'INVALID_MEDIA_TYPE',
        ...context,
      }
    );
  }
}

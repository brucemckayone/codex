import {
  ForbiddenError,
  InternalServiceError,
  NotFoundError,
} from '@codex/service-errors';

/**
 * Content not found or not accessible error
 * Thrown when content doesn't exist, is not published, or is deleted
 */
export class ContentNotFoundError extends NotFoundError {
  constructor(contentId: string, context?: Record<string, unknown>) {
    super('Content not found or not accessible', {
      contentId,
      code: 'CONTENT_NOT_FOUND',
      ...context,
    });
  }
}

/**
 * Access denied error
 * Thrown when user doesn't have permission to access paid content
 */
export class AccessDeniedError extends ForbiddenError {
  constructor(
    userId: string,
    contentId: string,
    context?: Record<string, unknown>
  ) {
    super('User does not have access to this content', {
      userId,
      contentId,
      code: 'ACCESS_DENIED',
      ...context,
    });
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
 * Media not found error
 * Thrown when media file doesn't exist in R2 storage
 */
export class MediaNotFoundError extends NotFoundError {
  constructor(r2Key: string, contentId: string) {
    super('Media file not found in storage', {
      r2Key,
      contentId,
      code: 'MEDIA_NOT_FOUND',
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
export class OrganizationMismatchError extends ForbiddenError {
  constructor(
    contentId: string,
    expectedOrgId: string,
    actualOrgId: string | null
  ) {
    super('Content does not belong to the specified organization', {
      contentId,
      expectedOrganizationId: expectedOrgId,
      actualOrganizationId: actualOrgId,
      code: 'ORGANIZATION_MISMATCH',
    });
  }
}

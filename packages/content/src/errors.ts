/**
 * Content Service Errors
 *
 * Domain-specific error classes for content management.
 * Extends base errors from @codex/service-errors.
 */

import { ERROR_CODES } from '@codex/constants';
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
      code: ERROR_CODES.CONTENT_NOT_FOUND || 'CONTENT_NOT_FOUND',
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
          code: ERROR_CODES.MEDIA_NOT_FOUND || 'MEDIA_NOT_FOUND',
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

export class MediaOwnershipError extends ForbiddenError {
  constructor(mediaItemId: string, userId: string) {
    super('User does not own this media item', { mediaItemId, userId });
  }
}

/**
 * Thrown when a creator tries to publish monetised content (paid with a price,
 * or subscriber-gated) before their Stripe Connect account can receive money.
 *
 * Without this gate, a buyer can pay for content whose creator has no payout
 * destination — funds are collected and the creator payout is parked pending
 * indefinitely (see PurchaseService). Publishing is the last point at which the
 * content becomes purchasable, so it is the authoritative backend gate.
 *
 * `code: 'CREATOR_CONNECT_REQUIRED'` is shared with the subscription domain's
 * equivalent so the frontend can recognise the "set up payouts" condition
 * uniformly. Maps to HTTP 422 via BusinessLogicError.
 */
export class CreatorPayoutsRequiredError extends BusinessLogicError {
  constructor(creatorId: string, accessType: string) {
    super(
      'Set up payouts before publishing paid or subscriber content. Complete Stripe Connect onboarding to receive payments.',
      {
        creatorId,
        accessType,
        code: 'CREATOR_CONNECT_REQUIRED',
      }
    );
  }
}

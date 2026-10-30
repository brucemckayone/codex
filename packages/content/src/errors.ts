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

/**
 * A 404's context reaches the client as `details`, so this names the media
 * item only. Its (r2Key, contentId) form, which no caller used, would have
 * sent `{creatorId}/hls/{mediaId}/...` (Codex-adcgb).
 */
export class MediaNotFoundError extends NotFoundError {
  constructor(mediaItemId: string, context?: Record<string, unknown>) {
    super('Media item not found', { mediaItemId, ...context });
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
 * Category-specific errors (org landing "Browse by topic" taxonomy).
 */

export class CategoryNotFoundError extends NotFoundError {
  constructor(categoryId: string, context?: Record<string, unknown>) {
    super('Category not found', { categoryId, ...context });
  }
}

/**
 * Thrown as a race backstop when a category slug collides within its resolved
 * space at INSERT time. `CategoriesService.create` proactively suffixes
 * (`-2`, `-3`, …) to avoid collisions, so this only surfaces if a concurrent
 * insert claims the same suffix between the availability read and the write.
 */
export class CategorySlugConflictError extends ConflictError {
  constructor(slug: string) {
    super('Category with this slug already exists', { slug });
  }
}

/**
 * Thrown when a creator tries to publish content that earns money (any price,
 * or included in a tier — `requiresPayoutsToPublish`, `@codex/constants`)
 * before their Stripe Connect account can receive money, or to set or change
 * the price or tier of content that is already published. `@codex/access`
 * throws it for courses too (same rule, Codex-2hxff.14); `@codex/admin`, which
 * cannot depend on this package, has a twin with the same message and code.
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

/**
 * Publishing subscriber content that no tier includes (Codex-2hxff.91, owner
 * U2: "publishing needs at least one tier"). Saving such an item is allowed —
 * it is the CLOSED state a tier delete's "keep" also leaves — but it can't be
 * put on offer that way. "Subscriber content" is the switch on and NOT for
 * sale (`deriveContentAccessKind` = subscribers); a paid item whose tiers are
 * optional publishes with none, as it stays on sale. The studio's readiness
 * check matches
 * `code: 'TIER_REQUIRED_TO_PUBLISH'`. Maps to HTTP 422 via BusinessLogicError.
 * The context carries the content id only (it is sent to the client).
 */
export class TierRequiredToPublishError extends BusinessLogicError {
  constructor(contentId: string) {
    super('Tick at least one plan before publishing subscriber content.', {
      contentId,
      code: 'TIER_REQUIRED_TO_PUBLISH',
    });
  }
}

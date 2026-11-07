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
  ServiceError,
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

/**
 * Media that isn't ready to play: still processing, or failed. `mediaStatus`
 * tells the two apart, since one will finish and the other never will, and
 * `stalled` marks an upload that stopped (`uploading` past its stall line),
 * which won't either: the editor asks for the file again rather than to wait
 * (Codex-a6ofh.2.7).
 */
export class MediaNotReadyError extends BusinessLogicError {
  constructor(mediaItemId: string, mediaStatus?: string, stalled = false) {
    super('Media item not ready for publishing', {
      mediaItemId,
      ...(mediaStatus ? { mediaStatus } : {}),
      ...(stalled ? { stalled: true } : {}),
      code: ERROR_CODES.MEDIA_NOT_READY,
    });
  }
}

/**
 * A video or audio piece with no media attached, at publish or in a save of a
 * live piece. A draft may have none (Codex-a6ofh.2.1). 422 with
 * `details.code: 'MEDIA_REQUIRED'`.
 */
export class MediaRequiredToPublishError extends BusinessLogicError {
  constructor(contentId: string, contentType: string) {
    super('This content needs its media before it can be live.', {
      contentId,
      contentType,
      code: ERROR_CODES.MEDIA_REQUIRED,
    });
  }
}

/**
 * An article with nothing to read (`hasArticleBody`, @codex/validation), at
 * publish or in a save of a live piece. A draft may be empty
 * (Codex-a6ofh.2.1). 422 with `details.code: 'BODY_REQUIRED'`.
 */
export class ContentBodyRequiredError extends BusinessLogicError {
  constructor(contentId: string) {
    super('This article needs something to read before it can be live.', {
      contentId,
      code: ERROR_CODES.BODY_REQUIRED,
    });
  }
}

/**
 * A piece for sale without a price of at least £1, at publish or in a save of
 * a live piece. A draft may set the switch before the price
 * (Codex-a6ofh.2.1). 422 with `details.code: 'PRICE_REQUIRED'`.
 */
export class PriceRequiredToPublishError extends BusinessLogicError {
  constructor(contentId: string) {
    super(
      'Paid content needs a price of at least £1.00 before it can be live.',
      {
        contentId,
        code: ERROR_CODES.PRICE_REQUIRED,
      }
    );
  }
}

/**
 * Filing content into an org whose team the creator isn't on (Codex-ocal6),
 * by a create or a move, or publishing it there (Codex-a6ofh.2.1: a creator
 * who has left the org can't put a draft live in it). A create or move says
 * one thing whatever the reason, so it never tells whether an org id exists.
 * A publish names the creator: the caller may be an org admin, who IS on the
 * team, and the org is the row's own. 403 with `details.code: 'NOT_ON_ORG_TEAM'`.
 */
export class NotOnOrgTeamError extends ForbiddenError {
  constructor(action: 'file' | 'publish' = 'file') {
    super(
      action === 'publish'
        ? "This content's creator is no longer on the organization's team, so it can't be published there."
        : "You can only add content to an organization you're on the team of.",
      { code: ERROR_CODES.NOT_ON_ORG_TEAM }
    );
  }
}

/**
 * The counts a media delete refusal carries (Codex-6sbn1). A 409's context
 * reaches the client verbatim as `details`, so it is these two numbers and
 * nothing else: no titles, no ids. The Studio re-reads
 * `GET /api/media/:id/usage` to draw the list.
 */
export interface MediaUseCounts {
  live: number;
  drafts: number;
}

/**
 * DELETE /api/media/:id, refused: something live (published, bought, or an
 * org's intro video) uses the item. Checked first, so it wins over
 * {@link MediaUsageChangedError}.
 */
export class MediaInUseError extends ServiceError {
  constructor(counts: MediaUseCounts) {
    super(
      "Something published uses this media, so it can't be deleted yet.",
      ERROR_CODES.MEDIA_IN_USE,
      409,
      { live: counts.live, drafts: counts.drafts }
    );
  }
}

/**
 * DELETE /api/media/:id, refused: the uses differ from the ones the dialog
 * showed (the `?usage=` fingerprint), or drafts use it and no fingerprint was
 * sent. Nothing live uses it, or {@link MediaInUseError} would have won.
 */
export class MediaUsageChangedError extends ServiceError {
  constructor(counts: MediaUseCounts) {
    super(
      'Where this media is used has changed since you checked. Check again before deleting.',
      ERROR_CODES.MEDIA_USAGE_CHANGED,
      409,
      { live: counts.live, drafts: counts.drafts }
    );
  }
}

/**
 * Publishing content whose media item was deleted (it keeps the link, so a
 * restore heals it). 422 `BUSINESS_LOGIC_ERROR`; the editor matches
 * `details.code: 'MEDIA_DELETED'`.
 */
export class MediaDeletedError extends BusinessLogicError {
  constructor(contentId: string) {
    super(
      'Choose another media item before you publish: the last one was deleted.',
      { contentId, code: ERROR_CODES.MEDIA_DELETED }
    );
  }
}

/**
 * Publishing content, or saving live content, whose thumbnail is a frame of
 * one of the creator's deleted videos (Codex-tqvmx): the purge removes that
 * frame 30 days after the delete, and a live thumbnail would 404. 422
 * `BUSINESS_LOGIC_ERROR` with `details.code: 'THUMBNAIL_MEDIA_DELETED'`; the
 * editor shows the message, worded for the publish or the save it refused.
 */
export class ThumbnailMediaDeletedError extends BusinessLogicError {
  constructor(contentId: string, action: 'publish' | 'save') {
    super(
      action === 'publish'
        ? 'Choose another thumbnail before you publish: it’s a frame of a deleted video.'
        : 'Choose another thumbnail: live content can’t show a frame of a deleted video.',
      { contentId, code: ERROR_CODES.THUMBNAIL_MEDIA_DELETED }
    );
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

/**
 * A cancel of a publish-when-ready schedule that came too late: the piece
 * went live first, by the media-ready trigger or another tab (Codex-a6ofh.2.7).
 * 409 with `details.code: 'CONTENT_ALREADY_LIVE'`, never a 200 that reads as
 * "cancelled".
 */
export class ContentAlreadyLiveError extends ConflictError {
  constructor(contentId: string) {
    super('This is already live, so there is no publish to cancel.', {
      contentId,
      code: ERROR_CODES.CONTENT_ALREADY_LIVE,
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
 * throws it for courses too (same rule, Codex-2hxff.14), and `@codex/admin`'s
 * publish through the shared `assertPublishable` (Codex-a6ofh.2.1).
 *
 * Without this gate, a buyer can pay for content whose creator has no payout
 * destination — funds are collected and the creator payout is parked pending
 * indefinitely (see PurchaseService). Publishing is the last point at which the
 * content becomes purchasable, so it is the authoritative backend gate.
 *
 * `code: 'CREATOR_CONNECT_REQUIRED'` is shared with the subscription domain's
 * equivalent so the frontend can recognise the "set up payouts" condition
 * uniformly. Maps to HTTP 422 via BusinessLogicError.
 *
 * The context reaches the client verbatim, so it never names the creator: in
 * a team the one who can't be paid is often not the caller (review L5). A
 * refusal of several items (the tier checklist) names them by their ids,
 * which the caller already sees.
 */
export class CreatorPayoutsRequiredError extends BusinessLogicError {
  constructor(
    accessType: string,
    items: { contentIds?: string[]; courseIds?: string[] } = {}
  ) {
    super(
      'Set up payouts before publishing paid or subscriber content. Complete Stripe Connect onboarding to receive payments.',
      {
        accessType,
        ...items,
        code: ERROR_CODES.CREATOR_CONNECT_REQUIRED,
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
      code: ERROR_CODES.TIER_REQUIRED_TO_PUBLISH,
    });
  }
}

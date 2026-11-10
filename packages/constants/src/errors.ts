export const ERROR_CODES = {
  INVALID_URL: 'INVALID_URL',
  SSRF_BLOCKED: 'SSRF_BLOCKED',
  HTTPS_REQUIRED: 'HTTPS_REQUIRED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  INVALID_CONTENT_TYPE: 'INVALID_CONTENT_TYPE',
  MEDIA_NOT_READY: 'MEDIA_NOT_READY',
  // Media delete guard (Codex-6sbn1): 409s from DELETE /api/media/:id, and
  // the `details.code` of a publish refused because its media was deleted.
  MEDIA_IN_USE: 'MEDIA_IN_USE',
  MEDIA_USAGE_CHANGED: 'MEDIA_USAGE_CHANGED',
  MEDIA_DELETED: 'MEDIA_DELETED',
  // A publish, or a save to live content, refused because its thumbnail is a
  // frame of a deleted video (Codex-tqvmx).
  THUMBNAIL_MEDIA_DELETED: 'THUMBNAIL_MEDIA_DELETED',
  // The `details.code` of the other publish refusals (Codex-a6ofh.2.1): a
  // video or audio piece with no media, an article with nothing to read, a
  // piece for sale under £1, and a creator no longer on the org's team (also
  // a create or a move into an org they aren't on). The editor's publish
  // checklist maps each code to its row.
  MEDIA_REQUIRED: 'MEDIA_REQUIRED',
  BODY_REQUIRED: 'BODY_REQUIRED',
  PRICE_REQUIRED: 'PRICE_REQUIRED',
  NOT_ON_ORG_TEAM: 'NOT_ON_ORG_TEAM',
  // A subscriber piece published with no plan ticked, and a paid or
  // subscriber piece whose creator can't be paid yet (`@codex/content` and
  // `@codex/subscription` share the second, so the studio says one thing).
  TIER_REQUIRED_TO_PUBLISH: 'TIER_REQUIRED_TO_PUBLISH',
  CREATOR_CONNECT_REQUIRED: 'CREATOR_CONNECT_REQUIRED',
  CONTENT_NOT_FOUND: 'CONTENT_NOT_FOUND',
  // A cancel of a publish-when-ready schedule that came too late: the piece
  // went live first (Codex-a6ofh.2.7), so the editor says that, not "cancelled".
  CONTENT_ALREADY_LIVE: 'CONTENT_ALREADY_LIVE',
  // A publish-when-ready schedule cleared because its media failed for good
  // (Codex-a6ofh.2.8). Stored as `content.publish_blocked_reason`; no
  // publish ever refuses with it.
  MEDIA_FAILED: 'MEDIA_FAILED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  BUSINESS_LOGIC_ERROR: 'BUSINESS_LOGIC_ERROR',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
} as const;

/**
 * Every `details.code` a publish can be refused with (`@codex/content`'s
 * publish gate). The top-level code is only the class (`BUSINESS_LOGIC_ERROR`,
 * `FORBIDDEN`), so the studio forwards these (`forwardClientErrors`) and its
 * publish checklist maps each to its row (Codex-a6ofh.2.4).
 */
export const PUBLISH_REFUSAL_CODES = [
  ERROR_CODES.MEDIA_REQUIRED,
  ERROR_CODES.MEDIA_NOT_READY,
  ERROR_CODES.MEDIA_DELETED,
  ERROR_CODES.BODY_REQUIRED,
  ERROR_CODES.PRICE_REQUIRED,
  ERROR_CODES.NOT_ON_ORG_TEAM,
  ERROR_CODES.THUMBNAIL_MEDIA_DELETED,
  ERROR_CODES.TIER_REQUIRED_TO_PUBLISH,
  ERROR_CODES.CREATOR_CONNECT_REQUIRED,
] as const;

export type PublishRefusalCode = (typeof PUBLISH_REFUSAL_CODES)[number];

/**
 * Every reason a publish-when-ready schedule can end without going live, as
 * `content.publish_blocked_reason` stores it (Codex-a6ofh.2.8): a refusal
 * the go-live re-check returned, or the media failing for good.
 */
export const PUBLISH_BLOCKED_REASONS = [
  ...PUBLISH_REFUSAL_CODES,
  ERROR_CODES.MEDIA_FAILED,
] as const;

export type PublishBlockedReason = (typeof PUBLISH_BLOCKED_REASONS)[number];

export function isPublishBlockedReason(
  code: unknown
): code is PublishBlockedReason {
  return (PUBLISH_BLOCKED_REASONS as readonly unknown[]).includes(code);
}

export const STATUS_CODES = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
} as const;

export const AWS_ERRORS = {
  NOT_FOUND: 'NotFound',
} as const;

export class UrlValidationError extends Error {
  constructor(
    message: string,
    public code: keyof typeof ERROR_CODES
  ) {
    super(message);
    this.name = 'UrlValidationError';
  }
}

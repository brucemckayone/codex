/**
 * Content domain constants
 */

export const CONTENT_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
} as const;

export const MEDIA_STATUS = {
  UPLOADING: 'uploading',
  UPLOADED: 'uploaded',
  TRANSCODING: 'transcoding',
  READY: 'ready',
  FAILED: 'failed',
} as const;

export const CONTENT_TYPES = {
  VIDEO: 'video',
  AUDIO: 'audio',
  WRITTEN: 'written',
} as const;

export const MEDIA_TYPES = {
  VIDEO: 'video',
  AUDIO: 'audio',
} as const;

export const VISIBILITY = {
  PUBLIC: 'public',
  PRIVATE: 'private',
  MEMBERS_ONLY: 'members_only',
  PURCHASED_ONLY: 'purchased_only',
} as const;

/**
 * Content access model — defines HOW a piece of content is gated
 * (`content.access_type`).
 *
 * Single source of truth for the `content.access_type` column: mirrors its
 * CHECK constraint (`database/schema/content.ts` `check_content_access_type`)
 * and the `contentAccessTypeEnum` Zod schema (`@codex/validation`).
 *
 * Hierarchy (each level includes the ones above):
 *   free < followers < subscribers < team
 *
 * - free:        Anyone can access (price must be null/0, no tier)
 * - paid:        One-time purchase required (price > 0, no tier)
 * - followers:   Must follow the org (free opt-in) — subscribers + team also qualify
 * - subscribers: Subscription tier required (tier set, optional price for buy-bypass)
 * - team:        Owner/admin/creator only (org management roles)
 *
 * NB: 'members' was a legacy alias for 'team'; it has been fully removed and
 * 'team' is the canonical value.
 *
 * @see ACCESS_TYPES for per-user grant records (how a user *obtained* access).
 */
export const CONTENT_ACCESS_TYPE = {
  FREE: 'free',
  PAID: 'paid',
  FOLLOWERS: 'followers',
  SUBSCRIBERS: 'subscribers',
  TEAM: 'team',
} as const;

export type ContentAccessType =
  (typeof CONTENT_ACCESS_TYPE)[keyof typeof CONTENT_ACCESS_TYPE];

/**
 * Content-access GRANT records — how a user *obtained* access to a piece of
 * content. One row per (user, content) in the `content_access` table
 * (`database/schema/ecommerce.ts`).
 *
 * Single source of truth for the `content_access.access_type` column: mirrors
 * its CHECK constraint (`database/schema/ecommerce.ts` `check_access_type`).
 *
 * - purchased:     one-time purchase (completed or pending-webhook)
 * - subscription:  granted via an active subscription
 * - complimentary: manually granted by an org admin (no charge)
 * - preview:       time-boxed / partial preview grant
 *
 * NB: distinct from CONTENT_ACCESS_TYPE, which gates the content itself
 * (`content.access_type`) rather than recording how a user got in.
 *
 * @see CONTENT_ACCESS_TYPE for the content-gating model.
 */
export const ACCESS_TYPES = {
  PURCHASED: 'purchased',
  SUBSCRIPTION: 'subscription',
  COMPLIMENTARY: 'complimentary',
  PREVIEW: 'preview',
} as const;

export type ContentAccessGrantType =
  (typeof ACCESS_TYPES)[keyof typeof ACCESS_TYPES];

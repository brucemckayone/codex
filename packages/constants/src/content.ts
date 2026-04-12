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

export const ACCESS_TYPES = {
  FREE: 'free',
  PURCHASED: 'purchased',
  SUBSCRIPTION: 'subscription',
  COMPLIMENTARY: 'complimentary',
  MEMBERS_ONLY: 'members_only',
} as const;

/**
 * Content access model — defines HOW content is gated.
 *
 * Hierarchy (each level includes the ones above):
 *   free < followers < subscribers < team
 *
 * - free: Anyone can access (price must be null/0, no tier)
 * - paid: One-time purchase required (price > 0, no tier)
 * - followers: Must follow the org (free opt-in) — subscribers + team also qualify
 * - subscribers: Subscription tier required (tier set, optional price for buy-bypass)
 * - team: Owner/admin/creator only (org management roles)
 * - members: @deprecated — alias for 'team', kept for backward compat during migration
 *
 * @see ACCESS_TYPES for per-user grant records (how a user *obtained* access)
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

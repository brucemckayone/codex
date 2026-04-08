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
 * - free: Anyone can access (price must be null/0, no tier)
 * - paid: One-time purchase required (price > 0, no tier)
 * - subscribers: Subscription tier required (tier set, optional price for buy-bypass)
 * - members: Organisation team members only (no price, no tier)
 *
 * @see ACCESS_TYPES for per-user grant records (how a user *obtained* access)
 */
export const CONTENT_ACCESS_TYPE = {
  FREE: 'free',
  PAID: 'paid',
  SUBSCRIBERS: 'subscribers',
  MEMBERS: 'members',
} as const;

export type ContentAccessType =
  (typeof CONTENT_ACCESS_TYPE)[keyof typeof CONTENT_ACCESS_TYPE];

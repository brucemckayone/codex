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
  COMPLIMENTARY: 'complimentary',
  MEMBERS_ONLY: 'members_only',
} as const;

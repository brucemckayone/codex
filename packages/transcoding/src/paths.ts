/**
 * R2/B2 Path Generation - SINGLE SOURCE OF TRUTH
 *
 * All R2 storage paths for transcoding inputs and outputs MUST come from this file.
 * No path strings should be hardcoded elsewhere in the codebase.
 *
 * Storage Structure (single MEDIA_BUCKET with creator subfolder structure):
 *   {creatorId}/originals/{mediaId}/video.mp4          - Original upload
 *   {creatorId}/hls/{mediaId}/master.m3u8              - HLS master playlist
 *   {creatorId}/hls/{mediaId}/preview/preview.m3u8    - 30s preview clip
 *   {creatorId}/thumbnails/{mediaId}/auto-generated.jpg - Auto thumbnail
 *   {creatorId}/waveforms/{mediaId}/waveform.json      - Audio waveform data
 *   {creatorId}/waveforms/{mediaId}/waveform.png       - Audio waveform image
 */

import type { MediaType } from './types';

/**
 * Path configuration constants
 */
export const PATH_CONFIG = {
  /** Folder for original uploaded files */
  ORIGINALS_FOLDER: 'originals',
  /** Folder for HLS transcoded outputs */
  HLS_FOLDER: 'hls',
  /** Subfolder for HLS preview clips */
  HLS_PREVIEW_SUBFOLDER: 'preview',
  /** Folder for auto-generated thumbnails */
  THUMBNAILS_FOLDER: 'thumbnails',
  /** Folder for audio waveform data */
  WAVEFORMS_FOLDER: 'waveforms',

  /** Default filenames */
  HLS_MASTER_FILENAME: 'master.m3u8',
  HLS_PREVIEW_FILENAME: 'preview.m3u8',
  THUMBNAIL_FILENAME: 'auto-generated.jpg',
  WAVEFORM_JSON_FILENAME: 'waveform.json',
  WAVEFORM_IMAGE_FILENAME: 'waveform.png',

  /** New image pipeline folders */
  CONTENT_THUMBNAILS_FOLDER: 'content-thumbnails',
  MEDIA_THUMBNAILS_FOLDER: 'media-thumbnails',
  BRANDING_FOLDER: 'branding',
  LOGO_SUBFOLDER: 'logo',
  /** Root level avatars folder (not creator-scoped) */
  AVATARS_FOLDER: 'avatars',
} as const;

/**
 * B2 Path configuration constants (archival mezzanine storage)
 *
 * Bucket names by environment:
 * - Production: codex-mezzanine-production
 * - Dev: codex-mezzanine-dev
 * - Test: codex-mezzanine-test
 */
export const B2_PATH_CONFIG = {
  /** Folder for mezzanine archive files */
  MEZZANINE_FOLDER: 'mezzanine',
  /** Default mezzanine filename (high-quality CRF 18 intermediate) */
  MEZZANINE_FILENAME: 'mezzanine.mp4',
} as const;

/**
 * Generate B2 key for mezzanine archive file
 *
 * Mezzanine files are high-quality intermediates (CRF 18) stored in B2
 * for archival purposes and potential future re-transcoding.
 *
 * @param creatorId - Creator's user ID
 * @param mediaId - Media item UUID
 * @returns B2 key path to mezzanine file
 *
 * @example
 * getMezzanineKey('user-123', 'media-456')
 * // Returns: 'user-123/mezzanine/media-456/mezzanine.mp4'
 */
export function getMezzanineKey(creatorId: string, mediaId: string): string {
  return `${creatorId}/${B2_PATH_CONFIG.MEZZANINE_FOLDER}/${mediaId}/${B2_PATH_CONFIG.MEZZANINE_FILENAME}`;
}

/**
 * Generate B2 key prefix for mezzanine folder
 * Useful for listing or deleting mezzanine files for a media item
 *
 * @param creatorId - Creator's user ID
 * @param mediaId - Media item UUID
 * @returns B2 key prefix
 *
 * @example
 * getMezzaninePrefix('user-123', 'media-456')
 * // Returns: 'user-123/mezzanine/media-456/'
 */
export function getMezzaninePrefix(creatorId: string, mediaId: string): string {
  return `${creatorId}/${B2_PATH_CONFIG.MEZZANINE_FOLDER}/${mediaId}/`;
}

/**
 * Generate R2 key for original uploaded file
 *
 * @param creatorId - Creator's user ID
 * @param mediaId - Media item UUID
 * @param filename - Original filename with extension
 * @returns R2 key path
 *
 * @example
 * getOriginalKey('user-123', 'media-456', 'video.mp4')
 * // Returns: 'user-123/originals/media-456/video.mp4'
 */
export function getOriginalKey(
  creatorId: string,
  mediaId: string,
  filename: string
): string {
  return `${creatorId}/${PATH_CONFIG.ORIGINALS_FOLDER}/${mediaId}/${filename}`;
}

/**
 * Generate R2 key for HLS master playlist
 *
 * @param creatorId - Creator's user ID
 * @param mediaId - Media item UUID
 * @returns R2 key path to master.m3u8
 *
 * @example
 * getHlsMasterKey('user-123', 'media-456')
 * // Returns: 'user-123/hls/media-456/master.m3u8'
 */
export function getHlsMasterKey(creatorId: string, mediaId: string): string {
  return `${creatorId}/${PATH_CONFIG.HLS_FOLDER}/${mediaId}/${PATH_CONFIG.HLS_MASTER_FILENAME}`;
}

/**
 * Generate R2 key for HLS preview clip playlist
 *
 * @param creatorId - Creator's user ID
 * @param mediaId - Media item UUID
 * @returns R2 key path to preview playlist
 *
 * @example
 * getHlsPreviewKey('user-123', 'media-456')
 * // Returns: 'user-123/hls/media-456/preview/preview.m3u8'
 */
export function getHlsPreviewKey(creatorId: string, mediaId: string): string {
  return `${creatorId}/${PATH_CONFIG.HLS_FOLDER}/${mediaId}/${PATH_CONFIG.HLS_PREVIEW_SUBFOLDER}/${PATH_CONFIG.HLS_PREVIEW_FILENAME}`;
}

/**
 * Generate R2 key for HLS variant playlist
 *
 * @param creatorId - Creator's user ID
 * @param mediaId - Media item UUID
 * @param variant - Quality variant (1080p, 720p, 480p, 360p, audio)
 * @returns R2 key path to variant playlist
 *
 * @example
 * getHlsVariantKey('user-123', 'media-456', '1080p')
 * // Returns: 'user-123/hls/media-456/1080p/index.m3u8'
 */
export function getHlsVariantKey(
  creatorId: string,
  mediaId: string,
  variant: string
): string {
  return `${creatorId}/${PATH_CONFIG.HLS_FOLDER}/${mediaId}/${variant}/index.m3u8`;
}

/**
 * Generate R2 key for auto-generated thumbnail
 *
 * @param creatorId - Creator's user ID
 * @param mediaId - Media item UUID
 * @returns R2 key path to thumbnail
 *
 * @example
 * getThumbnailKey('user-123', 'media-456')
 * // Returns: 'user-123/thumbnails/media-456/auto-generated.jpg'
 */
export function getThumbnailKey(creatorId: string, mediaId: string): string {
  return `${creatorId}/${PATH_CONFIG.THUMBNAILS_FOLDER}/${mediaId}/${PATH_CONFIG.THUMBNAIL_FILENAME}`;
}

/**
 * Generate R2 key for audio waveform JSON data
 *
 * @param creatorId - Creator's user ID
 * @param mediaId - Media item UUID
 * @returns R2 key path to waveform JSON
 *
 * @example
 * getWaveformKey('user-123', 'media-456')
 * // Returns: 'user-123/waveforms/media-456/waveform.json'
 */
export function getWaveformKey(creatorId: string, mediaId: string): string {
  return `${creatorId}/${PATH_CONFIG.WAVEFORMS_FOLDER}/${mediaId}/${PATH_CONFIG.WAVEFORM_JSON_FILENAME}`;
}

/**
 * Generate R2 key for audio waveform image
 *
 * @param creatorId - Creator's user ID
 * @param mediaId - Media item UUID
 * @returns R2 key path to waveform PNG
 *
 * @example
 * getWaveformImageKey('user-123', 'media-456')
 * // Returns: 'user-123/waveforms/media-456/waveform.png'
 */
export function getWaveformImageKey(
  creatorId: string,
  mediaId: string
): string {
  return `${creatorId}/${PATH_CONFIG.WAVEFORMS_FOLDER}/${mediaId}/${PATH_CONFIG.WAVEFORM_IMAGE_FILENAME}`;
}

/**
 * Generate R2 key for content thumbnail (custom uploaded)
 *
 * @param creatorId - Creator's user ID
 * @param contentId - Content UUID
 * @param size - Size variant (sm, md, lg)
 * @returns R2 key path to webp image
 *
 * @example
 * getContentThumbnailKey('user-123', 'content-456', 'md')
 * // Returns: 'user-123/content-thumbnails/content-456/md.webp'
 */
export function getContentThumbnailKey(
  creatorId: string,
  contentId: string,
  size: string
): string {
  return `${creatorId}/${PATH_CONFIG.CONTENT_THUMBNAILS_FOLDER}/${contentId}/${size}.webp`;
}

/**
 * Generate R2 key for organization logo
 *
 * @param creatorId - Organization/Creator ID
 * @param size - Size variant (sm, md, lg) or 'original' for SVG
 * @returns R2 key path to webp image (or svg)
 *
 * @example
 * getOrgLogoKey('org-123', 'lg')
 * // Returns: 'org-123/branding/logo/lg.webp'
 */
export function getOrgLogoKey(creatorId: string, size: string): string {
  // SVG logos might use 'original' size without .webp extension?
  // Plan says "Store original sanitized SVG".
  // But also says "ensure consistent {size}.webp naming".
  // If size is 'original' and it's SVG, we might want to handle extension,
  // but for now implementing strict {size}.webp as per task unless size implies extension.
  // Actually, let's stick to .webp for now as the plan emphasizes it.
  // For SVG support, we might need a separate function or 'original.svg'
  // but the interface for this task is about the standard sizes.
  return `${creatorId}/${PATH_CONFIG.BRANDING_FOLDER}/${PATH_CONFIG.LOGO_SUBFOLDER}/${size}.webp`;
}

/**
 * Generate R2 key for user avatar
 *
 * @param userId - User ID
 * @param size - Size variant (sm, md, lg)
 * @returns R2 key path to webp image
 *
 * @example
 * getUserAvatarKey('user-123', 'sm')
 * // Returns: 'avatars/user-123/sm.webp'
 */
export function getUserAvatarKey(userId: string, size: string): string {
  return `${PATH_CONFIG.AVATARS_FOLDER}/${userId}/${size}.webp`;
}

/**
 * Thumbnail size variant type
 */
export type ThumbnailSize = 'sm' | 'md' | 'lg';

/**
 * Generate R2 key for auto-generated media thumbnail
 * Stored in ASSETS_BUCKET for public CDN access
 *
 * These are the responsive WebP thumbnails generated during video transcoding,
 * distinct from custom-uploaded content thumbnails.
 *
 * @param creatorId - Creator's user ID
 * @param mediaId - Media item UUID
 * @param size - Size variant (sm/md/lg)
 * @returns R2 key path to WebP thumbnail in ASSETS_BUCKET
 *
 * @example
 * getMediaThumbnailKey('user-123', 'media-456', 'md')
 * // Returns: 'user-123/media-thumbnails/media-456/md.webp'
 */
export function getMediaThumbnailKey(
  creatorId: string,
  mediaId: string,
  size: ThumbnailSize
): string {
  return `${creatorId}/${PATH_CONFIG.MEDIA_THUMBNAILS_FOLDER}/${mediaId}/${size}.webp`;
}

/**
 * Get public CDN URL for media thumbnail
 *
 * Constructs the full CDN URL for a media thumbnail variant.
 * No presigned URL needed since ASSETS_BUCKET is public.
 *
 * @param creatorId - Creator's user ID
 * @param mediaId - Media item UUID
 * @param size - Size variant (sm/md/lg)
 * @param cdnBase - CDN base URL (defaults to production CDN)
 * @returns Full CDN URL to thumbnail
 *
 * @example
 * getMediaThumbnailUrl('user-123', 'media-456', 'lg')
 * // Returns: 'https://cdn-assets.revelations.studio/user-123/media-thumbnails/media-456/lg.webp'
 */
export function getMediaThumbnailUrl(
  creatorId: string,
  mediaId: string,
  size: ThumbnailSize,
  cdnBase = 'https://cdn-assets.revelations.studio'
): string {
  const key = getMediaThumbnailKey(creatorId, mediaId, size);
  return `${cdnBase}/${key}`;
}

/**
 * Generate R2 key prefix for all HLS outputs
 * Useful for listing or deleting all HLS files for a media item
 *
 * @param creatorId - Creator's user ID
 * @param mediaId - Media item UUID
 * @returns R2 key prefix
 *
 * @example
 * getHlsPrefix('user-123', 'media-456')
 * // Returns: 'user-123/hls/media-456/'
 */
export function getHlsPrefix(creatorId: string, mediaId: string): string {
  return `${creatorId}/${PATH_CONFIG.HLS_FOLDER}/${mediaId}/`;
}

/**
 * Generate all expected output keys for a transcoding job
 *
 * @param creatorId - Creator's user ID
 * @param mediaId - Media item UUID
 * @param mediaType - Type of media (video or audio)
 * @returns Object with all expected output keys
 */
export function getTranscodingOutputKeys(
  creatorId: string,
  mediaId: string,
  mediaType: MediaType
): {
  hlsMasterKey: string;
  hlsPreviewKey: string;
  thumbnailKey: string | null;
  waveformKey: string | null;
  waveformImageKey: string | null;
} {
  const hlsMasterKey = getHlsMasterKey(creatorId, mediaId);
  const hlsPreviewKey = getHlsPreviewKey(creatorId, mediaId);

  if (mediaType === 'video') {
    return {
      hlsMasterKey,
      hlsPreviewKey,
      thumbnailKey: getThumbnailKey(creatorId, mediaId),
      waveformKey: null,
      waveformImageKey: null,
    };
  }

  // Audio
  return {
    hlsMasterKey,
    hlsPreviewKey,
    thumbnailKey: null,
    waveformKey: getWaveformKey(creatorId, mediaId),
    waveformImageKey: getWaveformImageKey(creatorId, mediaId),
  };
}

/**
 * Parse a media item's r2Key to extract components
 *
 * @param r2Key - Full R2 key path
 * @returns Parsed components or null if invalid format
 *
 * @example
 * parseR2Key('user-123/originals/media-456/video.mp4')
 * // Returns: { creatorId: 'user-123', folder: 'originals', mediaId: 'media-456', filename: 'video.mp4' }
 */
export function parseR2Key(r2Key: string): {
  creatorId: string;
  folder: string;
  mediaId: string;
  filename: string;
} | null {
  const parts = r2Key.split('/');
  if (parts.length < 4) {
    return null;
  }

  const [creatorId, folder, mediaId, ...rest] = parts;
  const filename = rest.join('/');

  if (!creatorId || !folder || !mediaId || !filename) {
    return null;
  }

  return { creatorId, folder, mediaId, filename };
}

/**
 * Validate that an R2 key follows expected format (no path traversal)
 *
 * @param r2Key - R2 key to validate
 * @returns true if valid, false otherwise
 */
export function isValidR2Key(r2Key: string): boolean {
  // Check for path traversal attempts (including URL-encoded variants)
  if (
    r2Key.includes('..') ||
    r2Key.includes('//') ||
    r2Key.includes('%2e') ||
    r2Key.includes('%2E') ||
    r2Key.includes('\\')
  ) {
    return false;
  }

  // Check for null bytes (including URL-encoded)
  if (r2Key.includes('\0') || r2Key.includes('%00')) {
    return false;
  }

  // Must start with alphanumeric (creator ID)
  if (!/^[a-zA-Z0-9]/.test(r2Key)) {
    return false;
  }

  // Parse to validate structure
  const parsed = parseR2Key(r2Key);
  return parsed !== null;
}

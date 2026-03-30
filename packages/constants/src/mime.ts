export const MIME_TYPES = {
  VIDEO: {
    MP4: 'video/mp4',
    MP2T: 'video/MP2T', // HLS .ts segments
  },
  STREAMING: {
    HLS: 'application/vnd.apple.mpegurl', // .m3u8 playlists
    HLS_ALT: 'application/x-mpegURL', // Alternative .m3u8 MIME type
  },
  IMAGE: {
    PNG: 'image/png',
    JPEG: 'image/jpeg',
    WEBP: 'image/webp',
    GIF: 'image/gif',
    SVG: 'image/svg+xml',
  },
  AUDIO: {
    MPEG: 'audio/mpeg',
    WAV: 'audio/wav',
    MP4: 'audio/mp4',
  },
  DOCUMENT: {
    PDF: 'application/pdf',
    TXT: 'text/plain',
    CSV: 'text/csv',
  },
  APPLICATION: {
    JSON: 'application/json',
  },
} as const;

/**
 * Supported MIME types for image uploads across the platform
 * Used by image-processing and validation packages
 *
 * Note: SVG excluded from upload validation (sanitized separately via DOMPurify)
 */
export const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  MIME_TYPES.IMAGE.PNG,
  MIME_TYPES.IMAGE.JPEG,
  MIME_TYPES.IMAGE.WEBP,
  MIME_TYPES.IMAGE.GIF,
]) as Set<string>;

/**
 * Supported MIME types for media uploads (video and audio).
 * Must stay in sync with mimeTypeSchema in @codex/validation.
 */
export const SUPPORTED_MEDIA_MIME_TYPES = new Set([
  MIME_TYPES.VIDEO.MP4,
  'video/quicktime',
  'video/x-msvideo',
  'video/webm',
  MIME_TYPES.AUDIO.MPEG,
  MIME_TYPES.AUDIO.MP4,
  MIME_TYPES.AUDIO.WAV,
  'audio/webm',
  'audio/ogg',
]) as Set<string>;

/**
 * MIME type to file extension mapping for media uploads.
 * Must stay in sync with mimeTypeSchema in @codex/validation.
 */
export const MIME_TO_EXTENSION: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/webm': 'weba',
  'audio/ogg': 'ogg',
};

export const HEADERS = {
  CONTENT_TYPE: 'Content-Type',
  AUTHORIZATION: 'Authorization',
  WORKER_SIGNATURE: 'X-Worker-Signature',
  WORKER_TIMESTAMP: 'X-Worker-Timestamp',
  REQUEST_ID: 'X-Request-Id',
} as const;

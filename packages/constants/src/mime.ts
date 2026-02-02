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

export const HEADERS = {
  CONTENT_TYPE: 'Content-Type',
  AUTHORIZATION: 'Authorization',
  WORKER_SIGNATURE: 'X-Worker-Signature',
  WORKER_TIMESTAMP: 'X-Worker-Timestamp',
  REQUEST_ID: 'X-Request-Id',
} as const;

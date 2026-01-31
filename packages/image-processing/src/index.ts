/**
 * @codex/image-processing
 *
 * Image upload validation and processing service
 * Handles static image assets: thumbnails, logos, avatars
 */

// Re-export from @codex/validation for convenience
export {
  extractMimeType,
  MAX_IMAGE_SIZE_BYTES,
  SUPPORTED_IMAGE_MIME_TYPES,
  validateImageSignature,
  validateImageUpload,
} from '@codex/validation';
export { ImageUploadError, InvalidImageError } from './errors';
export { type ImageProcessingResult, ImageProcessingService } from './service';

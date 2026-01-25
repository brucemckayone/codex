/**
 * @codex/image-processing
 *
 * Image upload validation and processing service
 * Handles static image assets: thumbnails, logos, avatars
 */

export { ImageUploadError, InvalidImageError } from './errors';
export { type ImageProcessingResult, ImageProcessingService } from './service';
export {
  extractMimeType,
  MAX_IMAGE_SIZE_BYTES,
  SUPPORTED_MIME_TYPES,
  validateImageSignature,
  validateImageUpload,
} from './validation';

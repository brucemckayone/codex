/**
 * @codex/image-processing
 *
 * Image upload validation and processing service
 * Handles static image assets: thumbnails, logos, avatars
 */

export { ImageProcessingService, type ImageProcessingResult } from './service';
export { InvalidImageError, ImageUploadError } from './errors';
export {
  validateImageUpload,
  validateImageSignature,
  extractMimeType,
  MAX_IMAGE_SIZE_BYTES,
  SUPPORTED_MIME_TYPES,
} from './validation';

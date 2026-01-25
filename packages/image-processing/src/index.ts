<<<<<<< HEAD

export * from './photon-wrapper';
export * from './processor';
export * from './service';

=======

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

>>>>>>> 8382ae6cb976af715f83b1cc106536c18c8b47cf

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
export {
  type CleanupStats,
  type OrphanedFileRecord,
  OrphanedFileService,
  PAGE_IMAGE_GRACE_MS,
  type RecordOrphanInput,
} from './orphaned-file-service';
// Page-image key shape (Codex-61zsk.10): the save that nominates page images
// for cleanup (`CourseJourneyService`) and the sweep that deletes them
// (media-api's orphan DO) must agree with the upload on every key.
export {
  pageIdOfPageImageKey,
  pageImageKey,
  pageImageKeyOfObject,
  pageImageObjectKeys,
} from './page-image-keys';
export { type ImageProcessingResult, ImageProcessingService } from './service';
// `recordOrphansOrLog` (Codex-61zsk.10): the one guarded, never-throwing way to
// queue an orphan record from a failure/removal path. `CourseJourneyService`
// needs it directly — a page image's orphan candidates surface from a
// `sections` jsonb diff inside `saveJourneyPage`, not from an
// `ImageProcessingService` upload/persist call, so this is the one
// `upload-pipeline.ts` helper that has to leave the package rather than stay
// an internal implementation detail of `service.ts`.
export { recordOrphansOrLog } from './utils/upload-pipeline';

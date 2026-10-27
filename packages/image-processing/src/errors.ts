import { ValidationError } from '@codex/service-errors';

/**
 * What an uploader is told when a file passes the magic-byte check but its
 * size cannot be read, or it will not decode (Codex-kk9nv.12).
 */
export const UNREADABLE_IMAGE_MESSAGE =
  'This image could not be read. Try saving it as a JPEG or PNG and uploading it again.';

export class InvalidImageError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidImageError';
  }
}

export class ImageUploadError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'ImageUploadError';
  }
}

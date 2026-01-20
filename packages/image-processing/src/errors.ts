import { ValidationError } from '@codex/service-errors';

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

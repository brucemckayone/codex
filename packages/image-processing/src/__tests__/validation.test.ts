import { describe, expect, it } from 'vitest';
import { InvalidImageError } from '../errors';
import {
  extractMimeType,
  MAX_IMAGE_SIZE_BYTES,
  validateImageUpload,
} from '../validation';

describe('Image Validation', () => {
  it('should have MAX_IMAGE_SIZE_BYTES set to 5MB', () => {
    expect(MAX_IMAGE_SIZE_BYTES).toBe(5 * 1024 * 1024);
  });

  describe('extractMimeType', () => {
    it('should extract simple mime type', () => {
      expect(extractMimeType('image/jpeg')).toBe('image/jpeg');
    });

    it('should extract mime type with charset', () => {
      expect(extractMimeType('image/png; charset=utf-8')).toBe('image/png');
    });

    it('should throw error for empty content type', () => {
      expect(() => extractMimeType('')).toThrow(InvalidImageError);
    });
  });

  describe('validateImageUpload', () => {
    it('should throw error if buffer is empty', () => {
      const buffer = new ArrayBuffer(0);
      expect(() => validateImageUpload(buffer, 'image/png')).toThrow(
        InvalidImageError
      );
      expect(() => validateImageUpload(buffer, 'image/png')).toThrow(
        'Image file is empty'
      );
    });

    it('should throw error if buffer is too large', () => {
      // Create a buffer 1 byte larger than limit
      // Note: Creating a large buffer might be slow or memory intensive in test,
      // but 5MB + 1 byte is fine.
      const buffer = new ArrayBuffer(MAX_IMAGE_SIZE_BYTES + 1);
      expect(() => validateImageUpload(buffer, 'image/png')).toThrow(
        InvalidImageError
      );
      expect(() => validateImageUpload(buffer, 'image/png')).toThrow(
        'Image too large'
      );
    });

    it('should throw error for unsupported mime type', () => {
      const buffer = new Uint8Array([0xff, 0xd8, 0xff]).buffer; // JPEG magic bytes
      expect(() => validateImageUpload(buffer, 'application/pdf')).toThrow(
        InvalidImageError
      );
      expect(() => validateImageUpload(buffer, 'application/pdf')).toThrow(
        'Unsupported MIME type'
      );
    });

    it('should validate valid JPEG signature', () => {
      const buffer = new Uint8Array([0xff, 0xd8, 0xff]).buffer;
      expect(() => validateImageUpload(buffer, 'image/jpeg')).not.toThrow();
    });

    it('should validate valid PNG signature', () => {
      const buffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
      expect(() => validateImageUpload(buffer, 'image/png')).not.toThrow();
    });

    it('should throw error if magic bytes do not match mime type', () => {
      const buffer = new Uint8Array([0xff, 0xd8, 0xff]).buffer; // JPEG bytes
      expect(() => validateImageUpload(buffer, 'image/png')).toThrow(
        InvalidImageError
      );
      expect(() => validateImageUpload(buffer, 'image/png')).toThrow(
        'File does not match image/png format'
      );
    });
  });
});

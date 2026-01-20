/**
 * Image Upload Validation
 *
 * Implements strict magic byte checking and size limits for image security.
 */

import { InvalidImageError } from './errors';

// Maximum image size: 5MB
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

// Supported image MIME types
export const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

// Magic bytes (file signatures) for supported formats
const MAGIC_BYTES: Record<string, Uint8Array[]> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
  'image/gif': [
    [0x47, 0x49, 0x46, 0x38, 0x37], // GIF87a
    [0x47, 0x49, 0x46, 0x38, 0x39], // GIF89a
  ],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF (WebP starts with RIFF...WEBP)
};

/**
 * Verify file magic bytes match expected image format
 * Prevents attacks like renamed .exe files disguised as images
 */
export function validateImageSignature(
  buffer: ArrayBuffer,
  expectedMimeType: string
): boolean {
  if (!SUPPORTED_MIME_TYPES.has(expectedMimeType)) {
    throw new InvalidImageError(
      `Unsupported MIME type: ${expectedMimeType}. Supported: JPEG, PNG, GIF, WebP`
    );
  }

  const bytes = new Uint8Array(buffer);
  const magicSets = MAGIC_BYTES[expectedMimeType];

  if (!magicSets) {
    throw new InvalidImageError(`No magic bytes defined for ${expectedMimeType}`);
  }

  // Check if file starts with any valid magic bytes for this format
  const isValid = magicSets.some((magic) => {
    if (bytes.length < magic.length) return false;
    return magic.every((byte, idx) => bytes[idx] === byte);
  });

  if (!isValid) {
    throw new InvalidImageError(
      `File does not match ${expectedMimeType} format (invalid magic bytes)`
    );
  }

  // Additional check for WebP: verify "WEBP" marker
  if (expectedMimeType === 'image/webp') {
    const view = new DataView(buffer);
    // RIFF....WEBP format: bytes 8-11 should be "WEBP"
    if (view.byteLength < 12) {
      throw new InvalidImageError('WebP file too small (missing WEBP marker)');
    }
    const webpMarker = [
      view.getUint8(8),
      view.getUint8(9),
      view.getUint8(10),
      view.getUint8(11),
    ];
    const expectedWebp = [0x57, 0x45, 0x42, 0x50]; // "WEBP"
    if (!webpMarker.every((byte, idx) => byte === expectedWebp[idx])) {
      throw new InvalidImageError('File is RIFF but not WebP format');
    }
  }

  return true;
}

/**
 * Validate image file for upload
 * Checks magic bytes, size, and MIME type
 */
export function validateImageUpload(
  buffer: ArrayBuffer,
  mimeType: string
): void {
  // Check size
  if (buffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
    throw new InvalidImageError(
      `Image too large: ${(buffer.byteLength / 1024 / 1024).toFixed(2)}MB exceeds 5MB limit`
    );
  }

  if (buffer.byteLength === 0) {
    throw new InvalidImageError('Image file is empty');
  }

  // Validate magic bytes
  validateImageSignature(buffer, mimeType);
}

/**
 * Extract MIME type from Content-Type header
 * Handles cases like "image/jpeg; charset=utf-8"
 */
export function extractMimeType(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase();
}

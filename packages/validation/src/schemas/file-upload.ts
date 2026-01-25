import { MIME_TYPES } from '@codex/constants';
import { z } from 'zod';
import { sanitizeSvgContent } from '../primitives';
import {
  ALLOWED_LOGO_MIME_TYPES,
  type AllowedLogoMimeType,
  MAX_LOGO_FILE_SIZE_BYTES,
} from './settings';

/**
 * File Upload Validation
 *
 * Provides validators for file uploads with comprehensive security checks:
 * - MIME type validation (allowlist-based)
 * - File size limits
 * - Magic number verification (prevents MIME type spoofing)
 * - SVG sanitization (XSS prevention)
 */

// ============================================================================
// Magic Numbers for File Type Validation
// ============================================================================

/**
 * Magic numbers (file signatures) for supported image formats
 * Used to prevent MIME type spoofing attacks
 */
const MAGIC_NUMBERS = {
  [MIME_TYPES.IMAGE.PNG]: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  [MIME_TYPES.IMAGE.JPEG]: [0xff, 0xd8, 0xff],
  [MIME_TYPES.IMAGE.WEBP]: [0x52, 0x49, 0x46, 0x46], // RIFF
  [MIME_TYPES.IMAGE.SVG]: [0x3c, 0x3f, 0x78, 0x6d, 0x6c], // <?xml
} as const;

/**
 * Alternate SVG magic number (files starting with <svg)
 */
const SVG_ALTERNATE = [0x3c, 0x73, 0x76, 0x67]; // <svg

/**
 * Validates file header (magic numbers) matches claimed MIME type
 *
 * @param buffer - File content as Uint8Array
 * @param mimeType - Claimed MIME type from file.type
 * @returns True if magic numbers match, false otherwise
 */
function isValidImageHeader(buffer: Uint8Array, mimeType: string): boolean {
  const expectedMagicNumbers =
    MAGIC_NUMBERS[mimeType as keyof typeof MAGIC_NUMBERS];
  if (!expectedMagicNumbers) return false;

  // Special handling for WebP (RIFF + WEBP marker)
  if (mimeType === MIME_TYPES.IMAGE.WEBP) {
    if (buffer.length < 12) return false;
    const matchesRiff = expectedMagicNumbers.every(
      (byte, i) => buffer[i] === byte
    );
    if (!matchesRiff) return false;
    const webpMarker = [0x57, 0x45, 0x42, 0x50]; // WEBP at offset 8
    return webpMarker.every((byte, i) => buffer[8 + i] === byte);
  }

  // Special handling for SVG (can start with <?xml or <svg)
  if (mimeType === MIME_TYPES.IMAGE.SVG) {
    if (buffer.length < 5) return false;
    return (
      expectedMagicNumbers.every((byte, i) => buffer[i] === byte) ||
      SVG_ALTERNATE.every((byte, i) => buffer[i] === byte)
    );
  }

  // Standard check for PNG, JPEG
  return expectedMagicNumbers.every((byte, i) => buffer[i] === byte);
}

// ============================================================================
// Types
// ============================================================================

/**
 * Validated logo file data ready for upload
 */
export interface ValidatedLogoFile {
  buffer: ArrayBuffer;
  mimeType: string;
  size: number;
}

// ============================================================================
// Validators
// ============================================================================

/**
 * Parse and validate logo file from FormData
 *
 * Security checks:
 * 1. File exists in FormData under 'logo' key
 * 2. MIME type is in allowlist (PNG, JPEG, WebP, SVG)
 * 3. File size within limit (5MB)
 * 4. Magic numbers match claimed MIME type (prevents spoofing)
 * 5. SVG content is sanitized via DOMPurify (XSS prevention)
 *
 * @param formData - FormData from multipart/form-data request
 * @returns Validated file data ready for R2 upload
 * @throws ZodError if validation fails
 *
 * @example
 * ```typescript
 * // In procedure() input validator
 * input: {
 *   formData: async (c) => {
 *     const formData = await c.req.formData();
 *     return validateLogoUpload(formData);
 *   }
 * }
 * ```
 */
export async function validateLogoUpload(
  formData: FormData
): Promise<ValidatedLogoFile> {
  // Check file exists
  const file = formData.get('logo');
  if (!file || !(file instanceof File)) {
    throw new z.ZodError([
      {
        code: 'custom',
        message: 'Logo file is required',
        path: ['logo'],
      },
    ]);
  }

  // Validate MIME type (allowlist)
  if (!ALLOWED_LOGO_MIME_TYPES.includes(file.type as AllowedLogoMimeType)) {
    throw new z.ZodError([
      {
        code: 'custom',
        message: `Invalid file type. Allowed: ${ALLOWED_LOGO_MIME_TYPES.join(', ')}`,
        path: ['logo'],
      },
    ]);
  }

  if (file.size <= 0) {
    throw new z.ZodError([
      {
        code: 'custom',
        message: 'File size cannot be zero',
        path: ['logo'],
      },
    ]);
  }

  // Validate file size
  if (file.size > MAX_LOGO_FILE_SIZE_BYTES) {
    throw new z.ZodError([
      {
        code: 'custom',
        message: `File too large. Maximum size: ${MAX_LOGO_FILE_SIZE_BYTES / 1024 / 1024}MB`,
        path: ['logo'],
      },
    ]);
  }

  // Read file buffer for magic number validation
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Validate magic numbers (prevents MIME type spoofing)
  if (!isValidImageHeader(bytes, file.type)) {
    throw new z.ZodError([
      {
        code: 'custom',
        message:
          'File content does not match claimed MIME type (possible spoofing attempt)',
        path: ['logo'],
      },
    ]);
  }

  // Sanitize SVG content (XSS prevention)
  let finalBuffer = buffer;
  if (file.type === MIME_TYPES.IMAGE.SVG) {
    const textDecoder = new TextDecoder();
    const svgContent = textDecoder.decode(buffer);
    const sanitized = await sanitizeSvgContent(svgContent);
    finalBuffer = new TextEncoder().encode(sanitized).buffer as ArrayBuffer;
  }

  return {
    buffer: finalBuffer,
    mimeType: file.type,
    size: file.size,
  };
}

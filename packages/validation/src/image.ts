import { z } from 'zod';
import { MAX_IMAGE_SIZE_BYTES } from './limits';
import { sanitizeSvgContent } from './primitives';

/**
 * Magic numbers (file signatures) for supported image formats
 * Used to prevent MIME type spoofing attacks
 */
export const MAGIC_NUMBERS = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/webp': [0x52, 0x49, 0x46, 0x46], // RIFF
  'image/gif': [0x47, 0x49, 0x46, 0x38], // GIF8
  'image/svg+xml': [0x3c, 0x3f, 0x78, 0x6d, 0x6c], // <?xml
} as const;

/**
 * Alternate SVG magic number (files starting with <svg)
 */
const SVG_ALTERNATE = [0x3c, 0x73, 0x76, 0x67]; // <svg

export type AllowedMimeType = keyof typeof MAGIC_NUMBERS;

/**
 * Validates file header (magic numbers) matches claimed MIME type
 *
 * @param buffer - File content as Uint8Array
 * @param mimeType - Claimed MIME type from file.type
 * @returns True if magic numbers match, false otherwise
 */
export function validateImageSignature(
  buffer: Uint8Array,
  mimeType: string
): boolean {
  const expectedMagicNumbers = MAGIC_NUMBERS[mimeType as AllowedMimeType];

  // If we don't know the mime type, we can't validate the signature
  if (!expectedMagicNumbers) return false;

  // Special handling for WebP (RIFF + WEBP marker)
  if (mimeType === 'image/webp') {
    if (buffer.length < 12) return false;
    const matchesRiff = expectedMagicNumbers.every(
      (byte, i) => buffer[i] === byte
    );
    if (!matchesRiff) return false;
    const webpMarker = [0x57, 0x45, 0x42, 0x50]; // WEBP at offset 8
    return webpMarker.every((byte, i) => buffer[8 + i] === byte);
  }

  // Special handling for SVG (can start with <?xml or <svg)
  if (mimeType === 'image/svg+xml') {
    if (buffer.length < 4) return false; // Minimum 4 bytes for <svg

    // Check <svg
    if (SVG_ALTERNATE.every((byte, i) => buffer[i] === byte)) return true;

    // Check <?xml
    if (buffer.length < 5) return false;
    return expectedMagicNumbers.every((byte, i) => buffer[i] === byte);
  }

  // Standard check for PNG, JPEG, GIF
  return expectedMagicNumbers.every((byte, i) => buffer[i] === byte);
}

export interface ImageValidationConfig {
  maxSizeBytes?: number;
  allowedMimeTypes: AllowedMimeType[];
  fieldName?: string;
  sanitizeSvg?: boolean;
}

export interface ValidatedImageFile {
  buffer: ArrayBuffer;
  mimeType: string;
  size: number;
}

/**
 * Generic image upload validation utility
 *
 * @param formData - FormData object containing the file
 * @param config - Validation configuration
 * @returns Validated file data
 */
export async function validateImageUpload(
  formData: FormData,
  config: ImageValidationConfig
): Promise<ValidatedImageFile> {
  const fieldName = config.fieldName || 'image';
  const file = formData.get(fieldName);
  const maxBytes = config.maxSizeBytes || MAX_IMAGE_SIZE_BYTES;

  if (!file || !(file instanceof File)) {
    throw new z.ZodError([
      {
        code: 'custom',
        message: 'Image file is required',
        path: [fieldName],
      },
    ]);
  }

  // Validate MIME type
  if (!config.allowedMimeTypes.includes(file.type as AllowedMimeType)) {
    throw new z.ZodError([
      {
        code: 'custom',
        message: `Invalid file type. Allowed: ${config.allowedMimeTypes.join(', ')}`,
        path: [fieldName],
      },
    ]);
  }

  if (file.size <= 0) {
    throw new z.ZodError([
      {
        code: 'custom',
        message: 'File size cannot be zero',
        path: [fieldName],
      },
    ]);
  }

  // Validate file size
  if (file.size > maxBytes) {
    throw new z.ZodError([
      {
        code: 'custom',
        message: `File too large. Maximum size: ${maxBytes / 1024 / 1024}MB`,
        path: [fieldName],
      },
    ]);
  }

  // Read buffer and validate signature
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (!validateImageSignature(bytes, file.type)) {
    throw new z.ZodError([
      {
        code: 'custom',
        message: 'File content does not match claimed MIME type',
        path: [fieldName],
      },
    ]);
  }

  // Sanitize SVG if requested
  let finalBuffer = buffer;
  if (config.sanitizeSvg && file.type === 'image/svg+xml') {
    const textDecoder = new TextDecoder();
    const svgContent = textDecoder.decode(buffer);
    const sanitized = sanitizeSvgContent(svgContent);
    finalBuffer = new TextEncoder().encode(sanitized).buffer as ArrayBuffer;
  }

  return {
    buffer: finalBuffer,
    mimeType: file.type,
    size: file.size,
  };
}

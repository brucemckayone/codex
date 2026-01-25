import { MIME_TYPES } from '@codex/constants';

/**
 * File Content Validation Utilities
 *
 * Validates files by checking magic numbers (file signatures) to prevent
 * MIME type spoofing attacks. This ensures uploaded files are actually
 * the type they claim to be.
 *
 * Note: SVG sanitization moved to @codex/validation package.
 */

/**
 * Magic number signatures for supported image formats
 * These are the first bytes that identify file types
 */
const MAGIC_NUMBERS: Record<string, number[]> = {
  [MIME_TYPES.IMAGE.PNG]: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  [MIME_TYPES.IMAGE.JPEG]: [0xff, 0xd8, 0xff],
  [MIME_TYPES.IMAGE.WEBP]: [0x52, 0x49, 0x46, 0x46], // RIFF
  [MIME_TYPES.IMAGE.SVG]: [0x3c, 0x3f, 0x78, 0x6d, 0x6c], // <?xml or <svg
} as const;

/**
 * Additional check for SVG files (can start with <svg)
 */
const SVG_ALTERNATE = [0x3c, 0x73, 0x76, 0x67]; // <svg

/**
 * Validates that file content matches claimed MIME type
 *
 * @param buffer - File content as ArrayBuffer or Uint8Array
 * @param mimeType - Claimed MIME type
 * @returns True if file content matches MIME type
 *
 * @example
 * ```typescript
 * const file = await request.blob();
 * const buffer = await file.arrayBuffer();
 *
 * if (!isValidImageHeader(buffer, 'image/png')) {
 *   throw new Error('File is not a valid PNG');
 * }
 * ```
 */
export function isValidImageHeader(
  buffer: ArrayBuffer | Uint8Array,
  mimeType: string
): boolean {
  // Convert ArrayBuffer to Uint8Array if needed
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  // Get expected magic numbers for this MIME type
  const expectedMagicNumbers =
    MAGIC_NUMBERS[mimeType as keyof typeof MAGIC_NUMBERS];

  if (!expectedMagicNumbers) {
    // Unsupported MIME type
    return false;
  }

  // Special handling for WebP (check for RIFF header)
  if (mimeType === MIME_TYPES.IMAGE.WEBP) {
    // Check first 4 bytes match RIFF
    if (!bytes.slice(0, 4).every((b, i) => b === bytes[i])) return false;
    // Check bytes 8-11 match WEBP
    const webpMagic = [0x57, 0x45, 0x42, 0x50]; // WEBP
    return webpMagic.every((b, i) => b === bytes[i + 8]);
  }

  // Special handling for SVG (check for XML declaration or SVG tag)
  if (mimeType === MIME_TYPES.IMAGE.SVG) {
    if (bytes.length < 5) return false;

    return (
      matchesMagicNumbers(bytes, expectedMagicNumbers) ||
      matchesMagicNumbers(bytes, SVG_ALTERNATE)
    );
  }

  // Check if file starts with expected magic numbers
  return matchesMagicNumbers(bytes, expectedMagicNumbers);
}

/**
 * Helper to check if bytes match expected magic numbers
 */
function matchesMagicNumbers(
  bytes: Uint8Array,
  expected: readonly number[]
): boolean {
  if (bytes.length < expected.length) {
    return false;
  }

  for (let i = 0; i < expected.length; i++) {
    if (bytes[i] !== expected[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Sanitizes SVG content to remove XSS vectors using DOMPurify.
 *
 * @deprecated Moved to @codex/validation package. Import from there instead:
 * ```typescript
 * import { MIME_TYPES } from '@codex/constants';
 * import { MIME_TYPES, FILE_SIZES } from '@codex/constants';
 * import { sanitizeSvgContent } from '@codex/validation';
 * ```
 *
 * @param content - Raw SVG file content as string
 * @returns Sanitized SVG content safe for rendering
 */
export async function sanitizeSvgContent(content: string): Promise<string> {
  // Re-export from validation package for backwards compatibility
  const { sanitizeSvgContent: sanitize } = await import('@codex/validation');
  return sanitize(content);
}

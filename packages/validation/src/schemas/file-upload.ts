import { z } from 'zod';

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

import { validateImageUpload } from '../image';

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
  const result = await validateImageUpload(formData, {
    allowedMimeTypes: [...ALLOWED_LOGO_MIME_TYPES],
    maxSizeBytes: MAX_LOGO_FILE_SIZE_BYTES,
    fieldName: 'logo',
    sanitizeSvg: true,
  });

  return {
    buffer: result.buffer,
    mimeType: result.mimeType,
    size: result.size,
  };
}

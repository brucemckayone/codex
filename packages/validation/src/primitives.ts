import { z } from 'zod';

/**
 * Primitive Validation Schemas
 *
 * Reusable validation schemas for common data types used across the application.
 * These are the building blocks for more complex validation schemas.
 */

// ============================================================================
// Identifiers
// ============================================================================

/**
 * UUID validation (v4)
 * Used for all primary/foreign key references
 *
 * @example
 * ```typescript
 * import { uuidSchema } from '@codex/validation/primitives';
 *
 * const id = c.req.param('id');
 * const validated = uuidSchema.parse(id); // throws if invalid
 * ```
 */
export const uuidSchema = z.string().uuid({
  message: 'Invalid ID format',
});

/**
 * Better Auth User ID validation
 * Better Auth generates user IDs as alphanumeric strings (base62-like format)
 * e.g., 'GV762T8n0fCnqy3qxRvoMjJZ7hTTd44b'
 *
 * Used for user IDs (users.id column is text, not uuid)
 *
 * @example
 * ```typescript
 * import { userIdSchema } from '@codex/validation/primitives';
 *
 * const userId = userIdSchema.parse('GV762T8n0fCnqy3qxRvoMjJZ7hTTd44b');
 * ```
 */
export const userIdSchema = z
  .string()
  .min(1, 'User ID is required')
  .max(64, 'User ID is too long')
  .regex(/^[a-zA-Z0-9]+$/, {
    message: 'Invalid user ID format',
  });

/**
 * Slug validation
 * - Lowercase alphanumeric + hyphens only
 * - No leading/trailing hyphens
 * - Prevents XSS and path traversal
 *
 * @param maxLength - Maximum slug length (default: 500)
 */
export const createSlugSchema = (maxLength: number = 500) =>
  z
    .string()
    .trim()
    .min(1, 'Slug is required')
    .max(maxLength, `Slug must be ${maxLength} characters or less`)
    .transform((val) => val.toLowerCase())
    .pipe(
      z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
        message:
          'Slug must contain only lowercase letters, numbers, and hyphens (no leading/trailing hyphens)',
      })
    );

// ============================================================================
// URLs
// ============================================================================

/**
 * URL validation
 * - Must be valid HTTP/HTTPS URL
 * - Prevents javascript: and data: URIs (XSS prevention)
 */
export const urlSchema = z
  .string()
  .url('Invalid URL format')
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol);
      } catch {
        return false;
      }
    },
    {
      message: 'URL must use HTTP or HTTPS protocol',
    }
  );

// ============================================================================
// Numbers
// ============================================================================

/**
 * Price validation (integer cents)
 * - Non-negative integer only
 * - Max $100,000 (10,000,000 cents)
 * - Null = free content
 */
export const priceCentsSchema = z
  .number()
  .int('Price must be a whole number (in cents)')
  .min(0, 'Price cannot be negative')
  .max(10000000, 'Price cannot exceed $100,000')
  .nullable();

/**
 * Positive integer schema
 * Used for counts, IDs, page numbers, etc.
 */
export const positiveIntSchema = z
  .number()
  .int('Must be a whole number')
  .positive('Must be greater than 0');

/**
 * Non-negative integer schema
 * Used for counts that can be zero
 */
export const nonNegativeIntSchema = z
  .number()
  .int('Must be a whole number')
  .min(0, 'Must be 0 or greater');

// ============================================================================
// Strings
// ============================================================================

/**
 * Create a sanitized string schema with length limits
 * Trims whitespace and enforces min/max length
 *
 * @param minLength - Minimum length
 * @param maxLength - Maximum length
 * @param fieldName - Field name for error messages
 */
export const createSanitizedStringSchema = (
  minLength: number,
  maxLength: number,
  fieldName: string
) =>
  z
    .string()
    .trim()
    .min(minLength, `${fieldName} must be at least ${minLength} characters`)
    .max(maxLength, `${fieldName} must be ${maxLength} characters or less`);

/**
 * Create an optional text schema with max length
 * Allows null or undefined
 *
 * @param maxLength - Maximum length
 * @param fieldName - Field name for error messages
 */
export const createOptionalTextSchema = (
  maxLength: number,
  fieldName: string
) =>
  z
    .string()
    .trim()
    .max(maxLength, `${fieldName} must be ${maxLength} characters or less`)
    .optional()
    .nullable();

// ============================================================================
// Email
// ============================================================================

/**
 * Email validation
 * Uses Zod's built-in email validation
 */
export const emailSchema = z.string().email('Invalid email format');

// ============================================================================
// Common Params Schemas
// ============================================================================

/**
 * Create params schema with ID
 * Common pattern for route params validation
 *
 * @example
 * ```typescript
 * const schema = { params: createIdParamsSchema() };
 * // Validates: { id: string (UUID) }
 * ```
 */
export function createIdParamsSchema() {
  return z.object({ id: uuidSchema });
}

/**
 * Create params schema with slug
 *
 * @example
 * ```typescript
 * const schema = { params: createSlugParamsSchema() };
 * // Validates: { slug: string }
 * ```
 */
export function createSlugParamsSchema(maxLength: number = 255) {
  return z.object({ slug: createSlugSchema(maxLength) });
}

// ============================================================================
// Dates
// ============================================================================

/**
 * ISO date string validation
 * Accepts ISO 8601 date strings and coerces to Date objects
 * Works with query params (strings) and JSON bodies
 *
 * @example
 * ```typescript
 * const schema = z.object({ startDate: isoDateSchema.optional() });
 * schema.parse({ startDate: '2025-01-15' }); // Date object
 * ```
 */
export const isoDateSchema = z.coerce.date({
  errorMap: () => ({
    message: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DD)',
  }),
});

/**
 * Stripe Metadata Validation Utilities
 *
 * Generic utilities for validating and extracting Stripe metadata.
 * Schemas can be defined per-endpoint as needed.
 */

import { z } from 'zod';
import type Stripe from 'stripe';

// ========================================
// Generic Validation Types
// ========================================

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: z.ZodError };

// ========================================
// Core Validation Functions
// ========================================

/**
 * Validate metadata against a Zod schema
 */
export function validateMetadata<T>(
  metadata: Stripe.Metadata | null | undefined,
  schema: z.ZodSchema<T>
): ValidationResult<T> {
  if (!metadata || Object.keys(metadata).length === 0) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: 'custom',
          path: [],
          message: 'Metadata is empty or undefined',
        },
      ]),
    };
  }

  const result = schema.safeParse(metadata);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

/**
 * Validate metadata strictly (throws on error)
 */
export function validateMetadataStrict<T>(
  metadata: Stripe.Metadata | null | undefined,
  schema: z.ZodSchema<T>
): T {
  if (!metadata || Object.keys(metadata).length === 0) {
    throw new z.ZodError([
      {
        code: 'custom',
        path: [],
        message: 'Metadata is empty or undefined',
      },
    ]);
  }
  return schema.parse(metadata);
}

/**
 * Validate with fallback to default value
 */
export function validateMetadataWithDefault<T>(
  metadata: Stripe.Metadata | null | undefined,
  schema: z.ZodSchema<T>,
  defaultValue: T
): T {
  const result = validateMetadata(metadata, schema);
  return result.success ? result.data : defaultValue;
}

/**
 * Format validation errors for logging
 */
export function formatValidationErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return `${path ? `${path}: ` : ''}${issue.message}`;
  });
}

/**
 * Extract and validate a single field from metadata
 */
export function extractField<T>(
  metadata: Stripe.Metadata | null | undefined,
  field: string,
  validator: (value: string) => T
): T | null {
  if (!metadata || !(field in metadata)) {
    return null;
  }
  try {
    return validator(metadata[field]);
  } catch {
    return null;
  }
}

/**
 * Check if metadata has required fields
 */
export function hasRequiredFields(
  metadata: Stripe.Metadata | null | undefined,
  fields: string[]
): boolean {
  if (!metadata) return false;
  return fields.every((field) => field in metadata && metadata[field]);
}

/**
 * Extract metadata safely with type checking
 */
export function safeExtractMetadata<T extends Record<string, string>>(
  metadata: Stripe.Metadata | null | undefined
): T | null {
  if (!metadata || Object.keys(metadata).length === 0) {
    return null;
  }
  return metadata as T;
}

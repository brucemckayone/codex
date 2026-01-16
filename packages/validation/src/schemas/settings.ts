import { z } from 'zod';
import { hexColorSchema, timezoneSchema, urlSchema } from '../primitives';

/**
 * Platform Settings Validation Schemas
 *
 * Security-focused validation for platform branding, contact, and feature settings.
 * Aligned with database schema at packages/database/src/schema/settings.ts
 *
 * Key Security Principles:
 * 1. XSS Prevention: Hex color validation prevents injection
 * 2. Input Length Limits: Match database constraints exactly
 * 3. URL Validation: Uses urlSchema (HTTP/HTTPS only)
 * 4. Type Safety: Export inferred types for use across application
 */

// ============================================================================
// Logo Validation Constants
// ============================================================================

/**
 * Allowed MIME types for logo uploads
 * Only common web-safe image formats
 */
import { FILE_SIZES, MIME_TYPES } from '@codex/constants';

export type AllowedLogoMimeType =
  | typeof MIME_TYPES.IMAGE.PNG
  | typeof MIME_TYPES.IMAGE.JPEG
  | typeof MIME_TYPES.IMAGE.WEBP
  | typeof MIME_TYPES.IMAGE.SVG;

export const ALLOWED_LOGO_MIME_TYPES = [
  MIME_TYPES.IMAGE.PNG,
  MIME_TYPES.IMAGE.JPEG,
  MIME_TYPES.IMAGE.WEBP,
  MIME_TYPES.IMAGE.SVG,
] as const;

/**
 * Maximum logo file size: 5MB
 */
export const MAX_LOGO_FILE_SIZE_BYTES = FILE_SIZES.LOGO_MAX_BYTES;

/**
 * Logo MIME type validation
 */
export const logoMimeTypeSchema = z.enum(ALLOWED_LOGO_MIME_TYPES, {
  errorMap: () => ({
    message: 'Logo must be PNG, JPEG, WebP, or SVG format',
  }),
});

// ============================================================================
// Domain Schemas
// ============================================================================

/**
 * Update Branding Settings Input
 * Used for PUT /api/settings/branding
 */
export const updateBrandingSchema = z.object({
  primaryColorHex: hexColorSchema.optional(),
});

export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;

/**
 * Update Contact Settings Input
 * Used for PUT /api/settings/contact
 */
export const updateContactSchema = z.object({
  platformName: z
    .string()
    .trim()
    .min(1, 'Platform name is required')
    .max(100, 'Platform name must be 100 characters or less')
    .optional(),
  supportEmail: z.string().email('Invalid email format').optional(),
  contactUrl: urlSchema.nullable().optional(),
  timezone: timezoneSchema.optional(),
});

export type UpdateContactInput = z.infer<typeof updateContactSchema>;

/**
 * Update Feature Settings Input
 * Used for PUT /api/settings/features
 */
export const updateFeaturesSchema = z.object({
  enableSignups: z.boolean().optional(),
  enablePurchases: z.boolean().optional(),
});

export type UpdateFeaturesInput = z.infer<typeof updateFeaturesSchema>;

// ============================================================================
// Response Schemas (for type inference)
// ============================================================================

/**
 * Branding settings response shape
 */
export const brandingSettingsSchema = z.object({
  logoUrl: z.string().nullable(),
  primaryColorHex: z.string(),
});

export type BrandingSettingsResponse = z.infer<typeof brandingSettingsSchema>;

/**
 * Contact settings response shape
 */
export const contactSettingsSchema = z.object({
  platformName: z.string(),
  supportEmail: z.string(),
  contactUrl: z.string().nullable(),
  timezone: z.string(),
});

export type ContactSettingsResponse = z.infer<typeof contactSettingsSchema>;

/**
 * Feature settings response shape
 */
export const featureSettingsSchema = z.object({
  enableSignups: z.boolean(),
  enablePurchases: z.boolean(),
});

export type FeatureSettingsResponse = z.infer<typeof featureSettingsSchema>;

/**
 * All settings combined response shape
 */
export const allSettingsSchema = z.object({
  branding: brandingSettingsSchema,
  contact: contactSettingsSchema,
  features: featureSettingsSchema,
});

export type AllSettingsResponse = z.infer<typeof allSettingsSchema>;

// ============================================================================
// Defaults (returned when no settings exist)
// ============================================================================

/**
 * Default branding settings
 * Used when organization has no branding_settings row
 */
export const DEFAULT_BRANDING: BrandingSettingsResponse = {
  logoUrl: null,
  primaryColorHex: '#3B82F6',
} as const;

/**
 * Default contact settings
 * Used when organization has no contact_settings row
 */
export const DEFAULT_CONTACT: ContactSettingsResponse = {
  platformName: 'Codex Platform',
  supportEmail: 'support@example.com',
  contactUrl: null,
  timezone: 'UTC',
} as const;

/**
 * Default feature settings
 * Used when organization has no feature_settings row
 */
export const DEFAULT_FEATURES: FeatureSettingsResponse = {
  enableSignups: true,
  enablePurchases: true,
} as const;

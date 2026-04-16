import type {
  BrandingSettingsResponse,
  ContactSettingsResponse,
  FeatureSettingsResponse,
} from '@codex/shared-types';
import { z } from 'zod';
import {
  densityValueSchema,
  fontNameSchema,
  hexColorSchema,
  radiusValueSchema,
  timezoneSchema,
  urlSchema,
} from '../primitives';

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
export const logoMimeTypeSchema = z.enum(ALLOWED_LOGO_MIME_TYPES);

// ============================================================================
// Pricing FAQ Schemas
// ============================================================================

/**
 * Single pricing FAQ item
 */
export const pricingFaqItemSchema = z.object({
  id: z.string().uuid('FAQ item must have a valid UUID'),
  question: z
    .string()
    .trim()
    .min(1, 'Question is required')
    .max(200, 'Question must be 200 characters or less'),
  answer: z
    .string()
    .trim()
    .min(1, 'Answer is required')
    .max(2000, 'Answer must be 2000 characters or less')
    .refine((str) => !/<[^>]*>/g.test(str), 'Answer cannot contain HTML tags'),
  order: z.number().int().min(0, 'Order must be non-negative'),
});

/**
 * Array of FAQ items (max 20 per org, unique order values)
 */
export const pricingFaqSchema = z
  .array(pricingFaqItemSchema)
  .max(20, 'Maximum 20 FAQ items allowed')
  .refine((items) => {
    const orders = items.map((i) => i.order);
    return new Set(orders).size === orders.length;
  }, 'Each FAQ item must have a unique order value');

export type PricingFaqItem = z.infer<typeof pricingFaqItemSchema>;

// ============================================================================
// Domain Schemas
// ============================================================================

/**
 * Update Branding Settings Input
 * Used for PUT /api/settings/branding
 */
export const updateBrandingSchema = z.object({
  primaryColorHex: hexColorSchema.optional(),
  secondaryColorHex: hexColorSchema.nullable().optional(),
  accentColorHex: hexColorSchema.nullable().optional(),
  backgroundColorHex: hexColorSchema.nullable().optional(),
  fontBody: fontNameSchema.nullable().optional(),
  fontHeading: fontNameSchema.nullable().optional(),
  radiusValue: radiusValueSchema.optional(),
  densityValue: densityValueSchema.optional(),
  // Brand Editor fine-tune fields
  tokenOverrides: z.string().nullable().optional(), // JSON string
  darkModeOverrides: z.string().nullable().optional(), // JSON string: Partial<ThemeColors>
  textColorHex: hexColorSchema.nullable().optional(),
  shadowScale: z.string().max(10).nullable().optional(),
  shadowColor: z.string().max(20).nullable().optional(),
  textScale: z.string().max(10).nullable().optional(),
  headingWeight: z.string().max(10).nullable().optional(),
  bodyWeight: z.string().max(10).nullable().optional(),
  heroLayout: z
    .enum([
      'default',
      'centered',
      'logo-hero',
      'minimal',
      'split',
      'magazine',
      'asymmetric',
      'portrait',
      'gallery',
      'stacked',
    ])
    .optional(),
  pricingFaq: z.union([z.literal(null), z.string().min(1)]).optional(),
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
  // Social media URLs (optional, nullable)
  twitterUrl: urlSchema.nullable().optional(),
  youtubeUrl: urlSchema.nullable().optional(),
  instagramUrl: urlSchema.nullable().optional(),
  tiktokUrl: urlSchema.nullable().optional(),
});

export type UpdateContactInput = z.infer<typeof updateContactSchema>;

/**
 * Update Feature Settings Input
 * Used for PUT /api/settings/features
 */
export const updateFeaturesSchema = z.object({
  enableSignups: z.boolean().optional(),
  enablePurchases: z.boolean().optional(),
  enableSubscriptions: z.boolean().optional(),
});

export type UpdateFeaturesInput = z.infer<typeof updateFeaturesSchema>;

// ============================================================================
// Response Schemas (for type inference)
// ============================================================================

/**
 * Branding settings response shape
 * Explicitly typed to match BrandingSettingsResponse (logoUrl is required but nullable)
 */
export const brandingSettingsSchema: z.ZodType<BrandingSettingsResponse> = z
  .object({
    logoUrl: z.string().url('Invalid URL format').nullable(),
    primaryColorHex: hexColorSchema,
    secondaryColorHex: hexColorSchema.nullable(),
    accentColorHex: hexColorSchema.nullable(),
    backgroundColorHex: hexColorSchema.nullable(),
    fontBody: z.string().nullable(),
    fontHeading: z.string().nullable(),
    radiusValue: z.number(),
    densityValue: z.number(),
    introVideoMediaItemId: z.string().uuid().nullable(),
    introVideoUrl: z.string().url().nullable(),
    tokenOverrides: z.string().nullable(),
    darkModeOverrides: z.string().nullable(),
    textColorHex: hexColorSchema.nullable(),
    shadowScale: z.string().nullable(),
    shadowColor: z.string().nullable(),
    textScale: z.string().nullable(),
    headingWeight: z.string().nullable(),
    bodyWeight: z.string().nullable(),
    heroLayout: z.string(),
    pricingFaq: z.string().nullable(),
  })
  .pipe(
    z.object({
      logoUrl: z.string().url().nullable(),
      primaryColorHex: z.string(),
      secondaryColorHex: z.string().nullable(),
      accentColorHex: z.string().nullable(),
      backgroundColorHex: z.string().nullable(),
      fontBody: z.string().nullable(),
      fontHeading: z.string().nullable(),
      radiusValue: z.number(),
      densityValue: z.number(),
      introVideoMediaItemId: z.string().uuid().nullable(),
      introVideoUrl: z.string().url().nullable(),
      tokenOverrides: z.string().nullable(),
      darkModeOverrides: z.string().nullable(),
      textColorHex: z.string().nullable(),
      shadowScale: z.string().nullable(),
      shadowColor: z.string().nullable(),
      textScale: z.string().nullable(),
      headingWeight: z.string().nullable(),
      bodyWeight: z.string().nullable(),
      heroLayout: z.string(),
      pricingFaq: z.string().nullable(),
    })
  );

/**
 * Contact settings response shape
 */
export const contactSettingsSchema = z.object({
  platformName: z.string(),
  supportEmail: z.string(),
  contactUrl: z.string().nullable(),
  timezone: z.string(),
  // Social media URLs (optional and nullable)
  twitterUrl: z.string().nullable().optional(),
  youtubeUrl: z.string().nullable().optional(),
  instagramUrl: z.string().nullable().optional(),
  tiktokUrl: z.string().nullable().optional(),
});

/**
 * Feature settings response shape
 */
export const featureSettingsSchema = z.object({
  enableSignups: z.boolean(),
  enablePurchases: z.boolean(),
  enableSubscriptions: z.boolean(),
});

/**
 * All settings combined response shape
 */
export const allSettingsSchema = z.object({
  branding: brandingSettingsSchema,
  contact: contactSettingsSchema,
  features: featureSettingsSchema,
});

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
  secondaryColorHex: null,
  accentColorHex: null,
  backgroundColorHex: null,
  fontBody: null,
  fontHeading: null,
  radiusValue: 0.5,
  introVideoMediaItemId: null,
  introVideoUrl: null,
  tokenOverrides: null,
  darkModeOverrides: null,
  textColorHex: null,
  shadowScale: null,
  shadowColor: null,
  textScale: null,
  headingWeight: null,
  bodyWeight: null,
  heroLayout: 'default',
  densityValue: 1,
  pricingFaq: null,
};

/**
 * Default contact settings
 * Used when organization has no contact_settings row
 */
export const DEFAULT_CONTACT: ContactSettingsResponse = {
  platformName: 'Codex Platform',
  supportEmail: 'support@example.com',
  contactUrl: null,
  timezone: 'UTC',
  // Social media URLs (null by default)
  twitterUrl: null,
  youtubeUrl: null,
  instagramUrl: null,
  tiktokUrl: null,
} as const;

/**
 * Default feature settings
 * Used when organization has no feature_settings row
 */
export const DEFAULT_FEATURES: FeatureSettingsResponse = {
  enableSignups: true,
  enablePurchases: true,
  enableSubscriptions: false,
} as const;

// ============================================================================
// Intro Video
// ============================================================================

/**
 * Link an existing media item as the org's intro video
 */
export const linkIntroVideoSchema = z.object({
  mediaItemId: z.string().uuid(),
});

export type LinkIntroVideoInput = z.infer<typeof linkIntroVideoSchema>;

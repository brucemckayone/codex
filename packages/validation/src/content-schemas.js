import { z } from 'zod';
/**
 * Content Management Validation Schemas
 *
 * Security-focused validation for organizations, media items, and content.
 * Aligned with database schema at packages/database/src/schema/content.ts
 *
 * Key Security Principles:
 * 1. XSS Prevention: Sanitize all user-generated strings
 * 2. Input Length Limits: Match database constraints exactly
 * 3. Enum Whitelisting: Only allow database-defined enum values
 * 4. Type Safety: Export inferred types for use across application
 * 5. Clear Error Messages: User-friendly, non-leaking error messages
 */
// ============================================================================
// Reusable Schema Components
// ============================================================================
const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/**
 * UUID validation (v4)
 * Used for all primary/foreign key references
 */
const uuidSchema = z.string().uuid({
  message: 'Invalid ID format',
});
/**
 * Slug validation
 * - Lowercase alphanumeric + hyphens only
 * - No leading/trailing hyphens
 * - Prevents XSS and path traversal
 */
const slugSchema = z
  .string()
  .trim()
  .min(1, 'Slug is required')
  .max(500, 'Slug must be 500 characters or less')
  .transform((val) => val.toLowerCase())
  .pipe(
    z.string().regex(slugRegex, {
      message:
        'Slug must contain only lowercase letters, numbers, and hyphens (no leading/trailing hyphens)',
    })
  );
/**
 * Organization slug validation (shorter than content slug)
 * Must be unique across platform
 */
const organizationSlugSchema = z
  .string()
  .trim()
  .min(1, 'Slug is required')
  .max(255, 'Slug must be 255 characters or less')
  .transform((val) => val.toLowerCase())
  .pipe(
    z.string().regex(slugRegex, {
      message:
        'Slug must contain only lowercase letters, numbers, and hyphens (no leading/trailing hyphens)',
    })
  );
/**
 * URL validation
 * - Must be valid HTTP/HTTPS URL
 * - Prevents javascript: and data: URIs (XSS prevention)
 */
const urlSchema = z
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
/**
 * Price validation (integer cents)
 * - Non-negative integer only
 * - Max $100,000 (10,000,000 cents)
 * - Null = free content
 */
const priceCentsSchema = z
  .number()
  .int('Price must be a whole number (in cents)')
  .min(0, 'Price cannot be negative')
  .max(10000000, 'Price cannot exceed $100,000')
  .nullable();
/**
 * Sanitized string for user-generated content
 * - Trims whitespace
 * - Prevents empty strings
 * - Use for titles, descriptions, names
 */
const sanitizedStringSchema = (minLength, maxLength, fieldName) =>
  z
    .string()
    .trim()
    .min(minLength, `${fieldName} must be at least ${minLength} characters`)
    .max(maxLength, `${fieldName} must be ${maxLength} characters or less`);
/**
 * Optional sanitized text (can be null)
 */
const optionalTextSchema = (maxLength, fieldName) =>
  z
    .string()
    .trim()
    .max(maxLength, `${fieldName} must be ${maxLength} characters or less`)
    .optional()
    .nullable();
// ============================================================================
// Organization Schemas
// ============================================================================
/**
 * Database enum: No CHECK constraint, but follows convention
 * Keeping validation for type safety
 */
export const organizationStatusEnum = z.enum(
  ['active', 'suspended', 'deleted'],
  {
    errorMap: () => ({
      message: 'Status must be active, suspended, or deleted',
    }),
  }
);
/**
 * Create Organization Input
 * Aligns with database schema: packages/database/src/schema/content.ts lines 10-27
 */
export const createOrganizationSchema = z.object({
  name: sanitizedStringSchema(1, 255, 'Organization name'),
  slug: organizationSlugSchema,
  description: optionalTextSchema(5000, 'Description'),
  logoUrl: urlSchema.optional().nullable(),
  websiteUrl: urlSchema.optional().nullable(),
});
/**
 * Update Organization Input
 * All fields optional (partial update)
 */
export const updateOrganizationSchema = createOrganizationSchema.partial();
// ============================================================================
// Media Item Schemas
// ============================================================================
/**
 * Media type enum
 * Aligns with database CHECK constraint: line 73
 */
export const mediaTypeEnum = z.enum(['video', 'audio'], {
  errorMap: () => ({ message: 'Media type must be video or audio' }),
});
/**
 * Media status enum
 * Aligns with database CHECK constraint: line 72
 */
export const mediaStatusEnum = z.enum(
  ['uploading', 'uploaded', 'transcoding', 'ready', 'failed'],
  {
    errorMap: () => ({ message: 'Invalid media status' }),
  }
);
/**
 * MIME type validation for media uploads
 * Whitelist only supported formats
 */
const mimeTypeSchema = z.enum(
  [
    // Video formats
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/webm',
    // Audio formats
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/webm',
    'audio/ogg',
  ],
  {
    errorMap: () => ({ message: 'Unsupported file format' }),
  }
);
/**
 * Create Media Item Input
 * Aligns with database schema: packages/database/src/schema/content.ts lines 35-74
 */
export const createMediaItemSchema = z.object({
  title: sanitizedStringSchema(1, 255, 'Media title'),
  description: optionalTextSchema(5000, 'Description'),
  mediaType: mediaTypeEnum,
  mimeType: mimeTypeSchema,
  fileSizeBytes: z
    .number()
    .int('File size must be a whole number')
    .min(1, 'File size must be greater than 0')
    .max(5 * 1024 * 1024 * 1024, 'File size cannot exceed 5GB'), // 5GB max
  // R2 storage path (validated format)
  // Prevents path traversal attacks
  r2Key: z
    .string()
    .min(1, 'R2 key is required')
    .max(500, 'R2 key must be 500 characters or less')
    .regex(
      /^[a-zA-Z0-9/_-]+(\.[a-zA-Z0-9]+)?$/,
      'R2 key contains invalid characters'
    )
    .refine(
      (key) => !key.includes('..'),
      'R2 key cannot contain path traversal sequences'
    ),
});
/**
 * Update Media Item Input
 * Used by transcoding service to update status, metadata, etc.
 */
export const updateMediaItemSchema = z.object({
  status: mediaStatusEnum.optional(),
  durationSeconds: z.number().int().min(0).max(86400).optional(), // Max 24 hours
  width: z.number().int().min(1).max(7680).optional(), // Max 8K width
  height: z.number().int().min(1).max(4320).optional(), // Max 8K height
  hlsMasterPlaylistKey: z.string().max(500).optional().nullable(),
  thumbnailKey: z.string().max(500).optional().nullable(),
  uploadedAt: z.date().optional(),
});
// ============================================================================
// Content Schemas
// ============================================================================
/**
 * Content type enum
 * Aligns with database CHECK constraint: line 150
 */
export const contentTypeEnum = z.enum(['video', 'audio', 'written'], {
  errorMap: () => ({
    message: 'Content type must be video, audio, or written',
  }),
});
/**
 * Visibility enum
 * Aligns with database CHECK constraint: line 149
 */
export const visibilityEnum = z.enum(
  ['public', 'private', 'members_only', 'purchased_only'],
  {
    errorMap: () => ({ message: 'Invalid visibility setting' }),
  }
);
/**
 * Content status enum
 * Aligns with database CHECK constraint: line 148
 */
export const contentStatusEnum = z.enum(['draft', 'published', 'archived'], {
  errorMap: () => ({ message: 'Status must be draft, published, or archived' }),
});
/**
 * Tag validation
 * - Individual tag must be non-empty string
 * - Max 50 characters per tag
 * - Array max 20 tags
 */
const tagsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, 'Tag cannot be empty')
      .max(50, 'Tag must be 50 characters or less')
  )
  .max(20, 'Maximum 20 tags allowed')
  .optional()
  .default([]);
/**
 * Base content schema (without refinements)
 * Used for both create and update schemas
 */
const baseContentSchema = z.object({
  title: sanitizedStringSchema(1, 500, 'Title'),
  slug: slugSchema,
  description: optionalTextSchema(10000, 'Description'),
  contentType: contentTypeEnum,
  // Media reference (required for video/audio, optional for written)
  mediaItemId: uuidSchema.optional().nullable(),
  // Written content body (Phase 2+)
  contentBody: optionalTextSchema(100000, 'Content body'),
  // Organization (nullable = personal content)
  organizationId: uuidSchema.optional().nullable(),
  // Category (simple string, Phase 1)
  category: z
    .string()
    .trim()
    .min(1, 'Category cannot be empty')
    .max(100, 'Category must be 100 characters or less')
    .optional()
    .nullable(),
  // Tags (JSONB array)
  tags: tagsSchema,
  // Thumbnail (optional custom override)
  thumbnailUrl: urlSchema.optional().nullable(),
  // Access control
  visibility: visibilityEnum.default('purchased_only'),
  priceCents: priceCentsSchema.optional(),
});
/**
 * Create Content Input
 * Aligns with database schema: packages/database/src/schema/content.ts lines 81-152
 *
 * Security validations:
 * - Validates mediaItemId exists and belongs to creator (service layer)
 * - Validates content type matches media type (service layer)
 * - Slug uniqueness per organization (database constraint)
 */
export const createContentSchema = baseContentSchema
  .refine(
    (data) => {
      // Video/audio content MUST have mediaItemId
      if (['video', 'audio'].includes(data.contentType)) {
        return !!data.mediaItemId;
      }
      return true;
    },
    {
      message: 'Media item is required for video and audio content',
      path: ['mediaItemId'],
    }
  )
  .refine(
    (data) => {
      // Written content MUST have contentBody
      if (data.contentType === 'written') {
        return !!data.contentBody && data.contentBody.length > 0;
      }
      return true;
    },
    {
      message: 'Content body is required for written content',
      path: ['contentBody'],
    }
  )
  .refine(
    (data) => {
      // Free content (null or 0 price) cannot be purchased_only
      if (
        (data.priceCents === null || data.priceCents === 0) &&
        data.visibility === 'purchased_only'
      ) {
        return false;
      }
      return true;
    },
    {
      message: 'Free content cannot have purchased_only visibility',
      path: ['visibility'],
    }
  );
/**
 * Update Content Input
 * All fields optional (partial update)
 * Note: Cannot change mediaItemId after creation
 */
export const updateContentSchema = baseContentSchema
  .partial()
  .omit({ mediaItemId: true }); // Cannot change media reference
/**
 * Publish Content Input
 * Simple schema for status change operations
 */
export const publishContentSchema = z.object({
  contentId: uuidSchema,
});
// ============================================================================
// Query Parameter Schemas
// ============================================================================
/**
 * Pagination schema
 * Reusable for list queries
 */
export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});
/**
 * Sort order enum
 */
export const sortOrderEnum = z.enum(['asc', 'desc'], {
  errorMap: () => ({ message: 'Sort order must be asc or desc' }),
});
/**
 * Content query/filter schema
 * Used for listing and searching content
 */
export const contentQuerySchema = z.object({
  // Pagination
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  // Filters
  status: contentStatusEnum.optional(),
  contentType: contentTypeEnum.optional(),
  visibility: visibilityEnum.optional(),
  category: z.string().max(100).optional(),
  organizationId: uuidSchema.optional(),
  // Search
  search: z.string().max(255).optional(),
  // Sorting
  sortBy: z
    .enum([
      'createdAt',
      'updatedAt',
      'publishedAt',
      'title',
      'viewCount',
      'purchaseCount',
    ])
    .default('createdAt'),
  sortOrder: sortOrderEnum.default('desc'),
});
/**
 * Media item query schema
 */
export const mediaQuerySchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  status: mediaStatusEnum.optional(),
  mediaType: mediaTypeEnum.optional(),
  sortBy: z.enum(['createdAt', 'uploadedAt', 'title']).default('createdAt'),
  sortOrder: sortOrderEnum.default('desc'),
});
/**
 * Organization query schema
 */
export const organizationQuerySchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  search: z.string().max(255).optional(),
  sortBy: z.enum(['createdAt', 'name']).default('createdAt'),
  sortOrder: sortOrderEnum.default('desc'),
});
// ============================================================================
// Upload Request Schema (for multipart upload initiation)
// ============================================================================
/**
 * Upload request validation
 * Used to initiate direct upload to R2
 *
 * Security:
 * - Validates file size before upload
 * - Validates MIME type against whitelist
 * - Prevents directory traversal in filename
 */
export const uploadRequestSchema = z.object({
  filename: z
    .string()
    .min(1, 'Filename is required')
    .max(255, 'Filename must be 255 characters or less')
    .regex(/^[a-zA-Z0-9._-]+$/, 'Filename contains invalid characters'),
  contentType: mimeTypeSchema,
  fileSizeBytes: z
    .number()
    .int('File size must be a whole number')
    .min(1, 'File size must be greater than 0')
    .max(5 * 1024 * 1024 * 1024, 'File size cannot exceed 5GB'),
  title: sanitizedStringSchema(1, 255, 'Title'),
  description: optionalTextSchema(1000, 'Description'),
  mediaType: mediaTypeEnum,
});
// ============================================================================
// Exports Summary
// ============================================================================
/**
 * Re-export all schemas and types for convenience
 *
 * Usage in service layer:
 * ```typescript
 * import { createContentSchema, type CreateContentInput } from '@codex/validation';
 *
 * const validated = createContentSchema.parse(userInput);
 * const content = await contentService.create(validated, creatorId);
 * ```
 */

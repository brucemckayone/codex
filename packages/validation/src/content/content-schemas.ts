import {
  CONTENT_ACCESS_TYPE,
  CONTENT_STATUS,
  CONTENT_TYPES,
  MEDIA_STATUS,
  MEDIA_TYPES,
  RESERVED_SUBDOMAINS_SET,
  VISIBILITY,
} from '@codex/constants';
import { z } from 'zod';
import {
  createOptionalTextSchema,
  createSanitizedStringSchema,
  createSlugSchema,
  priceCentsSchema,
  urlSchema,
  uuidSchema,
} from '../primitives';
import { paginationSchema } from '../shared/pagination-schema';

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

/**
 * Content slug validation (max 500 chars)
 */
const slugSchema = createSlugSchema(500);

/**
 * Organization slug validation (max 255 chars)
 * Must be unique across platform and not conflict with reserved subdomains
 */
const organizationSlugSchema = createSlugSchema(255).refine(
  (slug) => !RESERVED_SUBDOMAINS_SET.has(slug),
  { message: 'This slug is reserved and cannot be used for an organization' }
);

/**
 * Sanitized string for user-generated content
 * - Trims whitespace
 * - Prevents empty strings
 * - Use for titles, descriptions, names
 */
const sanitizedStringSchema = createSanitizedStringSchema;

/**
 * Optional sanitized text (can be null)
 */
const optionalTextSchema = createOptionalTextSchema;

// ============================================================================
// Organization Schemas
// ============================================================================

/**
 * Database enum: No CHECK constraint, but follows convention
 * Keeping validation for type safety
 */
export const organizationStatusEnum = z.enum([
  'active',
  'suspended',
  'deleted',
]);

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

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/**
 * Update Organization Input
 * All fields optional (partial update)
 */
export const updateOrganizationSchema = createOrganizationSchema.partial();

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

// ============================================================================
// Media Item Schemas
// ============================================================================

/**
 * Media type enum
 * Aligns with database CHECK constraint: line 73
 */
export const mediaTypeEnum = z.enum([MEDIA_TYPES.VIDEO, MEDIA_TYPES.AUDIO]);

/**
 * Media status enum
 * Aligns with database CHECK constraint: line 72
 */
export const mediaStatusEnum = z.enum([
  MEDIA_STATUS.UPLOADING,
  MEDIA_STATUS.UPLOADED,
  MEDIA_STATUS.TRANSCODING,
  MEDIA_STATUS.READY,
  MEDIA_STATUS.FAILED,
]);

/**
 * MIME type validation for media uploads
 * Whitelist only supported formats
 */
const mimeTypeSchema = z.enum([
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
]);

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

  // R2 storage path — optional, generated server-side if not provided.
  // When provided (e.g. tests), validated to prevent path traversal.
  r2Key: z
    .string()
    .min(1, 'R2 key cannot be empty')
    .max(500, 'R2 key must be 500 characters or less')
    .regex(
      /^[a-zA-Z0-9/_-]+(\.[a-zA-Z0-9]+)?$/,
      'R2 key contains invalid characters'
    )
    .refine(
      (key) => !key.includes('..'),
      'R2 key cannot contain path traversal sequences'
    )
    .optional(),
});

export type CreateMediaItemInput = z.infer<typeof createMediaItemSchema>;

/**
 * Update Media Item Input
 * Used by transcoding service to update status, metadata, etc.
 * Also supports user-editable fields (title, description) via the studio UI.
 */
export const updateMediaItemSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional().nullable(),
  status: mediaStatusEnum.optional(),
  durationSeconds: z.number().int().min(0).max(86400).optional(), // Max 24 hours
  width: z.number().int().min(1).max(7680).optional(), // Max 8K width
  height: z.number().int().min(1).max(4320).optional(), // Max 8K height
  hlsMasterPlaylistKey: z.string().max(500).optional().nullable(),
  thumbnailKey: z.string().max(500).optional().nullable(),
  uploadedAt: z.date().optional(),
});

export type UpdateMediaItemInput = z.infer<typeof updateMediaItemSchema>;

// ============================================================================
// Content Schemas
// ============================================================================

/**
 * Content type enum
 * Aligns with database CHECK constraint: line 150
 */
export const contentTypeEnum = z.enum([
  CONTENT_TYPES.VIDEO,
  CONTENT_TYPES.AUDIO,
  CONTENT_TYPES.WRITTEN,
]);

/**
 * Visibility enum
 * Aligns with database CHECK constraint: line 149
 */
export const visibilityEnum = z.enum([
  VISIBILITY.PUBLIC,
  VISIBILITY.PRIVATE,
  VISIBILITY.MEMBERS_ONLY,
  VISIBILITY.PURCHASED_ONLY,
]);

/**
 * Content access type enum — defines the content's access model.
 * Replaces visibility for access control decisions.
 */
export const contentAccessTypeEnum = z.enum([
  CONTENT_ACCESS_TYPE.FREE,
  CONTENT_ACCESS_TYPE.PAID,
  CONTENT_ACCESS_TYPE.FOLLOWERS,
  CONTENT_ACCESS_TYPE.SUBSCRIBERS,
  CONTENT_ACCESS_TYPE.TEAM,
]);

/**
 * Content status enum
 * Aligns with database CHECK constraint: line 148
 */
export const contentStatusEnum = z.enum([
  CONTENT_STATUS.DRAFT,
  CONTENT_STATUS.PUBLISHED,
  CONTENT_STATUS.ARCHIVED,
]);

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

  // Written content body (Phase 2+) — limit raised for Tiptap JSON overhead
  contentBody: optionalTextSchema(500000, 'Content body'),

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

  // Access control (new model)
  accessType: contentAccessTypeEnum.default(CONTENT_ACCESS_TYPE.FREE),

  priceCents: priceCentsSchema.optional(),

  // Subscription tier gating (null = not included in any subscription)
  minimumTierId: uuidSchema.optional().nullable(),

  // Shader preset for immersive audio playback mode
  shaderPreset: z
    .string()
    .trim()
    .max(50, 'Shader preset must be 50 characters or less')
    .optional()
    .nullable(),

  // Per-preset parameter overrides (intensity, grain, etc.)
  shaderConfig: z
    .record(z.string(), z.union([z.number(), z.boolean()]))
    .optional()
    .nullable(),

  // Creator-flagged "feature on homepage" — promotes to full-width editorial
  // card on the org landing feed. Defaults to false at DB level.
  featured: z.boolean().optional(),
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
      if (
        ([CONTENT_TYPES.VIDEO, CONTENT_TYPES.AUDIO] as string[]).includes(
          data.contentType
        )
      ) {
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
      if (data.contentType === CONTENT_TYPES.WRITTEN) {
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
      // 'paid' access type requires priceCents > 0
      if (data.accessType === CONTENT_ACCESS_TYPE.PAID) {
        return !!data.priceCents && data.priceCents > 0;
      }
      return true;
    },
    {
      message: 'Paid content requires a price greater than £0',
      path: ['priceCents'],
    }
  )
  .refine(
    (data) => {
      // 'subscribers' access type requires a minimum tier
      if (data.accessType === CONTENT_ACCESS_TYPE.SUBSCRIBERS) {
        return !!data.minimumTierId;
      }
      return true;
    },
    {
      message: 'Subscriber content requires a minimum subscription tier',
      path: ['minimumTierId'],
    }
  )
  .refine(
    (data) => {
      // 'free' access type cannot have a price or tier
      if (data.accessType === CONTENT_ACCESS_TYPE.FREE) {
        return !data.priceCents || data.priceCents === 0;
      }
      return true;
    },
    {
      message: 'Free content cannot have a price',
      path: ['priceCents'],
    }
  )
  .refine(
    (data) => {
      // 'followers' access type requires an organization
      if (data.accessType === CONTENT_ACCESS_TYPE.FOLLOWERS) {
        return !!data.organizationId;
      }
      return true;
    },
    {
      message: 'Followers-only content requires an organisation',
      path: ['organizationId'],
    }
  )
  .refine(
    (data) => {
      // 'team' access type requires an organization
      if (data.accessType === CONTENT_ACCESS_TYPE.TEAM) {
        return !!data.organizationId;
      }
      return true;
    },
    {
      message: 'Team-only content requires an organisation',
      path: ['organizationId'],
    }
  )
  .refine(
    (data) => {
      // `minimumTierId` is only meaningful for 'subscribers' (required, gates
      // access) and 'paid' (optional, hybrid mode — subscribers at this tier
      // get it included alongside one-time purchases). For every other access
      // type the tier is nonsensical and must be absent.
      const tierAllowed =
        data.accessType === CONTENT_ACCESS_TYPE.SUBSCRIBERS ||
        data.accessType === CONTENT_ACCESS_TYPE.PAID;
      return tierAllowed || !data.minimumTierId;
    },
    {
      message:
        'Subscription tier is only valid for subscriber-gated or paid-hybrid content',
      path: ['minimumTierId'],
    }
  );

export type CreateContentInput = z.infer<typeof createContentSchema>;

/**
 * Update Content Input
 * All fields optional (partial update). Cross-field invariants are checked
 * only when both fields are present in the partial payload — the remaining
 * "did the admin leave a tier set when switching to an incompatible mode?"
 * case is handled defensively in ContentService.update() (see content-service.ts).
 */
export const updateContentSchema = baseContentSchema.partial().refine(
  (data) => {
    // Only evaluate when the caller sent both fields. If accessType is absent,
    // the DB value stands and we can't reason about the combination here.
    if (data.accessType === undefined || !data.minimumTierId) return true;
    return (
      data.accessType === CONTENT_ACCESS_TYPE.SUBSCRIBERS ||
      data.accessType === CONTENT_ACCESS_TYPE.PAID
    );
  },
  {
    message:
      'Subscription tier is only valid for subscriber-gated or paid-hybrid content',
    path: ['minimumTierId'],
  }
);

export type UpdateContentInput = z.infer<typeof updateContentSchema>;

/**
 * Publish Content Input
 * Simple schema for status change operations
 */
export const publishContentSchema = z.object({
  contentId: uuidSchema,
});

export type PublishContentInput = z.infer<typeof publishContentSchema>;

// ============================================================================
// Query Parameter Schemas
// ============================================================================

/**
 * Pagination Input Type
 * Import from '@codex/validation' to use PaginationInput
 */

/**
 * Sort order enum
 */
export const sortOrderEnum = z.enum(['asc', 'desc']);

/**
 * Content query/filter schema
 * Used for listing and searching content
 * Extends pagination with content-specific filters and sorting
 */
export const contentQuerySchema = paginationSchema.extend({
  // Filters
  status: contentStatusEnum.optional(),
  contentType: contentTypeEnum.optional(),
  accessType: contentAccessTypeEnum.optional(),
  category: z.string().max(100).optional(),
  organizationId: uuidSchema.optional(),
  creatorId: uuidSchema.optional(),

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

export type ContentQueryInput = z.infer<typeof contentQuerySchema>;

/**
 * Media item query schema
 * Extends pagination with media-specific filters and sorting
 */
export const mediaQuerySchema = paginationSchema.extend({
  status: mediaStatusEnum.optional(),
  mediaType: mediaTypeEnum.optional(),
  sortBy: z.enum(['createdAt', 'uploadedAt', 'title']).default('createdAt'),
  sortOrder: sortOrderEnum.default('desc'),
});

export type MediaQueryInput = z.infer<typeof mediaQuerySchema>;

/**
 * Public content query schema (org-scoped)
 * Used for unauthenticated listing of published content within an organization.
 * Requires orgId or slug to prevent unscoped platform-wide enumeration.
 */
export const publicContentQuerySchema = paginationSchema
  .extend({
    orgId: uuidSchema.optional(),
    slug: z.string().max(500).optional(),
    contentType: contentTypeEnum.optional(),
    search: z.string().max(255).optional(),
    sort: z.enum(['newest', 'oldest', 'title']).default('newest'),
    creatorId: uuidSchema.optional(),
    // Creator-flagged featured filter — true returns only featured items,
    // false excludes them. Undefined (default) returns all published items.
    // Accepts boolean or stringified boolean (URL query strings).
    featured: z
      .union([
        z.boolean(),
        z.enum(['true', 'false']).transform((v) => v === 'true'),
      ])
      .optional(),
  })
  .refine((data) => data.orgId || data.slug, {
    message: 'Either orgId or slug must be provided',
    path: ['orgId'],
  })
  .transform((data) => ({
    ...data,
    limit: Math.min(data.limit, 50),
  }));

export type PublicContentQueryInput = z.infer<typeof publicContentQuerySchema>;

/**
 * Discover content query schema (platform-wide)
 * Used by the discover page to browse all published content across organizations.
 * Intentionally omits orgId/slug — platform-wide access is the only valid use case.
 */
export const discoverContentQuerySchema = paginationSchema
  .extend({
    contentType: contentTypeEnum.optional(),
    search: z.string().max(255).optional(),
    sort: z.enum(['newest', 'oldest', 'title']).default('newest'),
  })
  .transform((data) => ({
    ...data,
    limit: Math.min(data.limit, 50),
  }));

export type DiscoverContentQueryInput = z.infer<
  typeof discoverContentQuerySchema
>;

// ============================================================================
// Slug Availability Check Schema
// ============================================================================

/**
 * Check content slug availability
 * Used by the SlugField component for real-time uniqueness feedback.
 *
 * Scoping mirrors the database partial unique indexes:
 * - With organizationId: checks slug + org uniqueness
 * - Without organizationId: checks slug + creator uniqueness (personal content)
 */
export const checkContentSlugSchema = z.object({
  slug: slugSchema,
  organizationId: uuidSchema.optional().nullable(),
  excludeContentId: uuidSchema.optional().nullable(),
});

export type CheckContentSlugInput = z.infer<typeof checkContentSlugSchema>;

/**
 * Organization query schema
 * Extends pagination with organization-specific filters and sorting
 */
export const organizationQuerySchema = paginationSchema.extend({
  search: z.string().max(255).optional(),
  sortBy: z.enum(['createdAt', 'name']).default('createdAt'),
  sortOrder: sortOrderEnum.default('desc'),
});

export type OrganizationQueryInput = z.infer<typeof organizationQuerySchema>;

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

export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;

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

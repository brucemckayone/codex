import { z } from 'zod';
/**
 * Database enum: No CHECK constraint, but follows convention
 * Keeping validation for type safety
 */
export declare const organizationStatusEnum: z.ZodEnum<
  ['active', 'suspended', 'deleted']
>;
/**
 * Create Organization Input
 * Aligns with database schema: packages/database/src/schema/content.ts lines 10-27
 */
export declare const createOrganizationSchema: z.ZodObject<
  {
    name: z.ZodString;
    slug: z.ZodPipeline<z.ZodEffects<z.ZodString, string, string>, z.ZodString>;
    description: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    logoUrl: z.ZodNullable<
      z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>
    >;
    websiteUrl: z.ZodNullable<
      z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>
    >;
  },
  'strip',
  z.ZodTypeAny,
  {
    slug: string;
    name: string;
    description?: string | null | undefined;
    logoUrl?: string | null | undefined;
    websiteUrl?: string | null | undefined;
  },
  {
    slug: string;
    name: string;
    description?: string | null | undefined;
    logoUrl?: string | null | undefined;
    websiteUrl?: string | null | undefined;
  }
>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
/**
 * Update Organization Input
 * All fields optional (partial update)
 */
export declare const updateOrganizationSchema: z.ZodObject<
  {
    name: z.ZodOptional<z.ZodString>;
    slug: z.ZodOptional<
      z.ZodPipeline<z.ZodEffects<z.ZodString, string, string>, z.ZodString>
    >;
    description: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
    logoUrl: z.ZodOptional<
      z.ZodNullable<z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>>
    >;
    websiteUrl: z.ZodOptional<
      z.ZodNullable<z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>>
    >;
  },
  'strip',
  z.ZodTypeAny,
  {
    slug?: string | undefined;
    name?: string | undefined;
    description?: string | null | undefined;
    logoUrl?: string | null | undefined;
    websiteUrl?: string | null | undefined;
  },
  {
    slug?: string | undefined;
    name?: string | undefined;
    description?: string | null | undefined;
    logoUrl?: string | null | undefined;
    websiteUrl?: string | null | undefined;
  }
>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
/**
 * Media type enum
 * Aligns with database CHECK constraint: line 73
 */
export declare const mediaTypeEnum: z.ZodEnum<['video', 'audio']>;
/**
 * Media status enum
 * Aligns with database CHECK constraint: line 72
 */
export declare const mediaStatusEnum: z.ZodEnum<
  ['uploading', 'uploaded', 'transcoding', 'ready', 'failed']
>;
/**
 * Create Media Item Input
 * Aligns with database schema: packages/database/src/schema/content.ts lines 35-74
 */
export declare const createMediaItemSchema: z.ZodObject<
  {
    title: z.ZodString;
    description: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    mediaType: z.ZodEnum<['video', 'audio']>;
    mimeType: z.ZodEnum<
      [
        'video/mp4',
        'video/quicktime',
        'video/x-msvideo',
        'video/webm',
        'audio/mpeg',
        'audio/mp4',
        'audio/wav',
        'audio/webm',
        'audio/ogg',
      ]
    >;
    fileSizeBytes: z.ZodNumber;
    r2Key: z.ZodEffects<z.ZodString, string, string>;
  },
  'strip',
  z.ZodTypeAny,
  {
    mediaType: 'video' | 'audio';
    title: string;
    mimeType:
      | 'video/mp4'
      | 'video/quicktime'
      | 'video/x-msvideo'
      | 'video/webm'
      | 'audio/mpeg'
      | 'audio/mp4'
      | 'audio/wav'
      | 'audio/webm'
      | 'audio/ogg';
    fileSizeBytes: number;
    r2Key: string;
    description?: string | null | undefined;
  },
  {
    mediaType: 'video' | 'audio';
    title: string;
    mimeType:
      | 'video/mp4'
      | 'video/quicktime'
      | 'video/x-msvideo'
      | 'video/webm'
      | 'audio/mpeg'
      | 'audio/mp4'
      | 'audio/wav'
      | 'audio/webm'
      | 'audio/ogg';
    fileSizeBytes: number;
    r2Key: string;
    description?: string | null | undefined;
  }
>;
export type CreateMediaItemInput = z.infer<typeof createMediaItemSchema>;
/**
 * Update Media Item Input
 * Used by transcoding service to update status, metadata, etc.
 */
export declare const updateMediaItemSchema: z.ZodObject<
  {
    status: z.ZodOptional<
      z.ZodEnum<['uploading', 'uploaded', 'transcoding', 'ready', 'failed']>
    >;
    durationSeconds: z.ZodOptional<z.ZodNumber>;
    width: z.ZodOptional<z.ZodNumber>;
    height: z.ZodOptional<z.ZodNumber>;
    hlsMasterPlaylistKey: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    thumbnailKey: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    uploadedAt: z.ZodOptional<z.ZodDate>;
  },
  'strip',
  z.ZodTypeAny,
  {
    status?:
      | 'uploading'
      | 'uploaded'
      | 'transcoding'
      | 'ready'
      | 'failed'
      | undefined;
    durationSeconds?: number | undefined;
    width?: number | undefined;
    height?: number | undefined;
    hlsMasterPlaylistKey?: string | null | undefined;
    thumbnailKey?: string | null | undefined;
    uploadedAt?: Date | undefined;
  },
  {
    status?:
      | 'uploading'
      | 'uploaded'
      | 'transcoding'
      | 'ready'
      | 'failed'
      | undefined;
    durationSeconds?: number | undefined;
    width?: number | undefined;
    height?: number | undefined;
    hlsMasterPlaylistKey?: string | null | undefined;
    thumbnailKey?: string | null | undefined;
    uploadedAt?: Date | undefined;
  }
>;
export type UpdateMediaItemInput = z.infer<typeof updateMediaItemSchema>;
/**
 * Content type enum
 * Aligns with database CHECK constraint: line 150
 */
export declare const contentTypeEnum: z.ZodEnum<['video', 'audio', 'written']>;
/**
 * Visibility enum
 * Aligns with database CHECK constraint: line 149
 */
export declare const visibilityEnum: z.ZodEnum<
  ['public', 'private', 'members_only', 'purchased_only']
>;
/**
 * Content status enum
 * Aligns with database CHECK constraint: line 148
 */
export declare const contentStatusEnum: z.ZodEnum<
  ['draft', 'published', 'archived']
>;
/**
 * Create Content Input
 * Aligns with database schema: packages/database/src/schema/content.ts lines 81-152
 *
 * Security validations:
 * - Validates mediaItemId exists and belongs to creator (service layer)
 * - Validates content type matches media type (service layer)
 * - Slug uniqueness per organization (database constraint)
 */
export declare const createContentSchema: z.ZodEffects<
  z.ZodEffects<
    z.ZodEffects<
      z.ZodObject<
        {
          title: z.ZodString;
          slug: z.ZodPipeline<
            z.ZodEffects<z.ZodString, string, string>,
            z.ZodString
          >;
          description: z.ZodNullable<z.ZodOptional<z.ZodString>>;
          contentType: z.ZodEnum<['video', 'audio', 'written']>;
          mediaItemId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
          contentBody: z.ZodNullable<z.ZodOptional<z.ZodString>>;
          organizationId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
          category: z.ZodNullable<z.ZodOptional<z.ZodString>>;
          tags: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString, 'many'>>>;
          thumbnailUrl: z.ZodNullable<
            z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>
          >;
          visibility: z.ZodDefault<
            z.ZodEnum<['public', 'private', 'members_only', 'purchased_only']>
          >;
          priceCents: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        },
        'strip',
        z.ZodTypeAny,
        {
          contentType: 'video' | 'audio' | 'written';
          slug: string;
          title: string;
          tags: string[];
          visibility: 'public' | 'private' | 'members_only' | 'purchased_only';
          mediaItemId?: string | null | undefined;
          organizationId?: string | null | undefined;
          description?: string | null | undefined;
          contentBody?: string | null | undefined;
          category?: string | null | undefined;
          thumbnailUrl?: string | null | undefined;
          priceCents?: number | null | undefined;
        },
        {
          contentType: 'video' | 'audio' | 'written';
          slug: string;
          title: string;
          mediaItemId?: string | null | undefined;
          organizationId?: string | null | undefined;
          description?: string | null | undefined;
          contentBody?: string | null | undefined;
          category?: string | null | undefined;
          tags?: string[] | undefined;
          thumbnailUrl?: string | null | undefined;
          visibility?:
            | 'public'
            | 'private'
            | 'members_only'
            | 'purchased_only'
            | undefined;
          priceCents?: number | null | undefined;
        }
      >,
      {
        contentType: 'video' | 'audio' | 'written';
        slug: string;
        title: string;
        tags: string[];
        visibility: 'public' | 'private' | 'members_only' | 'purchased_only';
        mediaItemId?: string | null | undefined;
        organizationId?: string | null | undefined;
        description?: string | null | undefined;
        contentBody?: string | null | undefined;
        category?: string | null | undefined;
        thumbnailUrl?: string | null | undefined;
        priceCents?: number | null | undefined;
      },
      {
        contentType: 'video' | 'audio' | 'written';
        slug: string;
        title: string;
        mediaItemId?: string | null | undefined;
        organizationId?: string | null | undefined;
        description?: string | null | undefined;
        contentBody?: string | null | undefined;
        category?: string | null | undefined;
        tags?: string[] | undefined;
        thumbnailUrl?: string | null | undefined;
        visibility?:
          | 'public'
          | 'private'
          | 'members_only'
          | 'purchased_only'
          | undefined;
        priceCents?: number | null | undefined;
      }
    >,
    {
      contentType: 'video' | 'audio' | 'written';
      slug: string;
      title: string;
      tags: string[];
      visibility: 'public' | 'private' | 'members_only' | 'purchased_only';
      mediaItemId?: string | null | undefined;
      organizationId?: string | null | undefined;
      description?: string | null | undefined;
      contentBody?: string | null | undefined;
      category?: string | null | undefined;
      thumbnailUrl?: string | null | undefined;
      priceCents?: number | null | undefined;
    },
    {
      contentType: 'video' | 'audio' | 'written';
      slug: string;
      title: string;
      mediaItemId?: string | null | undefined;
      organizationId?: string | null | undefined;
      description?: string | null | undefined;
      contentBody?: string | null | undefined;
      category?: string | null | undefined;
      tags?: string[] | undefined;
      thumbnailUrl?: string | null | undefined;
      visibility?:
        | 'public'
        | 'private'
        | 'members_only'
        | 'purchased_only'
        | undefined;
      priceCents?: number | null | undefined;
    }
  >,
  {
    contentType: 'video' | 'audio' | 'written';
    slug: string;
    title: string;
    tags: string[];
    visibility: 'public' | 'private' | 'members_only' | 'purchased_only';
    mediaItemId?: string | null | undefined;
    organizationId?: string | null | undefined;
    description?: string | null | undefined;
    contentBody?: string | null | undefined;
    category?: string | null | undefined;
    thumbnailUrl?: string | null | undefined;
    priceCents?: number | null | undefined;
  },
  {
    contentType: 'video' | 'audio' | 'written';
    slug: string;
    title: string;
    mediaItemId?: string | null | undefined;
    organizationId?: string | null | undefined;
    description?: string | null | undefined;
    contentBody?: string | null | undefined;
    category?: string | null | undefined;
    tags?: string[] | undefined;
    thumbnailUrl?: string | null | undefined;
    visibility?:
      | 'public'
      | 'private'
      | 'members_only'
      | 'purchased_only'
      | undefined;
    priceCents?: number | null | undefined;
  }
>;
export type CreateContentInput = z.infer<typeof createContentSchema>;
/**
 * Update Content Input
 * All fields optional (partial update)
 * Note: Cannot change mediaItemId after creation
 */
export declare const updateContentSchema: z.ZodObject<
  Omit<
    {
      title: z.ZodOptional<z.ZodString>;
      slug: z.ZodOptional<
        z.ZodPipeline<z.ZodEffects<z.ZodString, string, string>, z.ZodString>
      >;
      description: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
      contentType: z.ZodOptional<z.ZodEnum<['video', 'audio', 'written']>>;
      mediaItemId: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
      contentBody: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
      organizationId: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
      category: z.ZodOptional<z.ZodNullable<z.ZodOptional<z.ZodString>>>;
      tags: z.ZodOptional<
        z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString, 'many'>>>
      >;
      thumbnailUrl: z.ZodOptional<
        z.ZodNullable<z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>>
      >;
      visibility: z.ZodOptional<
        z.ZodDefault<
          z.ZodEnum<['public', 'private', 'members_only', 'purchased_only']>
        >
      >;
      priceCents: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
    },
    'mediaItemId'
  >,
  'strip',
  z.ZodTypeAny,
  {
    contentType?: 'video' | 'audio' | 'written' | undefined;
    organizationId?: string | null | undefined;
    slug?: string | undefined;
    description?: string | null | undefined;
    title?: string | undefined;
    contentBody?: string | null | undefined;
    category?: string | null | undefined;
    tags?: string[] | undefined;
    thumbnailUrl?: string | null | undefined;
    visibility?:
      | 'public'
      | 'private'
      | 'members_only'
      | 'purchased_only'
      | undefined;
    priceCents?: number | null | undefined;
  },
  {
    contentType?: 'video' | 'audio' | 'written' | undefined;
    organizationId?: string | null | undefined;
    slug?: string | undefined;
    description?: string | null | undefined;
    title?: string | undefined;
    contentBody?: string | null | undefined;
    category?: string | null | undefined;
    tags?: string[] | undefined;
    thumbnailUrl?: string | null | undefined;
    visibility?:
      | 'public'
      | 'private'
      | 'members_only'
      | 'purchased_only'
      | undefined;
    priceCents?: number | null | undefined;
  }
>;
export type UpdateContentInput = z.infer<typeof updateContentSchema>;
/**
 * Publish Content Input
 * Simple schema for status change operations
 */
export declare const publishContentSchema: z.ZodObject<
  {
    contentId: z.ZodString;
  },
  'strip',
  z.ZodTypeAny,
  {
    contentId: string;
  },
  {
    contentId: string;
  }
>;
export type PublishContentInput = z.infer<typeof publishContentSchema>;
/**
 * Pagination schema
 * Reusable for list queries
 */
export declare const paginationSchema: z.ZodObject<
  {
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
  },
  'strip',
  z.ZodTypeAny,
  {
    page: number;
    limit: number;
  },
  {
    page?: number | undefined;
    limit?: number | undefined;
  }
>;
export type PaginationInput = z.infer<typeof paginationSchema>;
/**
 * Sort order enum
 */
export declare const sortOrderEnum: z.ZodEnum<['asc', 'desc']>;
/**
 * Content query/filter schema
 * Used for listing and searching content
 */
export declare const contentQuerySchema: z.ZodObject<
  {
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
    status: z.ZodOptional<z.ZodEnum<['draft', 'published', 'archived']>>;
    contentType: z.ZodOptional<z.ZodEnum<['video', 'audio', 'written']>>;
    visibility: z.ZodOptional<
      z.ZodEnum<['public', 'private', 'members_only', 'purchased_only']>
    >;
    category: z.ZodOptional<z.ZodString>;
    organizationId: z.ZodOptional<z.ZodString>;
    search: z.ZodOptional<z.ZodString>;
    sortBy: z.ZodDefault<
      z.ZodEnum<
        [
          'createdAt',
          'updatedAt',
          'publishedAt',
          'title',
          'viewCount',
          'purchaseCount',
        ]
      >
    >;
    sortOrder: z.ZodDefault<z.ZodEnum<['asc', 'desc']>>;
  },
  'strip',
  z.ZodTypeAny,
  {
    page: number;
    limit: number;
    sortBy:
      | 'title'
      | 'createdAt'
      | 'updatedAt'
      | 'publishedAt'
      | 'viewCount'
      | 'purchaseCount';
    sortOrder: 'asc' | 'desc';
    contentType?: 'video' | 'audio' | 'written' | undefined;
    organizationId?: string | undefined;
    status?: 'draft' | 'published' | 'archived' | undefined;
    category?: string | undefined;
    visibility?:
      | 'public'
      | 'private'
      | 'members_only'
      | 'purchased_only'
      | undefined;
    search?: string | undefined;
  },
  {
    contentType?: 'video' | 'audio' | 'written' | undefined;
    organizationId?: string | undefined;
    status?: 'draft' | 'published' | 'archived' | undefined;
    category?: string | undefined;
    visibility?:
      | 'public'
      | 'private'
      | 'members_only'
      | 'purchased_only'
      | undefined;
    page?: number | undefined;
    limit?: number | undefined;
    search?: string | undefined;
    sortBy?:
      | 'title'
      | 'createdAt'
      | 'updatedAt'
      | 'publishedAt'
      | 'viewCount'
      | 'purchaseCount'
      | undefined;
    sortOrder?: 'asc' | 'desc' | undefined;
  }
>;
export type ContentQueryInput = z.infer<typeof contentQuerySchema>;
/**
 * Media item query schema
 */
export declare const mediaQuerySchema: z.ZodObject<
  {
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
    status: z.ZodOptional<
      z.ZodEnum<['uploading', 'uploaded', 'transcoding', 'ready', 'failed']>
    >;
    mediaType: z.ZodOptional<z.ZodEnum<['video', 'audio']>>;
    sortBy: z.ZodDefault<z.ZodEnum<['createdAt', 'uploadedAt', 'title']>>;
    sortOrder: z.ZodDefault<z.ZodEnum<['asc', 'desc']>>;
  },
  'strip',
  z.ZodTypeAny,
  {
    page: number;
    limit: number;
    sortBy: 'title' | 'uploadedAt' | 'createdAt';
    sortOrder: 'asc' | 'desc';
    mediaType?: 'video' | 'audio' | undefined;
    status?:
      | 'uploading'
      | 'uploaded'
      | 'transcoding'
      | 'ready'
      | 'failed'
      | undefined;
  },
  {
    mediaType?: 'video' | 'audio' | undefined;
    status?:
      | 'uploading'
      | 'uploaded'
      | 'transcoding'
      | 'ready'
      | 'failed'
      | undefined;
    page?: number | undefined;
    limit?: number | undefined;
    sortBy?: 'title' | 'uploadedAt' | 'createdAt' | undefined;
    sortOrder?: 'asc' | 'desc' | undefined;
  }
>;
export type MediaQueryInput = z.infer<typeof mediaQuerySchema>;
/**
 * Organization query schema
 */
export declare const organizationQuerySchema: z.ZodObject<
  {
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
    search: z.ZodOptional<z.ZodString>;
    sortBy: z.ZodDefault<z.ZodEnum<['createdAt', 'name']>>;
    sortOrder: z.ZodDefault<z.ZodEnum<['asc', 'desc']>>;
  },
  'strip',
  z.ZodTypeAny,
  {
    page: number;
    limit: number;
    sortBy: 'name' | 'createdAt';
    sortOrder: 'asc' | 'desc';
    search?: string | undefined;
  },
  {
    page?: number | undefined;
    limit?: number | undefined;
    search?: string | undefined;
    sortBy?: 'name' | 'createdAt' | undefined;
    sortOrder?: 'asc' | 'desc' | undefined;
  }
>;
export type OrganizationQueryInput = z.infer<typeof organizationQuerySchema>;
/**
 * Upload request validation
 * Used to initiate direct upload to R2
 *
 * Security:
 * - Validates file size before upload
 * - Validates MIME type against whitelist
 * - Prevents directory traversal in filename
 */
export declare const uploadRequestSchema: z.ZodObject<
  {
    filename: z.ZodString;
    contentType: z.ZodEnum<
      [
        'video/mp4',
        'video/quicktime',
        'video/x-msvideo',
        'video/webm',
        'audio/mpeg',
        'audio/mp4',
        'audio/wav',
        'audio/webm',
        'audio/ogg',
      ]
    >;
    fileSizeBytes: z.ZodNumber;
    title: z.ZodString;
    description: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    mediaType: z.ZodEnum<['video', 'audio']>;
  },
  'strip',
  z.ZodTypeAny,
  {
    contentType:
      | 'video/mp4'
      | 'video/quicktime'
      | 'video/x-msvideo'
      | 'video/webm'
      | 'audio/mpeg'
      | 'audio/mp4'
      | 'audio/wav'
      | 'audio/webm'
      | 'audio/ogg';
    mediaType: 'video' | 'audio';
    title: string;
    fileSizeBytes: number;
    filename: string;
    description?: string | null | undefined;
  },
  {
    contentType:
      | 'video/mp4'
      | 'video/quicktime'
      | 'video/x-msvideo'
      | 'video/webm'
      | 'audio/mpeg'
      | 'audio/mp4'
      | 'audio/wav'
      | 'audio/webm'
      | 'audio/ogg';
    mediaType: 'video' | 'audio';
    title: string;
    fileSizeBytes: number;
    filename: string;
    description?: string | null | undefined;
  }
>;
export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;
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
//# sourceMappingURL=content-schemas.d.ts.map

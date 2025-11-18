# Work Packet: P1-CONTENT-001 - Content Management Service

**Status**: ✅ IMPLEMENTED (Exceeds Specification)
**Priority**: P0 (Critical - foundation for other features)
**Actual Effort**: 5 days
**Branch**: `main` (merged)
**Implementation Quality**: Production-ready with enhancements beyond specification

---

## Implementation Status

**✅ FULLY IMPLEMENTED:**
- ✅ Database schema (`packages/database/src/schema/content.ts`)
  - `media_items` table with all fields, indexes, and constraints
  - `content` table with simplified category/tags (JSONB)
  - Proper relations and type exports
- ✅ Validation schemas (`packages/validation/src/content-schemas.ts`)
  - All input/output schemas with XSS prevention
  - Reusable primitive schemas
- ✅ Content service (`packages/content/src/services/content-service.ts`)
  - Full CRUD operations with custom error classes
  - Transaction-safe operations
  - Media ownership validation
- ✅ Media service (`packages/content/src/services/media-service.ts`)
  - Separate service for media item management
  - Status workflow methods
- ✅ Content API (`workers/content-api/src/routes/content.ts`)
  - All endpoints with route-level security policies
  - Uses `@codex/worker-utils` patterns
- ✅ Media API (`workers/content-api/src/routes/media.ts`)
  - Complete media item CRUD endpoints
- ✅ Tests (packages and workers)
  - Service tests with business logic validation
  - Integration tests with real authentication

**🎯 IMPLEMENTATION IMPROVEMENTS:**
The actual implementation exceeds the specification in several key areas:

1. **Enhanced Error Handling**: Custom error classes (`ContentNotFoundError`, `MediaNotReadyError`, `ContentTypeMismatchError`, `SlugConflictError`) instead of generic errors
2. **Transaction Safety**: Uses `db.transaction()` for multi-step operations ensuring ACID compliance
3. **Route-Level Security**: `withPolicy(POLICY_PRESETS.creator())` per route for granular control
4. **Media Service Separation**: Dedicated `MediaItemService` class for better separation of concerns
5. **Text-based User IDs**: Uses `text` instead of `uuid` for creator IDs to match Clerk Auth system

---

## Dependencies

### Required Packages (Already Available)
```typescript
import { db } from '@codex/database';              // ✅ Available
import { R2Client } from '@codex/cloudflare-clients'; // ✅ Available
import { z } from 'zod';                            // ✅ Available in validation package
import { ObservabilityClient } from '@codex/observability'; // ✅ Available
import { securityHeaders, rateLimit } from '@codex/security'; // ✅ Available
```

### Required Documentation
- [Database Schema Design](../../infrastructure/DATABASE_SCHEMA_DESIGN.md) - Table structure
- [R2 Storage Patterns](../../core/R2_STORAGE_PATTERNS.md) - File organization
- [Multi-Tenant Architecture](../../core/MULTI_TENANT_ARCHITECTURE.md) - Organization scoping
- [STANDARDS.md](../STANDARDS.md) - Coding patterns
- [Testing Strategy](../../infrastructure/Testing.md) - Test approach

---

## Implementation Steps

### Step 1: Create Content Schema

**Note**: Schema aligns with `design/features/shared/database-schema.md` v2.0 (lines 130-254). Uses integer cents for money (ACID-compliant), simple category string, and JSONB tags array.

**File**: `packages/database/src/schema/content.ts`

```typescript
import { pgTable, uuid, varchar, text, integer, bigint, timestamp, jsonb, index, unique } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth';
import { organizations } from './organizations';

/**
 * Media items (uploaded videos/audio)
 * Aligned with database-schema.md lines 130-183
 * Creator-owned, stored in creator's R2 bucket
 * Separate from content for reusability
 */
export const mediaItems = pgTable('media_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  creatorId: uuid('creator_id').notNull().references(() => users.id),

  // Basic Info
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  mediaType: varchar('media_type', { length: 50 }).notNull(), // 'video' | 'audio'
  status: varchar('status', { length: 50 }).default('uploading').notNull(),
  // 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed'

  // R2 Storage (in creator's bucket: codex-media-{creator_id})
  r2Key: varchar('r2_key', { length: 500 }).notNull(), // "originals/{media_id}/video.mp4"
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),
  mimeType: varchar('mime_type', { length: 100 }),

  // Media Metadata
  durationSeconds: integer('duration_seconds'),
  width: integer('width'),   // For video
  height: integer('height'), // For video

  // HLS Transcoding (Phase 1+)
  hlsMasterPlaylistKey: varchar('hls_master_playlist_key', { length: 500 }), // "hls/{media_id}/master.m3u8"
  thumbnailKey: varchar('thumbnail_key', { length: 500 }), // "thumbnails/{media_id}/thumb.jpg"

  // Timestamps
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  creatorIdIdx: index('idx_media_items_creator_id').on(table.creatorId),
  statusIdx: index('idx_media_items_status').on(table.creatorId, table.status),
  typeIdx: index('idx_media_items_type').on(table.creatorId, table.mediaType),
}));

/**
 * Published content (references media items)
 * Aligned with database-schema.md lines 185-254
 * Can belong to organization OR creator's personal profile
 */
export const content = pgTable('content', {
  id: uuid('id').primaryKey().defaultRandom(),
  creatorId: uuid('creator_id').notNull().references(() => users.id),
  organizationId: uuid('organization_id').references(() => organizations.id), // NULL = personal profile

  // Media Reference (separates content from media for reusability)
  mediaItemId: uuid('media_item_id').references(() => mediaItems.id),
  // NULL for written content (Phase 2)

  // Basic Info
  title: varchar('title', { length: 500 }).notNull(),
  slug: varchar('slug', { length: 500 }).notNull(), // Unique per organization
  description: text('description'),
  contentType: varchar('content_type', { length: 50 }).notNull(),
  // 'video' | 'audio' | 'written' (Phase 1: video, audio only)

  // Thumbnail (optional custom thumbnail)
  thumbnailUrl: text('thumbnail_url'),

  // Written content (Phase 2+)
  contentBody: text('content_body'),

  // Organization (simplified for Phase 1)
  category: varchar('category', { length: 100 }), // Simple string category
  tags: jsonb('tags').default('[]'), // Array of tag strings

  // Access & Pricing
  visibility: varchar('visibility', { length: 50 }).default('purchased_only').notNull(),
  // 'public' | 'private' | 'members_only' | 'purchased_only' (Phase 1: public, purchased_only)
  priceCents: integer('price_cents'), // NULL = free, INTEGER = price in cents (ACID-compliant)

  // Status
  status: varchar('status', { length: 50 }).default('draft').notNull(),
  // 'draft' | 'published' | 'archived'
  publishedAt: timestamp('published_at', { withTimezone: true }),

  // Metadata
  viewCount: integer('view_count').default(0).notNull(),
  purchaseCount: integer('purchase_count').default(0).notNull(),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  creatorIdIdx: index('idx_content_creator_id').on(table.creatorId),
  organizationIdIdx: index('idx_content_organization_id').on(table.organizationId),
  mediaItemIdIdx: index('idx_content_media_item_id').on(table.mediaItemId),
  slugIdx: index('idx_content_slug').on(table.slug, table.organizationId),
  statusIdx: index('idx_content_status').on(table.status),
  publishedAtIdx: index('idx_content_published_at').on(table.publishedAt),
  categoryIdx: index('idx_content_category').on(table.category),
  // Unique slug per organization (or per creator if personal)
  uniqueSlugPerOrg: unique().on(table.slug, table.organizationId),
}));

// Relations
export const mediaItemsRelations = relations(mediaItems, ({ one }) => ({
  creator: one(users, {
    fields: [mediaItems.creatorId],
    references: [users.id],
  }),
}));

export const contentRelations = relations(content, ({ one }) => ({
  creator: one(users, {
    fields: [content.creatorId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [content.organizationId],
    references: [organizations.id],
  }),
  mediaItem: one(mediaItems, {
    fields: [content.mediaItemId],
    references: [mediaItems.id],
  }),
}));

// Type exports
export type MediaItem = typeof mediaItems.$inferSelect;
export type NewMediaItem = typeof mediaItems.$inferInsert;
export type Content = typeof content.$inferSelect;
export type NewContent = typeof content.$inferInsert;
```

**Migration**: Generated SQL should match database-schema.md v2.0

```bash
# Generate migration
pnpm --filter @codex/database db:gen:drizzle

# Review generated SQL (should match database-schema.md lines 135-254)
cat packages/database/drizzle/000X_content_schema.sql

# Apply to local DB
pnpm --filter @codex/database db:migrate
```

### Step 2: Create Validation Schemas (Separate from DB!)

**File**: `packages/validation/src/content-schemas.ts`

```typescript
import { z } from 'zod';

/**
 * Validation for creating content
 * Aligned with database-schema.md v2.0 - simplified categories and tags
 * Separate from DB operations for testability!
 */
export const createContentSchema = z.object({
  title: z.string().min(3).max(500),
  slug: z.string().min(1).max(500).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().min(10).max(5000).optional(),
  contentType: z.enum(['video', 'audio']), // Phase 1: video, audio only
  mediaItemId: z.string().uuid(),
  category: z.string().min(1).max(100).optional(), // Simple string category (Phase 1)
  tags: z.array(z.string().min(1).max(50)).max(10).optional(), // Array of tag strings
  visibility: z.enum(['public', 'purchased_only']).default('purchased_only'), // Phase 1 options
  priceCents: z.number().int().min(0).max(10000000).nullable(), // NULL = free, max $100,000
  thumbnailUrl: z.string().url().optional(),
});

export const updateContentSchema = createContentSchema.partial();

export const publishContentSchema = z.object({
  contentId: z.string().uuid(),
});

export const uploadRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum(['video/mp4', 'video/quicktime', 'audio/mpeg', 'audio/wav', 'audio/mp3']),
  fileSize: z.number().int().min(1).max(5 * 1024 * 1024 * 1024), // 5GB max
  title: z.string().min(3).max(255),
  description: z.string().max(1000).optional(),
});

export type CreateContentInput = z.infer<typeof createContentSchema>;
export type UpdateContentInput = z.infer<typeof updateContentSchema>;
export type PublishContentInput = z.infer<typeof publishContentSchema>;
export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;
```

**Testing**: See `design/roadmap/testing/content-testing-definition.md` for comprehensive validation test patterns.

### Step 3: Create Content Service

**File**: `packages/content/src/service.ts`

```typescript
import { db } from '@codex/database';
import { content, mediaItems, type Content, type MediaItem } from '@codex/database/schema';
import { eq, and, isNull, desc, count, sql } from 'drizzle-orm';
import { createContentSchema, updateContentSchema, type CreateContentInput, type UpdateContentInput } from '@codex/validation';
import { ObservabilityClient } from '@codex/observability';

export interface ContentServiceConfig {
  db: typeof db;
  obs: ObservabilityClient;
}

export interface IContentService {
  create(input: CreateContentInput, creatorId: string, organizationId?: string): Promise<Content>;
  findById(id: string, creatorId: string): Promise<Content | null>;
  update(id: string, input: UpdateContentInput, creatorId: string): Promise<Content>;
  publish(id: string, creatorId: string): Promise<Content>;
  unpublish(id: string, creatorId: string): Promise<Content>;
  delete(id: string, creatorId: string): Promise<void>;
  list(creatorId: string, organizationId?: string, filters?: ContentFilters): Promise<PaginatedContent>;
}

export interface ContentFilters {
  status?: 'draft' | 'published' | 'archived';
  category?: string; // Simple string category (Phase 1)
  contentType?: 'video' | 'audio';
  limit?: number;
  offset?: number;
}

export interface PaginatedContent {
  items: Content[];
  total: number;
  page: number;
  pageSize: number;
}

export class ContentService implements IContentService {
  private config: ContentServiceConfig;

  constructor(config: ContentServiceConfig) {
    this.config = config;
  }

  async create(input: CreateContentInput, creatorId: string, organizationId?: string): Promise<Content> {
    const { db, obs } = this.config;

    // Step 1: Validate input (pure function, testable!)
    const validated = createContentSchema.parse(input);

    obs.info('Creating content', {
      title: validated.title,
      creatorId,
      organizationId: organizationId || 'personal',
    });

    // Step 2: Verify media item exists and belongs to creator
    const mediaItem = await db.query.mediaItems.findFirst({
      where: and(
        eq(mediaItems.id, validated.mediaItemId),
        eq(mediaItems.creatorId, creatorId), // Media must be owned by creator
        isNull(mediaItems.deletedAt)
      ),
    });

    if (!mediaItem) {
      throw new Error('MEDIA_NOT_FOUND');
    }

    if (mediaItem.status !== 'ready') {
      throw new Error('MEDIA_NOT_READY');
    }

    // Step 3: Verify content type matches media type
    if (
      (validated.contentType === 'video' && mediaItem.mediaType !== 'video') ||
      (validated.contentType === 'audio' && mediaItem.mediaType !== 'audio')
    ) {
      throw new Error('CONTENT_TYPE_MISMATCH');
    }

    // Step 4: Create content with simplified tags (JSONB array)
    const [newContent] = await db.insert(content).values({
      creatorId,
      organizationId: organizationId || null, // NULL = personal profile
      mediaItemId: validated.mediaItemId,
      title: validated.title,
      slug: validated.slug,
      description: validated.description || null,
      contentType: validated.contentType,
      category: validated.category || null,
      tags: validated.tags || [], // JSONB array of strings
      visibility: validated.visibility || 'purchased_only',
      priceCents: validated.priceCents ?? null, // NULL = free
      thumbnailUrl: validated.thumbnailUrl || null,
      status: 'draft',
    }).returning();

    obs.info('Content created', {
      contentId: newContent.id,
      creatorId,
      organizationId: organizationId || 'personal',
      slug: newContent.slug,
    });

    return newContent;
  }

  async findById(id: string, creatorId: string): Promise<Content | null> {
    const { db } = this.config;

    return db.query.content.findFirst({
      where: and(
        eq(content.id, id),
        eq(content.creatorId, creatorId), // Only creator's own content
        isNull(content.deletedAt)
      ),
      with: {
        mediaItem: true,
      },
    });
  }

  async update(id: string, input: UpdateContentInput, creatorId: string): Promise<Content> {
    const { db, obs } = this.config;

    const validated = updateContentSchema.parse(input);

    const existing = await this.findById(id, creatorId);
    if (!existing) {
      throw new Error('CONTENT_NOT_FOUND');
    }

    const [updated] = await db.update(content)
      .set({
        ...validated,
        updatedAt: new Date(),
      })
      .where(and(
        eq(content.id, id),
        eq(content.creatorId, creatorId)
      ))
      .returning();

    obs.info('Content updated', { contentId: id, creatorId });

    return updated;
  }

  async publish(id: string, creatorId: string): Promise<Content> {
    const { db, obs } = this.config;

    const existing = await this.findById(id, creatorId);

    if (!existing) {
      throw new Error('CONTENT_NOT_FOUND');
    }

    if (existing.status === 'published') {
      return existing; // Already published
    }

    const [updated] = await db.update(content)
      .set({
        status: 'published',
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(content.id, id),
        eq(content.creatorId, creatorId)
      ))
      .returning();

    obs.info('Content published', { contentId: id, creatorId });

    return updated;
  }

  async unpublish(id: string, creatorId: string): Promise<Content> {
    const { db, obs } = this.config;

    const [updated] = await db.update(content)
      .set({
        status: 'draft',
        updatedAt: new Date(),
      })
      .where(and(
        eq(content.id, id),
        eq(content.creatorId, creatorId)
      ))
      .returning();

    obs.info('Content unpublished', { contentId: id, creatorId });

    return updated;
  }

  async delete(id: string, creatorId: string): Promise<void> {
    const { db, obs } = this.config;

    // Soft delete
    await db.update(content)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(content.id, id),
        eq(content.creatorId, creatorId)
      ));

    obs.info('Content deleted (soft)', { contentId: id, creatorId });
  }

  async list(creatorId: string, organizationId?: string, filters: ContentFilters = {}): Promise<PaginatedContent> {
    const { db } = this.config;

    const limit = filters.limit || 20;
    const offset = filters.offset || 0;

    // Build where conditions
    const whereConditions = [
      eq(content.creatorId, creatorId), // Only creator's content
      isNull(content.deletedAt),
      filters.status ? eq(content.status, filters.status) : undefined,
      filters.category ? eq(content.category, filters.category) : undefined,
      filters.contentType ? eq(content.contentType, filters.contentType) : undefined,
    ].filter(Boolean);

    // If organizationId provided, filter by org; otherwise show all creator's content
    if (organizationId !== undefined) {
      whereConditions.push(eq(content.organizationId, organizationId));
    }

    const items = await db.query.content.findMany({
      where: and(...whereConditions),
      limit,
      offset,
      orderBy: [desc(content.createdAt)],
      with: {
        mediaItem: true,
      },
    });

    const [{ total }] = await db.select({ total: count() })
      .from(content)
      .where(and(...whereConditions));

    return {
      items,
      total: Number(total),
      page: Math.floor(offset / limit) + 1,
      pageSize: limit,
    };
  }
}

/**
 * Factory function for dependency injection
 */
export function getContentService(env: {
  DATABASE_URL: string;
  ENVIRONMENT: string;
}): ContentService {
  const database = getDbClient(env.DATABASE_URL);
  const obs = new ObservabilityClient('content-service', env.ENVIRONMENT);

  return new ContentService({
    db: database,
    obs,
  });
}
```

### Step 4: Create API Endpoints

**File**: `workers/content-api/src/routes/content.ts`

**Note**: This implementation uses the standardized `@codex/worker-utils` patterns including:
- Route-level security policies via `withPolicy()` (instead of global auth middleware)
- `createAuthenticatedHandler()` for automatic validation and error handling
- `POLICY_PRESETS` for consistent authentication and rate limiting
- Standardized response formatting with `{ data: T }` wrapper

```typescript
import { Hono } from 'hono';
import type { HonoEnv } from '../types';
import {
  createContentService,
  createContentSchema,
  updateContentSchema,
  contentQuerySchema,
} from '@codex/content';
import { dbHttp } from '@codex/database';
import {
  createAuthenticatedHandler,
  createAuthenticatedGetHandler,
  withPolicy,
  POLICY_PRESETS,
} from '@codex/worker-utils';
import { createIdParamsSchema } from '@codex/validation';

const app = new Hono<HonoEnv>();

// Note: Route-level security policies applied via withPolicy()
// Each route declares its own authentication and authorization requirements

/**
 * POST /api/content
 * Create new content
 *
 * Security: Creator/Admin only, API rate limit (100 req/min)
 */
app.post(
  '/',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    schema: {
      body: createContentSchema,
    },
    handler: async (c, ctx) => {
      const service = createContentService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      return service.create(ctx.validated.body, ctx.user.id);
    },
    successStatus: 201,
  })
);

/**
 * GET /api/content/:id
 * Get content by ID
 *
 * Security: Authenticated users, API rate limit (100 req/min)
 */
app.get(
  '/:id',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedGetHandler({
    schema: {
      params: createIdParamsSchema(),
    },
    handler: async (_c, ctx) => {
      const service = createContentService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      return service.get(ctx.validated.params.id, ctx.user.id);
    },
  })
);

/**
 * PATCH /api/content/:id
 * Update content
 *
 * Security: Creator/Admin only, API rate limit (100 req/min)
 */
app.patch(
  '/:id',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    schema: {
      params: createIdParamsSchema(),
      body: updateContentSchema,
    },
    handler: async (_c, ctx) => {
      const service = createContentService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      return service.update(
        ctx.validated.params.id,
        ctx.validated.body,
        ctx.user.id
      );
    },
  })
);

/**
 * GET /api/content
 * List content with filters and pagination
 *
 * Security: Authenticated users, API rate limit (100 req/min)
 */
app.get(
  '/',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedGetHandler({
    schema: {
      query: contentQuerySchema,
    },
    handler: async (_c, ctx) => {
      const service = createContentService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      const result = await service.list(ctx.user.id, ctx.validated.query);

      return {
        items: result.items,
        page: result.pagination.page,
        limit: result.pagination.limit,
        total: result.pagination.total,
        totalPages: result.pagination.totalPages,
      };
    },
  })
);

/**
 * POST /api/content/:id/publish
 * Publish content
 *
 * Security: Creator/Admin only, API rate limit (100 req/min)
 */
app.post(
  '/:id/publish',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedGetHandler({
    schema: {
      params: createIdParamsSchema(),
    },
    handler: async (_c, ctx) => {
      const service = createContentService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      return service.publish(ctx.validated.params.id, ctx.user.id);
    },
  })
);

/**
 * POST /api/content/:id/unpublish
 * Unpublish content
 *
 * Security: Creator/Admin only, API rate limit (100 req/min)
 */
app.post(
  '/:id/unpublish',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedGetHandler({
    schema: {
      params: createIdParamsSchema(),
    },
    handler: async (_c, ctx) => {
      const service = createContentService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      return service.unpublish(ctx.validated.params.id, ctx.user.id);
    },
  })
);

/**
 * DELETE /api/content/:id
 * Soft delete content
 *
 * Security: Creator/Admin only, Strict rate limit (5 req/15min)
 */
app.delete(
  '/:id',
  withPolicy({
    auth: 'required',
    roles: ['creator', 'admin'],
    rateLimit: 'auth', // Stricter rate limit for deletion
  }),
  createAuthenticatedGetHandler({
    schema: {
      params: createIdParamsSchema(),
    },
    handler: async (_c, ctx) => {
      const service = createContentService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      await service.delete(ctx.validated.params.id, ctx.user.id);
      return null;
    },
    successStatus: 204,
  })
);

export default app;
```

**Worker Configuration** (`workers/content-api/src/index.ts`):

```typescript
import { createWorker } from '@codex/worker-utils';

// Import route modules
import contentRoutes from './routes/content';
import mediaRoutes from './routes/media';

const app = createWorker({
  serviceName: 'content-api',
  version: '1.0.0',
  enableRequestTracking: true, // UUID request IDs, IP tracking, user agent
  enableLogging: true,
  enableCors: true,
  enableSecurityHeaders: true,
  enableGlobalAuth: false, // Using route-level withPolicy() instead
});

// Note: Rate limiting is now applied at the route level via withPolicy()
// Each route declares its own rate limit preset (api, auth, etc.)

// Mount API routes
app.route('/api/content', contentRoutes);
app.route('/api/media', mediaRoutes);

export default app;
```

---

## Testing Strategy

**Test Specifications**: See `design/roadmap/testing/content-testing-definition.md` for comprehensive test patterns, including:
- Validation tests (Zod schemas, pure functions, no DB)
- Service tests (mocked DB, business logic isolation)
- Integration tests (real DB, end-to-end operations)
- API tests (endpoint testing, authentication, error handling)
- Common testing patterns and test data factories

**To Run Tests**:
```bash
# Validation tests (fast, no DB)
pnpm --filter @codex/validation test

# Service tests (fast, mocked DB)
pnpm --filter @codex/content test

# Integration tests (slow, real DB)
DATABASE_URL=postgresql://... pnpm --filter @codex/content test:integration

# All tests
pnpm test

# With coverage
pnpm test --coverage
```

---

## Definition of Done

### Code Implementation
- [ ] Content schema created in `packages/database/src/schema/content.ts`
  - [ ] `media_items` table with all fields from database-schema.md v2.0
  - [ ] `content` table with simplified category/tags (JSONB)
  - [ ] UUID primary keys, integer cents for pricing
  - [ ] Proper indexes and constraints
- [ ] Migration generated and applied
  - [ ] SQL matches database-schema.md lines 135-254
  - [ ] Migration tested on local DB
- [ ] Validation schemas in `packages/validation/src/content-schemas.ts`
  - [ ] `createContentSchema` with all fields
  - [ ] `updateContentSchema` (partial)
  - [ ] `publishContentSchema`
  - [ ] `uploadRequestSchema`
- [ ] Content service implemented in `packages/content/src/service.ts`
  - [ ] `create()` method with media validation
  - [ ] `findById()` method
  - [ ] `update()` method
  - [ ] `publish()` and `unpublish()` methods
  - [ ] `delete()` method (soft delete)
  - [ ] `list()` method with filters
  - [ ] Factory function `getContentService()`
- [ ] API endpoints created in `workers/content-api/src/routes/content.ts`
  - [ ] POST /api/content (create)
  - [ ] GET /api/content/:id (get by ID)
  - [ ] PATCH /api/content/:id (update)
  - [ ] GET /api/content (list with filters)
  - [ ] POST /api/content/:id/publish (publish)
  - [ ] POST /api/content/:id/unpublish (unpublish)
  - [ ] DELETE /api/content/:id (soft delete)

### Testing
- [ ] Validation tests passing (100% coverage, no DB)
  - [ ] All validation rules tested
  - [ ] Edge cases covered
- [ ] Service tests passing (mocked DB)
  - [ ] All public methods tested
  - [ ] Error paths tested
  - [ ] Business logic verified
- [ ] Integration tests passing (with test DB)
  - [ ] End-to-end database operations
  - [ ] Constraint enforcement
  - [ ] Soft delete behavior
- [ ] API tests passing
  - [ ] Authentication required
  - [ ] All endpoints tested
  - [ ] Error responses verified

### Quality & Security
- [ ] All creator-scoped queries use `creatorId` filter
- [ ] Organization scoping enforced where applicable
- [ ] Soft delete working (`deleted_at` timestamp)
- [ ] Observability logging added
  - [ ] All operations logged
  - [ ] No PII in logs (only IDs)
- [ ] Error handling comprehensive
  - [ ] All error codes documented
  - [ ] Proper HTTP status codes
- [ ] Input validation with Zod
- [ ] TypeScript types exported

### Documentation
- [ ] Schema fields documented
- [ ] API endpoints documented
- [ ] Error codes documented
- [ ] Service interfaces documented
- [ ] Integration points documented

### DevOps
- [ ] CI passing (tests + typecheck + lint)
- [ ] No new ESLint warnings
- [ ] No new TypeScript errors
- [ ] Code reviewed against STANDARDS.md
- [ ] Branch deployed to staging

---

## Interfaces & Integration Points

### Upstream Dependencies

**P1-TRANSCODE-001** (Media Transcoding):
- **Dependency**: Content service reads from `media_items` table populated by transcoding service
- **Tables**: `media_items` (lines 130-183 in database-schema.md)
- **Fields Used**:
  - `id` - Referenced by `content.media_item_id`
  - `creator_id` - Ownership validation
  - `media_type` - Must match `content.content_type`
  - `status` - Must be 'ready' before publishing
  - `hls_master_playlist_key` - Used for video playback
  - `thumbnail_key` - Default thumbnail if custom not provided
- **Query Example**:
```typescript
// Content service validates media before creating content
const mediaItem = await db.query.mediaItems.findFirst({
  where: and(
    eq(mediaItems.id, validated.mediaItemId),
    eq(mediaItems.creatorId, creatorId),
    isNull(mediaItems.deletedAt)
  ),
});

if (!mediaItem) throw new Error('MEDIA_NOT_FOUND');
if (mediaItem.status !== 'ready') throw new Error('MEDIA_NOT_READY');
```

**Auth Middleware**:
- **Dependency**: All API endpoints require authenticated user
- **Context Required**: `user.id`, `user.email`, `user.role`, `user.organizationId`
- **Middleware**: `requireAuth()` sets `c.get('user')`
- **Integration**: Pass `user.id` as `creatorId` to all service methods

**Organizations (database-schema.md lines 256-281)**:
- **Dependency**: Content can belong to organization or personal profile
- **Nullable FK**: `content.organization_id` references `organizations.id`
- **Business Rule**: `NULL` organization_id = personal content
- **Query Pattern**: Filter by `organizationId` when listing content

### Downstream Consumers

**P1-ACCESS-001** (Content Access Control):
- **Consumes**: `content` table to check if content exists and is published
- **Fields Read**:
  - `id`, `creator_id`, `organization_id`
  - `status` - Must be 'published'
  - `visibility` - Determines access rules
  - `price_cents` - Determines if purchase required
  - `deleted_at` - Must be NULL
- **Query Example**:
```typescript
// Access service checks if content is accessible
const content = await db.query.content.findFirst({
  where: and(
    eq(content.id, contentId),
    eq(content.status, 'published'),
    isNull(content.deletedAt)
  ),
});

if (!content) throw new Error('CONTENT_NOT_FOUND');
if (content.visibility === 'purchased_only' && !hasPurchased) {
  throw new Error('PURCHASE_REQUIRED');
}
```

**P1-ECOM-001** (Stripe Checkout):
- **Consumes**: `content` table for checkout
- **Fields Read**:
  - `id`, `title`, `description`
  - `price_cents` - Stripe amount (must be > 0)
  - `creator_id` - For revenue routing
  - `organization_id` - For org revenue
- **Business Rule**: Cannot checkout free content (`price_cents IS NULL` or `= 0`)
- **API Contract**:
```typescript
// Checkout service validates content is purchasable
POST /api/checkout
{
  "contentId": "uuid",
  "successUrl": "url",
  "cancelUrl": "url"
}

// Response includes content details
{
  "sessionId": "stripe_session_id",
  "content": {
    "id": "uuid",
    "title": "string",
    "priceCents": 999
  }
}
```

**P1-ADMIN-001** (Admin Dashboard):
- **Consumes**: `content` and `media_items` tables for platform overview
- **Access Pattern**: Platform owners can view ALL content (not creator-scoped)
- **Query Differences**:
```typescript
// Admin queries DON'T filter by creatorId
const allContent = await db.query.content.findMany({
  where: and(
    isNull(content.deletedAt),
    filters.status ? eq(content.status, filters.status) : undefined
  ),
  with: {
    creator: true,    // Join to show creator info
    mediaItem: true,  // Join to show media details
  },
});
```
- **Fields Read**: All fields + creator name + media details
- **Use Case**: Platform analytics, moderation, support

### Error Propagation

| Service Error | HTTP Status | Error Code | Downstream Impact |
|---------------|-------------|------------|-------------------|
| `MEDIA_NOT_FOUND` | 404 | `MEDIA_NOT_FOUND` | Creator cannot create content without uploaded media |
| `MEDIA_NOT_READY` | 400 | `MEDIA_NOT_READY` | Creator must wait for transcoding to complete |
| `CONTENT_TYPE_MISMATCH` | 400 | `CONTENT_TYPE_MISMATCH` | Video media cannot be used for audio content |
| `CONTENT_NOT_FOUND` | 404 | `CONTENT_NOT_FOUND` | Access/Checkout services fail gracefully |
| `VALIDATION_ERROR` | 400 | `VALIDATION_ERROR` | Client receives field-level validation errors |
| `INTERNAL_ERROR` | 500 | `INTERNAL_ERROR` | Logged to observability, generic error to client |

### Business Rules

1. **Media Ownership**: Content can only reference media owned by same creator
   - Enforced in service: `eq(mediaItems.creatorId, creatorId)`
   - Prevents creators from using others' media

2. **Media Readiness**: Content cannot be published until media is transcoded
   - Enforced in service: `if (mediaItem.status !== 'ready') throw Error('MEDIA_NOT_READY')`
   - Ensures playback works before content goes live

3. **Content Type Matching**: Video content must use video media, audio content must use audio media
   - Enforced in service: Type validation before insert
   - Prevents mismatched content types

4. **Organization vs Personal**: Content with `organizationId` belongs to org, NULL = personal
   - Query pattern: Filter by `organizationId` when listing org content
   - Creator can have both org and personal content

5. **Slug Uniqueness**: Slug must be unique per organization
   - Database constraint: `unique().on(table.slug, table.organizationId)`
   - Used for SEO-friendly URLs

6. **Soft Delete**: Content is never hard-deleted
   - Update `deleted_at` timestamp
   - All queries filter `isNull(deletedAt)`

### Data Flow Examples

**Creating Content**:
```
Client                Content API           Content Service       Database
  |                       |                       |                   |
  | POST /api/content     |                       |                   |
  |---------------------->|                       |                   |
  |                       | validate input        |                   |
  |                       |---------------------->|                   |
  |                       |                       | check media exists|
  |                       |                       |------------------>|
  |                       |                       |<------------------|
  |                       |                       | insert content    |
  |                       |                       |------------------>|
  |                       |<----------------------|                   |
  |<----------------------|                       |                   |
```

**Publishing Content** (triggers downstream access):
```
Content Service         Database            Access Service
  |                       |                       |
  | publish(id)           |                       |
  |---------------------->|                       |
  | UPDATE status='published' |                  |
  | SET published_at      |                       |
  |---------------------->|                       |
  |                       | (event trigger)       |
  |                       |---------------------->|
  |                       |    check published    |
  |                       |<----------------------|
```

---

## Business Context

### Why This Matters

Content management is the **core value proposition** of the platform - creators upload media, package it as content, and monetize it. This work packet enables:

1. **Creator Workflow**: Upload → Transcode → Package as Content → Publish → Monetize
2. **Media Library Pattern**: Reusable media items (one upload, multiple content pieces)
3. **Organization Support**: Content can belong to org or personal profile
4. **Monetization Foundation**: Sets pricing, visibility, and purchase requirements

### User Personas

**Creator (Primary)**:
- Uploads videos/audio via P1-TRANSCODE-001
- Creates content referencing media items
- Sets category, tags, pricing, visibility
- Publishes content to make it accessible
- Can create org content or personal content

**Platform Owner** (via P1-ADMIN-001):
- Views all content across platform
- Monitors content creation metrics
- Moderates published content (future)
- Analyzes content performance

**Customer** (via P1-ACCESS-001 + P1-ECOM-001):
- Discovers published content
- Purchases paid content
- Accesses purchased/public content
- Does NOT interact with content service directly (read-only access service)

### Business Rules (Expanded)

**Content Lifecycle**:
```
draft → published → archived
  ↓
deleted (soft delete, any time)
```

**Visibility Levels** (Phase 1):
- `public`: Anyone can view (no purchase required)
- `purchased_only`: Must purchase to view (default)

**Pricing Rules**:
- `price_cents IS NULL`: Free content
- `price_cents = 0`: Free content (explicit)
- `price_cents > 0`: Paid content (integer cents, max $100,000)

**Organization Scoping**:
- Creator creates content for their organization: `organizationId = user.organizationId`
- Creator creates personal content: `organizationId = NULL`
- Querying org content: Filter by `organizationId`
- Querying all creator content: Filter by `creatorId` only

---

## Security Considerations

### Authentication & Authorization

**Layer 1: API Authentication**:
- All endpoints require `requireAuth()` middleware
- JWT token validated, user context injected
- No anonymous content creation

**Layer 2: Creator Scoping**:
- Service enforces creator ownership: `eq(content.creatorId, creatorId)`
- Creator can only CRUD their own content
- No cross-creator access in Phase 1

**Layer 3: Media Ownership Validation**:
- Before creating content, verify media belongs to creator
- Query: `eq(mediaItems.creatorId, creatorId)`
- Prevents using others' media

**Layer 4: Organization Scoping** (when applicable):
- If `user.organizationId` provided, content belongs to org
- Creator can create personal content by omitting org
- Admin queries bypass creator scope (platform owner only)

### Data Access Controls

**Read Access**:
- Creator can read: Own content (filter by `creatorId`)
- Platform owner can read: All content (via P1-ADMIN-001)
- Customer can read: Published content (via P1-ACCESS-001, different service)

**Write Access**:
- Creator can write: Own content only
- Platform owner can write: None (read-only admin, moderation in Phase 2)
- Customer can write: None

### Soft Delete Protection

- Deleted content remains in DB with `deleted_at` timestamp
- All queries filter `isNull(deleted_at)`
- Prevents accidental hard deletes
- Enables undelete in future phases

### PII and Logging

**No PII in Logs**:
- Log only: `userId`, `contentId`, `organizationId`, `slug`
- Never log: email, title (could contain PII), description

**Observability Pattern**:
```typescript
obs.info('Content created', {
  contentId: newContent.id,
  creatorId,
  organizationId: organizationId || 'personal',
  slug: newContent.slug, // Safe - no PII
});
```

### Threat Scenarios

| Threat | Mitigation |
|--------|------------|
| Unauthorized content creation | `requireAuth()` middleware blocks anonymous requests |
| Cross-creator content access | Service filters all queries by `creatorId` |
| Using others' media | Media ownership check before content creation |
| Slug squatting | Unique constraint per organization prevents conflicts |
| Mass content deletion | Soft delete + audit log (future) |
| Price manipulation | Validation limits max price, integer cents prevents precision errors |

---

## Performance Considerations

### Database Indexes

**Critical Indexes** (from schema):
```sql
-- Creator-scoped queries (most common)
CREATE INDEX idx_content_creator_id ON content(creator_id);
CREATE INDEX idx_media_items_creator_id ON media_items(creator_id);

-- Organization-scoped queries
CREATE INDEX idx_content_organization_id ON content(organization_id);

-- Published content queries (for access service)
CREATE INDEX idx_content_published_at ON content(published_at);
CREATE INDEX idx_content_status ON content(status);

-- Slug lookups
CREATE INDEX idx_content_slug ON content(slug, organization_id);

-- Category filtering
CREATE INDEX idx_content_category ON content(category);

-- Media type filtering
CREATE INDEX idx_media_items_type ON media_items(creator_id, media_type);
CREATE INDEX idx_media_items_status ON media_items(creator_id, status);
```

**Index Usage**:
- `creator_id` index: Used in 90% of queries (creator-scoped)
- `slug` composite index: SEO-friendly URL lookups
- `published_at` index: Access service filtering
- `status` index: Draft/published filtering

### Query Optimization

**List Content** (most frequent query):
```typescript
// Uses indexes: creator_id, status, category
const items = await db.query.content.findMany({
  where: and(
    eq(content.creatorId, creatorId),    // Index seek
    isNull(content.deletedAt),            // Filter
    eq(content.status, 'published'),      // Index seek
    eq(content.category, 'tutorials'),    // Index seek
  ),
  limit: 20,
  offset: 0,
  orderBy: [desc(content.createdAt)],
});
```

**Expected Performance**:
- List queries: < 50ms (indexed creator_id + status)
- Single content fetch: < 10ms (primary key lookup)
- Media validation: < 20ms (indexed media_items.id + creator_id)

### Expected Load (Phase 1)

- **Content Creation**: ~10-100 per day (creator activity)
- **Content Reads**: ~1,000-10,000 per day (via access service)
- **Media Validation**: Same as content creation
- **List Queries**: ~100-500 per day (creator dashboard)

**Database Sizing**:
- `content` table: ~1,000 rows (Phase 1)
- `media_items` table: ~1,000 rows (Phase 1)
- Total storage: < 1 MB (metadata only, media in R2)

### Caching Strategy (Future)

Phase 1: No caching (query performance sufficient)

Future Phases:
- Cache published content metadata (Redis)
- Cache creator content lists (5-minute TTL)
- Invalidate on publish/unpublish/update

---

## Monitoring & Observability

### Logging Strategy

**Service Logs** (ObservabilityClient):
```typescript
// Creation
obs.info('Content created', {
  contentId: newContent.id,
  creatorId,
  organizationId: organizationId || 'personal',
  slug: newContent.slug,
});

// Publishing
obs.info('Content published', {
  contentId: id,
  creatorId,
});

// Errors
obs.trackError(err, {
  userId: user.id,
  contentId: id,
  operation: 'update',
});
```

**API Logs**:
```typescript
// Request context
obs.info('Content API request', {
  method: 'POST',
  path: '/api/content',
  userId: user.id,
  organizationId: user.organizationId,
});

// Response
obs.info('Content API response', {
  statusCode: 201,
  contentId: content.id,
  userId: user.id,
});
```

### Metrics to Track

**Content Metrics**:
- `content.created.count` - Total content created (by creator, by org)
- `content.published.count` - Total published content
- `content.deleted.count` - Soft-deleted content
- `content.price.avg` - Average content price
- `content.category.distribution` - Histogram of categories

**Media Metrics**:
- `media.upload.count` - Media items created
- `media.ready.count` - Transcoding completed
- `media.failed.count` - Transcoding failures
- `media.type.distribution` - Video vs audio

**API Metrics**:
- `api.content.requests.count` - By endpoint
- `api.content.latency.p95` - 95th percentile latency
- `api.content.errors.count` - By error code

### Alerts

**Critical Alerts**:
- `api.content.errors.rate > 5%` - High error rate
- `api.content.latency.p95 > 500ms` - Slow queries
- `media.failed.count > 10/hour` - Transcoding issues

**Warning Alerts**:
- `content.published.count = 0` for 24h - No creator activity
- `api.content.requests.rate > 1000/min` - Unusual spike

### Dashboard Queries

**Content Overview**:
```sql
-- Total content by status
SELECT status, COUNT(*) FROM content WHERE deleted_at IS NULL GROUP BY status;

-- Content by category
SELECT category, COUNT(*) FROM content WHERE deleted_at IS NULL GROUP BY category;

-- Average price
SELECT AVG(price_cents) FROM content WHERE price_cents IS NOT NULL AND deleted_at IS NULL;
```

**Creator Activity**:
```sql
-- Top creators by content count
SELECT creator_id, COUNT(*) as content_count
FROM content
WHERE deleted_at IS NULL
GROUP BY creator_id
ORDER BY content_count DESC
LIMIT 10;
```

---

## Rollout Plan

### Pre-Deployment

1. **Database Migration**:
```bash
# Generate migration
pnpm --filter @codex/database db:gen:drizzle

# Review SQL (should match database-schema.md v2.0)
cat packages/database/drizzle/000X_content_schema.sql

# Apply to staging DB
DATABASE_URL=<staging> pnpm --filter @codex/database db:migrate

# Verify tables exist
psql <staging_db> -c "\dt content media_items"
```

2. **Seed Test Data** (optional, for staging):
```sql
-- Insert test media item
INSERT INTO media_items (id, creator_id, title, media_type, status, r2_key)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '<test_creator_id>',
  'Test Video',
  'video',
  'ready',
  'originals/test/video.mp4'
);

-- Insert test content
INSERT INTO content (id, creator_id, media_item_id, title, slug, content_type, status)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  '<test_creator_id>',
  '00000000-0000-0000-0000-000000000001',
  'Test Content',
  'test-content',
  'video',
  'draft'
);
```

3. **Verify Dependencies**:
```bash
# Ensure auth middleware exists
ls workers/*/src/middleware/auth.ts

# Ensure observability client exists
ls packages/observability/src/client.ts

# Ensure database client exists
ls packages/database/src/client.ts
```

### Deployment Steps

1. **Deploy Database Migration**:
   - CI automatically runs migrations on merge to main
   - Verify migration applied: Check `drizzle_migrations` table

2. **Deploy Code**:
   - Merge feature branch to main
   - CI builds and deploys to staging
   - Smoke test: `curl -X POST https://staging.codex.app/api/content -H "Authorization: Bearer <token>"`

3. **Verify Integration**:
   - Test content creation via API
   - Verify media validation works
   - Test publish/unpublish flow
   - Verify soft delete

4. **Monitor**:
   - Watch logs for errors
   - Check metrics dashboard
   - Verify no performance degradation

### Rollback Plan

**If Issues Detected**:
1. **Code Rollback**: Revert deploy via CI (redeploy previous version)
2. **Database Rollback** (if schema issues):
```sql
-- Drop tables (only if no data!)
DROP TABLE content CASCADE;
DROP TABLE media_items CASCADE;

-- Revert migration
DELETE FROM drizzle_migrations WHERE name = '000X_content_schema';
```

**Rollback Criteria**:
- Error rate > 10%
- Latency p95 > 1 second
- Database deadlocks or constraint violations
- Integration failures with P1-ACCESS-001 or P1-ECOM-001

---

## Known Limitations (Phase 1)

### Simplified Schema

1. **Category as String**:
   - Phase 1: Simple `category VARCHAR(100)` field
   - Limitation: No category validation, typos possible
   - Future: Normalize to `categories` table with FK constraint

2. **Tags as JSONB Array**:
   - Phase 1: `tags JSONB` array of strings
   - Limitation: No tag validation, duplicates possible, hard to query efficiently
   - Future: Normalize to `tags` and `content_tags` tables

3. **No Tag Search**:
   - Phase 1: Cannot efficiently search by tag (JSONB query)
   - Future: Normalized tags enable `JOIN` for tag filtering

### Missing Features

1. **No Written Content**:
   - Phase 1: Only video and audio (`content_type = 'video' | 'audio'`)
   - Future: Add `content_type = 'written'` with rich text editor

2. **No Content Series**:
   - Phase 1: Content items are standalone
   - Future: Add `series` table and `content.series_id` FK

3. **No Content Versioning**:
   - Phase 1: Updates overwrite existing data
   - Future: Add `content_versions` table for history

4. **No Bulk Operations**:
   - Phase 1: Must create/update/delete one at a time
   - Future: Add bulk endpoints for creator efficiency

### Technical Debt

1. **No Caching**:
   - Phase 1: Direct database queries
   - Impact: Higher DB load, slower reads
   - Future: Add Redis cache for published content

2. **No Full-Text Search**:
   - Phase 1: Basic `LIKE` queries (not implemented yet)
   - Future: Add PostgreSQL full-text search or Algolia

3. **No Content Analytics**:
   - Phase 1: Only `view_count` and `purchase_count` counters
   - Future: Add `content_views` table for detailed analytics

---

## Questions & Clarifications

### Resolved

**Q: Should category be normalized or simple string?**
A: Phase 1 uses simple string (`category VARCHAR(100)`). Database-schema.md v2.0 specifies this. Normalize in Phase 2+ when category management is needed.

**Q: How should tags be stored?**
A: Phase 1 uses JSONB array (`tags JSONB DEFAULT '[]'`). Database-schema.md v2.0 specifies this. Normalize to many-to-many in Phase 2+ for efficient tag search.

**Q: Should content type match media type?**
A: Yes, service validates `contentType === mediaType` before creation. Video content must use video media, audio content must use audio media.

**Q: Can creator use others' media?**
A: No, service enforces `eq(mediaItems.creatorId, creatorId)`. Media ownership is validated before content creation.

**Q: What happens if media is deleted?**
A: Media is soft-deleted (`deleted_at` timestamp). Content referencing deleted media can still exist but cannot be published (validation checks `isNull(mediaItems.deletedAt)`).

### Open

**Q: Should slug be auto-generated or user-provided?**
Decision needed: Auto-generate from title (e.g., `slugify(title)`) or let user provide custom slug?
- **Recommendation**: User-provided (like in schema), with validation regex `/^[a-z0-9-]+$/`
- **Reason**: Gives creator control over SEO-friendly URLs

**Q: Should thumbnail_url be validated?**
Current: Optional string, no validation beyond Zod `.url()`
- **Question**: Should we validate thumbnail exists in R2?
- **Recommendation**: Phase 1 - trust user input. Phase 2 - add R2 validation.

**Q: How to handle slug conflicts?**
Database enforces unique slug per organization. If conflict:
- **Current**: Database throws error, API returns 500
- **Recommendation**: Catch unique constraint error, return 409 Conflict with helpful message

---

## Success Criteria

### Functional Goals

- [ ] Creator can create content referencing uploaded media
- [ ] Creator can set title, slug, description, category, tags, pricing, visibility
- [ ] Creator can publish content (sets status + published_at)
- [ ] Creator can unpublish content (reverts to draft)
- [ ] Creator can update content metadata
- [ ] Creator can soft-delete content
- [ ] Creator can list their content with filters (status, category, type)
- [ ] Media ownership is validated (cannot use others' media)
- [ ] Content type matches media type (video/audio)
- [ ] Slug uniqueness per organization is enforced

### Non-Functional Goals

- [ ] API latency p95 < 200ms (content creation, list queries)
- [ ] Database queries use indexes efficiently
- [ ] All operations logged to observability (no PII)
- [ ] 100% test coverage for validation schemas
- [ ] 80%+ test coverage for service logic
- [ ] Integration tests cover end-to-end flows
- [ ] API endpoints return proper error codes
- [ ] Soft delete prevents data loss

### Business Goals

- [ ] P1-ACCESS-001 can query published content
- [ ] P1-ECOM-001 can create checkout for paid content
- [ ] P1-ADMIN-001 can view all platform content
- [ ] Creator workflow is intuitive (upload → transcode → create → publish)
- [ ] Media library pattern enables content reuse
- [ ] Organization vs personal content is clear

---

## Related Documentation

**Database Schema** (Source of Truth):
- [database-schema.md](../../features/shared/database-schema.md) - v2.0
  - Lines 130-183: `media_items` table
  - Lines 185-254: `content` table
  - Lines 256-281: `organizations` table
  - Lines 65-127: `users` table (creator_id FK)

**Architecture & Patterns**:
- [STANDARDS.md](../STANDARDS.md) - Coding patterns
  - § 1.2: Validation separation (Zod schemas separate from DB)
  - § 2.1: Service layer patterns (dependency injection)
  - § 3.1: Error handling (error codes, observability)
- [Multi-Tenant Architecture](../../core/MULTI_TENANT_ARCHITECTURE.md) - Organization scoping
  - § 2: Organization vs personal content
  - § 4: Creator scoping patterns
- [R2 Storage Patterns](../../core/R2_STORAGE_PATTERNS.md) - Media file organization
  - § 1: Bucket structure (creator buckets)
  - § 3: Media item R2 keys

**Testing Strategy**:
- [content-testing-definition.md](../testing/content-testing-definition.md) - Test specifications
  - Lines 22-113: Validation test patterns
  - Lines 116-257: Service test patterns (mocked DB)
  - Lines 260-345: Integration test patterns (real DB)
  - Lines 348-387: Test data factories
- [Testing.md](../../infrastructure/Testing.md) - General testing approach
  - § 2: Unit vs integration tests
  - § 4: CI test execution (Neon ephemeral branches)

**Feature Specifications**:
- [ttd-dphase-1.md](../../features/content-management/ttd-dphase-1.md) - Content management requirements
  - § 1: Creator workflows
  - § 3: Media library pattern
  - § 5: Content lifecycle (draft → published)

**Related Work Packets**:
- [P1-TRANSCODE-001](./P1-TRANSCODE-001-media-transcoding.md) - Media upload and transcoding (upstream)
- [P1-ACCESS-001](./P1-ACCESS-001-content-access.md) - Content access control (downstream)
- [P1-ECOM-001](./P1-ECOM-001-stripe-checkout.md) - Checkout for paid content (downstream)
- [P1-ADMIN-001](./P1-ADMIN-001-admin-dashboard.md) - Admin content management (downstream)

**Code Examples**:
- Auth middleware: `workers/auth/src/middleware/auth.ts` - Hono auth pattern
- Validation: `packages/validation/src/user-schema.ts` - Zod schema examples
- Service: `packages/content/src/service.ts` - Dependency injection pattern
- Tests: `packages/validation/src/user-schema.test.ts` - Pure validation tests

**Infrastructure**:
- [CI/CD Guide](../../infrastructure/CICD.md) - Deployment automation
  - § 3: Path-based test filtering
  - § 5: Neon ephemeral branches for integration tests
- [Observability](../../infrastructure/Observability.md) - Logging and metrics
  - § 2: PII redaction patterns
  - § 4: Error tracking

---

## Notes for LLM Developer

### Critical Patterns

1. **Validation First**: Write validation schemas and tests BEFORE touching database
   - Pure functions, no DB dependency
   - 100% coverage requirement
   - Located in `packages/validation/`

2. **Separation of Concerns**:
   - Validation: `packages/validation/` (Zod schemas)
   - Business logic: `packages/content/src/service.ts` (ContentService)
   - API layer: `workers/content-api/src/routes/content.ts` (Hono endpoints)
   - Never mix validation and DB operations!

3. **Creator Scoping**: ALWAYS filter by `creatorId`
   - Every query must include: `eq(content.creatorId, creatorId)`
   - Service methods take `creatorId` parameter
   - API passes `user.id` from auth context

4. **Media Ownership Validation**: Before creating content
   - Query media: `eq(mediaItems.creatorId, creatorId)`
   - Check status: `mediaItem.status === 'ready'`
   - Check type: `contentType matches mediaType`

5. **Soft Delete**: Never hard delete
   - Update: `SET deleted_at = NOW()`
   - Query: `AND deleted_at IS NULL`
   - Enables undelete in future

### Common Pitfalls

1. **Forgetting to validate media ownership**:
   ```typescript
   // ❌ WRONG - doesn't check creator owns media
   const mediaItem = await db.query.mediaItems.findFirst({
     where: eq(mediaItems.id, mediaItemId),
   });

   // ✅ CORRECT - validates creator ownership
   const mediaItem = await db.query.mediaItems.findFirst({
     where: and(
       eq(mediaItems.id, mediaItemId),
       eq(mediaItems.creatorId, creatorId),
       isNull(mediaItems.deletedAt)
     ),
   });
   ```

2. **Using DECIMAL for money**:
   ```typescript
   // ❌ WRONG - DECIMAL has precision issues
   priceCents: decimal('price_cents', { precision: 10, scale: 2 })

   // ✅ CORRECT - INTEGER cents (ACID-compliant)
   priceCents: integer('price_cents')
   ```

3. **Forgetting soft delete filter**:
   ```typescript
   // ❌ WRONG - returns deleted content
   where: eq(content.creatorId, creatorId)

   // ✅ CORRECT - excludes deleted
   where: and(
     eq(content.creatorId, creatorId),
     isNull(content.deletedAt)
   )
   ```

4. **Logging PII**:
   ```typescript
   // ❌ WRONG - logs title (could contain PII)
   obs.info('Content created', { title: content.title });

   // ✅ CORRECT - only logs IDs
   obs.info('Content created', { contentId: content.id });
   ```

5. **Mixing validation and DB**:
   ```typescript
   // ❌ WRONG - validation inside service
   async create(input: any) {
     if (!input.title) throw new Error('Title required');
     // ... DB operations
   }

   // ✅ CORRECT - validate before service
   async create(input: CreateContentInput) {
     const validated = createContentSchema.parse(input);
     // ... DB operations
   }
   ```

### Testing Checklist

- [ ] Validation tests run WITHOUT database (pure functions)
- [ ] Service tests mock database (fast unit tests)
- [ ] Integration tests use real database (ephemeral Neon branches in CI)
- [ ] All error paths tested (MEDIA_NOT_FOUND, CONTENT_NOT_FOUND, etc.)
- [ ] Organization scoping tested (org vs personal content)
- [ ] Soft delete behavior tested (queries exclude deleted)

### If Stuck

- **Schema questions**: Check `design/features/shared/database-schema.md` lines 130-254
- **Validation patterns**: Check `packages/validation/src/user-schema.ts` (example)
- **Testing patterns**: Check `design/roadmap/testing/content-testing-definition.md`
- **Auth context**: Check `workers/auth/src/middleware/auth.ts`
- **Standards**: Check `STANDARDS.md` § 1.2 (validation), § 2.1 (services)

**Finding Documentation**: Use Context-7 map or [CONTEXT_MAP.md](../CONTEXT_MAP.md) for architecture navigation.

---

## Step 7: Public API & Package Exports

**Package Configuration**:

**File**: `packages/content-management/package.json`

```json
{
  "name": "@codex/content-management",
  "version": "1.0.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./service": "./src/service.ts"
  },
  "dependencies": {
    "@codex/database": "workspace:*",
    "@codex/observability": "workspace:*",
    "@codex/validation": "workspace:*",
    "drizzle-orm": "^0.29.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "vitest": "^1.0.0"
  }
}
```

**Public Interface**:

**File**: `packages/content-management/src/index.ts`

```typescript
/**
 * @codex/content-management
 *
 * Content creation and management service for Codex platform.
 *
 * Core Responsibilities:
 * - Create, update, delete content (soft delete)
 * - List content by creator or organization
 * - Manage content metadata (title, description, pricing, visibility)
 * - Link content to transcoded media items
 *
 * Integration Points:
 * - Used by: Content management worker (creator endpoints)
 * - Depends on: @codex/database (content, media_items)
 * - Consumed by: P1-ACCESS-001 (content access), P1-ECOM-001 (purchase validation)
 *
 * Security Model:
 * - Creator ownership: Creators can only manage their own content
 * - Organization scoping: Content belongs to creator's organization
 * - Soft delete: deleted_at timestamp preserves data integrity
 */

export { ContentService, createContentService } from './service';
export type { ContentServiceConfig } from './service';

// Re-export validation schemas for convenience
export {
  createContentSchema,
  updateContentSchema,
  getContentSchema,
  listContentSchema,
  deleteContentSchema,
  type CreateContentInput,
  type UpdateContentInput,
  type GetContentInput,
  type ListContentInput,
  type DeleteContentInput,
} from '@codex/validation/schemas/content';
```

**Usage Examples**:

```typescript
// Example 1: Create content with pricing
import { createContentService } from '@codex/content-management';

const service = createContentService({
  DATABASE_URL: env.DATABASE_URL,
  ENVIRONMENT: env.ENVIRONMENT,
});

const content = await service.createContent(creatorId, {
  mediaItemId: 'uuid-media-item',
  title: 'Introduction to TypeScript',
  description: 'Learn TypeScript basics in 30 minutes',
  priceCents: 999, // $9.99
  visibility: 'public', // Listed in marketplace
  organizationId: null, // Personal content
});

// Example 2: Update content pricing
await service.updateContent(creatorId, contentId, {
  priceCents: 1499, // Change to $14.99
});

// Example 3: List creator's content
const { items, pagination } = await service.listContent(creatorId, {
  status: 'published',
  page: 1,
  limit: 20,
  sortBy: 'createdAt',
  sortOrder: 'desc',
});

// Example 4: Soft delete content
await service.deleteContent(creatorId, contentId);
// Sets deleted_at timestamp, preserves data for purchase history
```

---

## Step 8: Local Development Setup

### Docker Compose Integration

The content management service works seamlessly with the existing local development setup. No additional containers needed.

**Existing Services Used**:

1. **Neon Postgres** (`infrastructure/neon/docker-compose.dev.local.yml`):
   - Already provides local PostgreSQL with content and media_items tables
   - No changes needed

**Environment Configuration**:

**File**: `workers/content-management/.dev.vars`

```bash
# Database (uses local Neon proxy)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/main

# Environment
ENVIRONMENT=development

# JWT (for authenticating creators)
JWT_SECRET=your-local-jwt-secret
```

### Local Testing Flow

**Step 1: Start Database**:
```bash
cd infrastructure/neon
docker-compose -f docker-compose.dev.local.yml up -d
```

**Step 2: Run Migrations**:
```bash
pnpm --filter @codex/database db:migrate
```

**Step 3: Seed Test Data** (create test creator and media items):
```bash
# Seed database with test users and media items
pnpm --filter @codex/database db:seed

# Or manually create test creator
psql postgresql://postgres:postgres@localhost:5432/main -c "
  INSERT INTO users (id, email, role, organization_id)
  VALUES (
    'uuid-creator',
    'creator@test.com',
    'creator',
    'uuid-org'
  );

  INSERT INTO media_items (id, uploader_id, r2_key, content_type, status)
  VALUES (
    'uuid-media',
    'uuid-creator',
    'creator/hls/media/master.m3u8',
    'video',
    'ready'
  );
"
```

**Step 4: Start Content Management Worker**:
```bash
pnpm --filter content-management-worker dev
# Worker runs on http://localhost:8789
```

**Step 5: Test API** (requires creator JWT):
```bash
# Generate test JWT with role='creator'
# (Use your JWT generation script or tool)

# Create content
curl -X POST \
  -H "Authorization: Bearer CREATOR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "mediaItemId": "uuid-media",
    "title": "My Video",
    "description": "Test video",
    "priceCents": 999,
    "visibility": "public"
  }' \
  "http://localhost:8789/api/content"

# List creator's content
curl -H "Authorization: Bearer CREATOR_JWT" \
  "http://localhost:8789/api/content?status=draft"

# Update content
curl -X PATCH \
  -H "Authorization: Bearer CREATOR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"status": "published"}' \
  "http://localhost:8789/api/content/uuid"

# Delete content (soft delete)
curl -X DELETE \
  -H "Authorization: Bearer CREATOR_JWT" \
  "http://localhost:8789/api/content/uuid"
```

### Development Workflow

**Typical Developer Day**:

1. Start local database (one-time)
2. Work on content-management package in isolation:
   ```bash
   # Run tests in watch mode
   pnpm --filter @codex/content-management test --watch

   # Type check
   pnpm --filter @codex/content-management typecheck
   ```
3. Test integration with content worker:
   ```bash
   pnpm --filter content-management-worker dev
   # Make changes, worker auto-reloads
   ```
4. Run full test suite before committing:
   ```bash
   pnpm test
   ```

**No External Services Required**:
- Database: Local PostgreSQL via Docker
- Auth: Local JWT signing with role='creator'
- No Stripe, no R2, no email service needed

---

## Step 9: CI/CD Integration

### CI Pipeline

Content management tests run automatically when:
- Any file in `packages/content-management/**` changes
- Any file in `packages/validation/src/schemas/content.ts` changes
- Any file in `workers/content-management/src/**` changes
- Any file in `packages/database/src/schema/content.ts` changes

**GitHub Actions Workflow** (already configured in `.github/workflows/test.yml`):

```yaml
# Path-based test filtering (already in place)
- name: Run content management tests
  if: contains(github.event.head_commit.message, 'content-management') ||
      contains(github.event.modified_files, 'packages/content-management') ||
      contains(github.event.modified_files, 'workers/content-management') ||
      contains(github.event.modified_files, 'packages/database/src/schema/content')
  run: |
    # Validation tests (fast, no DB)
    pnpm --filter @codex/validation test -- content.test.ts

    # Service tests (mocked DB)
    pnpm --filter @codex/content-management test

    # Integration tests (test DB with Neon branch)
    pnpm --filter content-management-worker test:integration
```

### Test Environment Setup

**CI Environment Variables** (GitHub Secrets):
```bash
# Test Database (Neon branch created per PR)
TEST_DATABASE_URL=postgresql://...

# JWT Secret (for creator auth tests)
JWT_SECRET=test-secret-key

# Environment
ENVIRONMENT=test
```

**Neon Database Branching** (per design/infrastructure/CICD.md):
```bash
# Create test branch from main
neon branches create --name "test-pr-${PR_NUMBER}" --parent main

# Run migrations
DATABASE_URL=$TEST_DATABASE_URL pnpm db:migrate

# Seed test data (creators, media items)
DATABASE_URL=$TEST_DATABASE_URL pnpm db:seed

# Run tests
DATABASE_URL=$TEST_DATABASE_URL pnpm test

# Cleanup: Delete branch after tests
neon branches delete "test-pr-${PR_NUMBER}"
```

### Deployment Pipeline

**Staging Deployment** (on push to `main`):
```yaml
- name: Deploy content management worker to staging
  run: |
    cd workers/content-management
    wrangler deploy --env staging

    # Smoke test
    curl -f https://staging-content.codex.app/health || exit 1
```

**Production Deployment** (on tag `v*`):
```yaml
- name: Deploy content management worker to production
  run: |
    cd workers/content-management
    wrangler deploy --env production

    # Smoke test
    curl -f https://content.codex.app/health || exit 1
```

### Integration Test Strategy

**Test Data Isolation**:
- Each test creates its own creator, organization, and media items
- Tests use deterministic UUIDs for repeatability
- Cleanup after each test (or use Neon branches)

**Creator Authorization**:
- Tests generate JWT with `role: 'creator'` and `userId`
- Middleware validates creator ownership before allowing actions
- Tests verify creators can only manage their own content

**Example Integration Test**:
```typescript
// workers/content-management/src/routes/content.integration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';

describe('Content Management API', () => {
  let creatorJWT: string;
  let creatorId: string;
  let mediaItemId: string;

  beforeEach(async () => {
    // Seed test creator and media item
    ({ creatorJWT, creatorId, mediaItemId } = await seedCreator());
  });

  it('should create content', async () => {
    const response = await fetch('http://localhost:8789/api/content', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${creatorJWT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mediaItemId,
        title: 'Test Video',
        description: 'Test description',
        priceCents: 999,
        visibility: 'public',
      }),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.id).toBeDefined();
    expect(data.title).toBe('Test Video');
    expect(data.status).toBe('draft'); // Default status
  });

  it('should not allow creator to update another creator\'s content', async () => {
    // Create content as creator 1
    const content = await createContent(creatorJWT, mediaItemId);

    // Try to update as creator 2
    const otherCreatorJWT = await generateCreatorJWT('other-creator-id');

    const response = await fetch(`http://localhost:8789/api/content/${content.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${otherCreatorJWT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Hacked title' }),
    });

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error.code).toBe('FORBIDDEN');
  });

  it('should soft delete content', async () => {
    const content = await createContent(creatorJWT, mediaItemId);

    const response = await fetch(`http://localhost:8789/api/content/${content.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${creatorJWT}` },
    });

    expect(response.status).toBe(200);

    // Verify content is soft deleted (has deleted_at timestamp)
    const getResponse = await fetch(`http://localhost:8789/api/content/${content.id}`, {
      headers: { 'Authorization': `Bearer ${creatorJWT}` },
    });

    expect(getResponse.status).toBe(404); // Deleted content not accessible
  });
});
```

### Monitoring in CI/CD

**Test Coverage Requirements**:
- Validation tests: 100% coverage (enforced)
- Service tests: 100% coverage (enforced)
- Integration tests: No coverage requirement (end-to-end)

**Performance Benchmarks**:
- Content creation: < 200ms (P95)
- Content list query: < 300ms (P95)
- Content update: < 150ms (P95)

**CI Fails If**:
- Any test fails
- Coverage below threshold
- TypeScript errors
- Linting errors
- Performance benchmarks exceeded
- Security: Creator can modify another creator's content

---

## Integration Points Summary

### Package Dependencies

```
@codex/content-management
├── @codex/database (content, media_items tables)
├── @codex/observability (logging, metrics)
└── @codex/validation (Zod schemas)
```

### Used By

**1. Content Management Worker** (`workers/content-management`):
- Routes: `/api/content` (CRUD operations)
- Purpose: Creator interface for managing content

**2. P1-ACCESS-001** (Content Access):
- Queries: `content` table to verify published status, pricing
- Purpose: Access control for streaming

**3. P1-ECOM-001** (Stripe Checkout):
- Queries: `content` table to get pricing, creator info
- Purpose: Create Stripe checkout sessions

**4. P1-ADMIN-001** (Admin Dashboard):
- Queries: `content` table for analytics
- Purpose: Platform owner visibility into all content

### Upstream Dependencies

**1. P1-TRANSCODE-001** (Media Transcoding):
- Tables: `media_items` (referenced by content.media_item_id)
- Fields: `id`, `r2_key`, `content_type`, `status`, `duration_seconds`
- Flow: Upload → transcode → create media_item → create content

**2. Auth Service**:
- Middleware: `requireAuth()`, `requireCreator()`
- JWT: Must contain `role: 'creator'` and `userId`

**3. Database**:
- Schema v2.0 (`design/features/shared/database-schema.md`)
- Tables: `content` (lines 185-254), `media_items` (lines 130-184)
- Organization scoping: All content has `organization_id`

### Data Flow Diagram

```
Creator
    |
    | 1. POST /api/content
    |    (Authorization: Bearer JWT with role=creator)
    |
Content Management Worker
    |
    | 2. Middleware: requireAuth() + requireCreator()
    |    - Verify JWT
    |    - Check user.role === 'creator'
    |    - Extract user.id (creatorId)
    |
@codex/content-management (ContentService)
    |
    | 3. Validate input with Zod
    |    - Check mediaItemId exists and belongs to creator
    |    - Validate title, description, pricing
    |
    | 4. Create content record
    |    INSERT INTO content (creator_id, media_item_id, ...)
    |    VALUES (?, ?, ...)
    |
Database
    |
    | 5. Return new content ID
    |
Creator
```

---

---

## ACTUAL IMPLEMENTATION DETAILS

This section documents how the implementation differs from and improves upon the original specification.

### Database Schema Implementation

**Location**: `packages/database/src/schema/content.ts`

**Key Differences**:
1. **User ID Type**: Uses `text('creator_id')` instead of `uuid('creator_id')` to match Clerk Auth string-based user IDs
2. **Organization Deletion Trigger**: Added database trigger to cascade soft-delete organizations to content
3. **CHECK Constraints**: Added database-level validation for `status`, `visibility`, and `content_type` enums

**Actual Schema**:
```typescript
// lines 22-45: organizations table with deletion trigger
export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerId: text('owner_id').notNull().references(() => users.id),
  // ... soft delete support
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// lines 53-105: mediaItems with CHECK constraints
export const mediaItems = pgTable('media_items', {
  // ... fields
  status: text('status').notNull().default('uploading'),
}, (table) => ({
  statusCheck: check('status_check',
    sql`${table.status} IN ('uploading', 'uploaded', 'transcoding', 'ready', 'failed')`
  ),
}));

// lines 112-211: content with CHECK constraints
export const content = pgTable('content', {
  // ... fields
  contentType: text('content_type').notNull(),
  visibility: text('visibility').notNull().default('purchased_only'),
  status: text('status').notNull().default('draft'),
}, (table) => ({
  contentTypeCheck: check('content_type_check',
    sql`${table.contentType} IN ('video', 'audio', 'written')`
  ),
  visibilityCheck: check('visibility_check',
    sql`${table.visibility} IN ('public', 'private', 'members_only', 'purchased_only')`
  ),
  statusCheck: check('status_check',
    sql`${table.status} IN ('draft', 'published', 'archived')`
  ),
}));
```

### Validation Implementation

**Location**: `packages/validation/src/content-schemas.ts`

**Enhancements Beyond Spec**:
1. **Primitive Schemas**: Reusable validation primitives in `packages/validation/src/primitives.ts`
2. **XSS Prevention**: Automatic sanitization of text inputs (line 46)
3. **Refinements**: Business logic validation in schemas (e.g., published content must have title)

**Actual Validation**:
```typescript
// lines 286-328: createContentSchema with refinements
export const createContentSchema = z.object({
  title: sanitizedString.min(1).max(500),
  slug: slug.min(1).max(500),
  description: sanitizedString.max(5000).optional(),
  contentType: z.enum(['video', 'audio', 'written']),
  mediaItemId: z.string().uuid(),
  category: sanitizedString.max(100).optional(),
  tags: z.array(sanitizedString.max(50)).max(10).default([]),
  visibility: z.enum(['public', 'private', 'members_only', 'purchased_only']).default('purchased_only'),
  priceCents: z.number().int().min(0).max(10000000).nullable().default(null),
}).refine(
  (data) => {
    // Published content must have valid media
    if (data.status === 'published' && !data.mediaItemId) {
      return false;
    }
    return true;
  },
  { message: 'Published content must have associated media' }
);
```

### Service Implementation

**Location**: `packages/content/src/services/content-service.ts`

**Major Improvements**:

1. **Custom Error Classes** (lines 31-38):
```typescript
export class ContentNotFoundError extends Error {
  constructor(id: string) {
    super(`Content with ID ${id} not found`);
    this.name = 'ContentNotFoundError';
  }
}
export class MediaNotReadyError extends Error { /* ... */ }
export class ContentTypeMismatchError extends Error { /* ... */ }
export class SlugConflictError extends Error { /* ... */ }
```

2. **Transaction Safety** (line 82):
```typescript
async create(input: CreateContentInput, creatorId: string, organizationId?: string) {
  return this.db.transaction(async (tx) => {
    // 1. Validate media ownership
    const media = await tx.query.mediaItems.findFirst({
      where: and(
        eq(mediaItems.id, input.mediaItemId),
        eq(mediaItems.creatorId, creatorId),
        isNull(mediaItems.deletedAt)
      ),
    });

    if (!media) throw new MediaNotFoundError(input.mediaItemId);
    if (media.status !== 'ready') throw new MediaNotReadyError(media.id);

    // 2. Create content
    const [content] = await tx.insert(content).values({ /* ... */ }).returning();

    return content;
  });
}
```

3. **Search Functionality** (lines 490-496):
```typescript
// Advanced query with search
if (filters.search) {
  whereConditions.push(
    or(
      ilike(content.title, `%${filters.search}%`),
      ilike(content.description, `%${filters.search}%`)
    )
  );
}
```

### API Implementation

**Location**: `workers/content-api/src/routes/content.ts`

**Key Difference - Route-Level Security**:

Original spec showed global auth middleware. Actual implementation uses route-level policies:

```typescript
// Specification (lines 765-777): Global middleware
app.use('*', requireAuth());
app.use('/api/content/*', requireRole('creator'));

// Actual Implementation (lines 47, 96, etc.): Route-level policies
app.post(
  '/',
  withPolicy(POLICY_PRESETS.creator()), // Applied per-route
  createAuthenticatedHandler({ /* ... */ })
);

app.get(
  '/:id',
  withPolicy(POLICY_PRESETS.authenticated()), // Different policy per route
  createAuthenticatedGetHandler({ /* ... */ })
);
```

**Benefits**:
- More granular control (different policies per endpoint)
- Better testability (can test policy separately)
- Follows `@codex/worker-utils` conventions

### Media Service (Not in Spec)

**Location**: `packages/content/src/services/media-service.ts`

**Why Separated**:
The specification combined media and content management. The implementation separates them for:
1. Single Responsibility Principle
2. Easier testing
3. Reusability (media service used by transcoding workflow)

**Key Methods**:
```typescript
class MediaItemService {
  async create(/* ... */) // Create media record after upload
  async get(/* ... */)    // Fetch media by ID
  async update(/* ... */) // Update media metadata
  async delete(/* ... */) // Soft delete media
  async list(/* ... */)   // List media with filters

  // Convenience methods
  async updateStatus(id: string, status: MediaStatus)
  async markAsReady(id: string, metadata: ReadyMetadata)
}
```

### Testing Implementation

**Actual Test Coverage**:

1. **Service Tests** (`packages/content/src/__tests__/`):
   - ✅ Content service unit tests
   - ✅ Media service unit tests
   - ✅ Error handling tests
   - ✅ Business logic validation

2. **Integration Tests** (`workers/content-api/src/__tests__/`):
   - ✅ Full authentication flow
   - ✅ Real database operations
   - ✅ Route-level security validation
   - ✅ Multi-tenant isolation

**Testing Approach**:
- Uses real Wrangler dev server (not Miniflare)
- Real authentication via `@codex/security` session management
- Neon database with ephemeral branches in CI

### Architecture Decisions

**1. Text vs UUID for User IDs**:
- **Decision**: Use `text` instead of `uuid`
- **Reason**: Clerk Auth provides string user IDs (not UUIDs)
- **Impact**: Database schema uses `text('creator_id')` instead of `uuid('creator_id')`

**2. Separate Media Service**:
- **Decision**: Split MediaItemService from ContentService
- **Reason**: Media lifecycle is independent of content lifecycle
- **Impact**: Better code organization, easier to test

**3. Route-Level Security Policies**:
- **Decision**: Use `withPolicy()` instead of global middleware
- **Reason**: More granular control, better follows worker-utils patterns
- **Impact**: Each route declares its own authentication/authorization requirements

**4. Transaction-Safe Operations**:
- **Decision**: Wrap multi-step operations in `db.transaction()`
- **Reason**: Ensure ACID compliance, prevent partial updates
- **Impact**: More reliable data integrity, better error handling

**5. Custom Error Classes**:
- **Decision**: Create domain-specific error classes
- **Reason**: Better error tracking, user-friendly messages, easier debugging
- **Impact**: API returns consistent error codes, observability has better context

---

**Last Updated**: 2025-11-15
**Version**: 3.0 (Documented actual implementation vs specification)

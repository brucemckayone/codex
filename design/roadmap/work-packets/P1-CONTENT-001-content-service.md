# Work Packet: P1-CONTENT-001 - Content Management Service

**Status**: 🚧 To Be Implemented
**Priority**: P0 (Critical - foundation for other features)
**Estimated Effort**: 5-7 days
**Branch**: `feature/P1-CONTENT-001-content-service`

---

## Current State

**✅ Already Implemented:**
- Database client (`packages/database/src/client.ts`) - Drizzle ORM + Neon
- R2 client (`packages/cloudflare-clients/src/r2/client.ts`) - File operations
- Validation package (`packages/validation/`) - Zod schemas
- Security middleware (`packages/security/`) - Headers, rate limiting
- Observability (`packages/observability/`) - Logging with PII redaction
- Test utilities (`packages/test-utils/`) - Factories, DB helpers

**🚧 Needs Implementation:**
- Content database schema (tables: content, media_items, categories, tags)
- Content validation schemas (Zod)
- Content service (business logic)
- Content API endpoints
- Tests (unit + integration)

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

**File**: `workers/content-api/src/index.ts` (or add to existing worker)

```typescript
import { Hono } from 'hono';
import { contentService } from '@codex/content';
import { securityHeaders, rateLimit, RATE_LIMIT_PRESETS } from '@codex/security';
import { createContentSchema } from '@codex/validation';

type Bindings = {
  DATABASE_URL: string;
  ENVIRONMENT: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', securityHeaders());
app.use('*', rateLimit(RATE_LIMIT_PRESETS.api));

// Create content
app.post('/api/content', async (c) => {
  try {
    // TODO: Get organizationId from session
    const organizationId = 'org-123'; // Placeholder

    const body = await c.req.json();
    const validated = createContentSchema.parse(body);

    const content = await contentService.create(validated, organizationId);

    return c.json({ data: content }, 201);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: err.errors } }, 400);
    }
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create content' } }, 500);
  }
});

// Get content by ID
app.get('/api/content/:id', async (c) => {
  const organizationId = 'org-123'; // TODO: From session
  const id = c.req.param('id');

  const content = await contentService.findById(id, organizationId);

  if (!content) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Content not found' } }, 404);
  }

  return c.json({ data: content });
});

// List content
app.get('/api/content', async (c) => {
  const organizationId = 'org-123'; // TODO: From session

  const filters = {
    status: c.req.query('status'),
    categoryId: c.req.query('categoryId'),
    limit: parseInt(c.req.query('limit') || '20'),
    offset: parseInt(c.req.query('offset') || '0'),
  };

  const result = await contentService.list(organizationId, filters);

  return c.json({ data: result });
});

// Publish content
app.post('/api/content/:id/publish', async (c) => {
  const organizationId = 'org-123'; // TODO: From session
  const id = c.req.param('id');

  const content = await contentService.publish(id, organizationId);

  return c.json({ data: content });
});

export default app;
```

---

## Test Specifications

### Unit Tests (No DB Required!)

**File**: `packages/validation/src/content-schemas.test.ts` (Already covered in Step 2)

### Integration Tests (With DB)

**File**: `packages/content/src/service.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { contentService } from './service';
import { createTestDb, createTestMediaItem, createTestCategory } from '@codex/test-utils';

describe('ContentService Integration', () => {
  let testDb;
  let organizationId: string;
  let mediaItemId: string;
  let categoryId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    organizationId = 'org-test-123';

    // Create test media item
    mediaItemId = await createTestMediaItem({
      organizationId,
      status: 'ready'
    });

    // Create test category
    categoryId = await createTestCategory();
  });

  it('should create content', async () => {
    const input = {
      title: 'Test Video',
      description: 'A test video description',
      mediaItemId,
      categoryId,
      priceCents: 999,
    };

    const content = await contentService.create(input, organizationId);

    expect(content.id).toBeDefined();
    expect(content.title).toBe('Test Video');
    expect(content.slug).toBe('test-video');
    expect(content.status).toBe('draft');
  });

  it('should reject content with non-existent media item', async () => {
    const input = {
      title: 'Test',
      description: 'Description',
      mediaItemId: 'nonexistent-id',
      categoryId,
      priceCents: 0,
    };

    await expect(
      contentService.create(input, organizationId)
    ).rejects.toThrow('Media item not found');
  });

  it('should generate unique slugs', async () => {
    const input = {
      title: 'Same Title',
      description: 'Description',
      mediaItemId,
      categoryId,
      priceCents: 0,
    };

    const content1 = await contentService.create(input, organizationId);
    const content2 = await contentService.create(input, organizationId);

    expect(content1.slug).toBe('same-title');
    expect(content2.slug).toBe('same-title-1');
  });

  it('should publish content', async () => {
    const input = {
      title: 'Publish Test',
      description: 'Description',
      mediaItemId,
      categoryId,
      priceCents: 999,
    };

    const content = await contentService.create(input, organizationId);
    const published = await contentService.publish(content.id, organizationId);

    expect(published.status).toBe('published');
    expect(published.publishedAt).toBeInstanceOf(Date);
  });

  it('should soft delete content', async () => {
    const input = {
      title: 'Delete Test',
      description: 'Description',
      mediaItemId,
      categoryId,
      priceCents: 0,
    };

    const content = await contentService.create(input, organizationId);
    await contentService.delete(content.id, organizationId);

    const found = await contentService.findById(content.id, organizationId);
    expect(found).toBeNull(); // Should not find deleted content
  });
});
```

---

## Definition of Done

- [ ] Content schema created in `packages/database/src/schema/content.ts`
- [ ] Migration generated and applied
- [ ] Validation schemas in `packages/validation/src/content-schemas.ts`
- [ ] Validation tests passing (100% coverage, no DB)
- [ ] Content service implemented in `packages/content/src/service.ts`
- [ ] Service integration tests passing (with test DB)
- [ ] API endpoints created (or added to existing worker)
- [ ] All organization-scoped queries use `organizationId` filter
- [ ] Slug generation handles duplicates
- [ ] Soft delete working
- [ ] Observability logging added
- [ ] CI passing (tests + typecheck + lint)
- [ ] Code reviewed against STANDARDS.md

---

## Integration Points

### Existing Packages Used
- `@codex/database` - DB client, will add content schema
- `@codex/cloudflare-clients` - R2 operations (for upload URLs in Step 5)
- `@codex/validation` - Will add content validation schemas
- `@codex/security` - API security middleware
- `@codex/observability` - Logging
- `@codex/test-utils` - Test helpers

### Future Integration
- **E-Commerce**: Will reference `content.priceCents` for checkout
- **Content Access**: Will check published status before granting access
- **Admin Dashboard**: Will list/manage all content

---

## Related Documentation

**Must Read**:
- [STANDARDS.md](../STANDARDS.md) - Coding patterns (especially § 1.2 on validation separation)
- [Database Schema Design](../../infrastructure/DATABASE_SCHEMA_DESIGN.md) - Table relationships
- [R2 Storage Patterns](../../core/R2_STORAGE_PATTERNS.md) - File organization
- [Multi-Tenant Architecture](../../core/MULTI_TENANT_ARCHITECTURE.md) - Organization scoping

**Reference**:
- [Content Management TDD](../../features/content-management/ttd-dphase-1.md) - Feature specification
- [Testing Strategy](../../infrastructure/Testing.md) - Test approach
- [CI/CD Guide](../../infrastructure/CICD.md) - How tests run

**Code Examples**:
- Auth worker: `workers/auth/src/index.ts` - Hono + middleware pattern
- Validation: `packages/validation/src/user-schema.ts` - Zod schemas
- Tests: `packages/validation/src/user-schema.test.ts` - Pure validation tests

---

## Notes for LLM Developer

1. **Validation First**: Write validation schemas and their tests BEFORE touching the database
2. **Separation of Concerns**: Keep validation logic in `packages/validation/`, DB operations in service
3. **Organization Scoping**: ALWAYS filter by `organizationId` in queries
4. **Test Without DB**: Validation tests should run without database connection
5. **Use Existing Packages**: Don't reinvent - use @codex packages for security, logging, etc.
6. **No Deployment**: CI/CD handles deployment automatically, just write code + tests

**If Stuck**: Check [CONTEXT_MAP.md](../CONTEXT_MAP.md) for finding documentation, or use Context-7 map for up-to-date architecture.

---

**Last Updated**: 2025-11-05

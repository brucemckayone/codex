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
 * Separate from DB operations for testability!
 */
export const createContentSchema = z.object({
  title: z.string().min(3).max(255),
  description: z.string().min(10).max(5000),
  mediaItemId: z.string().uuid(),
  categoryId: z.string().uuid(),
  tagIds: z.array(z.string().uuid()).max(10).optional(),
  priceCents: z.number().int().min(0).max(1000000), // Max $10,000
});

export const updateContentSchema = createContentSchema.partial();

export const uploadRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum(['video/mp4', 'video/quicktime', 'audio/mpeg', 'audio/wav']),
  fileSize: z.number().int().min(1).max(5 * 1024 * 1024 * 1024), // 5GB max
});

export type CreateContentInput = z.infer<typeof createContentSchema>;
export type UpdateContentInput = z.infer<typeof updateContentSchema>;
export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;
```

**Tests** (Pure validation, no DB!):

**File**: `packages/validation/src/content-schemas.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { createContentSchema, uploadRequestSchema } from './content-schemas';

describe('Content Validation', () => {
  describe('createContentSchema', () => {
    it('should validate valid input', () => {
      const input = {
        title: 'My Video',
        description: 'A great video about coding',
        mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
        categoryId: '123e4567-e89b-12d3-a456-426614174001',
        priceCents: 999,
      };

      const result = createContentSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject title too short', () => {
      const input = {
        title: 'AB', // Too short
        description: 'A great video',
        mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
        categoryId: '123e4567-e89b-12d3-a456-426614174001',
        priceCents: 999,
      };

      const result = createContentSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('title');
      }
    });

    it('should reject negative price', () => {
      const input = {
        title: 'My Video',
        description: 'A great video',
        mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
        categoryId: '123e4567-e89b-12d3-a456-426614174001',
        priceCents: -100, // Invalid
      };

      const result = createContentSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('uploadRequestSchema', () => {
    it('should validate video upload', () => {
      const input = {
        filename: 'video.mp4',
        contentType: 'video/mp4',
        fileSize: 1024 * 1024 * 100, // 100MB
      };

      const result = uploadRequestSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject file too large', () => {
      const input = {
        filename: 'huge.mp4',
        contentType: 'video/mp4',
        fileSize: 6 * 1024 * 1024 * 1024, // 6GB (over limit)
      };

      const result = uploadRequestSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject invalid content type', () => {
      const input = {
        filename: 'doc.pdf',
        contentType: 'application/pdf', // Not allowed
        fileSize: 1024,
      };

      const result = uploadRequestSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
```

### Step 3: Create Content Service

**File**: `packages/content/src/service.ts`

```typescript
import { db } from '@codex/database';
import { content, mediaItems, tags, contentTags, type Content, type MediaItem } from '@codex/database/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { createContentSchema, updateContentSchema, type CreateContentInput } from '@codex/validation';
import { ObservabilityClient } from '@codex/observability';

export interface IContentService {
  create(input: CreateContentInput, creatorId: string, organizationId?: string): Promise<Content>;
  findById(id: string, creatorId: string): Promise<Content | null>;
  update(id: string, input: Partial<CreateContentInput>, creatorId: string): Promise<Content>;
  publish(id: string, creatorId: string): Promise<Content>;
  delete(id: string, creatorId: string): Promise<void>;
  list(creatorId: string, organizationId?: string, filters?: ContentFilters): Promise<PaginatedContent>;
}

export interface ContentFilters {
  status?: 'draft' | 'published' | 'archived';
  categoryId?: string;
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
  private obs: ObservabilityClient;

  constructor() {
    this.obs = new ObservabilityClient('content-service', process.env.ENVIRONMENT || 'development');
  }

  async create(input: CreateContentInput, creatorId: string, organizationId?: string): Promise<Content> {
    // Step 1: Validate input (pure function, testable!)
    const validated = createContentSchema.parse(input);

    // Step 2: Verify media item exists and belongs to creator
    const mediaItem = await db.query.mediaItems.findFirst({
      where: and(
        eq(mediaItems.id, validated.mediaItemId),
        eq(mediaItems.creatorId, creatorId) // Media must be owned by creator
      ),
    });

    if (!mediaItem) {
      throw new Error('Media item not found or access denied');
    }

    if (mediaItem.status !== 'ready') {
      throw new Error('Media item not ready (still processing)');
    }

    // Step 3: If organizationId provided, verify creator belongs to org (Phase 2+)
    // Phase 1: organizationId is always the single org, skip check
    // Phase 2+: Check organization_members table

    // Step 4: Generate unique slug (unique per org OR per creator if personal)
    const slug = await this.generateUniqueSlug(validated.title, organizationId, creatorId);

    // Step 5: Create content
    const [newContent] = await db.insert(content).values({
      creatorId,
      organizationId: organizationId || null, // NULL = personal profile
      title: validated.title,
      slug,
      description: validated.description,
      mediaItemId: validated.mediaItemId,
      categoryId: validated.categoryId,
      priceCents: validated.priceCents,
      status: 'draft',
    }).returning();

    // Step 6: Handle tags if provided
    if (validated.tagIds && validated.tagIds.length > 0) {
      await db.insert(contentTags).values(
        validated.tagIds.map(tagId => ({
          contentId: newContent.id,
          tagId,
        }))
      );
    }

    this.obs.info('Content created', {
      contentId: newContent.id,
      creatorId,
      organizationId: organizationId || 'personal'
    });

    return newContent;
  }

  async findById(id: string, creatorId: string): Promise<Content | null> {
    return db.query.content.findFirst({
      where: and(
        eq(content.id, id),
        eq(content.creatorId, creatorId), // Only creator's own content
        isNull(content.deletedAt)
      ),
      with: {
        mediaItem: true,
        category: true,
        tags: { with: { tag: true } },
      },
    });
  }

  async publish(id: string, creatorId: string): Promise<Content> {
    const existing = await this.findById(id, creatorId);

    if (!existing) {
      throw new Error('Content not found');
    }

    if (existing.status === 'published') {
      return existing; // Already published
    }

    const [updated] = await db.update(content)
      .set({
        status: 'published',
        publishedAt: new Date(),
      })
      .where(and(
        eq(content.id, id),
        eq(content.creatorId, creatorId)
      ))
      .returning();

    this.obs.info('Content published', { contentId: id, creatorId });

    return updated;
  }

  async delete(id: string, creatorId: string): Promise<void> {
    // Soft delete
    await db.update(content)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(content.id, id),
        eq(content.creatorId, creatorId)
      ));

    this.obs.info('Content deleted', { contentId: id, creatorId });
  }

  async list(creatorId: string, organizationId?: string, filters: ContentFilters = {}): Promise<PaginatedContent> {
    const limit = filters.limit || 20;
    const offset = filters.offset || 0;

    // Build where conditions
    const whereConditions = [
      eq(content.creatorId, creatorId), // Only creator's content
      isNull(content.deletedAt),
      filters.status ? eq(content.status, filters.status) : undefined,
      filters.categoryId ? eq(content.categoryId, filters.categoryId) : undefined,
    ];

    // If organizationId provided, filter by org; otherwise show all creator's content
    if (organizationId !== undefined) {
      whereConditions.push(eq(content.organizationId, organizationId));
    }

    const items = await db.query.content.findMany({
      where: and(...whereConditions.filter(Boolean)),
      limit,
      offset,
      orderBy: [desc(content.createdAt)],
      with: {
        mediaItem: true,
        category: true,
      },
    });

    const [{ count }] = await db.select({ count: count() })
      .from(content)
      .where(and(...whereConditions.filter(Boolean)));

    return {
      items,
      total: Number(count),
      page: Math.floor(offset / limit) + 1,
      pageSize: limit,
    };
  }

  private async generateUniqueSlug(title: string, organizationId: string | undefined, creatorId: string): Promise<string> {
    let slug = title.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Check uniqueness (unique per org OR per creator if personal)
    let attempt = 0;
    let finalSlug = slug;

    while (attempt < 10) {
      const existing = await db.query.content.findFirst({
        where: and(
          eq(content.slug, finalSlug),
          organizationId !== undefined
            ? eq(content.organizationId, organizationId)
            : and(isNull(content.organizationId), eq(content.creatorId, creatorId)),
          isNull(content.deletedAt)
        ),
      });

      if (!existing) {
        return finalSlug;
      }

      attempt++;
      finalSlug = `${slug}-${attempt}`;
    }

    throw new Error('Unable to generate unique slug');
  }
}

export const contentService = new ContentService();
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

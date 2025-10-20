# Content Management - Phase 1 TDD (Technical Design Document)

## System Overview

The content management system enables Platform Owners to upload, organize, and manage video and written content. Files are stored in Cloudflare R2 (S3-compatible object storage), metadata in Neon Postgres. Direct browser-to-R2 uploads via presigned URLs ensure scalability and performance.

**Architecture**:
- **Storage Layer**: Cloudflare R2 for media files
- **Metadata Layer**: Neon Postgres for content records
- **Upload Strategy**: Direct browser ’ R2 (bypasses server)
- **Access Control**: Signed URLs for secure file access

**Architecture Diagram**: See [Content Management Architecture](../_assets/content-architecture.png)

---

## Dependencies

### Must Be Completed First

1. **Drizzle ORM Setup** ([Infrastructure - Database Setup](../../infrastructure/DatabaseSetup.md))
   - Database schema for content, categories, tags
   - **Why**: Content metadata stored in database

2. **Cloudflare R2 Bucket** ([Infrastructure - Cloudflare Setup](../../infrastructure/CloudflareSetup.md))
   - Bucket created: `codex-content`
   - R2 API credentials configured
   - **Why**: Files stored in R2

3. **Auth System** ([Auth TDD](../auth/ttd-dphase-1.md))
   - `requireOwner()` guard implemented
   - **Why**: Only Platform Owners can manage content

### Can Be Developed In Parallel
- E-Commerce (content pricing integration happens later)
- Content Access (access control uses content metadata)

---

## Component List

### 1. Content Service (`packages/web/src/lib/server/content/service.ts`)

**Responsibility**: Business logic for content CRUD operations

**Interface**:
```typescript
export interface IContentService {
  // Create
  createContent(data: CreateContentInput): Promise<Content>;

  // Read
  getContentById(id: string): Promise<Content | null>;
  getContentList(filters: ContentFilters): Promise<PaginatedContent>;

  // Update
  updateContent(id: string, data: UpdateContentInput): Promise<Content>;
  publishContent(id: string): Promise<Content>;
  archiveContent(id: string): Promise<Content>;

  // Delete
  deleteContent(id: string): Promise<void>;
}
```

**Implementation**:
```typescript
import { db } from '$lib/server/db';
import { content, categories, tags, contentTags } from '$lib/server/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { r2Service } from './r2';

export class ContentService implements IContentService {
  async createContent(data: CreateContentInput): Promise<Content> {
    // 1. Validate category exists
    const category = await db.query.categories.findFirst({
      where: eq(categories.id, data.categoryId)
    });

    if (!category) {
      throw new Error('Category not found');
    }

    // 2. Insert content record
    const [newContent] = await db.insert(content).values({
      title: data.title,
      description: data.description,
      contentType: data.contentType,
      categoryId: data.categoryId,
      price: data.price,
      status: 'draft',
      // File info (if uploaded)
      fileKey: data.fileKey,  // R2 key
      fileSize: data.fileSize,
      fileMimeType: data.fileMimeType,
      // Article content (if article type)
      articleBody: data.articleBody
    }).returning();

    // 3. Handle tags
    if (data.tags && data.tags.length > 0) {
      await this.addTags(newContent.id, data.tags);
    }

    return newContent;
  }

  async getContentList(filters: ContentFilters): Promise<PaginatedContent> {
    const query = db.query.content.findMany({
      where: and(
        isNull(content.deletedAt),  // Exclude deleted
        filters.status ? eq(content.status, filters.status) : undefined,
        filters.categoryId ? eq(content.categoryId, filters.categoryId) : undefined
      ),
      with: {
        category: true,
        tags: {
          with: {
            tag: true
          }
        }
      },
      limit: filters.limit || 20,
      offset: filters.offset || 0,
      orderBy: (content, { desc }) => [desc(content.createdAt)]
    });

    const items = await query;
    const total = await db.select({ count: sql`count(*)` })
      .from(content)
      .where(isNull(content.deletedAt));

    return {
      items,
      total: Number(total[0].count),
      page: Math.floor((filters.offset || 0) / (filters.limit || 20)) + 1,
      pageSize: filters.limit || 20
    };
  }

  async updateContent(id: string, data: UpdateContentInput): Promise<Content> {
    const [updated] = await db.update(content)
      .set({
        title: data.title,
        description: data.description,
        price: data.price,
        categoryId: data.categoryId,
        // If new file uploaded
        fileKey: data.fileKey,
        fileSize: data.fileSize,
        fileMimeType: data.fileMimeType,
        updatedAt: new Date()
      })
      .where(eq(content.id, id))
      .returning();

    // Update tags
    if (data.tags) {
      await this.replaceTags(id, data.tags);
    }

    // If file replaced, delete old file from R2
    if (data.oldFileKey && data.fileKey && data.oldFileKey !== data.fileKey) {
      await r2Service.deleteFile(data.oldFileKey);
    }

    return updated;
  }

  async publishContent(id: string): Promise<Content> {
    const [published] = await db.update(content)
      .set({ status: 'published', publishedAt: new Date() })
      .where(eq(content.id, id))
      .returning();

    return published;
  }

  async deleteContent(id: string): Promise<void> {
    // Soft delete
    await db.update(content)
      .set({ deletedAt: new Date() })
      .where(eq(content.id, id));
  }

  // Tag management helpers
  private async addTags(contentId: string, tagNames: string[]): Promise<void> {
    for (const tagName of tagNames) {
      // Find or create tag
      let tag = await db.query.tags.findFirst({
        where: eq(tags.name, tagName.toLowerCase())
      });

      if (!tag) {
        [tag] = await db.insert(tags).values({ name: tagName.toLowerCase() }).returning();
      }

      // Link tag to content
      await db.insert(contentTags).values({
        contentId,
        tagId: tag.id
      });
    }
  }

  private async replaceTags(contentId: string, tagNames: string[]): Promise<void> {
    // Delete existing tag relationships
    await db.delete(contentTags).where(eq(contentTags.contentId, contentId));

    // Add new tags
    await this.addTags(contentId, tagNames);
  }
}

export const contentService = new ContentService();
```

---

### 2. R2 Service (`packages/web/src/lib/server/content/r2.ts`)

**Responsibility**: Interact with Cloudflare R2 for file storage

**Implementation**:
```typescript
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export class R2Service {
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = 'codex-content';

    // R2 uses S3-compatible API
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!
      }
    });
  }

  /**
   * Generate presigned POST URL for direct browser upload
   * Returns URL and fields for multipart form POST
   */
  async getUploadUrl(fileKey: string, contentType: string): Promise<PresignedUploadUrl> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: fileKey,
      ContentType: contentType
    });

    const url = await getSignedUrl(this.client, command, {
      expiresIn: 3600  // 1 hour
    });

    return {
      url,
      fileKey,
      expiresIn: 3600
    };
  }

  /**
   * Generate signed URL for downloading/viewing file
   * Used for serving video/PDF to customers
   */
  async getDownloadUrl(fileKey: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: fileKey
    });

    return await getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Delete file from R2
   * Used when content deleted or file replaced
   */
  async deleteFile(fileKey: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: fileKey
    });

    await this.client.send(command);
  }

  /**
   * Generate unique file key for R2
   * Format: content/{contentId}/{timestamp}-{filename}
   */
  generateFileKey(contentId: string, filename: string): string {
    const timestamp = Date.now();
    const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `content/${contentId}/${timestamp}-${sanitized}`;
  }
}

export const r2Service = new R2Service();
```

---

### 3. Upload Flow (Direct Browser ’ R2)

**Responsibility**: Handle file uploads without passing through server

**Backend API** (`packages/web/src/routes/api/content/upload-url/+server.ts`):
```typescript
import { r2Service } from '$lib/server/content/r2';
import { requireOwner } from '$lib/server/guards';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  // Require Platform Owner
  requireOwner({ locals, url: request.url });

  const { filename, contentType, contentId } = await request.json();

  // Validate file type
  const allowedTypes = [
    'video/mp4',
    'video/webm',
    'application/pdf',
    'image/jpeg',
    'image/png'
  ];

  if (!allowedTypes.includes(contentType)) {
    return json({ error: 'Invalid file type' }, { status: 400 });
  }

  // Generate unique file key
  const fileKey = r2Service.generateFileKey(contentId, filename);

  // Get presigned upload URL
  const uploadUrl = await r2Service.getUploadUrl(fileKey, contentType);

  return json({
    uploadUrl: uploadUrl.url,
    fileKey: uploadUrl.fileKey,
    expiresIn: uploadUrl.expiresIn
  });
};
```

**Frontend Upload** (`packages/web/src/lib/components/ContentUpload.svelte`):
```typescript
<script lang="ts">
  let file: File | null = null;
  let uploadProgress = 0;
  let uploading = false;

  async function handleUpload() {
    if (!file) return;

    uploading = true;

    try {
      // 1. Request presigned URL from backend
      const response = await fetch('/api/content/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          contentId: crypto.randomUUID()  // Generate contentId upfront
        })
      });

      const { uploadUrl, fileKey } = await response.json();

      // 2. Upload directly to R2
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          uploadProgress = (e.loaded / e.total) * 100;
        }
      });

      xhr.addEventListener('load', async () => {
        if (xhr.status === 200) {
          // 3. Notify backend of successful upload
          await saveContentMetadata(fileKey, file.size, file.type);
          uploading = false;
          alert('Upload complete!');
        }
      });

      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.send(file);

    } catch (error) {
      console.error('Upload failed:', error);
      uploading = false;
    }
  }

  async function saveContentMetadata(fileKey: string, fileSize: number, mimeType: string) {
    // Save content metadata to database
    await fetch('/api/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'My Video',  // From form
        description: '...',
        fileKey,
        fileSize,
        fileMimeType: mimeType,
        // ... other metadata
      })
    });
  }
</script>

<input type="file" accept="video/*,.pdf" bind:files={file} />
<button on:click={handleUpload} disabled={uploading}>
  {uploading ? `Uploading... ${uploadProgress.toFixed(0)}%` : 'Upload'}
</button>

{#if uploading}
  <progress value={uploadProgress} max="100"></progress>
{/if}
```

---

### 4. Content CRUD API Routes

**Create Content** (`packages/web/src/routes/api/content/+server.ts`):
```typescript
import { contentService } from '$lib/server/content/service';
import { requireOwner } from '$lib/server/guards';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  requireOwner({ locals, url: request.url });

  const data = await request.json();

  try {
    const content = await contentService.createContent(data);
    return json(content, { status: 201 });
  } catch (error) {
    return json({ error: error.message }, { status: 400 });
  }
};

export const GET: RequestHandler = async ({ url, locals }) => {
  requireOwner({ locals, url: url.toString() });

  const filters = {
    status: url.searchParams.get('status'),
    categoryId: url.searchParams.get('category'),
    limit: Number(url.searchParams.get('limit') || 20),
    offset: Number(url.searchParams.get('offset') || 0)
  };

  const result = await contentService.getContentList(filters);
  return json(result);
};
```

**Update/Delete Content** (`packages/web/src/routes/api/content/[id]/+server.ts`):
```typescript
import { contentService } from '$lib/server/content/service';
import { requireOwner } from '$lib/server/guards';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
  requireOwner({ locals, url: request.url });

  const data = await request.json();
  const content = await contentService.updateContent(params.id, data);

  return json(content);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  requireOwner({ locals, url: request.url });

  await contentService.deleteContent(params.id);

  return json({ success: true });
};
```

**Publish Content** (`packages/web/src/routes/api/content/[id]/publish/+server.ts`):
```typescript
export const POST: RequestHandler = async ({ params, locals }) => {
  requireOwner({ locals, url: request.url });

  const content = await contentService.publishContent(params.id);

  return json(content);
};
```

---

## Data Models / Schema

**Content Table** (`packages/web/src/lib/server/db/schema/content.ts`):
```typescript
import { pgTable, uuid, varchar, text, decimal, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const contentTypeEnum = pgEnum('content_type', ['video', 'pdf', 'article']);
export const contentStatusEnum = pgEnum('content_status', ['draft', 'published', 'archived']);

export const content = pgTable('content', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Metadata
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  contentType: contentTypeEnum('content_type').notNull(),
  status: contentStatusEnum('status').default('draft').notNull(),

  // File info (for video/PDF)
  fileKey: varchar('file_key', { length: 500 }),  // R2 key
  fileSize: bigint('file_size', { mode: 'number' }),  // bytes
  fileMimeType: varchar('file_mime_type', { length: 100 }),

  // Article content (for article type)
  articleBody: text('article_body'),

  // Organization
  categoryId: uuid('category_id').references(() => categories.id).notNull(),

  // Pricing
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),  // USD

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  publishedAt: timestamp('published_at'),
  deletedAt: timestamp('deleted_at')
});

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).unique().notNull(),
  slug: varchar('slug', { length: 100 }).unique().notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull()
});

export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 50 }).unique().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
});

export const contentTags = pgTable('content_tags', {
  contentId: uuid('content_id').references(() => content.id, { onDelete: 'cascade' }).notNull(),
  tagId: uuid('tag_id').references(() => tags.id, { onDelete: 'cascade' }).notNull()
});
```

---

## Environment Configuration

```bash
# Cloudflare R2
CLOUDFLARE_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key

# Content settings
MAX_VIDEO_SIZE=5368709120  # 5GB in bytes
MAX_PDF_SIZE=104857600      # 100MB in bytes
```

---

## Testing Strategy

### Unit Tests

```typescript
describe('ContentService', () => {
  it('creates content with metadata', async () => {
    const content = await contentService.createContent({
      title: 'Test Video',
      description: 'Test description',
      contentType: 'video',
      categoryId: 'category-uuid',
      price: 29.99,
      fileKey: 'content/123/video.mp4',
      fileSize: 1024000,
      fileMimeType: 'video/mp4'
    });

    expect(content.id).toBeDefined();
    expect(content.status).toBe('draft');
    expect(content.title).toBe('Test Video');
  });

  it('publishes content', async () => {
    const content = await contentService.publishContent('content-uuid');

    expect(content.status).toBe('published');
    expect(content.publishedAt).toBeDefined();
  });
});
```

### Integration Tests

```typescript
describe('Content API', () => {
  it('POST /api/content creates content', async () => {
    const response = await POST({
      request: new Request('http://localhost/api/content', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Test',
          contentType: 'video',
          categoryId: 'cat-id',
          price: 19.99
        })
      }),
      locals: { user: mockOwner() }
    });

    expect(response.status).toBe(201);
    const content = await response.json();
    expect(content.title).toBe('Test');
  });
});
```

---

## Related Documents

- **PRD**: [Content Management PRD](./pdr-phase-1.md)
- **Cross-Feature Dependencies**:
  - [E-Commerce TDD](../e-commerce/ttd-dphase-1.md) - Content pricing
  - [Content Access TDD](../content-access/ttd-dphase-1.md) - Access control
  - [Admin Dashboard TDD](../admin-dashboard/ttd-dphase-1.md) - Management UI
- **Infrastructure**:
  - [Database Schema](../../infrastructure/DatabaseSchema.md)
  - [Cloudflare R2 Setup](../../infrastructure/CloudflareSetup.md)
  - [Testing Strategy](../../infrastructure/TestingStrategy.md)

---

**Document Version**: 1.0
**Last Updated**: 2025-10-20
**Status**: Draft - Awaiting Review

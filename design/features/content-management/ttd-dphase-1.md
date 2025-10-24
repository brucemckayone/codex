# Content Management - Phase 1 TDD (Technical Design Document)

## System Overview

The content management system enables Creators to upload, organize, and manage video and audio content using a **media library pattern**. Media files (videos/audio) are stored separately from content metadata, allowing reusability across multiple content entities.

**Key Architecture Decisions**:

- **Media Library Pattern**: Separate `media_items` table for uploaded files, `content` table references media via `media_item_id`
- **Bucket-Per-Creator**: Each creator gets isolated R2 buckets (`codex-media-{creatorId}`, `codex-resources-{creatorId}`, `codex-assets-{creatorId}`)
- **Reusable Resources**: PDF/workbooks stored once, attached to multiple content/offerings via `resource_attachments`
- **Direct Upload Strategy**: Browser → R2 uploads via presigned URLs (bypasses server)
- **Transcoding Separation**: Video transcoding handled by separate Media Transcoding feature

**Architecture**:

- **Storage Layer**: Cloudflare R2 (bucket-per-creator) for media files, resources, assets
- **Metadata Layer**: Neon Postgres for `media_items`, `content`, `resources` records
- **Upload Strategy**: Direct browser → R2 (bypasses server, tracks progress)
- **Access Control**: Presigned URLs for secure file access

**Architecture Diagram**:

![Content Management Architecture](./assets/content-management-architecture.png)

The diagram illustrates the direct upload strategy (browser → R2 via presigned URLs), media library pattern, bucket-per-creator isolation, and transcoding queue integration.

---

## Dependencies

See the centralized [Cross-Feature Dependencies](../../cross-feature-dependencies.md#4-content-management) document for details on dependencies between features.

### Technical Prerequisites

1.  **Drizzle ORM Setup**: The database schema for content, media, and resources must be in place.
2.  **Cloudflare R2 Buckets**: The bucket-per-creator architecture needs to be set up for file storage.
3.  **Auth System**: The `requireCreatorAccess()` guard is necessary to protect content management routes.
4.  **Cloudflare Queue**: The `TRANSCODING_QUEUE` is needed to handle video processing jobs.

---

## Component List

### 1. Media Items Service (`packages/web/src/lib/server/media/service.ts`)

**Responsibility**: Manage media library (uploaded videos/audio)

**Interface**:

```typescript
export interface IMediaItemsService {
  // Create media item record after upload
  createMediaItem(data: CreateMediaItemInput): Promise<MediaItem>;

  // Read
  getMediaItemById(id: string, ownerId: string): Promise<MediaItem | null>;
  getMediaLibrary(
    ownerId: string,
    filters: MediaFilters
  ): Promise<PaginatedMediaItems>;

  // Update
  updateMediaItemStatus(id: string, status: MediaStatus): Promise<MediaItem>;

  // Delete (only if not referenced by content)
  deleteMediaItem(id: string, ownerId: string): Promise<void>;
}

export type MediaStatus =
  | 'uploading'
  | 'uploaded'
  | 'transcoding'
  | 'ready'
  | 'failed';

export interface CreateMediaItemInput {
  id: string; // Generated upfront (UUID)
  ownerId: string;
  type: 'video' | 'audio';
  bucketName: string; // 'codex-media-{creatorId}'
  fileKey: string; // 'originals/{mediaId}/original.mp4'
  filename: string;
  fileSize: number;
  mimeType: string;
}
```

**Implementation**:

```typescript
import { db } from '$lib/server/db';
import { mediaItems, content } from '$lib/server/db/schema';
import { eq, and, isNull } from 'drizzle-orm';

export class MediaItemsService implements IMediaItemsService {
  async createMediaItem(data: CreateMediaItemInput): Promise<MediaItem> {
    // Insert media_items record
    const [newMediaItem] = await db
      .insert(mediaItems)
      .values({
        id: data.id,
        ownerId: data.ownerId,
        type: data.type,
        status: 'uploaded', // Initial status
        bucketName: data.bucketName,
        fileKey: data.fileKey,
        filename: data.filename,
        fileSize: data.fileSize,
        mimeType: data.mimeType,
      })
      .returning();

    return newMediaItem;
  }

  async getMediaLibrary(
    ownerId: string,
    filters: MediaFilters
  ): Promise<PaginatedMediaItems> {
    const items = await db.query.mediaItems.findMany({
      where: and(
        eq(mediaItems.ownerId, ownerId),
        filters.type ? eq(mediaItems.type, filters.type) : undefined,
        filters.status ? eq(mediaItems.status, filters.status) : undefined
      ),
      limit: filters.limit || 20,
      offset: filters.offset || 0,
      orderBy: (mediaItems, { desc }) => [desc(mediaItems.createdAt)],
    });

    const total = await db
      .select({ count: sql`count(*)` })
      .from(mediaItems)
      .where(eq(mediaItems.ownerId, ownerId));

    return {
      items,
      total: Number(total[0].count),
      page: Math.floor((filters.offset || 0) / (filters.limit || 20)) + 1,
      pageSize: filters.limit || 20,
    };
  }

  async updateMediaItemStatus(
    id: string,
    status: MediaStatus
  ): Promise<MediaItem> {
    const [updated] = await db
      .update(mediaItems)
      .set({ status, updatedAt: new Date() })
      .where(eq(mediaItems.id, id))
      .returning();

    return updated;
  }

  async deleteMediaItem(id: string, ownerId: string): Promise<void> {
    // Check if media item is referenced by any content
    const referencingContent = await db.query.content.findFirst({
      where: and(eq(content.mediaItemId, id), isNull(content.deletedAt)),
    });

    if (referencingContent) {
      throw new Error('Cannot delete media item: referenced by content');
    }

    // Delete media item
    await db
      .delete(mediaItems)
      .where(and(eq(mediaItems.id, id), eq(mediaItems.ownerId, ownerId)));

    // Note: R2 file deletion handled separately (manual cleanup or cron job)
  }
}

export const mediaItemsService = new MediaItemsService();
```

---

### 2. Content Service (`packages/web/src/lib/server/content/service.ts`)

**Responsibility**: Business logic for content CRUD operations (references media library)

**Interface**:

```typescript
export interface IContentService {
  // Create content (references existing media item)
  createContent(data: CreateContentInput, ownerId: string): Promise<Content>;

  // Read
  getContentById(id: string, ownerId: string): Promise<Content | null>;
  getContentList(
    ownerId: string,
    filters: ContentFilters
  ): Promise<PaginatedContent>;

  // Update
  updateContent(
    id: string,
    ownerId: string,
    data: UpdateContentInput
  ): Promise<Content>;
  publishContent(id: string, ownerId: string): Promise<Content>;
  archiveContent(id: string, ownerId: string): Promise<Content>;

  // Delete (soft delete)
  deleteContent(id: string, ownerId: string): Promise<void>;
}

export interface CreateContentInput {
  title: string;
  description: string;
  mediaItemId: string; // Reference to media library
  categoryId: string;
  tags: string[];
  price: number;
  customThumbnailKey?: string; // Optional custom thumbnail in R2
}
```

**Implementation**:

```typescript
import { db } from '$lib/server/db';
import {
  content,
  mediaItems,
  categories,
  tags,
  contentTags,
  resourceAttachments,
} from '$lib/server/db/schema';
import { eq, and, isNull } from 'drizzle-orm';

export class ContentService implements IContentService {
  async createContent(
    data: CreateContentInput,
    ownerId: string
  ): Promise<Content> {
    // 1. Validate media item exists and belongs to creator
    const mediaItem = await db.query.mediaItems.findFirst({
      where: and(
        eq(mediaItems.id, data.mediaItemId),
        eq(mediaItems.ownerId, ownerId)
      ),
    });

    if (!mediaItem) {
      throw new Error('Media item not found or access denied');
    }

    // 2. Validate media item is ready (transcoded)
    if (mediaItem.type === 'video' && mediaItem.status !== 'ready') {
      throw new Error('Media item not ready (still transcoding)');
    }

    // 3. Validate category exists
    const category = await db.query.categories.findFirst({
      where: eq(categories.id, data.categoryId),
    });

    if (!category) {
      throw new Error('Category not found');
    }

    // 4. Insert content record
    const [newContent] = await db
      .insert(content)
      .values({
        title: data.title,
        description: data.description,
        mediaItemId: data.mediaItemId, // Reference to media library
        categoryId: data.categoryId,
        price: data.price,
        status: 'draft',
        ownerId,
        customThumbnailKey: data.customThumbnailKey,
      })
      .returning();

    // 5. Handle tags
    if (data.tags && data.tags.length > 0) {
      await this.addTags(newContent.id, data.tags);
    }

    return newContent;
  }

  async getContentList(
    ownerId: string,
    filters: ContentFilters
  ): Promise<PaginatedContent> {
    const items = await db.query.content.findMany({
      where: and(
        eq(content.ownerId, ownerId),
        isNull(content.deletedAt), // Exclude deleted
        filters.status ? eq(content.status, filters.status) : undefined,
        filters.categoryId
          ? eq(content.categoryId, filters.categoryId)
          : undefined
      ),
      with: {
        mediaItem: true, // Include media item details
        category: true,
        tags: {
          with: {
            tag: true,
          },
        },
        resourceAttachments: {
          // Include attached resources
          with: {
            resource: true,
          },
        },
      },
      limit: filters.limit || 20,
      offset: filters.offset || 0,
      orderBy: (content, { desc }) => [desc(content.createdAt)],
    });

    const total = await db
      .select({ count: sql`count(*)` })
      .from(content)
      .where(and(eq(content.ownerId, ownerId), isNull(content.deletedAt)));

    return {
      items,
      total: Number(total[0].count),
      page: Math.floor((filters.offset || 0) / (filters.limit || 20)) + 1,
      pageSize: filters.limit || 20,
    };
  }

  async updateContent(
    id: string,
    ownerId: string,
    data: UpdateContentInput
  ): Promise<Content> {
    // Validate ownership
    const existing = await db.query.content.findFirst({
      where: and(eq(content.id, id), eq(content.ownerId, ownerId)),
    });

    if (!existing) {
      throw new Error('Content not found or access denied');
    }

    // If changing media item, validate new media item
    if (data.mediaItemId && data.mediaItemId !== existing.mediaItemId) {
      const mediaItem = await db.query.mediaItems.findFirst({
        where: and(
          eq(mediaItems.id, data.mediaItemId),
          eq(mediaItems.ownerId, ownerId)
        ),
      });

      if (!mediaItem) {
        throw new Error('Media item not found or access denied');
      }
    }

    // Update content
    const [updated] = await db
      .update(content)
      .set({
        title: data.title,
        description: data.description,
        mediaItemId: data.mediaItemId,
        price: data.price,
        categoryId: data.categoryId,
        customThumbnailKey: data.customThumbnailKey,
        updatedAt: new Date(),
      })
      .where(and(eq(content.id, id), eq(content.ownerId, ownerId)))
      .returning();

    // Update tags
    if (data.tags) {
      await this.replaceTags(id, data.tags);
    }

    // If custom thumbnail replaced, old thumbnail should be deleted from R2
    // (Handled by separate cleanup job or immediate R2Service call)

    return updated;
  }

  async publishContent(id: string, ownerId: string): Promise<Content> {
    const [published] = await db
      .update(content)
      .set({ status: 'published', publishedAt: new Date() })
      .where(and(eq(content.id, id), eq(content.ownerId, ownerId)))
      .returning();

    return published;
  }

  async deleteContent(id: string, ownerId: string): Promise<void> {
    // Soft delete content
    await db
      .update(content)
      .set({ deletedAt: new Date() })
      .where(and(eq(content.id, id), eq(content.ownerId, ownerId)));

    // Note: Does NOT delete media item (may be used by other content)
    // Note: Does NOT delete resource attachments (resources remain for other content)
  }

  // Tag management helpers
  private async addTags(contentId: string, tagNames: string[]): Promise<void> {
    for (const tagName of tagNames) {
      // Find or create tag
      let tag = await db.query.tags.findFirst({
        where: eq(tags.name, tagName.toLowerCase()),
      });

      if (!tag) {
        [tag] = await db
          .insert(tags)
          .values({ name: tagName.toLowerCase() })
          .returning();
      }

      // Link tag to content
      await db
        .insert(contentTags)
        .values({
          contentId,
          tagId: tag.id,
        })
        .onConflictDoNothing(); // Avoid duplicates
    }
  }

  private async replaceTags(
    contentId: string,
    tagNames: string[]
  ): Promise<void> {
    // Delete existing tag relationships
    await db.delete(contentTags).where(eq(contentTags.contentId, contentId));

    // Add new tags
    await this.addTags(contentId, tagNames);
  }
}

export const contentService = new ContentService();
```

---

### 3. Resource Service (`packages/web/src/lib/server/resources/service.ts`)

**Responsibility**: Manage reusable resources (PDFs, workbooks) and attachments

**Interface**:

```typescript
export interface IResourceService {
  // Create resource record after upload
  createResource(data: CreateResourceInput, ownerId: string): Promise<Resource>;

  // Attach resource to content
  attachResourceToContent(
    resourceId: string,
    contentId: string,
    label: string,
    ownerId: string
  ): Promise<void>;

  // Detach resource from content
  detachResourceFromContent(
    resourceId: string,
    contentId: string,
    ownerId: string
  ): Promise<void>;

  // List resources owned by creator
  getResourceLibrary(
    ownerId: string,
    filters: ResourceFilters
  ): Promise<PaginatedResources>;

  // Delete resource (only if not attached to any content)
  deleteResource(id: string, ownerId: string): Promise<void>;
}

export interface CreateResourceInput {
  id: string; // Generated upfront (UUID)
  ownerId: string;
  bucketName: string; // 'codex-resources-{creatorId}'
  fileKey: string; // '{resourceId}/filename.pdf'
  filename: string;
  fileSize: number;
  mimeType: string;
}
```

**Implementation**:

```typescript
import { db } from '$lib/server/db';
import { resources, resourceAttachments, content } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

export class ResourceService implements IResourceService {
  async createResource(
    data: CreateResourceInput,
    ownerId: string
  ): Promise<Resource> {
    const [newResource] = await db
      .insert(resources)
      .values({
        id: data.id,
        ownerId: data.ownerId,
        bucketName: data.bucketName,
        fileKey: data.fileKey,
        filename: data.filename,
        fileSize: data.fileSize,
        mimeType: data.mimeType,
      })
      .returning();

    return newResource;
  }

  async attachResourceToContent(
    resourceId: string,
    contentId: string,
    label: string,
    ownerId: string
  ): Promise<void> {
    // Validate resource ownership
    const resource = await db.query.resources.findFirst({
      where: and(eq(resources.id, resourceId), eq(resources.ownerId, ownerId)),
    });

    if (!resource) {
      throw new Error('Resource not found or access denied');
    }

    // Validate content ownership
    const contentItem = await db.query.content.findFirst({
      where: and(eq(content.id, contentId), eq(content.ownerId, ownerId)),
    });

    if (!contentItem) {
      throw new Error('Content not found or access denied');
    }

    // Create attachment
    await db
      .insert(resourceAttachments)
      .values({
        resourceId,
        entityType: 'content',
        entityId: contentId,
        attachmentLabel: label,
      })
      .onConflictDoNothing(); // Avoid duplicates
  }

  async detachResourceFromContent(
    resourceId: string,
    contentId: string,
    ownerId: string
  ): Promise<void> {
    // Validate ownership via resource
    const resource = await db.query.resources.findFirst({
      where: and(eq(resources.id, resourceId), eq(resources.ownerId, ownerId)),
    });

    if (!resource) {
      throw new Error('Resource not found or access denied');
    }

    // Delete attachment
    await db
      .delete(resourceAttachments)
      .where(
        and(
          eq(resourceAttachments.resourceId, resourceId),
          eq(resourceAttachments.entityType, 'content'),
          eq(resourceAttachments.entityId, contentId)
        )
      );
  }

  async getResourceLibrary(
    ownerId: string,
    filters: ResourceFilters
  ): Promise<PaginatedResources> {
    const items = await db.query.resources.findMany({
      where: eq(resources.ownerId, ownerId),
      limit: filters.limit || 20,
      offset: filters.offset || 0,
      orderBy: (resources, { desc }) => [desc(resources.createdAt)],
    });

    const total = await db
      .select({ count: sql`count(*)` })
      .from(resources)
      .where(eq(resources.ownerId, ownerId));

    return {
      items,
      total: Number(total[0].count),
      page: Math.floor((filters.offset || 0) / (filters.limit || 20)) + 1,
      pageSize: filters.limit || 20,
    };
  }

  async deleteResource(id: string, ownerId: string): Promise<void> {
    // Check if resource is attached to any content
    const attachments = await db.query.resourceAttachments.findFirst({
      where: eq(resourceAttachments.resourceId, id),
    });

    if (attachments) {
      throw new Error('Cannot delete resource: attached to content/offerings');
    }

    // Delete resource
    await db
      .delete(resources)
      .where(and(eq(resources.id, id), eq(resources.ownerId, ownerId)));

    // Note: R2 file deletion handled separately
  }
}

export const resourceService = new ResourceService();
```

---

### 4. R2 Service (`packages/web/src/lib/server/r2/service.ts`)

**Responsibility**: Interact with Cloudflare R2 for file storage (bucket-per-creator)

**Implementation**:

```typescript
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export class R2Service {
  private client: S3Client;
  private accountId: string;

  constructor() {
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID!;

    // R2 uses S3-compatible API
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${this.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }

  /**
   * Provision creator buckets on signup
   * Creates: codex-media-{creatorId}, codex-resources-{creatorId}, codex-assets-{creatorId}
   */
  async provisionCreatorBuckets(creatorId: string): Promise<void> {
    const buckets = [
      `codex-media-${creatorId}`,
      `codex-resources-${creatorId}`,
      `codex-assets-${creatorId}`,
    ];

    for (const bucketName of buckets) {
      try {
        await this.client.send(
          new CreateBucketCommand({
            Bucket: bucketName,
          })
        );

        console.log(`Created bucket: ${bucketName}`);
      } catch (error) {
        // Bucket may already exist, ignore error
        console.error(`Failed to create bucket ${bucketName}:`, error);
      }
    }

    // Store bucket names in creator_buckets table (see Database Schema)
  }

  /**
   * Generate presigned PUT URL for direct browser upload
   */
  async getUploadUrl(
    bucketName: string,
    fileKey: string,
    contentType: string,
    expiresIn: number = 900 // 15 minutes (large files)
  ): Promise<PresignedUploadUrl> {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      ContentType: contentType,
    });

    const url = await getSignedUrl(this.client, command, { expiresIn });

    return {
      url,
      bucketName,
      fileKey,
      expiresIn,
    };
  }

  /**
   * Generate signed URL for downloading/viewing file
   * Used for serving video HLS streams, resources to customers
   */
  async getDownloadUrl(
    bucketName: string,
    fileKey: string,
    expiresIn: number = 3600 // 1 hour
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
    });

    return await getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Delete file from R2
   */
  async deleteFile(bucketName: string, fileKey: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
    });

    await this.client.send(command);
  }

  /**
   * Generate unique file keys for R2
   */
  generateMediaKey(mediaId: string, filename: string): string {
    const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `originals/${mediaId}/${sanitized}`;
  }

  generateResourceKey(resourceId: string, filename: string): string {
    const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `${resourceId}/${sanitized}`;
  }

  generateThumbnailKey(
    entityType: string,
    entityId: string,
    filename: string
  ): string {
    const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `thumbnails/${entityType}/${entityId}/${sanitized}`;
  }
}

export const r2Service = new R2Service();
```

---

### 5. Upload Flows

#### A. Media Upload Flow (Video/Audio)

**Backend API** (`packages/web/src/routes/api/media/presigned-upload/+server.ts`):

```typescript
import { r2Service } from '$lib/server/r2/service';
import { requireCreatorAccess } from '$lib/server/guards';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  // Require Creator access
  const user = requireCreatorAccess({ locals, url: request.url });

  const { filename, contentType, mediaId } = await request.json();

  // Validate file type
  const allowedTypes = [
    'video/mp4',
    'video/webm',
    'video/quicktime', // MOV
    'audio/mpeg', // MP3
    'audio/mp4', // M4A
    'audio/wav',
  ];

  if (!allowedTypes.includes(contentType)) {
    return json({ error: 'Invalid file type' }, { status: 400 });
  }

  // Generate presigned URL for creator's media bucket
  const bucketName = `codex-media-${user.id}`;
  const fileKey = r2Service.generateMediaKey(mediaId, filename);

  const uploadUrl = await r2Service.getUploadUrl(
    bucketName,
    fileKey,
    contentType
  );

  return json({
    uploadUrl: uploadUrl.url,
    bucketName: uploadUrl.bucketName,
    fileKey: uploadUrl.fileKey,
    expiresIn: uploadUrl.expiresIn,
  });
};
```

**Upload Complete API** (`packages/web/src/routes/api/media/upload-complete/+server.ts`):

```typescript
import { mediaItemsService } from '$lib/server/media/service';
import { requireCreatorAccess } from '$lib/server/guards';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  const user = requireCreatorAccess({ locals, url: request.url });

  const { mediaId, filename, fileSize, mimeType, bucketName, fileKey } =
    await request.json();

  // Create media_items record
  const mediaItem = await mediaItemsService.createMediaItem({
    id: mediaId,
    ownerId: user.id,
    type: mimeType.startsWith('video/') ? 'video' : 'audio',
    bucketName,
    fileKey,
    filename,
    fileSize,
    mimeType,
  });

  // If video, enqueue transcoding job
  if (mediaItem.type === 'video') {
    await platform.env.TRANSCODING_QUEUE.send({
      mediaId: mediaItem.id,
      inputBucket: bucketName,
      inputKey: fileKey,
      outputBucket: bucketName,
      outputPrefix: `hls/${mediaId}/`,
    });

    // Update status to transcoding
    await mediaItemsService.updateMediaItemStatus(mediaId, 'transcoding');
  } else {
    // Audio files are immediately ready
    await mediaItemsService.updateMediaItemStatus(mediaId, 'ready');
  }

  return json(mediaItem, { status: 201 });
};
```

#### B. Resource Upload Flow (PDFs, Workbooks)

**Backend API** (`packages/web/src/routes/api/resources/presigned-upload/+server.ts`):

```typescript
export const POST: RequestHandler = async ({ request, locals }) => {
  const user = requireCreatorAccess({ locals, url: request.url });

  const { filename, contentType, resourceId } = await request.json();

  // Validate file type
  const allowedTypes = [
    'application/pdf',
    'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // XLSX
  ];

  if (!allowedTypes.includes(contentType)) {
    return json({ error: 'Invalid file type' }, { status: 400 });
  }

  // Generate presigned URL for creator's resource bucket
  const bucketName = `codex-resources-${user.id}`;
  const fileKey = r2Service.generateResourceKey(resourceId, filename);

  const uploadUrl = await r2Service.getUploadUrl(
    bucketName,
    fileKey,
    contentType
  );

  return json({
    uploadUrl: uploadUrl.url,
    bucketName: uploadUrl.bucketName,
    fileKey: uploadUrl.fileKey,
    expiresIn: uploadUrl.expiresIn,
  });
};
```

**Upload Complete API** (`packages/web/src/routes/api/resources/upload-complete/+server.ts`):

```typescript
import { resourceService } from '$lib/server/resources/service';

export const POST: RequestHandler = async ({ request, locals }) => {
  const user = requireCreatorAccess({ locals, url: request.url });

  const { resourceId, filename, fileSize, mimeType, bucketName, fileKey } =
    await request.json();

  // Create resources record
  const resource = await resourceService.createResource(
    {
      id: resourceId,
      ownerId: user.id,
      bucketName,
      fileKey,
      filename,
      fileSize,
      mimeType,
    },
    user.id
  );

  return json(resource, { status: 201 });
};
```

---

### 6. Content CRUD API Routes

**Create Content** (`packages/web/src/routes/api/content/+server.ts`):

```typescript
import { contentService } from '$lib/server/content/service';
import { requireCreatorAccess } from '$lib/server/guards';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  const user = requireCreatorAccess({ locals, url: request.url });

  const data = await request.json();

  try {
    const content = await contentService.createContent(data, user.id);
    return json(content, { status: 201 });
  } catch (error) {
    return json({ error: error.message }, { status: 400 });
  }
};

export const GET: RequestHandler = async ({ url, locals }) => {
  const user = requireCreatorAccess({ locals, url: url.toString() });

  const filters = {
    status: url.searchParams.get('status'),
    categoryId: url.searchParams.get('category'),
    limit: Number(url.searchParams.get('limit') || 20),
    offset: Number(url.searchParams.get('offset') || 0),
  };

  const result = await contentService.getContentList(user.id, filters);
  return json(result);
};
```

**Attach Resource to Content** (`packages/web/src/routes/api/content/[id]/resources/+server.ts`):

```typescript
import { resourceService } from '$lib/server/resources/service';

export const POST: RequestHandler = async ({ request, params, locals }) => {
  const user = requireCreatorAccess({ locals, url: request.url });

  const { resourceId, label } = await request.json();

  await resourceService.attachResourceToContent(
    resourceId,
    params.id, // contentId
    label,
    user.id
  );

  return json({ success: true });
};

export const DELETE: RequestHandler = async ({ request, params, locals }) => {
  const user = requireCreatorAccess({ locals, url: request.url });

  const { resourceId } = await request.json();

  await resourceService.detachResourceFromContent(
    resourceId,
    params.id, // contentId
    user.id
  );

  return json({ success: true });
};
```

---

## Data Models / Schema

**Media Items Table** (`packages/web/src/lib/server/db/schema/media.ts`):

```typescript
import {
  pgTable,
  uuid,
  varchar,
  text,
  bigint,
  timestamp,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const mediaTypeEnum = pgEnum('media_type', ['video', 'audio']);
export const mediaStatusEnum = pgEnum('media_status', [
  'uploading',
  'uploaded',
  'transcoding',
  'ready',
  'failed',
]);

export const mediaItems = pgTable('media_items', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Ownership
  ownerId: uuid('owner_id')
    .references(() => users.id)
    .notNull(),

  // Type
  type: mediaTypeEnum('type').notNull(),
  status: mediaStatusEnum('status').default('uploading').notNull(),

  // Storage (R2)
  bucketName: varchar('bucket_name', { length: 100 }).notNull(), // 'codex-media-{creatorId}'
  fileKey: varchar('file_key', { length: 500 }).notNull(), // 'originals/{mediaId}/original.mp4'
  filename: varchar('filename', { length: 255 }).notNull(),
  fileSize: bigint('file_size', { mode: 'number' }).notNull(), // bytes
  mimeType: varchar('mime_type', { length: 100 }).notNull(),

  // HLS output (if video, populated after transcoding)
  hlsMasterPlaylistKey: varchar('hls_master_playlist_key', { length: 500 }), // 'hls/{mediaId}/master.m3u8'

  // Metadata (extracted during transcoding)
  durationSeconds: integer('duration_seconds'),
  width: integer('width'),
  height: integer('height'),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

**Content Table** (`packages/web/src/lib/server/db/schema/content.ts`):

```typescript
import {
  pgTable,
  uuid,
  varchar,
  text,
  decimal,
  timestamp,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const contentStatusEnum = pgEnum('content_status', [
  'draft',
  'published',
  'archived',
]);

export const content = pgTable('content', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Ownership
  ownerId: uuid('owner_id')
    .references(() => users.id)
    .notNull(),

  // Metadata
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  status: contentStatusEnum('status').default('draft').notNull(),

  // Media reference (media library)
  mediaItemId: uuid('media_item_id')
    .references(() => mediaItems.id)
    .notNull(),

  // Custom thumbnail (optional, override auto-generated)
  customThumbnailKey: varchar('custom_thumbnail_key', { length: 500 }), // R2 key in assets bucket

  // Organization
  categoryId: uuid('category_id')
    .references(() => categories.id)
    .notNull(),

  // Pricing
  price: decimal('price', { precision: 10, scale: 2 }).notNull(), // USD

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  publishedAt: timestamp('published_at'),
  deletedAt: timestamp('deleted_at'),
});
```

**Resources Table** (`packages/web/src/lib/server/db/schema/resources.ts`):

```typescript
export const resources = pgTable('resources', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Ownership
  ownerId: uuid('owner_id')
    .references(() => users.id)
    .notNull(),

  // Storage (R2)
  bucketName: varchar('bucket_name', { length: 100 }).notNull(), // 'codex-resources-{creatorId}'
  fileKey: varchar('file_key', { length: 500 }).notNull(), // '{resourceId}/filename.pdf'
  filename: varchar('filename', { length: 255 }).notNull(),
  fileSize: bigint('file_size', { mode: 'number' }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const resourceAttachments = pgTable('resource_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Resource reference
  resourceId: uuid('resource_id')
    .references(() => resources.id, { onDelete: 'cascade' })
    .notNull(),

  // Entity reference (content, offering, course, etc.)
  entityType: varchar('entity_type', { length: 50 }).notNull(), // 'content', 'offering', 'course'
  entityId: uuid('entity_id').notNull(),

  // Attachment metadata
  attachmentLabel: varchar('attachment_label', { length: 100 }), // e.g., "Workbook", "Bonus PDF"

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Unique constraint: one resource can only attach to same entity once
export const resourceAttachmentsUnique = unique('resource_entity_unique').on(
  resourceAttachments.resourceId,
  resourceAttachments.entityType,
  resourceAttachments.entityId
);
```

**Creator Buckets Table** (`packages/web/src/lib/server/db/schema/creator_buckets.ts`):

```typescript
export const creatorBuckets = pgTable('creator_buckets', {
  creatorId: uuid('creator_id')
    .primaryKey()
    .references(() => users.id),

  // Bucket names
  mediaBucket: varchar('media_bucket', { length: 100 }).notNull(), // 'codex-media-{creatorId}'
  resourcesBucket: varchar('resources_bucket', { length: 100 }).notNull(), // 'codex-resources-{creatorId}'
  assetsBucket: varchar('assets_bucket', { length: 100 }).notNull(), // 'codex-assets-{creatorId}'

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

**Categories & Tags** (same as before):

```typescript
export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).unique().notNull(),
  slug: varchar('slug', { length: 100 }).unique().notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 50 }).unique().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const contentTags = pgTable('content_tags', {
  contentId: uuid('content_id')
    .references(() => content.id, { onDelete: 'cascade' })
    .notNull(),
  tagId: uuid('tag_id')
    .references(() => tags.id, { onDelete: 'cascade' })
    .notNull(),
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
MAX_AUDIO_SIZE=524288000   # 500MB in bytes
MAX_RESOURCE_SIZE=104857600  # 100MB in bytes
```

---

## Testing Strategy

### Unit Tests

**MediaItemsService**:

```typescript
describe('MediaItemsService', () => {
  it('creates media item record', async () => {
    const mediaItem = await mediaItemsService.createMediaItem({
      id: 'media-uuid',
      ownerId: 'creator-uuid',
      type: 'video',
      bucketName: 'codex-media-creator-uuid',
      fileKey: 'originals/media-uuid/video.mp4',
      filename: 'video.mp4',
      fileSize: 1024000,
      mimeType: 'video/mp4',
    });

    expect(mediaItem.id).toBe('media-uuid');
    expect(mediaItem.status).toBe('uploaded');
    expect(mediaItem.type).toBe('video');
  });

  it('prevents deletion if media referenced by content', async () => {
    // Create content referencing media
    await contentService.createContent(
      {
        title: 'Test',
        mediaItemId: 'media-uuid',
        // ...
      },
      'creator-uuid'
    );

    // Attempt to delete media
    await expect(
      mediaItemsService.deleteMediaItem('media-uuid', 'creator-uuid')
    ).rejects.toThrow('Cannot delete media item: referenced by content');
  });
});
```

**ContentService**:

```typescript
describe('ContentService', () => {
  it('creates content referencing media item', async () => {
    const content = await contentService.createContent(
      {
        title: 'Test Video',
        description: 'Test description',
        mediaItemId: 'media-uuid',
        categoryId: 'category-uuid',
        tags: ['test', 'video'],
        price: 29.99,
      },
      'creator-uuid'
    );

    expect(content.id).toBeDefined();
    expect(content.mediaItemId).toBe('media-uuid');
    expect(content.status).toBe('draft');
  });
});
```

**ResourceService**:

```typescript
describe('ResourceService', () => {
  it('attaches resource to multiple content items', async () => {
    const resource = await resourceService.createResource(
      {
        id: 'resource-uuid',
        ownerId: 'creator-uuid',
        bucketName: 'codex-resources-creator-uuid',
        fileKey: 'resource-uuid/workbook.pdf',
        filename: 'workbook.pdf',
        fileSize: 500000,
        mimeType: 'application/pdf',
      },
      'creator-uuid'
    );

    // Attach to content A
    await resourceService.attachResourceToContent(
      'resource-uuid',
      'content-a-uuid',
      'Workbook',
      'creator-uuid'
    );

    // Attach to content B
    await resourceService.attachResourceToContent(
      'resource-uuid',
      'content-b-uuid',
      'Workbook',
      'creator-uuid'
    );

    // Verify attachments
    const attachments = await db.query.resourceAttachments.findMany({
      where: eq(resourceAttachments.resourceId, 'resource-uuid'),
    });

    expect(attachments).toHaveLength(2);
  });
});
```

### Integration Tests

**Media Upload Flow**:

```typescript
describe('Media Upload API', () => {
  it('generates presigned URL for media upload', async () => {
    const response = await POST({
      request: new Request('http://localhost/api/media/presigned-upload', {
        method: 'POST',
        body: JSON.stringify({
          filename: 'video.mp4',
          contentType: 'video/mp4',
          mediaId: 'media-uuid',
        }),
      }),
      locals: { user: mockCreator() },
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.uploadUrl).toBeDefined();
    expect(data.fileKey).toBe('originals/media-uuid/video.mp4');
  });
});
```

---

## Related Documents

- **PRD**: [Content Management PRD](./pdr-phase-1.md)
- **Cross-Feature Dependencies**:
  - [Media Transcoding TDD](../media-transcoding/ttd-dphase-1.md) - Video to HLS conversion
  - [E-Commerce TDD](../e-commerce/ttd-dphase-1.md) - Content pricing
  - [Content Access TDD](../content-access/ttd-dphase-1.md) - Access control
  - [Admin Dashboard TDD](../admin-dashboard/ttd-dphase-1.md) - Management UI
- **Infrastructure**:
  - [R2 Bucket Structure](../../infrastructure/R2BucketStructure.md) - Bucket-per-creator architecture
  - [Database Schema](../../infrastructure/DatabaseSchema.md)
  - [Cloudflare Setup](../../infrastructure/CloudflareSetup.md)
  - [Testing Strategy](../../infrastructure/TestingStrategy.md)

---

**Document Version**: 2.0
**Last Updated**: 2025-10-20
**Status**: Draft - Awaiting Review

# @codex/content Package Documentation

## Overview

The `@codex/content` package provides type-safe, transaction-aware services for managing content and media items in the Codex platform. This package is the core business logic layer for:

- **Content Management**: Create, publish, update, and delete content items (videos, audio, written) with full lifecycle management
- **Media Item Handling**: Upload and track media items through transcoding pipeline with status transitions
- **Creator Scoping**: Enforce creator ownership on all operations with organization support for team-based content
- **Soft Deletes**: Preserve data integrity for historical records and analytics while logically removing items

The package is heavily used by the `content-api` worker to provide RESTful endpoints for content operations.

---

## Public API

### Exported Services

| Export | Type | Purpose | Use When |
|--------|------|---------|----------|
| `ContentService` | Class | Manages content lifecycle (draft to published) | Creating, publishing, or managing content items |
| `MediaItemService` | Class | Manages media items through transcoding pipeline | Uploading media and updating transcoding status |

### Exported Error Classes

| Error | Extends | Purpose | Common Cause |
|-------|---------|---------|--------------|
| `ContentNotFoundError` | `NotFoundError` | Content with ID doesn't exist or doesn't belong to creator | Accessing non-existent content or wrong creator scope |
| `MediaNotFoundError` | `NotFoundError` | Media item doesn't exist or doesn't belong to creator | Referencing deleted or non-existent media |
| `MediaNotReadyError` | `BusinessLogicError` | Media item is not in 'ready' status | Publishing content without finished transcoding |
| `ContentTypeMismatchError` | `BusinessLogicError` | Content type doesn't match media type | Creating video content with audio media |
| `SlugConflictError` | `ConflictError` | Another content item has this slug in same scope | Slug must be unique per organization or creator |
| `MediaOwnershipError` | `ForbiddenError` | Creator doesn't own the media item | Using media from another creator |
| `ContentAlreadyPublishedError` | `BusinessLogicError` | Content is already published | Attempting to publish already-published content |

### Exported Types

| Type | Category | Purpose |
|------|----------|---------|
| `Content`, `NewContent` | Database | Content record from database |
| `MediaItem`, `NewMediaItem` | Database | Media item record from database |
| `ContentWithRelations`, `MediaItemWithRelations` | Domain | Records with populated creator/organization relations |
| `ContentFilters`, `MediaItemFilters` | Query | Filter parameters for list operations |
| `PaginatedResponse<T>`, `PaginationMetadata` | Response | Pagination wrapper and metadata |
| `ServiceConfig`, `Database`, `DatabaseTransaction` | Infrastructure | Service initialization and transaction support |

### Exported Validation Schemas

All Zod validation schemas are re-exported from `@codex/validation` for convenience:
- `createContentSchema`, `updateContentSchema`, `contentQuerySchema`
- `createMediaItemSchema`, `updateMediaItemSchema`, `mediaQuerySchema`
- Enums: `contentStatusEnum`, `contentTypeEnum`, `mediaStatusEnum`, `mediaTypeEnum`, `visibilityEnum`

---

## Core Services

### ContentService

Manages the complete lifecycle of content items from creation through publication.

#### Constructor

```typescript
constructor(config: ServiceConfig): ContentService
```

**Parameters:**
- `config.db: Database` - Drizzle ORM database instance (dbHttp for production)
- `config.environment: string` - Environment name ('development', 'staging', 'production')

**Example:**
```typescript
import { ContentService } from '@codex/content';
import { dbHttp } from '@codex/database';

const contentService = new ContentService({
  db: dbHttp,
  environment: 'production',
});
```

#### Methods

##### create(input: CreateContentInput, creatorId: string): Promise<Content>

Creates a new content item in draft status. Validates media item if provided and enforces slug uniqueness.

**Parameters:**
- `input` - Creation data validated by Zod schema:
  - `title: string` - Content title (required)
  - `slug: string` - URL-friendly slug (required, must be unique per organization)
  - `contentType: 'video' | 'audio' | 'written'` - Type of content (required)
  - `mediaItemId?: string` - ID of media item (optional for written content)
  - `description?: string` - Full description (optional)
  - `visibility?: 'public' | 'private' | 'members_only' | 'purchased_only'` - Access level (default: 'purchased_only')
  - `priceCents?: number` - Price in cents, null = free (optional)
  - `category?: string` - Content category (optional)
  - `tags?: string[]` - Array of tag strings (optional)
  - `thumbnailUrl?: string` - Custom thumbnail URL (optional)
  - `contentBody?: string` - Written content body (optional)
  - `organizationId?: string` - Organization ownership (optional, null = personal)
- `creatorId` - ID of the creator (for authorization and ownership)

**Returns:** Created content record with status='draft', publishedAt=null

**Throws:**
- `ValidationError` - If input fails Zod schema validation
- `MediaNotFoundError` - If mediaItemId provided but doesn't exist or doesn't belong to creator
- `ContentTypeMismatchError` - If content type doesn't match media type
- `SlugConflictError` - If slug already exists in same organization/creator scope

**Transaction:** Yes, atomic operation

**Example:**
```typescript
const newContent = await contentService.create({
  title: 'How to Code in TypeScript',
  slug: 'typescript-tutorial',
  contentType: 'video',
  mediaItemId: 'media-uuid-123',
  description: 'A comprehensive guide to TypeScript',
  visibility: 'public',
  priceCents: 2999, // $29.99
  category: 'Programming',
  tags: ['typescript', 'tutorial', 'beginner'],
}, 'creator-id-123');

// Result:
// {
//   id: 'content-uuid-456',
//   creatorId: 'creator-id-123',
//   mediaItemId: 'media-uuid-123',
//   title: 'How to Code in TypeScript',
//   slug: 'typescript-tutorial',
//   contentType: 'video',
//   status: 'draft',
//   visibility: 'public',
//   priceCents: 2999,
//   publishedAt: null,
//   viewCount: 0,
//   purchaseCount: 0,
//   ...
// }
```

---

##### get(id: string, creatorId: string): Promise<ContentWithRelations | null>

Retrieves a single content item with relations populated (creator, organization, media item).

**Parameters:**
- `id` - Content ID
- `creatorId` - Creator ID for authorization

**Returns:** Content with relations or null if not found

**Security:** Content must belong to the creator (scoped query)

**Example:**
```typescript
const content = await contentService.get('content-id-123', 'creator-id-123');

if (!content) {
  console.log('Content not found or does not belong to creator');
  return;
}

console.log(content.title); // 'How to Code in TypeScript'
console.log(content.creator.name); // Creator info populated
console.log(content.mediaItem.hlsMasterPlaylistKey); // HLS playlist URL
```

---

##### update(id: string, input: UpdateContentInput, creatorId: string): Promise<Content>

Updates content metadata. The mediaItemId is immutable after creation.

**Parameters:**
- `id` - Content ID
- `input` - Partial update data (all fields optional):
  - `title?: string`
  - `slug?: string` - Cannot duplicate existing slug in same scope
  - `description?: string`
  - `visibility?: string`
  - `priceCents?: number`
  - `category?: string`
  - `tags?: string[]`
  - `thumbnailUrl?: string`
  - `contentBody?: string`
- `creatorId` - Creator ID for authorization

**Returns:** Updated content record

**Throws:**
- `ContentNotFoundError` - If content doesn't exist
- `SlugConflictError` - If new slug conflicts with existing content
- `ValidationError` - If input fails validation

**Transaction:** Yes, atomic operation

**Example:**
```typescript
const updated = await contentService.update(
  'content-id-123',
  {
    title: 'Advanced TypeScript Guide',
    priceCents: 3999, // $39.99
    category: 'Advanced Programming',
  },
  'creator-id-123'
);
```

---

##### publish(id: string, creatorId: string): Promise<Content>

Publishes content by setting status to 'published' and publishedAt timestamp. Validates that media is ready (if video/audio).

**Parameters:**
- `id` - Content ID
- `creatorId` - Creator ID for authorization

**Returns:** Published content record with status='published' and publishedAt timestamp

**Throws:**
- `ContentNotFoundError` - If content doesn't exist
- `BusinessLogicError` - If content lacks required media or media is not ready
- `MediaNotReadyError` - If media status is not 'ready'

**Behavior:** Idempotent (returns existing published content if already published)

**Transaction:** Yes, validates media in transaction

**Example:**
```typescript
// Create and publish workflow
const draft = await contentService.create({ /* ... */ }, 'creator-id');

// ... after media transcoding completes ...

const published = await contentService.publish(draft.id, 'creator-id');
console.log(published.status); // 'published'
console.log(published.publishedAt); // Current timestamp
```

---

##### unpublish(id: string, creatorId: string): Promise<Content>

Unpublishes content by setting status back to 'draft'. Keeps publishedAt for history.

**Parameters:**
- `id` - Content ID
- `creatorId` - Creator ID for authorization

**Returns:** Unpublished content record with status='draft'

**Throws:**
- `ContentNotFoundError` - If content doesn't exist

**Example:**
```typescript
const unpublished = await contentService.unpublish('content-id-123', 'creator-id');
console.log(unpublished.status); // 'draft'
console.log(unpublished.publishedAt); // Original publish timestamp preserved
```

---

##### delete(id: string, creatorId: string): Promise<void>

Soft deletes content by setting deletedAt timestamp. Content remains queryable but is excluded from normal list operations.

**Parameters:**
- `id` - Content ID
- `creatorId` - Creator ID for authorization

**Throws:**
- `ContentNotFoundError` - If content doesn't exist

**Data Preservation:** All data preserved in database for analytics and history

**Example:**
```typescript
await contentService.delete('content-id-123', 'creator-id');
// Content no longer appears in list() but data exists for auditing
```

---

##### list(creatorId: string, filters?: ContentFilters, pagination?: PaginationParams): Promise<PaginatedResponse<ContentWithRelations>>

Lists content with comprehensive filtering, searching, and sorting. All results are scoped to the creator.

**Parameters:**
- `creatorId` - Creator ID for authorization
- `filters` - Optional filter object:
  - `status?: 'draft' | 'published' | 'archived'` - Filter by status
  - `contentType?: 'video' | 'audio' | 'written'` - Filter by content type
  - `visibility?: 'public' | 'private' | 'members_only' | 'purchased_only'` - Filter by visibility
  - `category?: string` - Filter by category
  - `organizationId?: string | null` - Filter by organization (null = personal content)
  - `search?: string` - Full-text search on title and description
  - `sortBy?: 'createdAt' | 'updatedAt' | 'publishedAt' | 'title' | 'viewCount' | 'purchaseCount'` - Sort field
  - `sortOrder?: 'asc' | 'desc'` - Sort direction
- `pagination` - Optional pagination (default: page=1, limit=20):
  - `page: number` - 1-indexed page number
  - `limit: number` - Results per page

**Returns:**
```typescript
{
  items: ContentWithRelations[], // Content records with relations
  pagination: {
    page: number,         // Current page
    limit: number,        // Per-page limit
    total: number,        // Total count
    totalPages: number    // Calculated total pages
  }
}
```

**Example:**
```typescript
// Get published videos, page 2
const result = await contentService.list(
  'creator-id-123',
  {
    status: 'published',
    contentType: 'video',
    sortBy: 'publishedAt',
    sortOrder: 'desc',
  },
  { page: 2, limit: 20 }
);

console.log(result.items.length); // Up to 20 items
console.log(result.pagination.total); // 47 total published videos
console.log(result.pagination.totalPages); // 3 pages

// Full-text search
const searchResult = await contentService.list(
  'creator-id-123',
  {
    search: 'typescript',
    status: 'published',
  }
);
```

---

### MediaItemService

Manages media items (uploaded videos/audio) through the upload and transcoding pipeline.

#### Constructor

```typescript
constructor(config: ServiceConfig): MediaItemService
```

**Parameters:** Same as ContentService

**Example:**
```typescript
import { MediaItemService } from '@codex/content';
import { dbHttp } from '@codex/database';

const mediaService = new MediaItemService({
  db: dbHttp,
  environment: 'production',
});
```

#### Methods

##### create(input: CreateMediaItemInput, creatorId: string): Promise<MediaItem>

Creates a new media item record with status='uploading'. The actual file upload happens separately.

**Parameters:**
- `input` - Creation data:
  - `title: string` - Media title (required)
  - `description?: string` - Description (optional)
  - `mediaType: 'video' | 'audio'` - Type of media (required)
  - `r2Key: string` - R2 storage key for original file (required)
  - `fileSizeBytes: number` - File size in bytes (required)
  - `mimeType: string` - MIME type (required)
- `creatorId` - ID of the creator (uploader)

**Returns:** Media item record with status='uploading'

**Example:**
```typescript
const mediaItem = await mediaService.create({
  title: 'TypeScript Tutorial Video',
  description: 'Full video recording',
  mediaType: 'video',
  r2Key: 'originals/media-uuid-123/typescript-tutorial.mp4',
  fileSizeBytes: 1073741824, // 1 GB
  mimeType: 'video/mp4',
}, 'creator-id-123');

console.log(mediaItem.status); // 'uploading'
```

---

##### get(id: string, creatorId: string): Promise<MediaItemWithRelations | null>

Retrieves a media item with creator relation populated.

**Parameters:**
- `id` - Media item ID
- `creatorId` - Creator ID for authorization

**Returns:** Media item with relations or null if not found

**Example:**
```typescript
const media = await mediaService.get('media-id-123', 'creator-id-123');
console.log(media?.status); // 'uploading', 'uploaded', 'transcoding', 'ready', or 'failed'
```

---

##### update(id: string, input: UpdateMediaItemInput, creatorId: string): Promise<MediaItem>

Updates media item metadata. Common updates include status changes and transcoding output keys.

**Parameters:**
- `id` - Media item ID
- `input` - Partial update data:
  - `title?: string`
  - `description?: string`
  - `status?: 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed'`
  - `hlsMasterPlaylistKey?: string` - HLS master playlist location
  - `thumbnailKey?: string` - Thumbnail image location
  - `durationSeconds?: number` - Duration in seconds
  - `width?: number` - Video width in pixels
  - `height?: number` - Video height in pixels
  - `uploadedAt?: Date` - When transcoding completed
- `creatorId` - Creator ID for authorization

**Returns:** Updated media item

**Throws:**
- `MediaNotFoundError` - If media doesn't exist
- `ValidationError` - If input fails validation

**Example:**
```typescript
// After transcoding completes, update with HLS and metadata
const updated = await mediaService.update(
  'media-id-123',
  {
    status: 'ready',
    hlsMasterPlaylistKey: 'hls/media-uuid-123/master.m3u8',
    thumbnailKey: 'thumbnails/media-uuid-123/thumbnail.jpg',
    durationSeconds: 1247,
    width: 1920,
    height: 1080,
    uploadedAt: new Date(),
  },
  'creator-id-123'
);

console.log(updated.status); // 'ready'
```

---

##### updateStatus(id: string, status: MediaItemStatus, creatorId: string): Promise<MediaItem>

Convenience method to update only the status. Common transitions:
- 'uploading' -> 'uploaded' (after S3 upload completes)
- 'uploaded' -> 'transcoding' (transcoding service starts)
- 'transcoding' -> 'ready' (transcoding complete)
- 'transcoding' -> 'failed' (transcoding failed)

**Parameters:**
- `id` - Media item ID
- `status` - New status value
- `creatorId` - Creator ID for authorization

**Returns:** Updated media item

**Example:**
```typescript
// File upload completed
const updated = await mediaService.updateStatus(
  'media-id-123',
  'uploaded',
  'creator-id-123'
);

// Transcoding started
await mediaService.updateStatus('media-id-123', 'transcoding', 'creator-id-123');

// Transcoding failed
await mediaService.updateStatus('media-id-123', 'failed', 'creator-id-123');
```

---

##### markAsReady(id: string, metadata: TranscodingMetadata, creatorId: string): Promise<MediaItem>

Convenience method called by transcoding service when HLS generation is complete. Sets status='ready' and populates all transcoding metadata.

**Parameters:**
- `id` - Media item ID
- `metadata` - Transcoding output metadata:
  - `hlsMasterPlaylistKey: string` - Location of master.m3u8
  - `thumbnailKey: string` - Location of thumbnail image
  - `durationSeconds: number` - Media duration
  - `width?: number` - Video width (optional)
  - `height?: number` - Video height (optional)
- `creatorId` - Creator ID for authorization

**Returns:** Updated media item with status='ready'

**Example:**
```typescript
const ready = await mediaService.markAsReady(
  'media-id-123',
  {
    hlsMasterPlaylistKey: 'hls/media-uuid-123/master.m3u8',
    thumbnailKey: 'thumbnails/media-uuid-123/thumbnail.jpg',
    durationSeconds: 1247,
    width: 1920,
    height: 1080,
  },
  'creator-id-123'
);

console.log(ready.status); // 'ready'
console.log(ready.uploadedAt); // Current timestamp
```

---

##### delete(id: string, creatorId: string): Promise<void>

Soft deletes media item by setting deletedAt timestamp. Content referencing this media will still exist but cannot be published.

**Parameters:**
- `id` - Media item ID
- `creatorId` - Creator ID for authorization

**Throws:**
- `MediaNotFoundError` - If media doesn't exist

**Example:**
```typescript
await mediaService.delete('media-id-123', 'creator-id-123');
```

---

##### list(creatorId: string, filters?: MediaItemFilters, pagination?: PaginationParams): Promise<PaginatedResponse<MediaItemWithRelations>>

Lists media items with filtering and pagination. All results are scoped to the creator.

**Parameters:**
- `creatorId` - Creator ID for authorization
- `filters` - Optional filter object:
  - `status?: 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed'` - Filter by status
  - `mediaType?: 'video' | 'audio'` - Filter by type
  - `sortBy?: 'createdAt' | 'uploadedAt' | 'title'` - Sort field
  - `sortOrder?: 'asc' | 'desc'` - Sort direction
- `pagination` - Optional pagination (default: page=1, limit=20)

**Returns:** Paginated response with media items and metadata

**Example:**
```typescript
// Get all ready videos
const result = await mediaService.list(
  'creator-id-123',
  {
    status: 'ready',
    mediaType: 'video',
    sortBy: 'uploadedAt',
    sortOrder: 'desc',
  },
  { page: 1, limit: 50 }
);

console.log(result.items.length); // Ready videos
console.log(result.pagination.total); // Total ready video count
```

---

## Content Lifecycle

The content service implements a state machine workflow for content:

```
CREATION PHASE:
  create() -> status='draft', publishedAt=null

EDITING PHASE (optional):
  update() -> modify metadata while draft

MEDIA PREPARATION:
  MediaItemService updates media status through pipeline:
    'uploading' -> 'uploaded' -> 'transcoding' -> 'ready'

PUBLISHING PHASE:
  publish() -> status='published', publishedAt=now
    - Validates media.status='ready' (if video/audio)
    - Sets publishedAt timestamp
    - Idempotent if already published

DISTRIBUTION:
  Content is now visible to audience based on visibility settings

UNPUBLISHING (optional):
  unpublish() -> status='draft' (reverts to draft)
    - publishedAt preserved for history

DELETION:
  delete() -> sets deletedAt (soft delete)
    - Content still in database
    - Excluded from normal list operations
    - Data preserved for analytics
```

### Example: Complete Workflow

```typescript
import { ContentService, MediaItemService } from '@codex/content';
import { dbHttp } from '@codex/database';

const creatorId = 'creator-123';
const environment = 'production';

const contentService = new ContentService({ db: dbHttp, environment });
const mediaService = new MediaItemService({ db: dbHttp, environment });

// Step 1: Create media item (user uploads file)
const mediaItem = await mediaService.create({
  title: 'My Video',
  mediaType: 'video',
  r2Key: 'originals/media-123/video.mp4',
  fileSizeBytes: 1024000000,
  mimeType: 'video/mp4',
}, creatorId);

console.log(mediaItem.status); // 'uploading'

// Step 2: Create content in draft (while media is uploading)
const content = await contentService.create({
  title: 'My Awesome Video',
  slug: 'my-awesome-video',
  contentType: 'video',
  mediaItemId: mediaItem.id,
  description: 'Check this out!',
  visibility: 'public',
  priceCents: 0,
}, creatorId);

console.log(content.status); // 'draft'

// Step 3: Update media as it progresses through pipeline
await mediaService.updateStatus(mediaItem.id, 'uploaded', creatorId);
// -> Upload to S3 completes

await mediaService.updateStatus(mediaItem.id, 'transcoding', creatorId);
// -> Transcoding service picks it up

// Step 4: Mark media ready (transcoding complete)
const readyMedia = await mediaService.markAsReady(
  mediaItem.id,
  {
    hlsMasterPlaylistKey: 'hls/media-123/master.m3u8',
    thumbnailKey: 'thumbnails/media-123/thumb.jpg',
    durationSeconds: 600,
    width: 1920,
    height: 1080,
  },
  creatorId
);

console.log(readyMedia.status); // 'ready'

// Step 5: Publish content
const published = await contentService.publish(content.id, creatorId);

console.log(published.status); // 'published'
console.log(published.publishedAt); // Current timestamp

// Step 6: Content is now live and viewable
```

---

## Usage Examples

### Example 1: Creating and Publishing Video Content

```typescript
import { ContentService, MediaItemService } from '@codex/content';
import { dbHttp } from '@codex/database';

const contentService = new ContentService({ db: dbHttp, environment: 'production' });
const mediaService = new MediaItemService({ db: dbHttp, environment: 'production' });

const creatorId = 'user-123';

// Create media item after upload
const media = await mediaService.create({
  title: 'Learn TypeScript',
  description: 'A comprehensive tutorial',
  mediaType: 'video',
  r2Key: 'originals/abc-123/learn-typescript.mp4',
  fileSizeBytes: 2147483648, // 2 GB
  mimeType: 'video/mp4',
}, creatorId);

// Create content draft
const content = await contentService.create({
  title: 'Learn TypeScript - Complete Guide',
  slug: 'learn-typescript-complete-guide',
  description: 'Master TypeScript from basics to advanced',
  contentType: 'video',
  mediaItemId: media.id,
  category: 'Programming',
  tags: ['typescript', 'javascript', 'tutorial'],
  visibility: 'public',
  priceCents: 4999, // $49.99
}, creatorId);

// When transcoding is complete, mark media ready
await mediaService.markAsReady(
  media.id,
  {
    hlsMasterPlaylistKey: 'hls/abc-123/master.m3u8',
    thumbnailKey: 'thumbnails/abc-123/cover.jpg',
    durationSeconds: 7200, // 2 hours
    width: 1920,
    height: 1080,
  },
  creatorId
);

// Publish content
const published = await contentService.publish(content.id, creatorId);
console.log(`Content published: ${published.title}`);
```

---

### Example 2: Listing Content with Filters

```typescript
import { ContentService } from '@codex/content';

const contentService = new ContentService({ db: dbHttp, environment: 'production' });
const creatorId = 'user-123';

// Get all published videos
const videoResult = await contentService.list(
  creatorId,
  {
    status: 'published',
    contentType: 'video',
    sortBy: 'publishedAt',
    sortOrder: 'desc',
  },
  { page: 1, limit: 20 }
);

console.log(`Found ${videoResult.pagination.total} published videos`);
videoResult.items.forEach((item) => {
  console.log(`- ${item.title} (${item.viewCount} views)`);
});

// Search for specific content
const searchResult = await contentService.list(
  creatorId,
  {
    search: 'typescript',
    status: 'published',
    sortBy: 'viewCount',
    sortOrder: 'desc',
  }
);

console.log(`Search results for "typescript": ${searchResult.items.length} items`);
```

---

### Example 3: Error Handling

```typescript
import {
  ContentService,
  ContentNotFoundError,
  MediaNotReadyError,
  SlugConflictError,
  wrapError,
} from '@codex/content';

const contentService = new ContentService({ db: dbHttp, environment: 'production' });

try {
  const content = await contentService.create({
    title: 'My Content',
    slug: 'my-content',
    contentType: 'video',
    mediaItemId: 'media-123',
  }, 'creator-123');
} catch (error) {
  if (error instanceof SlugConflictError) {
    console.error('Slug already taken:', error.message);
    // Suggest alternative slug to user
  } else if (error instanceof MediaNotFoundError) {
    console.error('Media item not found or does not belong to creator');
  } else {
    console.error('Unexpected error:', error);
  }
}

// Publishing without ready media
try {
  const published = await contentService.publish('content-123', 'creator-123');
} catch (error) {
  if (error instanceof MediaNotReadyError) {
    console.error('Media is still transcoding, cannot publish yet');
    // Wait and retry later
  } else if (error instanceof ContentNotFoundError) {
    console.error('Content does not exist');
  }
}

// Scoping enforcement
try {
  // Try to access another creator's content
  const other = await contentService.get('content-from-other-creator', 'my-creator-id');
  if (!other) {
    console.log('Content not found (this creator does not own it)');
  }
} catch (error) {
  throw wrapError(error, { attemptedAccess: 'cross-creator' });
}
```

---

## Media Management

### Upload Pipeline

Media items follow a strict state progression:

```
'uploading' - Initial state when record created
    |
    v
'uploaded' - File successfully uploaded to R2
    |
    v
'transcoding' - HLS transcoding in progress
    |
    +---> 'ready' - Transcoding complete, HLS playlist available
    |
    +---> 'failed' - Transcoding failed, cannot use for content
```

### Status Transitions

- **uploading -> uploaded**: After S3/R2 upload completes
- **uploaded -> transcoding**: When transcoding service picks up the job
- **transcoding -> ready**: When HLS playlist and thumbnail generated
- **transcoding -> failed**: If transcoding encounters an error

### Media Readiness Requirements

Before content can be published, the media must be in 'ready' status:

```typescript
// This will fail - media not ready yet
const published = await contentService.publish('content-123', 'creator-123');
// Error: MediaNotReadyError - Media item not ready for publishing

// This succeeds - media is ready
const readyMedia = await mediaService.get('media-123', 'creator-123');
if (readyMedia.status === 'ready') {
  const published = await contentService.publish('content-123', 'creator-123');
  // Success!
}
```

### Media Metadata

Once transcoding completes, the following metadata is captured:

```typescript
interface TranscodingMetadata {
  hlsMasterPlaylistKey: string;    // "hls/{id}/master.m3u8"
  thumbnailKey: string;            // "thumbnails/{id}/thumb.jpg"
  durationSeconds: number;         // Length of media in seconds
  width?: number;                  // Video width in pixels
  height?: number;                 // Video height in pixels
}
```

Example after transcoding:
```typescript
const media = await mediaService.get('media-123', 'creator-123');

// Media metadata available
console.log(media.hlsMasterPlaylistKey);  // "hls/abc-123/master.m3u8"
console.log(media.durationSeconds);       // 1247 seconds (20:47)
console.log(media.width, media.height);   // 1920, 1080
```

---

## Creator Scoping

All operations are scoped to the creator. This ensures data isolation between users.

### Scoping Rules

1. **All queries filter by creatorId**: No query returns data from other creators
2. **Write operations enforce ownership**: Cannot modify another creator's content or media
3. **Soft deletes respect scoping**: Deleted items are excluded from scoped queries

### Examples

```typescript
const creatorId = 'creator-123';
const otherCreatorId = 'other-creator-456';

// Create content
const content = await contentService.create({
  title: 'My Content',
  slug: 'my-content',
  contentType: 'video',
}, creatorId);

// Own creator can retrieve it
const found = await contentService.get(content.id, creatorId);
console.log(found); // Returns content

// Other creator cannot retrieve it (scoped)
const notFound = await contentService.get(content.id, otherCreatorId);
console.log(notFound); // null - access denied via scoping

// Other creator cannot modify it (scoped)
try {
  await contentService.update(
    content.id,
    { title: 'Hacked!' },
    otherCreatorId
  );
} catch (error) {
  // ContentNotFoundError - effectively denied access
}

// List operations are automatically scoped
const ownContent = await contentService.list(creatorId);
console.log(ownContent.items.length); // Creator's items only

const otherContent = await contentService.list(otherCreatorId);
console.log(otherContent.items.length); // Different creator's items only
```

### Organization Scoping

Content can belong to an organization or a creator's personal profile:

```typescript
// Personal content (null organization)
const personal = await contentService.create({
  title: 'My Personal Video',
  slug: 'my-personal-video',
  contentType: 'video',
  organizationId: null, // Personal
}, creatorId);

// Organization content
const orgContent = await contentService.create({
  title: 'Company Training Video',
  slug: 'company-training',
  contentType: 'video',
  organizationId: 'org-123', // Organization-owned
}, creatorId); // Still requires creator for audit trail

// Filter by organization
const result = await contentService.list(
  creatorId,
  { organizationId: 'org-123' } // Only org content
);

// Filter personal-only
const personalResult = await contentService.list(
  creatorId,
  { organizationId: null } // Only personal content
);
```

---

## Soft Deletes

All deletion operations are soft deletes - data is preserved with a deletedAt timestamp.

### Data Preservation Benefits

- **Purchase History**: Customers can still view/download purchased content
- **Analytics**: Historical view counts and revenue maintained
- **Compliance**: Content available for data export/GDPR requests
- **Recovery**: Deleted content can be restored (if feature implemented)

### Soft Delete Behavior

```typescript
// Before delete
const before = await contentService.get('content-123', 'creator-123');
console.log(before.deletedAt); // null

// Delete content (soft delete)
await contentService.delete('content-123', 'creator-123');

// After delete - cannot retrieve via normal queries
const after = await contentService.get('content-123', 'creator-123');
console.log(after); // null (excluded from scoped queries)

// List excludes deleted items
const list = await contentService.list('creator-123');
console.log(list.items.find(c => c.id === 'content-123')); // undefined (excluded)
```

### Restoration (Future Feature)

When restoring is implemented, simply clear the deletedAt:

```typescript
// Potential future API
await contentService.restore('content-123', 'creator-123');
// Would set deletedAt = null
```

---

## Integration Points

### Service Dependencies

The `@codex/content` package depends on:

| Package | Purpose | Usage |
|---------|---------|-------|
| `@codex/database` | Drizzle ORM and Neon PostgreSQL | Database queries and transactions |
| `@codex/validation` | Zod schemas for input validation | Validates all CreateContentInput, UpdateContentInput, etc. |
| `@codex/service-errors` | Base error classes and utilities | Extends NotFoundError, BusinessLogicError, etc. |
| `@codex/identity` | Organization types | Type imports for Organization |
| `@codex/observability` | Optional logging | Used by BaseService for observability |

### Service Dependents

Packages/workers that import from `@codex/content`:

| Dependent | Usage |
|-----------|-------|
| `content-api` worker | Creates service instances in route handlers |
| `content-access` worker | Checks content permissions/visibility |
| Integration tests | Uses services directly to set up test data |

### Data Flow in content-api Worker

```
HTTP Request
    |
    v
Route Handler (withPolicy authentication)
    |
    v
Create ServiceInstance (ContentService or MediaItemService)
    |
    v
Call Service Method (create, publish, list, etc.)
    |
    v
Service performs database operation (Drizzle)
    |
    v
Service returns typed result
    |
    v
Handler returns HTTP response (CreateContentResponse, etc.)
```

Example route handler:

```typescript
import { ContentService } from '@codex/content';
import { dbHttp } from '@codex/database';

app.post('/api/content', withPolicy(...), createAuthenticatedHandler({
  schema: { body: createContentSchema },
  handler: async (_c, ctx) => {
    // Service created per request
    const service = new ContentService({
      db: dbHttp,
      environment: ctx.env.ENVIRONMENT,
    });

    // Service method called
    const content = await service.create(ctx.validated.body, ctx.user.id);

    // Result returned to client
    return { data: content };
  },
}));
```

---

## Error Handling

### Error Class Hierarchy

All content errors extend from `@codex/service-errors` base classes:

```
ServiceError (base)
├── NotFoundError
│   ├── ContentNotFoundError
│   └── MediaNotFoundError
├── BusinessLogicError
│   ├── MediaNotReadyError
│   ├── ContentTypeMismatchError
│   └── ContentAlreadyPublishedError
├── ConflictError
│   └── SlugConflictError
├── ForbiddenError
│   └── MediaOwnershipError
└── ValidationError (from Zod)
```

### Error Handling Patterns

#### Pattern 1: Specific Error Catching

```typescript
try {
  const content = await contentService.create(input, creatorId);
} catch (error) {
  if (error instanceof SlugConflictError) {
    // Handle slug conflict
    res.status(409).json({ error: 'Slug already in use' });
  } else if (error instanceof MediaNotFoundError) {
    // Handle missing media
    res.status(404).json({ error: 'Media item not found' });
  } else if (error instanceof ValidationError) {
    // Handle validation failure
    res.status(400).json({ error: error.message, details: error.details });
  } else {
    // Handle unexpected error
    throw error;
  }
}
```

#### Pattern 2: isContentServiceError() Check

```typescript
import { isContentServiceError } from '@codex/content';

try {
  const content = await contentService.create(input, creatorId);
} catch (error) {
  if (isContentServiceError(error)) {
    // All content-related errors handled here
    console.error(`Service error: ${error.code}`, error.context);
    res.status(error.statusCode).json({ error: error.message });
  } else {
    // Unexpected error, log and report
    logger.error('Unexpected error:', error);
    throw error;
  }
}
```

#### Pattern 3: Using mapErrorToResponse()

The package provides a utility to convert errors to HTTP responses:

```typescript
import { mapErrorToResponse } from '@codex/content';

try {
  const content = await contentService.create(input, creatorId);
  return { data: content };
} catch (error) {
  const response = mapErrorToResponse(error);
  return new Response(JSON.stringify(response), {
    status: response.statusCode,
    headers: { 'content-type': 'application/json' },
  });
}
```

### Common Error Scenarios

| Error | Cause | Recovery |
|-------|-------|----------|
| `SlugConflictError` | Content with slug exists in scope | Suggest alternative slug |
| `MediaNotFoundError` | Media ID doesn't exist | User selects different media |
| `MediaNotReadyError` | Attempting to publish before transcoding | Wait for transcoding to complete |
| `ContentNotFoundError` | Content ID doesn't exist | Check ID, may be deleted |
| `ValidationError` | Input doesn't match schema | Return validation errors to client |
| `ContentTypeMismatchError` | Video content with audio media | Select correct media type |

---

## Transactions

The package uses database transactions to ensure atomicity of multi-step operations.

### Transactional Operations

The following operations use transactions:

1. **ContentService.create()** - Validates media + creates content atomically
2. **ContentService.update()** - Verifies ownership + updates atomically
3. **ContentService.publish()** - Validates media ready + publishes atomically
4. **ContentService.unpublish()** - State change in transaction
5. **ContentService.delete()** - Soft delete in transaction
6. **MediaItemService.update()** - Verify ownership + update atomically
7. **MediaItemService.delete()** - Soft delete in transaction

### Transaction Guarantees

- **Atomicity**: Operation either fully succeeds or fully fails
- **Isolation**: No partial updates visible to other connections
- **Consistency**: Scoping rules and constraints enforced
- **Error Rollback**: Failed operations automatically rollback

### Example: Transactional Create

```typescript
// This operation is atomic:
try {
  const content = await contentService.create(input, creatorId);
  // Both validations and insert succeed together, or both fail
} catch (error) {
  // If validation fails, insert never happens
  // If insert fails, no partial data exists
}
```

---

## Testing

### Test Setup

The package uses `@codex/test-utils` for test infrastructure:

```typescript
import {
  setupTestDatabase,
  teardownTestDatabase,
  seedTestUsers,
  createTestMediaItemInput,
  withNeonTestBranch,
} from '@codex/test-utils';
import { ContentService } from '@codex/content';

// Enable ephemeral Neon branch for test file
withNeonTestBranch();

describe('ContentService', () => {
  let db: Database;
  let service: ContentService;
  let creatorId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new ContentService({ db, environment: 'test' });
    const [userId] = await seedTestUsers(db, 1);
    creatorId = userId;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  // Tests here
});
```

### Testing Service Methods

#### Testing create() with media

```typescript
it('should create video content', async () => {
  // Arrange: Create ready media
  const [media] = await db
    .insert(mediaItems)
    .values(createTestMediaItemInput(creatorId, {
      mediaType: 'video',
      status: 'ready',
    }))
    .returning();

  // Act
  const result = await service.create({
    title: 'Test Video',
    slug: 'test-video',
    contentType: 'video',
    mediaItemId: media.id,
  }, creatorId);

  // Assert
  expect(result.id).toBeDefined();
  expect(result.status).toBe('draft');
  expect(result.mediaItemId).toBe(media.id);
});
```

#### Testing error conditions

```typescript
it('should throw MediaNotReadyError when media not ready', async () => {
  // Create media in uploading status
  const [media] = await db
    .insert(mediaItems)
    .values(createTestMediaItemInput(creatorId, {
      mediaType: 'video',
      status: 'uploading', // Not ready
    }))
    .returning();

  // Create content with non-ready media
  const content = await service.create({
    title: 'Test',
    slug: 'test',
    contentType: 'video',
    mediaItemId: media.id,
  }, creatorId);

  // Try to publish - should fail
  await expect(() =>
    service.publish(content.id, creatorId)
  ).rejects.toThrow(MediaNotReadyError);
});
```

#### Testing scoping

```typescript
it('should not allow access to other creator content', async () => {
  const otherCreatorId = 'other-creator';

  // Create content as first creator
  const content = await service.create({
    title: 'Private Content',
    slug: 'private',
    contentType: 'written',
  }, creatorId);

  // Other creator cannot access
  const result = await service.get(content.id, otherCreatorId);
  expect(result).toBeNull();
});
```

### Testing Patterns

1. **Arrange-Act-Assert**: Clear test structure
2. **Test Setup Helpers**: Use `createTestMediaItemInput()`, `seedTestUsers()`
3. **Ephemeral Database**: Each test file gets fresh Neon branch
4. **No Cleanup**: Branches automatically cleanup after tests
5. **Isolation**: Each test file has independent database state

### Recommended Test Coverage

- Create operations (valid, invalid, edge cases)
- Retrieval operations (existing, missing, scoped)
- Update operations (fields, permissions, validation)
- State transitions (publish, unpublish, delete)
- List operations (filtering, sorting, pagination)
- Error conditions (all error types)
- Scoping (creator isolation, organization filtering)
- Transactions (atomicity, rollback)

---

## Summary

The `@codex/content` package provides production-ready services for:

1. **Complete Content Lifecycle**: Draft to published with full workflow support
2. **Media Management**: Upload to transcoding completion with status tracking
3. **Creator Isolation**: Automatic scoping ensures data privacy
4. **Error Handling**: Domain-specific errors for clear error recovery
5. **Transaction Safety**: Atomic operations prevent partial updates
6. **Data Preservation**: Soft deletes maintain history and compliance

Use this package as the core service layer for all content operations in the Codex platform.

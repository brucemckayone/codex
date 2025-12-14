# @codex/content Package Documentation

## Overview

The `@codex/content` package provides type-safe, transaction-aware services for managing content and media items in the Codex platform. This package implements the complete lifecycle for:

- **Content Management**: Create, publish, update, and delete content items (videos, audio, written) with full lifecycle from draft to published to deleted
- **Media Item Handling**: Upload and track media items through transcoding pipeline with status transitions (uploading → uploaded → transcoding → ready/failed)
- **Creator Scoping**: Enforce creator ownership on all operations with automatic organization support for team-based content
- **Soft Deletes**: Preserve data integrity for historical records, analytics, and compliance while logically removing items

The package is the core business logic layer used by the `content-api` worker to provide RESTful endpoints for all content operations.

---

## Public API

### Exported Services

| Export | Type | Purpose | Use When |
|--------|------|---------|----------|
| `ContentService` | Class | Manages content lifecycle (draft to published) | Creating, publishing, or managing content items |
| `MediaItemService` | Class | Manages media items through transcoding pipeline | Uploading media and updating transcoding status |

### Exported Error Classes

| Error | Extends | Purpose | Common Cause | HTTP Status |
|-------|---------|---------|--------------|-------------|
| `ContentNotFoundError` | `NotFoundError` | Content with ID doesn't exist or doesn't belong to creator | Accessing non-existent content or wrong creator scope | 404 |
| `MediaNotFoundError` | `NotFoundError` | Media item doesn't exist or doesn't belong to creator | Referencing deleted or non-existent media | 404 |
| `MediaNotReadyError` | `BusinessLogicError` | Media item is not in 'ready' status | Publishing content without finished transcoding | 422 |
| `ContentTypeMismatchError` | `BusinessLogicError` | Content type doesn't match media type | Creating video content with audio media | 422 |
| `SlugConflictError` | `ConflictError` | Another content item has this slug in same scope | Slug must be unique per organization/creator | 409 |
| `MediaOwnershipError` | `ForbiddenError` | Creator doesn't own the media item | Using media from another creator | 403 |
| `ContentAlreadyPublishedError` | `BusinessLogicError` | Content is already published | Attempting to publish already-published content | 422 |

All errors extend from `@codex/service-errors` base classes and are mapped to standardized HTTP responses.

### Exported Types

| Type | Category | Purpose | Usage |
|------|----------|---------|-------|
| `Content`, `NewContent` | Database | Content record from database schema | Service method returns |
| `MediaItem`, `NewMediaItem` | Database | Media item record from database schema | Service method returns |
| `ContentWithRelations`, `MediaItemWithRelations` | Domain | Records with populated creator/organization/media relations | API response bodies |
| `ContentFilters`, `MediaItemFilters` | Query | Filter parameters for list operations | List method arguments |
| `PaginatedResponse<T>`, `PaginationMetadata` | Response | Pagination wrapper and metadata | List method returns |
| `ServiceConfig`, `Database`, `DatabaseTransaction` | Infrastructure | Service initialization and transaction support | Service constructor |
| `PaginationParams` | Query | Pagination parameters (page, limit) | List method arguments |
| `SortOrder` | Query | Sort direction ('asc' or 'desc') | List method filters |

### Exported Validation Schemas

All Zod validation schemas are re-exported from `@codex/validation` for convenience:

**Content schemas**:
- `createContentSchema` - Validates POST /api/content request body
- `updateContentSchema` - Validates PATCH /api/content/:id request body
- `contentQuerySchema` - Validates query parameters for list operations

**Media schemas**:
- `createMediaItemSchema` - Validates POST /api/media request body
- `updateMediaItemSchema` - Validates PATCH /api/media/:id request body
- `mediaQuerySchema` - Validates query parameters for media list

**Enums**:
- `contentStatusEnum` - 'draft' | 'published' | 'archived'
- `contentTypeEnum` - 'video' | 'audio' | 'written'
- `mediaStatusEnum` - 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed'
- `mediaTypeEnum` - 'video' | 'audio'
- `visibilityEnum` - 'public' | 'private' | 'members_only' | 'purchased_only'

---

## Core Services

### ContentService

Manages the complete lifecycle of content items from creation through publication to deletion.

#### Constructor

```typescript
constructor(config: ServiceConfig): ContentService
```

**Parameters:**
- `config.db: Database` - Drizzle ORM database instance (dbHttp for production, dbWs for tests)
- `config.environment: string` - Environment name ('development', 'staging', 'production')

**Inheritance**: Extends `BaseService` from `@codex/service-errors` for dependency injection and error mapping

**Example:**
```typescript
import { ContentService } from '@codex/content';
import { dbHttp } from '@codex/database';

const contentService = new ContentService({
  db: dbHttp,
  environment: 'production',
});
```

#### Method: create()

Creates a new content item in draft status. Validates media item if provided and enforces slug uniqueness within creator/organization scope.

```typescript
async create(input: CreateContentInput, creatorId: string): Promise<Content>
```

**Parameters:**
- `input` - Creation data validated by Zod schema:
  - `title: string` - Content title (required, 1-255 chars)
  - `slug: string` - URL-friendly slug (required, must be unique per organization/creator scope)
  - `contentType: 'video' | 'audio' | 'written'` - Type of content (required)
  - `mediaItemId?: string` - ID of media item (optional, required for video/audio, forbidden for written)
  - `description?: string` - Full description (optional, max 5000 chars)
  - `visibility?: 'public' | 'private' | 'members_only' | 'purchased_only'` - Access level (default: 'purchased_only')
  - `priceCents?: number` - Price in cents (optional, null = free, 0+ allowed)
  - `category?: string` - Content category (optional, max 100 chars)
  - `tags?: string[]` - Array of tag strings (optional, max 20 tags, each 50 chars)
  - `thumbnailUrl?: string` - Custom thumbnail URL (optional, must be valid URL)
  - `contentBody?: string` - Written content body (optional, for written content type)
  - `organizationId?: string` - Organization ownership (optional, null = personal/creator-owned)
- `creatorId` - ID of the creator (for authorization and ownership)

**Returns:** Created content record with:
- `status: 'draft'` - Always starts as draft, not published
- `publishedAt: null` - Not yet published
- `viewCount: 0` - No views initially
- `purchaseCount: 0` - No purchases initially

**Business Logic:**
1. Validates input against Zod schema (returns ValidationError if invalid)
2. Uses transaction for atomicity
3. If mediaItemId provided: validates media exists, belongs to creator, and type matches
4. Media validation does NOT require 'ready' status for draft creation (can be uploading)
5. Creates content record in single database operation
6. Enforces unique constraint on (creatorId, slug) or (organizationId, slug)

**Throws:**
- `ValidationError` - Input fails Zod schema validation (400)
- `MediaNotFoundError` - mediaItemId provided but doesn't exist or doesn't belong to creator (404)
- `ContentTypeMismatchError` - Content type doesn't match media type (video content with audio media) (422)
- `SlugConflictError` - Slug already exists in same organization/creator scope (409)

**Transaction:** Yes - atomic operation with media validation

**Example:**
```typescript
const newContent = await contentService.create({
  title: 'How to Code in TypeScript',
  slug: 'typescript-tutorial',
  contentType: 'video',
  mediaItemId: 'media-uuid-123',
  description: 'A comprehensive guide to TypeScript fundamentals',
  visibility: 'public',
  priceCents: 2999, // $29.99
  category: 'Programming',
  tags: ['typescript', 'tutorial', 'beginner'],
}, 'creator-id-123');

// Returns: Content with id, status='draft', publishedAt=null
```

---

#### Method: get()

Retrieves a single content item with relations populated (creator, organization, media item).

```typescript
async get(id: string, creatorId: string): Promise<ContentWithRelations | null>
```

**Parameters:**
- `id` - Content ID (UUID)
- `creatorId` - Creator ID for authorization and scoping

**Returns:**
- `ContentWithRelations` with nested `creator`, `organization`, and `mediaItem` objects
- `null` if content doesn't exist, is soft-deleted, or doesn't belong to creator

**Security:**
- Scoped to creatorId (cannot retrieve another creator's content)
- Excludes soft-deleted content (deletedAt IS NULL)
- Query includes creator/organization relations

**Example:**
```typescript
const content = await contentService.get('content-id-123', 'creator-id-123');

if (!content) {
  console.log('Content not found or does not belong to creator');
  return;
}

console.log(content.title); // 'How to Code in TypeScript'
console.log(content.creator.name); // Creator info populated
if (content.mediaItem) {
  console.log(content.mediaItem.hlsMasterPlaylistKey); // HLS playlist if ready
}
```

---

#### Method: update()

Updates content metadata. The mediaItemId is immutable after creation (cannot change the media).

```typescript
async update(id: string, input: UpdateContentInput, creatorId: string): Promise<Content>
```

**Parameters:**
- `id` - Content ID
- `input` - Partial update data (all fields optional):
  - `title?: string` - New title
  - `slug?: string` - New slug (cannot duplicate existing in scope)
  - `description?: string` - New description
  - `visibility?: string` - New visibility level
  - `priceCents?: number` - New price
  - `category?: string` - New category
  - `tags?: string[]` - New tags
  - `thumbnailUrl?: string` - New thumbnail URL
  - `contentBody?: string` - New written content body
- `creatorId` - Creator ID for authorization

**Returns:** Updated content record with all fields

**Throws:**
- `ContentNotFoundError` - Content doesn't exist or doesn't belong to creator (404)
- `SlugConflictError` - New slug conflicts with existing content in scope (409)
- `ValidationError` - Input fails validation (400)

**Transaction:** Yes - atomic operation with ownership verification

**Constraints:**
- Cannot change mediaItemId (immutable after creation)
- Cannot change creatorId (immutable)
- Slug must remain unique within scope

**Example:**
```typescript
const updated = await contentService.update(
  'content-id-123',
  {
    title: 'Advanced TypeScript Guide',
    priceCents: 3999, // $39.99
    category: 'Advanced Programming',
    tags: ['typescript', 'advanced', 'patterns'],
  },
  'creator-id-123'
);

console.log(updated.title); // Updated
console.log(updated.status); // 'draft' (unchanged)
```

---

#### Method: publish()

Publishes content by setting status to 'published' and publishedAt timestamp. Validates that media is ready (if video/audio).

```typescript
async publish(id: string, creatorId: string): Promise<Content>
```

**Parameters:**
- `id` - Content ID
- `creatorId` - Creator ID for authorization

**Returns:** Published content record with:
- `status: 'published'` - Content is now published
- `publishedAt: Date` - Current timestamp when published

**Business Logic:**
1. Transaction: retrieves content with media item relation
2. Checks content exists and belongs to creator
3. If already published: returns existing published content (idempotent)
4. For video/audio content: validates media exists and has status='ready'
5. For written content: no media validation
6. Updates status and publishedAt in single operation

**Throws:**
- `ContentNotFoundError` - Content doesn't exist (404)
- `MediaNotReadyError` - Media status is not 'ready' (422)
- `BusinessLogicError` - Video/audio content has no media item (422)

**Transaction:** Yes - validates media in transaction for consistency

**Idempotency:** If already published, returns the existing published content (safe to call multiple times)

**Example:**
```typescript
// Create and publish workflow
const draft = await contentService.create({
  title: 'My Video',
  slug: 'my-video',
  contentType: 'video',
  mediaItemId: 'media-123',
}, 'creator-id');

// ... media transcoding completes (status='ready') ...

const published = await contentService.publish(draft.id, 'creator-id');
console.log(published.status); // 'published'
console.log(published.publishedAt); // Current timestamp

// Calling again is safe (idempotent)
const stillPublished = await contentService.publish(draft.id, 'creator-id');
console.log(stillPublished.publishedAt); // Same timestamp
```

---

#### Method: unpublish()

Unpublishes content by setting status back to 'draft'. Keeps publishedAt for history.

```typescript
async unpublish(id: string, creatorId: string): Promise<Content>
```

**Parameters:**
- `id` - Content ID
- `creatorId` - Creator ID for authorization

**Returns:** Unpublished content record with:
- `status: 'draft'` - Reverted to draft
- `publishedAt: Date` - Original publish timestamp (preserved for history)

**Throws:**
- `ContentNotFoundError` - Content doesn't exist (404)

**Transaction:** Yes

**Use Case:** Temporarily hide content without deleting (e.g., for updates, fixes, or re-review)

**Example:**
```typescript
// Hide content temporarily
const unpublished = await contentService.unpublish('content-id-123', 'creator-id');
console.log(unpublished.status); // 'draft'
console.log(unpublished.publishedAt); // Original publish timestamp preserved

// Make changes
await contentService.update('content-id-123', { title: 'Updated Title' }, 'creator-id');

// Re-publish
const republished = await contentService.publish('content-id-123', 'creator-id');
console.log(republished.publishedAt); // NEW timestamp (updated on re-publish)
```

---

#### Method: delete()

Soft deletes content by setting deletedAt timestamp. Content remains in database but is excluded from normal queries.

```typescript
async delete(id: string, creatorId: string): Promise<void>
```

**Parameters:**
- `id` - Content ID
- `creatorId` - Creator ID for authorization

**Returns:** void

**Throws:**
- `ContentNotFoundError` - Content doesn't exist (404)

**Transaction:** Yes

**Data Preservation:**
- All data preserved in database for:
  - Purchase history (customers still have access if they purchased)
  - Analytics (view counts, revenue tracking)
  - Compliance (GDPR right to be forgotten with data retention policies)
  - Audit trails (who created, edited, deleted what, and when)

**Soft Delete Mechanism:**
- Sets `deletedAt` timestamp (not NULL)
- All queries use `scopedNotDeleted()` helper to automatically exclude soft-deleted items
- No data removal, only logical deletion

**Example:**
```typescript
// Before delete
const before = await contentService.get('content-id-123', 'creator-id');
console.log(before?.deletedAt); // null

// Delete (soft delete)
await contentService.delete('content-id-123', 'creator-id');

// After delete - cannot retrieve via normal queries
const after = await contentService.get('content-id-123', 'creator-id');
console.log(after); // null (excluded from scoped queries)

// List excludes deleted items
const list = await contentService.list('creator-id');
console.log(list.items.find(c => c.id === 'content-id-123')); // undefined
```

---

#### Method: list()

Lists content with comprehensive filtering, searching, sorting, and pagination. All results are scoped to the creator.

```typescript
async list(
  creatorId: string,
  filters?: ContentFilters,
  pagination?: PaginationParams
): Promise<PaginatedResponse<ContentWithRelations>>
```

**Parameters:**
- `creatorId` - Creator ID for authorization and scoping
- `filters` - Optional filter object:
  - `status?: 'draft' | 'published' | 'archived'` - Filter by publication status
  - `contentType?: 'video' | 'audio' | 'written'` - Filter by content type
  - `visibility?: 'public' | 'private' | 'members_only' | 'purchased_only'` - Filter by visibility
  - `category?: string` - Filter by category (exact match)
  - `organizationId?: string | null` - Filter by organization (null = personal content)
  - `search?: string` - Full-text search on title and description (case-insensitive)
  - `sortBy?: 'createdAt' | 'updatedAt' | 'publishedAt' | 'title' | 'viewCount' | 'purchaseCount'` - Sort field
  - `sortOrder?: 'asc' | 'desc'` - Sort direction
- `pagination` - Optional pagination (default: page=1, limit=20):
  - `page: number` - 1-indexed page number
  - `limit: number` - Results per page (max 100)

**Returns:**
```typescript
{
  items: ContentWithRelations[], // Content records with relations
  pagination: {
    page: number,              // Current page (1-indexed)
    limit: number,             // Per-page limit
    total: number,             // Total count matching filters
    totalPages: number         // Calculated (ceil(total / limit))
  }
}
```

**Query Strategy:**
1. Build WHERE conditions with all filters applied
2. Scope to creatorId (cannot see other creators' content)
3. Exclude soft-deleted content (deletedAt IS NULL)
4. Full-text search on title/description if provided
5. Apply sort order
6. Fetch with limit/offset for pagination
7. Count total matching for pagination metadata
8. Populate relations (mediaItem, creator, organization)

**Example:**
```typescript
// Get published videos, sorted by newest first, page 2
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

// Full-text search for typescript content
const searchResult = await contentService.list(
  'creator-id-123',
  {
    search: 'typescript',
    status: 'published',
  }
);

console.log(searchResult.items); // Only published with "typescript" in title/description

// Filter by organization
const orgContent = await contentService.list(
  'creator-id-123',
  {
    organizationId: 'org-456', // Only org content
    sortBy: 'createdAt',
    sortOrder: 'asc',
  }
);

// Filter personal-only
const personalContent = await contentService.list(
  'creator-id-123',
  {
    organizationId: null, // Only personal content
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

**Parameters:** Same as ContentService (db, environment)

**Inheritance**: Extends `BaseService` from `@codex/service-errors`

**Example:**
```typescript
import { MediaItemService } from '@codex/content';
import { dbHttp } from '@codex/database';

const mediaService = new MediaItemService({
  db: dbHttp,
  environment: 'production',
});
```

#### Method: create()

Creates a new media item record with status='uploading'. The actual file upload happens separately via R2 API.

```typescript
async create(input: CreateMediaItemInput, creatorId: string): Promise<MediaItem>
```

**Parameters:**
- `input` - Creation data:
  - `title: string` - Media title (required, 1-255 chars)
  - `description?: string` - Description (optional, max 5000 chars)
  - `mediaType: 'video' | 'audio'` - Type of media (required)
  - `r2Key: string` - R2 storage key for original file (required, e.g., 'originals/media-123/video.mp4')
  - `fileSizeBytes: number` - File size in bytes (required)
  - `mimeType: string` - MIME type (required, e.g., 'video/mp4')
- `creatorId` - ID of the creator (uploader)

**Returns:** Media item record with:
- `status: 'uploading'` - Always starts as uploading
- Other fields populated from input

**Example:**
```typescript
const mediaItem = await mediaService.create({
  title: 'TypeScript Tutorial Video',
  description: 'Full video recording from live session',
  mediaType: 'video',
  r2Key: 'originals/media-uuid-123/typescript-tutorial.mp4',
  fileSizeBytes: 1073741824, // 1 GB
  mimeType: 'video/mp4',
}, 'creator-id-123');

console.log(mediaItem.status); // 'uploading'
```

---

#### Method: get()

Retrieves a media item with creator relation populated.

```typescript
async get(id: string, creatorId: string): Promise<MediaItemWithRelations | null>
```

**Parameters:**
- `id` - Media item ID
- `creatorId` - Creator ID for authorization and scoping

**Returns:**
- `MediaItemWithRelations` with nested creator object
- `null` if media doesn't exist, is soft-deleted, or doesn't belong to creator

**Security:** Scoped to creatorId (cannot see other creators' media)

**Example:**
```typescript
const media = await mediaService.get('media-id-123', 'creator-id-123');
console.log(media?.status); // 'uploading', 'uploaded', 'transcoding', 'ready', or 'failed'
console.log(media?.creator.name); // Creator who uploaded
```

---

#### Method: update()

Updates media item metadata. Common updates include status changes and transcoding output keys.

```typescript
async update(id: string, input: UpdateMediaItemInput, creatorId: string): Promise<MediaItem>
```

**Parameters:**
- `id` - Media item ID
- `input` - Partial update data (all optional):
  - `title?: string` - New title
  - `description?: string` - New description
  - `status?: 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed'` - New status
  - `hlsMasterPlaylistKey?: string` - HLS master playlist location (e.g., 'hls/media-123/master.m3u8')
  - `thumbnailKey?: string` - Thumbnail image location (e.g., 'thumbnails/media-123/thumb.jpg')
  - `durationSeconds?: number` - Duration in seconds
  - `width?: number` - Video width in pixels
  - `height?: number` - Video height in pixels
  - `uploadedAt?: Date` - When transcoding completed
- `creatorId` - Creator ID for authorization

**Returns:** Updated media item

**Throws:**
- `MediaNotFoundError` - Media doesn't exist or doesn't belong to creator (404)
- `ValidationError` - Input fails validation (400)

**Transaction:** Yes

**Example:**
```typescript
// After file upload completes
await mediaService.updateStatus('media-id-123', 'uploaded', 'creator-id');

// After transcoding completes
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

#### Method: updateStatus()

Convenience method to update only the status. Common transitions:

```typescript
async updateStatus(
  id: string,
  status: 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed',
  creatorId: string
): Promise<MediaItem>
```

**Status Transitions:**
- `'uploading'` → `'uploaded'` - After S3/R2 upload completes
- `'uploaded'` → `'transcoding'` - When transcoding service picks up the job
- `'transcoding'` → `'ready'` - When HLS playlist and thumbnail generated
- `'transcoding'` → `'failed'` - If transcoding encounters an error

**Example:**
```typescript
// File upload completed
await mediaService.updateStatus('media-id-123', 'uploaded', 'creator-id');

// Transcoding started
await mediaService.updateStatus('media-id-123', 'transcoding', 'creator-id');

// Transcoding failed
await mediaService.updateStatus('media-id-123', 'failed', 'creator-id');
```

---

#### Method: markAsReady()

Convenience method called by transcoding service when HLS generation is complete. Sets status='ready' and populates all transcoding metadata in one call.

```typescript
async markAsReady(
  id: string,
  metadata: {
    hlsMasterPlaylistKey: string;    // Location of master.m3u8
    thumbnailKey: string;            // Location of thumbnail image
    durationSeconds: number;         // Media duration
    width?: number;                  // Video width (optional)
    height?: number;                 // Video height (optional)
  },
  creatorId: string
): Promise<MediaItem>
```

**Parameters:**
- `id` - Media item ID
- `metadata` - Transcoding output metadata
- `creatorId` - Creator ID for authorization

**Returns:** Updated media item with status='ready' and all metadata populated

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
console.log(ready.hlsMasterPlaylistKey); // 'hls/...'
console.log(ready.uploadedAt); // Current timestamp
```

---

#### Method: delete()

Soft deletes media item by setting deletedAt timestamp. Content referencing this media will still exist but cannot be published.

```typescript
async delete(id: string, creatorId: string): Promise<void>
```

**Parameters:**
- `id` - Media item ID
- `creatorId` - Creator ID for authorization

**Throws:**
- `MediaNotFoundError` - Media doesn't exist (404)

**Data Preservation:** Media remains in database for referential integrity

**Content Impact:** Content items referencing this media cannot be published (media validation fails)

**Example:**
```typescript
await mediaService.delete('media-id-123', 'creator-id-123');

// Content referencing this media cannot be published
try {
  await contentService.publish('content-using-media', 'creator-id');
} catch (error) {
  // MediaNotFoundError - media is soft-deleted
}
```

---

#### Method: list()

Lists media items with filtering and pagination. All results are scoped to the creator.

```typescript
async list(
  creatorId: string,
  filters?: MediaItemFilters,
  pagination?: PaginationParams
): Promise<PaginatedResponse<MediaItemWithRelations>>
```

**Parameters:**
- `creatorId` - Creator ID for authorization and scoping
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

console.log(result.items); // Ready videos
console.log(result.pagination.total); // Total ready video count
console.log(result.pagination.totalPages); // Total pages

// Get all media still uploading
const uploading = await mediaService.list(
  'creator-id-123',
  {
    status: 'uploading',
    sortBy: 'createdAt',
    sortOrder: 'asc',
  }
);

// Get all failed transcodes
const failed = await mediaService.list(
  'creator-id-123',
  { status: 'failed' }
);
```

---

## Content Lifecycle

The content service implements a complete state machine workflow for content:

```
CREATION PHASE:
  create() → status='draft', publishedAt=null
      ↓
EDITING PHASE (optional):
  update() → modify metadata while draft
      ↓
MEDIA PREPARATION:
  MediaItemService updates media status through pipeline:
    'uploading' → 'uploaded' → 'transcoding' → 'ready' or 'failed'
      ↓
PUBLISHING PHASE:
  publish() → status='published', publishedAt=now
    - Validates media.status='ready' (if video/audio)
    - Sets publishedAt timestamp
    - Idempotent if already published
      ↓
DISTRIBUTION:
  Content is now visible to audience based on visibility settings
      ↓
UNPUBLISHING (optional):
  unpublish() → status='draft' (reverts to draft)
    - publishedAt preserved for history
    - Content hidden from audience
      ↓
DELETION:
  delete() → sets deletedAt (soft delete)
    - Content still in database
    - Excluded from normal list operations
    - Data preserved for analytics
```

### Media Status Progression

```
'uploading' - Initial state when record created
    ↓ (after S3/R2 upload completes)
'uploaded' - File successfully uploaded to R2
    ↓ (transcoding service picks up the job)
'transcoding' - HLS transcoding in progress
    ├─ (on success) → 'ready' - Transcoding complete, HLS playlist available
    └─ (on failure) → 'failed' - Transcoding failed, cannot use for content
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

// Step 1: Create media item after upload to R2
const media = await mediaService.create({
  title: 'Learn TypeScript',
  description: 'A comprehensive tutorial',
  mediaType: 'video',
  r2Key: 'originals/abc-123/learn-typescript.mp4',
  fileSizeBytes: 2147483648, // 2 GB
  mimeType: 'video/mp4',
}, creatorId);

console.log(media.id); // media-uuid
console.log(media.status); // 'uploading'

// Step 2: Create content draft (linked to media)
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

console.log(content.id); // content-uuid
console.log(content.status); // 'draft'

// Step 3: Media transcoding service updates status
// (External service: updates status uploading → uploaded → transcoding → ready)
await mediaService.updateStatus(media.id, 'uploaded', creatorId);
await mediaService.updateStatus(media.id, 'transcoding', creatorId);

// Step 4: When transcoding completes, mark media as ready
const readyMedia = await mediaService.markAsReady(
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

console.log(readyMedia.status); // 'ready'

// Step 5: Publish content (now media is ready)
const published = await contentService.publish(content.id, creatorId);
console.log(published.status); // 'published'
console.log(published.publishedAt); // Current timestamp
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

// Filter by organization content
const orgContent = await contentService.list(
  creatorId,
  {
    organizationId: 'org-123',
    status: 'published',
  }
);

// Filter personal-only content
const personalContent = await contentService.list(
  creatorId,
  {
    organizationId: null,
  }
);
```

---

### Example 3: Error Handling

```typescript
import {
  ContentService,
  ContentNotFoundError,
  MediaNotReadyError,
  SlugConflictError,
  ContentTypeMismatchError,
  wrapError,
} from '@codex/content';

const contentService = new ContentService({ db: dbHttp, environment: 'production' });
const mediaService = new MediaItemService({ db: dbHttp, environment: 'production' });

// Creating content with error handling
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
  } else if (error instanceof ContentTypeMismatchError) {
    console.error('Content type does not match media type');
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
    // Prompt user to wait for transcoding to complete
  } else if (error instanceof ContentNotFoundError) {
    console.error('Content does not exist');
  }
}

// Scoping enforcement (access control)
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

### Example 4: Media Lifecycle Management

```typescript
import { MediaItemService } from '@codex/content';

const mediaService = new MediaItemService({ db: dbHttp, environment: 'production' });

// Track media through upload pipeline
const media = await mediaService.create({
  title: 'New Video',
  mediaType: 'video',
  r2Key: 'originals/new-video.mp4',
  fileSizeBytes: 1024000000,
  mimeType: 'video/mp4',
}, 'creator-id');

// Simulate upload progress
console.log(`Created media: ${media.id} (status: ${media.status})`);

// File upload completes
await mediaService.updateStatus(media.id, 'uploaded', 'creator-id');
console.log('File uploaded to R2');

// Transcoding service picks it up
await mediaService.updateStatus(media.id, 'transcoding', 'creator-id');
console.log('Transcoding started');

// Transcoding completes (with metadata)
const ready = await mediaService.markAsReady(
  media.id,
  {
    hlsMasterPlaylistKey: 'hls/new-video/master.m3u8',
    thumbnailKey: 'thumbnails/new-video/thumb.jpg',
    durationSeconds: 600,
    width: 1920,
    height: 1080,
  },
  'creator-id'
);

console.log(`Media ready: ${ready.id}`);
console.log(`Duration: ${ready.durationSeconds}s (${Math.floor(ready.durationSeconds / 60)}:${(ready.durationSeconds % 60).toString().padStart(2, '0')})`);
console.log(`Quality: ${ready.width}x${ready.height}`);

// Or handle transcoding failure
const failed = await mediaService.updateStatus(media.id, 'failed', 'creator-id');
console.log('Transcoding failed - content cannot be published until fixed');
```

---

## Integration Points

### Service Dependencies

The `@codex/content` package depends on:

| Package | Purpose | Usage |
|---------|---------|-------|
| `@codex/database` | Drizzle ORM and Neon PostgreSQL | Database queries and transactions via dbHttp/dbWs clients |
| `@codex/validation` | Zod schemas for input validation | Validates all CreateContentInput, UpdateContentInput, etc. via .parse() |
| `@codex/service-errors` | Base error classes and utilities | Extends NotFoundError, BusinessLogicError, ConflictError; uses mapErrorToResponse |
| `@codex/identity` | Organization types | Type imports for Organization in ContentWithRelations |
| `@codex/observability` | Optional logging | Used by BaseService for observability (inherited in services) |

### Service Dependents

Packages/workers that import from `@codex/content`:

| Dependent | Usage | How |
|-----------|-------|-----|
| `workers/content-api` | Creates service instances in route handlers | Imports ContentService, MediaItemService; instantiates per-request |
| `@codex/access` | Verifies content existence and properties | Queries content table for access verification |
| Integration tests | Uses services directly for test setup | Imports services via setupTestDatabase patterns |
| `@codex/shared-types` | Types for API responses | Imports Content, ContentWithRelations, MediaItem types |

### Data Flow in content-api Worker

```
HTTP Request to content-api worker
    ↓
Route Handler (withPolicy authentication applies)
    ↓
Create ServiceInstance (ContentService or MediaItemService)
    ├─ config: { db: dbHttp, environment: ctx.env.ENVIRONMENT }
    └─ Passed to handler function
    ↓
Call Service Method (create, publish, list, etc.)
    ├─ Input validated via Zod schema
    ├─ Database operation via dbHttp
    ├─ Returns typed result (Content, MediaItem, etc.)
    └─ May throw ServiceError subclasses
    ↓
Handler catches and maps error (if thrown)
    ├─ ServiceError → mapErrorToResponse(error)
    └─ Returns HTTP response with correct status
    ↓
HTTP Response with standardized envelope
    └─ @codex/shared-types response types
```

Example route handler:

```typescript
app.post('/api/content', withPolicy(...), createAuthenticatedHandler({
  schema: { body: createContentSchema },
  handler: async (_c, ctx) => {
    // Service created per request
    const service = new ContentService({
      db: dbHttp,
      environment: ctx.env.ENVIRONMENT,
    });

    // Service method called with validated input
    const content = await service.create(ctx.validated.body, ctx.user.id);

    // Result returned to client in standardized envelope
    return { data: content };
  },
}));
```

---

## Error Handling

### Error Class Hierarchy

All content errors extend from `@codex/service-errors` base classes:

```
ServiceError (base, HTTP 500)
├── NotFoundError (HTTP 404)
│   ├── ContentNotFoundError
│   └── MediaNotFoundError
├── BusinessLogicError (HTTP 422)
│   ├── MediaNotReadyError
│   ├── ContentTypeMismatchError
│   ├── ContentAlreadyPublishedError
│   └── (others from service-errors)
├── ConflictError (HTTP 409)
│   └── SlugConflictError
├── ForbiddenError (HTTP 403)
│   ├── MediaOwnershipError
│   └── (others from service-errors)
└── ValidationError (HTTP 400, from Zod)
```

### Error Handling Patterns

#### Pattern 1: Specific Error Catching

```typescript
try {
  const content = await contentService.create(input, creatorId);
} catch (error) {
  if (error instanceof SlugConflictError) {
    // Handle slug conflict (409)
    res.status(409).json({ error: 'Slug already in use' });
  } else if (error instanceof MediaNotFoundError) {
    // Handle missing media (404)
    res.status(404).json({ error: 'Media item not found' });
  } else if (error instanceof ValidationError) {
    // Handle validation failure (400)
    res.status(400).json({ error: error.message, details: error.details });
  } else {
    // Handle unexpected error (500)
    throw error;
  }
}
```

#### Pattern 2: Using isContentServiceError() Type Guard

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

The package provides utility to convert errors to HTTP responses:

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

| Error | Status | Cause | Recovery |
|-------|--------|-------|----------|
| `SlugConflictError` | 409 | Content with slug exists in scope | Suggest alternative slug |
| `MediaNotFoundError` | 404 | Media ID doesn't exist or soft-deleted | User selects different media |
| `MediaNotReadyError` | 422 | Attempting to publish before transcoding | Wait for transcoding to complete |
| `ContentNotFoundError` | 404 | Content ID doesn't exist or soft-deleted | Check ID, may be deleted |
| `ValidationError` | 400 | Input doesn't match schema | Return validation errors to client |
| `ContentTypeMismatchError` | 422 | Video content with audio media | Select correct media type |
| `MediaOwnershipError` | 403 | Using media from another creator | Use media user owns |
| `ContentAlreadyPublishedError` | 422 | Already published content | Already in published state (idempotent) |

---

## Transactions

Services use database transactions to ensure atomicity of multi-step operations.

### Transactional Operations

The following operations use transactions:

| Method | Reason | Atomicity |
|--------|--------|-----------|
| `ContentService.create()` | Validates media + creates content together | All succeed or all fail |
| `ContentService.update()` | Verifies ownership + updates atomically | Consistency guaranteed |
| `ContentService.publish()` | Validates media ready + publishes atomically | Media status checked and published in same transaction |
| `ContentService.unpublish()` | State change in transaction | Atomic status update |
| `ContentService.delete()` | Soft delete in transaction | Atomic deletion |
| `MediaItemService.update()` | Verify ownership + update atomically | Consistency guaranteed |
| `MediaItemService.delete()` | Soft delete in transaction | Atomic deletion |

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
  // Database state unchanged
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
  createUniqueSlug,
  withNeonTestBranch,
} from '@codex/test-utils';
import { ContentService, MediaItemService } from '@codex/content';
import { dbWs } from '@codex/database';

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
    .values({
      creatorId,
      title: 'Test Video',
      mediaType: 'video',
      status: 'ready',
      r2Key: 'originals/test.mp4',
      fileSizeBytes: 1024000,
      mimeType: 'video/mp4',
    })
    .returning();

  // Act
  const result = await service.create({
    title: 'Test Video',
    slug: createUniqueSlug('test-video'),
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
    .values({
      creatorId,
      title: 'Uploading Video',
      mediaType: 'video',
      status: 'uploading', // Not ready
      r2Key: 'originals/uploading.mp4',
      fileSizeBytes: 1024000,
      mimeType: 'video/mp4',
    })
    .returning();

  // Create content with non-ready media
  const content = await service.create({
    title: 'Test',
    slug: createUniqueSlug('test'),
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
  const [otherCreatorId] = await seedTestUsers(db, 1);

  // Create content as first creator
  const content = await service.create({
    title: 'Private Content',
    slug: createUniqueSlug('private'),
    contentType: 'written',
  }, creatorId);

  // Other creator cannot access
  const result = await service.get(content.id, otherCreatorId);
  expect(result).toBeNull();
});
```

#### Testing list with filters

```typescript
it('should filter and paginate correctly', async () => {
  // Create multiple items
  for (let i = 0; i < 5; i++) {
    await service.create({
      title: `Video ${i}`,
      slug: createUniqueSlug(`video-${i}`),
      contentType: 'video',
      mediaItemId: 'media-123',
      category: 'Programming',
    }, creatorId);
  }

  // List with filter
  const result = await service.list(
    creatorId,
    { category: 'Programming', sortBy: 'createdAt', sortOrder: 'asc' },
    { page: 1, limit: 3 }
  );

  expect(result.items).toHaveLength(3);
  expect(result.pagination.total).toBe(5);
  expect(result.pagination.totalPages).toBe(2);
});
```

### Testing Patterns

1. **Arrange-Act-Assert**: Clear test structure
2. **Test Setup Helpers**: Use `seedTestUsers()`, `createUniqueSlug()`
3. **Ephemeral Database**: Each test file gets fresh Neon branch
4. **No Cleanup**: Branches automatically cleanup after tests
5. **Isolation**: Each test file has independent database state
6. **Transaction Testing**: Verify atomicity and rollback behavior

### Recommended Test Coverage

- Create operations (valid, invalid, edge cases)
- Retrieval operations (existing, missing, scoped)
- Update operations (fields, permissions, validation)
- State transitions (publish, unpublish, delete)
- List operations (filtering, sorting, pagination)
- Error conditions (all error types)
- Scoping (creator isolation, organization filtering)
- Transactions (atomicity, rollback)
- Media validation (type matching, ready status)

### Running Tests

```bash
# Run tests once
pnpm test

# Run in watch mode
pnpm test:watch

# Run with coverage
pnpm test:coverage

# Run specific test file
pnpm test content-service.test.ts
```

---

## Performance Considerations

### Query Optimization

**Indexes on content table**:
- `(creatorId, deletedAt, status)` - Common filtered queries
- `(organizationId, deletedAt, status)` - Organization scoped queries
- `(slug, creatorId)` - Slug uniqueness checks

**Indexes on mediaItems table**:
- `(creatorId, deletedAt, status)` - Media status queries
- `(status)` - Transcoding status tracking

### List Query Optimization

List operations use:
1. Single query with WHERE conditions applied
2. Pagination via LIMIT/OFFSET
3. Count query for total (may be expensive on large datasets)
4. Relations loaded in single query with Drizzle `with` clause

### Soft Delete Implications

- **Storage**: Soft-deleted records remain in tables (increases table size)
- **Query Performance**: All queries must include `deletedAt IS NULL` filter (handled by scopedNotDeleted() helper)
- **Indexes**: Include deletedAt in composite indexes for WHERE clause efficiency

### Caching Opportunities

- Content/media lookups are cheap (indexed queries)
- Can be called per-request without performance penalty
- No aggressive caching needed unless traffic is extreme

### Batch Operations

For bulk operations (e.g., publish multiple items), consider:
1. Transaction wrapping all operations
2. Batched database queries instead of N separate queries
3. Database-side bulk updates instead of iterating in application code

---

## Summary

The `@codex/content` package provides production-ready services for:

1. **Complete Content Lifecycle**: Draft → Published → Archived with full workflow support
2. **Media Management**: Upload to transcoding completion with status tracking
3. **Creator Isolation**: Automatic scoping ensures data privacy and multi-tenancy
4. **Transaction Safety**: Atomic operations prevent partial updates
5. **Error Handling**: Domain-specific errors for clear error recovery
6. **Data Preservation**: Soft deletes maintain history and compliance

The package is designed to be integrated with the `content-api` worker and other services in the Codex platform, providing the foundational business logic for all content operations.

---

**Last Updated**: 2025-12-14
**Status**: Production Ready
**Test Coverage**: >85% on all public methods
**Maintained by**: Codex Team

# @codex/content

Core service layer for content and media management in Codex platform. Provides type-safe services for managing media uploads, content creation, publishing lifecycle, and organizational scoping.

## Overview

The content package handles the complete lifecycle of media and content items:
- **Media Management**: Track uploaded videos/audio from creation through transcoding to ready state
- **Content Management**: Create, update, publish, and delete content with full metadata support
- **Organizational Scoping**: Content belongs to creators and optionally to organizations
- **Publishing Workflow**: Draft → Published state transitions with validation
- **Soft Deletes**: Data preservation for purchase history and analytics

All operations are creator-scoped (users only access their own data) with optional organization isolation.

## Public API

| Export | Type | Purpose |
|--------|------|---------|
| `ContentService` | Class | Service for content CRUD, publishing, filtering, and lifecycle management |
| `MediaItemService` | Class | Service for media item tracking, status updates, and metadata |
| `ContentNotFoundError` | Error Class | Thrown when content doesn't exist or isn't accessible |
| `MediaNotFoundError` | Error Class | Thrown when media item doesn't exist or isn't accessible |
| `MediaNotReadyError` | Error Class | Thrown when attempting to publish with non-ready media |
| `ContentTypeMismatchError` | Error Class | Thrown when content type doesn't match media type |
| `SlugConflictError` | Error Class | Thrown when slug already exists in scope |
| `ContentAlreadyPublishedError` | Error Class | Thrown when operation requires draft status |
| `MediaOwnershipError` | Error Class | Thrown when user doesn't own the media item |

Also re-exports base error classes from `@codex/service-errors`: `BusinessLogicError`, `ConflictError`, `ForbiddenError`, `NotFoundError`, `ValidationError`.

## Core Services

### ContentService

Handles all content-related operations with full lifecycle management.

#### Constructor

```typescript
constructor(config: ServiceConfig): ContentService

interface ServiceConfig {
  db: Database;  // Drizzle ORM database instance
  environment: string;  // 'production', 'staging', 'test'
}
```

#### Methods

##### create(input, creatorId)

Create new content as draft.

```typescript
async create(
  input: CreateContentInput,
  creatorId: string
): Promise<Content>
```

**Parameters:**
- `input` - Content creation data (validated by Zod)
  - `title` (string, required): Content title
  - `slug` (string, required): URL slug (unique within creator scope + org)
  - `description` (string, optional): Content description
  - `contentType` ('video' | 'audio' | 'written', required): Type of content
  - `mediaItemId` (string, optional): ID of associated media (required for video/audio)
  - `contentBody` (string, optional): Written content body
  - `category` (string, optional): Content category
  - `tags` (string[], optional): Array of tags
  - `thumbnailUrl` (string, optional): Custom thumbnail URL
  - `visibility` ('public' | 'private' | 'members_only' | 'purchased_only', required)
  - `priceCents` (number, optional): Price in cents (e.g., 999 = $9.99)
  - `organizationId` (string, optional): Org scope (null = personal)
- `creatorId` - ID of creator

**Returns:** Created content object with status='draft'

**Throws:**
- `MediaNotFoundError`: Media doesn't exist or doesn't belong to creator
- `ContentTypeMismatchError`: Content type doesn't match media type
- `SlugConflictError`: Slug already exists in this scope
- `ValidationError`: Input validation failed

**Notes:**
- Content always starts as 'draft' status
- Draft creation doesn't require media to be ready
- Media validation (readiness check) happens during publishing, not creation
- Slug must be unique per (creator + organization) tuple
- Organization scoping allows same slug in different orgs or personal scope

**Example:**
```typescript
const content = await contentService.create({
  title: 'My First Video',
  slug: 'my-first-video',
  description: 'An awesome video tutorial',
  contentType: 'video',
  mediaItemId: readyMediaId,
  category: 'tutorials',
  tags: ['typescript', 'coding'],
  visibility: 'purchased_only',
  priceCents: 1999,  // $19.99
  organizationId: orgId,
}, creatorId);
```

##### get(id, creatorId)

Retrieve single content with relations populated.

```typescript
async get(
  id: string,
  creatorId: string
): Promise<ContentWithRelations | null>
```

**Parameters:**
- `id` - Content ID
- `creatorId` - Creator ID (for authorization)

**Returns:** Content object with mediaItem, organization, and creator relations, or null if not found/not accessible

**Throws:** Wraps errors with context

**Notes:**
- Returns null if content doesn't exist or belongs to different creator
- Excludes soft-deleted content
- Populates mediaItem, organization, and creator relations

**Example:**
```typescript
const content = await contentService.get(contentId, creatorId);
if (content) {
  console.log(content.title);
  console.log(content.mediaItem?.status);  // Access related media
  console.log(content.organization?.name);  // Access org if exists
}
```

##### update(id, input, creatorId)

Update content metadata (title, description, pricing, visibility, etc).

```typescript
async update(
  id: string,
  input: UpdateContentInput,
  creatorId: string
): Promise<Content>
```

**Parameters:**
- `id` - Content ID
- `input` - Partial update data (any UpdateContentInput fields)
  - `title`, `description`, `contentBody`, `category`, `tags`
  - `visibility`, `priceCents`, `thumbnailUrl`
  - Other fields can be updated except: `mediaItemId` (immutable)
- `creatorId` - Creator ID (for authorization)

**Returns:** Updated content object

**Throws:**
- `ContentNotFoundError`: Content doesn't exist or doesn't belong to creator

**Notes:**
- Only the provided fields are updated
- Cannot change mediaItemId (immutable after creation)
- Updates `updatedAt` timestamp
- Validates input with Zod schema

**Example:**
```typescript
const updated = await contentService.update(
  contentId,
  {
    title: 'Updated Title',
    visibility: 'members_only',
    priceCents: 2999,
  },
  creatorId
);
```

##### publish(id, creatorId)

Publish draft content to live.

```typescript
async publish(
  id: string,
  creatorId: string
): Promise<Content>
```

**Parameters:**
- `id` - Content ID
- `creatorId` - Creator ID (for authorization)

**Returns:** Published content object with publishedAt timestamp set

**Throws:**
- `ContentNotFoundError`: Content doesn't exist
- `BusinessLogicError`: Video/audio content without media
- `MediaNotReadyError`: Media item not in 'ready' status

**Notes:**
- Sets status='published' and publishedAt=now
- Idempotent: publishing already-published content returns success
- For video/audio content: validates media exists and is ready
- For written content: no media required
- Soft check: if media status changes after publish, content stays published

**Example:**
```typescript
try {
  const published = await contentService.publish(contentId, creatorId);
  console.log(`Published at: ${published.publishedAt}`);
} catch (error) {
  if (error instanceof MediaNotReadyError) {
    console.log('Wait for media transcoding to complete');
  }
}
```

##### unpublish(id, creatorId)

Revert published content back to draft.

```typescript
async unpublish(
  id: string,
  creatorId: string
): Promise<Content>
```

**Parameters:**
- `id` - Content ID
- `creatorId` - Creator ID (for authorization)

**Returns:** Unpublished content with status='draft'

**Throws:**
- `ContentNotFoundError`: Content doesn't exist

**Notes:**
- Sets status='draft'
- Keeps publishedAt timestamp (preserves publish history)
- Updates updatedAt timestamp

**Example:**
```typescript
const unpublished = await contentService.unpublish(contentId, creatorId);
// Can publish again later
```

##### delete(id, creatorId)

Soft delete content (sets deleted_at timestamp).

```typescript
async delete(
  id: string,
  creatorId: string
): Promise<void>
```

**Parameters:**
- `id` - Content ID
- `creatorId` - Creator ID (for authorization)

**Throws:**
- `ContentNotFoundError`: Content doesn't exist

**Notes:**
- Soft delete only (data preserved)
- Deleted content excluded from all list operations
- Cannot retrieve deleted content via get()
- Data remains in database for purchase history/analytics

**Example:**
```typescript
await contentService.delete(contentId, creatorId);
// Content no longer appears in lists
```

##### list(creatorId, filters?, pagination?)

List content with filtering, pagination, and sorting.

```typescript
async list(
  creatorId: string,
  filters?: ContentFilters,
  pagination?: PaginationParams
): Promise<PaginatedResponse<ContentWithRelations>>
```

**Parameters:**
- `creatorId` - Creator ID (scopes to this user's content)
- `filters` (optional) - Query filters
  - `status?: 'draft' | 'published' | 'archived'` - Filter by status
  - `contentType?: 'video' | 'audio' | 'written'` - Filter by type
  - `visibility?: 'public' | 'private' | 'members_only' | 'purchased_only'` - Filter by visibility
  - `category?: string` - Filter by category
  - `organizationId?: string | null` - Filter by org (null = personal)
  - `search?: string` - Search title and description (case-insensitive contains)
  - `sortBy?: 'createdAt' | 'updatedAt' | 'publishedAt' | 'title' | 'viewCount' | 'purchaseCount'` - Sort field
  - `sortOrder?: 'asc' | 'desc'` - Sort direction
- `pagination` (optional) - Pagination parameters
  - `page?: number` - Page number (1-indexed, default: 1)
  - `limit?: number` - Items per page (default: 20)

**Returns:** Object with:
- `items`: Array of ContentWithRelations
- `pagination`: { page, limit, total, totalPages }

**Notes:**
- Always scoped to creator
- Excludes soft-deleted content
- Full-text search on title and description
- Default sort by createdAt descending
- Media, organization, and creator relations populated

**Example:**
```typescript
const result = await contentService.list(creatorId, {
  status: 'published',
  contentType: 'video',
  sortBy: 'publishedAt',
  sortOrder: 'desc',
  search: 'tutorial',
}, { page: 1, limit: 20 });

console.log(`Found ${result.pagination.total} videos`);
for (const content of result.items) {
  console.log(content.title);
}
```

---

### MediaItemService

Manages media items (uploaded videos/audio) through their lifecycle.

#### Constructor

```typescript
constructor(config: ServiceConfig): MediaItemService

interface ServiceConfig {
  db: Database;
  environment: string;
}
```

#### Methods

##### create(input, creatorId)

Create new media item in 'uploading' status.

```typescript
async create(
  input: CreateMediaItemInput,
  creatorId: string
): Promise<MediaItem>
```

**Parameters:**
- `input` - Media creation data
  - `title` (string, required): Media title
  - `description` (string, optional): Media description
  - `mediaType` ('video' | 'audio', required): Media type
  - `r2Key` (string, required): Cloudflare R2 storage key
  - `fileSizeBytes` (number, required): File size in bytes
  - `mimeType` (string, required): MIME type (e.g., 'video/mp4')
- `creatorId` - ID of uploader

**Returns:** Created media item with status='uploading'

**Notes:**
- Always starts with status='uploading'
- R2 key is tracked for deletion/retrieval
- File size and MIME type captured for reference

**Example:**
```typescript
const media = await mediaService.create({
  title: 'Tutorial Video',
  mediaType: 'video',
  mimeType: 'video/mp4',
  r2Key: 'originals/tutorial-2024.mp4',
  fileSizeBytes: 1024 * 1024 * 150,  // 150MB
}, creatorId);
```

##### get(id, creatorId)

Retrieve single media item.

```typescript
async get(
  id: string,
  creatorId: string
): Promise<MediaItemWithRelations | null>
```

**Parameters:**
- `id` - Media item ID
- `creatorId` - Creator ID (for authorization)

**Returns:** Media item with creator relation, or null if not found/not accessible

**Notes:**
- Excludes soft-deleted media
- Creator relation includes id, email, name

**Example:**
```typescript
const media = await mediaService.get(mediaId, creatorId);
if (media?.status === 'ready') {
  console.log('Media is ready for publishing');
}
```

##### update(id, input, creatorId)

Update media metadata (status, HLS keys, transcoding metadata).

```typescript
async update(
  id: string,
  input: UpdateMediaItemInput,
  creatorId: string
): Promise<MediaItem>
```

**Parameters:**
- `id` - Media item ID
- `input` - Partial update (any UpdateMediaItemInput fields)
  - `status?: 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed'`
  - `title`, `description`, `mimeType`
  - `hlsMasterPlaylistKey`, `thumbnailKey`
  - `durationSeconds`, `width`, `height`
- `creatorId` - Creator ID (for authorization)

**Returns:** Updated media item

**Throws:**
- `MediaNotFoundError`: Media doesn't exist

**Example:**
```typescript
// Called by transcoding service when HLS generation complete
const ready = await mediaService.update(
  mediaId,
  {
    status: 'ready',
    hlsMasterPlaylistKey: 'hls/tutorial/master.m3u8',
    thumbnailKey: 'thumbnails/tutorial/thumb.jpg',
    durationSeconds: 180,
    width: 1920,
    height: 1080,
  },
  creatorId
);
```

##### delete(id, creatorId)

Soft delete media item.

```typescript
async delete(
  id: string,
  creatorId: string
): Promise<void>
```

**Parameters:**
- `id` - Media item ID
- `creatorId` - Creator ID (for authorization)

**Throws:**
- `MediaNotFoundError`: Media doesn't exist

**Notes:**
- Soft delete only (data preserved)
- Content referencing deleted media still exists but cannot be published
- R2 cleanup is caller's responsibility

**Example:**
```typescript
await mediaService.delete(mediaId, creatorId);
```

##### list(creatorId, filters?, pagination?)

List media items with filtering and pagination.

```typescript
async list(
  creatorId: string,
  filters?: MediaItemFilters,
  pagination?: PaginationParams
): Promise<PaginatedResponse<MediaItemWithRelations>>
```

**Parameters:**
- `creatorId` - Creator ID (scopes to this user's media)
- `filters` (optional)
  - `status?: 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed'`
  - `mediaType?: 'video' | 'audio'`
  - `sortBy?: 'createdAt' | 'uploadedAt' | 'title'`
  - `sortOrder?: 'asc' | 'desc'`
- `pagination` (optional)
  - `page?: number` (default: 1)
  - `limit?: number` (default: 20)

**Returns:** Paginated list with metadata

**Example:**
```typescript
const readyMedia = await mediaService.list(creatorId, {
  status: 'ready',
  mediaType: 'video',
}, { limit: 50 });

console.log(`${readyMedia.pagination.total} videos ready for publishing`);
```

##### updateStatus(id, status, creatorId)

Convenience method to update only the status.

```typescript
async updateStatus(
  id: string,
  status: 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed',
  creatorId: string
): Promise<MediaItem>
```

**Notes:**
- Shorthand for update() with only status field
- Used during transcoding workflow

**Example:**
```typescript
await mediaService.updateStatus(mediaId, 'transcoding', creatorId);
// Later...
await mediaService.updateStatus(mediaId, 'ready', creatorId);
```

##### markAsReady(id, metadata, creatorId)

Mark media as ready with transcoding metadata.

```typescript
async markAsReady(
  id: string,
  metadata: {
    hlsMasterPlaylistKey: string;
    thumbnailKey: string;
    durationSeconds: number;
    width?: number;
    height?: number;
  },
  creatorId: string
): Promise<MediaItem>
```

**Parameters:**
- `id` - Media item ID
- `metadata` - Transcoding output metadata
  - `hlsMasterPlaylistKey`: Path to HLS master playlist in R2
  - `thumbnailKey`: Path to thumbnail in R2
  - `durationSeconds`: Media duration
  - `width`, `height`: Optional video dimensions
- `creatorId` - Creator ID

**Returns:** Media item with status='ready'

**Notes:**
- Sets status='ready' and uploadedAt=now
- Called by transcoding service on success
- Enables content to be published

**Example:**
```typescript
// Transcoding service completes HLS generation
const ready = await mediaService.markAsReady(
  mediaId,
  {
    hlsMasterPlaylistKey: 'hls/videos/abc123/master.m3u8',
    thumbnailKey: 'thumbnails/abc123.jpg',
    durationSeconds: 543,
    width: 1920,
    height: 1080,
  },
  creatorId
);
```

## Content Lifecycle

### States and Transitions

```
MEDIA LIFECYCLE:
uploading -> uploaded -> transcoding -> ready (or failed)

CONTENT LIFECYCLE:
draft -> published (with publishedAt set) -> draft (unpublish) -> deleted
```

### Publishing Requirements

- **Video/Audio Content**: Must have mediaItemId and media.status='ready'
- **Written Content**: No media required
- **Publishing Check**: Happens at publish() time, not creation time
- **Draft Creation**: Allows non-ready media (useful for scheduling)

### Idempotency

- Publishing already-published content: Returns success
- Unpublishing draft content: Returns success (no-op)

## Creator Scoping

All operations are scoped to the requesting creator:

```typescript
// Creator A's view
const contentA = await service.list(creatorA);  // Only sees own content

// Creator B's view
const contentB = await service.list(creatorB);  // Only sees own content

// Cross-creator access is blocked
const other = await service.get(creatorA_contentId, creatorB);  // Returns null
```

### Organization Scoping

Content can belong to organizations:

```typescript
// Personal content (no organizationId)
const personal = await service.create({
  title: 'My Content',
  // No organizationId
}, creatorId);

// Organization content
const orgContent = await service.create({
  title: 'Company Content',
  organizationId: orgId,
}, creatorId);

// List org content only
const filtered = await service.list(creatorId, {
  organizationId: orgId,
});

// List personal content only
const myContent = await service.list(creatorId, {
  organizationId: null,
});
```

### Slug Scoping

Slugs are unique per (creator + organization) tuple:

```typescript
// Allowed: Same slug in different orgs
await service.create({ slug: 'my-video', organizationId: org1 }, creator);
await service.create({ slug: 'my-video', organizationId: org2 }, creator);  // OK

// Allowed: Same slug for personal and org
await service.create({ slug: 'my-video' }, creator);  // personal
await service.create({ slug: 'my-video', organizationId: org }, creator);  // OK

// NOT Allowed: Duplicate slug in same scope
await service.create({ slug: 'my-video' }, creator);
await service.create({ slug: 'my-video' }, creator);  // SlugConflictError
```

## Soft Deletes

All deletions are soft (data preservation):

```typescript
// Soft delete sets deleted_at timestamp
await contentService.delete(contentId, creatorId);

// Soft-deleted content:
// - Excluded from get() - returns null
// - Excluded from list() - won't appear
// - Data preserved in database - purchase history intact
// - Can be restored (if undelete feature added)

// Hard delete is never done
```

## Integration Points

### Workers Using This Package

- **content-api** - HTTP API for content CRUD, publishing, media management
  - Routes: `/api/content/*` and `/api/media/*`
  - Uses ContentService and MediaItemService directly

### Dependencies

| Package | Purpose | Used For |
|---------|---------|----------|
| `@codex/database` | Drizzle ORM + Neon connection | All database queries and transactions |
| `@codex/validation` | Zod schemas | Input validation (create, update, list queries) |
| `@codex/service-errors` | Base error classes | Error hierarchy and wrapping |
| `@codex/identity` | Organization types | Org relations in content |
| `@codex/observability` | Logging/tracing (optional) | Debug/error logging |

### Data Flow Example

```
content-api worker
  ↓
ContentService.create(input, creatorId)
  ├─ Validates input with Zod
  ├─ Checks media exists & belongs to creator (in transaction)
  ├─ Validates content type matches media type
  └─ Inserts content record
      ↓
  content table (database)
  media_items table (database relations)
```

## Error Handling

### Error Classes and When They're Thrown

| Error | Condition | HTTP Status | Handling |
|-------|-----------|-------------|----------|
| `ContentNotFoundError` | Content doesn't exist or belongs to different creator | 404 | Return 404 to client |
| `MediaNotFoundError` | Media doesn't exist or belongs to different creator | 404 | Return 404 to client |
| `MediaNotReadyError` | Attempting to publish with non-ready media | 400 | Tell user to wait for transcoding |
| `ContentTypeMismatchError` | Content type doesn't match media type (video content + audio media) | 400 | Fix the request |
| `SlugConflictError` | Slug already exists in this scope | 409 | Use different slug |
| `ContentAlreadyPublishedError` | (Currently not used, reserved for future) | 400 | Already published |
| `MediaOwnershipError` | User doesn't own the media | 403 | Forbidden |
| `ValidationError` | Input validation failed | 400 | Invalid request |
| `BusinessLogicError` | Other business logic violations | 400 | Bad state |

### Error Handling Example

```typescript
try {
  const content = await contentService.create(input, creatorId);
} catch (error) {
  if (error instanceof SlugConflictError) {
    return res.status(409).json({ message: 'Slug already exists' });
  }
  if (error instanceof ValidationError) {
    return res.status(400).json({ message: error.message });
  }
  if (error instanceof MediaNotFoundError) {
    return res.status(404).json({ message: 'Media not found' });
  }
  // Generic error handling
  throw error;
}

try {
  const published = await contentService.publish(contentId, creatorId);
} catch (error) {
  if (error instanceof ContentNotFoundError) {
    return res.status(404).json({ message: 'Content not found' });
  }
  if (error instanceof MediaNotReadyError) {
    return res.status(400).json({
      message: 'Media not ready',
      hint: 'Wait for transcoding to complete'
    });
  }
  throw error;
}
```

## Transactions

Multi-step operations use database transactions for atomicity:

```typescript
// create() uses transaction:
// 1. Validate media exists
// 2. Insert content record
// All-or-nothing: if any step fails, entire operation rolls back

// publish() uses transaction:
// 1. Get content with media
// 2. Validate media ready
// 3. Update status and timestamps
// All atomic - consistent state guaranteed

// update() uses transaction:
// 1. Verify content exists and belongs to creator
// 2. Update fields
// Atomic - no partial updates
```

## Testing

### Test Setup

```typescript
import { setupTestDatabase, teardownTestDatabase } from '@codex/test-utils';

beforeAll(async () => {
  const db = setupTestDatabase();
  service = new ContentService({ db, environment: 'test' });
});

afterAll(async () => {
  await teardownTestDatabase();
});
```

### Testing Patterns

#### Test Content Creation

```typescript
it('should create content', async () => {
  // Arrange: Create test media
  const media = await db.insert(mediaItems).values({
    creatorId,
    status: 'ready',
    // ... other fields
  }).returning();

  // Act
  const content = await service.create({
    title: 'Test',
    slug: 'unique-slug',
    contentType: 'video',
    mediaItemId: media.id,
    visibility: 'public',
    priceCents: 0,
  }, creatorId);

  // Assert
  expect(content.status).toBe('draft');
  expect(content.creatorId).toBe(creatorId);
});
```

#### Test Authorization

```typescript
it('should not allow accessing other creator content', async () => {
  const otherCreatorContent = await service.create(input, otherCreatorId);

  const result = await service.get(otherCreatorContent.id, creatorId);

  expect(result).toBeNull();  // Not accessible
});
```

#### Test Soft Deletes

```typescript
it('should soft delete content', async () => {
  const content = await service.create(input, creatorId);

  await service.delete(content.id, creatorId);

  const deleted = await service.get(content.id, creatorId);
  expect(deleted).toBeNull();
});
```

#### Test Error Cases

```typescript
it('should throw SlugConflictError for duplicate slug', async () => {
  await service.create({ slug: 'my-slug', ... }, creatorId);

  await expect(
    service.create({ slug: 'my-slug', ... }, creatorId)
  ).rejects.toThrow(SlugConflictError);
});

it('should throw MediaNotReadyError if media not ready', async () => {
  const content = await service.create({
    mediaItemId: nonReadyMediaId,
    ...
  }, creatorId);

  await expect(
    service.publish(content.id, creatorId)
  ).rejects.toThrow(MediaNotReadyError);
});
```

### Test Data Helpers

Available from `@codex/test-utils`:

```typescript
import {
  createTestMediaItemInput,
  createTestOrganizationInput,
  createUniqueSlug,
  seedTestUsers,
  withNeonTestBranch,
} from '@codex/test-utils';

// Create test media
const media = createTestMediaItemInput(creatorId, {
  mediaType: 'video',
  status: 'ready',
});

// Create test org
const org = createTestOrganizationInput();

// Generate unique slug
const slug = createUniqueSlug('my-content');

// Seed test users
const [user1, user2] = await seedTestUsers(db, 2);

// Enable neon test branch (ephmeral database per test file)
withNeonTestBranch();
```

### Database Isolation

Tests use Neon ephemeral branches:

```typescript
// Each test file gets a fresh database
withNeonTestBranch();

// No cleanup needed - branch deleted after test file completes
// Each test creates its own data - idempotent tests
```

## Performance Notes

### Query Optimization

- List operations use pagination to avoid N+1 problems
- Relations (mediaItem, organization, creator) eagerly loaded
- Creator scoping applied at database level (filtered in WHERE clause)

### Soft Delete Impact

- Soft deletes require `deletedAt IS NULL` checks in all queries
- This is handled automatically by helper functions: `scopedNotDeleted()`, `whereNotDeleted()`
- No performance penalty for reasonable dataset sizes

### Batch Operations

For batch operations, use transactions:

```typescript
await db.transaction(async (tx) => {
  for (const input of items) {
    // Do work in transaction
  }
});
```

### Indexes

Database should have indexes on:
- `content(creatorId, deletedAt)` - Creator scoped queries
- `content(organizationId, slug, deletedAt)` - Slug uniqueness
- `media_items(creatorId, status, deletedAt)` - List with status filter
- `content(status, visibility)` - Published/public filtering

## Data Models

### Content Table Schema

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `creatorId` | UUID | Content creator (foreign key to users) |
| `organizationId` | UUID \| null | Organization (null = personal) |
| `mediaItemId` | UUID \| null | Linked media (optional, required for video/audio) |
| `title` | text | Content title |
| `slug` | text | URL slug (unique per creator+org) |
| `description` | text \| null | Content description |
| `contentType` | enum | 'video', 'audio', 'written' |
| `contentBody` | text \| null | Written content body |
| `category` | text \| null | Content category |
| `tags` | text[] | Array of tags |
| `thumbnailUrl` | text \| null | Custom thumbnail URL |
| `visibility` | enum | 'public', 'private', 'members_only', 'purchased_only' |
| `priceCents` | integer \| null | Price in cents |
| `status` | enum | 'draft', 'published', 'archived' |
| `publishedAt` | timestamp \| null | When published (null if draft) |
| `viewCount` | integer | Number of views |
| `purchaseCount` | integer | Number of purchases |
| `deletedAt` | timestamp \| null | Soft delete timestamp |
| `createdAt` | timestamp | Creation time |
| `updatedAt` | timestamp | Last update time |

**Slug Constraint**: Unique index on `(creatorId, slug, organizationId, deletedAt IS NULL)`

### MediaItem Table Schema

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `creatorId` | UUID | Uploader (foreign key to users) |
| `title` | text | Media title |
| `description` | text \| null | Media description |
| `mediaType` | enum | 'video', 'audio' |
| `status` | enum | 'uploading', 'uploaded', 'transcoding', 'ready', 'failed' |
| `r2Key` | text | Cloudflare R2 storage key |
| `fileSizeBytes` | bigint | Original file size |
| `mimeType` | text | MIME type |
| `hlsMasterPlaylistKey` | text \| null | HLS master playlist path (set when ready) |
| `thumbnailKey` | text \| null | Thumbnail path (set when ready) |
| `durationSeconds` | integer \| null | Duration in seconds (set when ready) |
| `width` | integer \| null | Video width (set when ready) |
| `height` | integer \| null | Video height (set when ready) |
| `uploadedAt` | timestamp \| null | When transcoding completed |
| `deletedAt` | timestamp \| null | Soft delete timestamp |
| `createdAt` | timestamp | Creation time |
| `updatedAt` | timestamp | Last update time |

## Validation Schemas

All inputs validated with Zod schemas from `@codex/validation`:

```typescript
// Exported and available from package
export {
  createContentSchema,
  updateContentSchema,
  contentQuerySchema,
  createMediaItemSchema,
  updateMediaItemSchema,
  mediaQuerySchema,
  // And enum types
  contentStatusEnum,
  contentTypeEnum,
  mediaTypeEnum,
  visibilityEnum,
  mediaStatusEnum,
}
```

## Type Reference

### Content Type

```typescript
interface Content {
  id: string;
  creatorId: string;
  organizationId: string | null;
  mediaItemId: string | null;
  title: string;
  slug: string;
  description: string | null;
  contentType: 'video' | 'audio' | 'written';
  contentBody: string | null;
  category: string | null;
  tags: string[];
  thumbnailUrl: string | null;
  visibility: 'public' | 'private' | 'members_only' | 'purchased_only';
  priceCents: number | null;
  status: 'draft' | 'published' | 'archived';
  publishedAt: Date | null;
  viewCount: number;
  purchaseCount: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ContentWithRelations extends Content {
  creator?: {
    id: string;
    email: string;
    name: string | null;
  };
  organization?: Organization | null;
  mediaItem?: MediaItem | null;
}
```

### MediaItem Type

```typescript
interface MediaItem {
  id: string;
  creatorId: string;
  title: string;
  description: string | null;
  mediaType: 'video' | 'audio';
  status: 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed';
  r2Key: string;
  fileSizeBytes: number;
  mimeType: string;
  hlsMasterPlaylistKey: string | null;
  thumbnailKey: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  uploadedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MediaItemWithRelations extends MediaItem {
  creator?: {
    id: string;
    email: string;
    name: string | null;
  };
}
```

## Usage Examples

### Complete Content Creation Workflow

```typescript
import {
  ContentService,
  MediaItemService,
  MediaNotReadyError,
  SlugConflictError,
} from '@codex/content';
import { dbHttp } from '@codex/database';

const contentService = new ContentService({
  db: dbHttp,
  environment: 'production',
});

const mediaService = new MediaItemService({
  db: dbHttp,
  environment: 'production',
});

// Step 1: User uploads file (create media item)
const media = await mediaService.create({
  title: 'My Tutorial Video',
  mediaType: 'video',
  mimeType: 'video/mp4',
  r2Key: 'originals/tutorial-abc123.mp4',
  fileSizeBytes: 1024 * 1024 * 250,  // 250MB
  description: 'Advanced TypeScript tutorial',
}, creatorId);

console.log(`Upload started. Media ID: ${media.id}, Status: ${media.status}`);

// Step 2: Transcoding service marks media as ready
await mediaService.markAsReady(media.id, {
  hlsMasterPlaylistKey: 'hls/abc123/master.m3u8',
  thumbnailKey: 'thumbnails/abc123.jpg',
  durationSeconds: 1842,
  width: 1920,
  height: 1080,
}, creatorId);

// Step 3: Create content (still draft)
try {
  const content = await contentService.create({
    title: 'Advanced TypeScript Tutorial',
    slug: 'advanced-typescript-tutorial',
    description: 'Learn advanced TypeScript patterns',
    contentType: 'video',
    mediaItemId: media.id,
    category: 'programming',
    tags: ['typescript', 'advanced', 'tutorial'],
    visibility: 'purchased_only',
    priceCents: 1999,  // $19.99
    organizationId: null,  // Personal content
  }, creatorId);

  console.log(`Content created: ${content.id}, Status: ${content.status}`);

  // Step 4: Publish content
  const published = await contentService.publish(content.id, creatorId);
  console.log(`Published at: ${published.publishedAt}`);

  // Step 5: Retrieve and verify
  const live = await contentService.get(content.id, creatorId);
  console.log(`Content is ${live?.status} with ${live?.mediaItem?.durationSeconds}s video`);

} catch (error) {
  if (error instanceof SlugConflictError) {
    console.log('This slug is already taken, try another');
  } else if (error instanceof MediaNotReadyError) {
    console.log('Media is still transcoding, try again later');
  } else {
    console.error('Unexpected error:', error);
  }
}
```

### Filtering and Pagination

```typescript
// List all published videos by this creator
const published = await contentService.list(creatorId, {
  status: 'published',
  contentType: 'video',
  sortBy: 'publishedAt',
  sortOrder: 'desc',
}, { page: 1, limit: 20 });

console.log(`Found ${published.pagination.total} videos`);
console.log(`Showing page ${published.pagination.page} of ${published.pagination.totalPages}`);

for (const content of published.items) {
  console.log(`- ${content.title} (${content.visibility})`);
  console.log(`  Views: ${content.viewCount}, Purchases: ${content.purchaseCount}`);
}

// Search and filter
const searched = await contentService.list(creatorId, {
  search: 'typescript',
  visibility: 'purchased_only',
});

// Organization-scoped content
const orgContent = await contentService.list(creatorId, {
  organizationId: companyOrgId,
}, { limit: 50 });

// Personal content only
const personal = await contentService.list(creatorId, {
  organizationId: null,
});
```

### Publishing Workflow with Error Handling

```typescript
async function publishContent(contentId: string, creatorId: string) {
  try {
    // Get current state
    const draft = await contentService.get(contentId, creatorId);
    if (!draft) {
      console.log('Content not found');
      return;
    }

    if (draft.status === 'published') {
      console.log('Already published');
      return;
    }

    // Attempt publish
    const published = await contentService.publish(contentId, creatorId);
    console.log(`Published successfully at ${published.publishedAt}`);

    // Fetch final state with relations
    const final = await contentService.get(contentId, creatorId);
    console.log({
      title: final?.title,
      slug: final?.slug,
      mediaStatus: final?.mediaItem?.status,
      hlsPlaylist: final?.mediaItem?.hlsMasterPlaylistKey,
    });

  } catch (error) {
    if (error instanceof ContentNotFoundError) {
      console.log('Content not found - may have been deleted');
    } else if (error instanceof MediaNotReadyError) {
      console.log('Media is still processing. Status updates:');
      const media = await mediaService.get(draft?.mediaItemId, creatorId);
      console.log(`Current status: ${media?.status}`);
      console.log('Check back in a few minutes');
    } else if (error instanceof BusinessLogicError) {
      console.log(`Cannot publish: ${error.message}`);
    } else {
      throw error;  // Unexpected error
    }
  }
}
```

### Media Management Workflow

```typescript
// List all media for creator
const allMedia = await mediaService.list(creatorId);
console.log(`Total media: ${allMedia.pagination.total}`);

// Filter by status
const ready = await mediaService.list(creatorId, {
  status: 'ready',
}, { limit: 100 });

const processing = await mediaService.list(creatorId, {
  status: 'transcoding',
});

console.log(`Ready: ${ready.pagination.total}`);
console.log(`Processing: ${processing.pagination.total}`);

// Check specific media
for (const item of processing.items) {
  console.log(`${item.title}: ${item.status} (${item.durationSeconds ?? '?'}s)`);
  if (item.status === 'ready') {
    // Ready to use for content
    const content = await contentService.create({
      title: item.title,
      slug: slugify(item.title),
      contentType: item.mediaType === 'video' ? 'video' : 'audio',
      mediaItemId: item.id,
      visibility: 'public',
      priceCents: 0,
    }, creatorId);
  }
}

// Cleanup: Delete unused media
const unused = await mediaService.list(creatorId, {
  status: 'ready',
});

// Only delete if not referenced by any published content
for (const media of unused.items) {
  const content = await contentService.list(creatorId, {
    contentType: media.mediaType === 'video' ? 'video' : 'audio',
  });
  const referenced = content.items.some(c => c.mediaItemId === media.id);

  if (!referenced) {
    await mediaService.delete(media.id, creatorId);
    console.log(`Deleted unused media: ${media.title}`);
  }
}
```

---

## Summary

The @codex/content package provides a complete content management solution with:

- **Two service classes** (ContentService, MediaItemService) handling all operations
- **Full creator scoping** - users only access their own content
- **Organization support** - content can belong to orgs or be personal
- **Publishing workflow** - draft to published state with validation
- **Soft deletes** - data preservation for history
- **Transaction safety** - all multi-step operations atomic
- **Comprehensive error handling** - specific error types for all cases
- **Type safety** - full TypeScript support with proper Drizzle ORM types
- **Integration** - used by content-api worker for HTTP API
- **Testing support** - with ephemeral database and test utilities

# @codex/content

Content Management Service Layer for Codex Platform

## Overview

Type-safe, transaction-aware services for managing organizations, media items, and content in the Codex platform.

### Features

- ✅ **Zero `any` types** - Fully type-safe with Drizzle ORM inference
- ✅ **Creator/Organization scoping** - All queries properly scoped
- ✅ **Transaction safety** - Multi-step operations wrapped in transactions
- ✅ **Soft deletes** - Data preservation with `deleted_at` timestamps
- ✅ **Custom errors** - Clear, context-rich error handling
- ✅ **Comprehensive filtering** - Pagination, search, sorting on all list endpoints

## Installation

```bash
pnpm add @codex/content
```

## Quick Start

```typescript
import { createContentService, createMediaItemService } from '@codex/content';
import { db } from '@codex/database';

// Initialize services
const contentService = createContentService({
  db,
  environment: 'production',
});

const mediaService = createMediaItemService({
  db,
  environment: 'production',
});
```

## ContentService

Manages published content (videos, audio, written).

### Create Content

```typescript
const content = await contentService.create(
  {
    title: 'Introduction to TypeScript',
    slug: 'intro-to-typescript',
    description: 'Learn TypeScript basics',
    contentType: 'video',
    mediaItemId: 'media-item-uuid',
    organizationId: 'org-uuid', // or null for personal content
    category: 'tutorials',
    tags: ['typescript', 'programming'],
    visibility: 'public',
    priceCents: 999, // $9.99 (use null for free)
  },
  creatorId
);
```

### Get Content

```typescript
// Get with relations (mediaItem, organization, creator)
const content = await contentService.get(contentId, creatorId);

if (!content) {
  throw new Error('Content not found');
}

console.log(content.title);
console.log(content.mediaItem?.hlsMasterPlaylistKey);
console.log(content.organization?.name);
```

### Update Content

```typescript
const updated = await contentService.update(
  contentId,
  {
    title: 'Updated Title',
    priceCents: 1499, // Change price to $14.99
    visibility: 'purchased_only',
  },
  creatorId
);
```

### Publish/Unpublish

```typescript
// Publish content (validates media is ready)
const published = await contentService.publish(contentId, creatorId);

// Unpublish content (back to draft)
const draft = await contentService.unpublish(contentId, creatorId);
```

### List Content

```typescript
const { items, pagination } = await contentService.list(
  creatorId,
  {
    status: 'published',
    contentType: 'video',
    category: 'tutorials',
    visibility: 'public',
    organizationId: 'org-uuid', // or null for personal content
    search: 'typescript', // searches title and description
    sortBy: 'createdAt',
    sortOrder: 'desc',
  },
  {
    page: 1,
    limit: 20,
  }
);

console.log(`Found ${pagination.total} items`);
console.log(`Page ${pagination.page} of ${pagination.totalPages}`);

for (const content of items) {
  console.log(`${content.title} - ${content.status}`);
}
```

### Delete Content (Soft Delete)

```typescript
// Soft delete - sets deleted_at timestamp
await contentService.delete(contentId, creatorId);

// Content is preserved for purchase history but excluded from queries
```

## MediaItemService

Manages uploaded media files (videos, audio).

### Create Media Item

```typescript
const mediaItem = await mediaService.create(
  {
    title: 'Raw Video Upload',
    description: 'Original video file',
    mediaType: 'video',
    mimeType: 'video/mp4',
    fileSizeBytes: 1024 * 1024 * 100, // 100MB
    r2Key: 'originals/media-id/video.mp4',
  },
  creatorId
);

// Initial status is 'uploading'
console.log(mediaItem.status); // 'uploading'
```

### Update Media Status

```typescript
// After upload completes
await mediaService.updateStatus(mediaId, 'uploaded', creatorId);

// After transcoding starts
await mediaService.updateStatus(mediaId, 'transcoding', creatorId);

// After transcoding completes
await mediaService.markAsReady(
  mediaId,
  {
    hlsMasterPlaylistKey: 'hls/media-id/master.m3u8',
    thumbnailKey: 'thumbnails/media-id/thumb.jpg',
    durationSeconds: 300,
    width: 1920,
    height: 1080,
  },
  creatorId
);
```

### List Media Items

```typescript
const { items, pagination } = await mediaService.list(
  creatorId,
  {
    status: 'ready',
    mediaType: 'video',
    sortBy: 'createdAt',
    sortOrder: 'desc',
  },
  { page: 1, limit: 20 }
);
```

## OrganizationService

Manages organizations for grouping content.

### Create Organization

```typescript
import { createOrganizationService } from '@codex/content';

const orgService = createOrganizationService({ db, environment: 'production' });

const org = await orgService.create({
  name: 'Acme Corporation',
  slug: 'acme-corp',
  description: 'Professional training content',
  logoUrl: 'https://example.com/logo.png',
  websiteUrl: 'https://acme.com',
});
```

### Get Organization

```typescript
// By ID
const org = await orgService.get(orgId);

// By slug
const org = await orgService.getBySlug('acme-corp');
```

### Check Slug Availability

```typescript
const isAvailable = await orgService.isSlugAvailable('new-org-slug');

if (!isAvailable) {
  throw new Error('Slug already taken');
}
```

## Error Handling

All services throw custom error classes with proper HTTP status codes and context.

```typescript
import {
  ContentNotFoundError,
  MediaNotReadyError,
  ForbiddenError,
  ValidationError,
  isContentServiceError,
} from '@codex/content';

try {
  const content = await contentService.publish(contentId, creatorId);
} catch (error) {
  if (error instanceof ContentNotFoundError) {
    return { status: 404, error: 'Content not found' };
  }

  if (error instanceof MediaNotReadyError) {
    return { status: 422, error: 'Media is still processing' };
  }

  if (error instanceof ForbiddenError) {
    return { status: 403, error: 'You do not own this content' };
  }

  if (isContentServiceError(error)) {
    // All service errors have: code, statusCode, message, context
    return {
      status: error.statusCode,
      error: {
        code: error.code,
        message: error.message,
        context: error.context,
      },
    };
  }

  // Unknown error - log and return generic 500
  console.error('Unexpected error:', error);
  return { status: 500, error: 'Internal server error' };
}
```

### Available Error Classes

| Error Class                   | Status | Description                               |
| ----------------------------- | ------ | ----------------------------------------- |
| `ContentNotFoundError`        | 404    | Content doesn't exist                     |
| `MediaNotFoundError`          | 404    | Media item doesn't exist                  |
| `OrganizationNotFoundError`   | 404    | Organization doesn't exist                |
| `ForbiddenError`              | 403    | User doesn't have permission              |
| `MediaOwnershipError`         | 403    | Media doesn't belong to creator           |
| `ValidationError`             | 400    | Input validation failed                   |
| `ContentTypeMismatchError`    | 400    | Content type doesn't match media type     |
| `ConflictError`               | 409    | Resource conflict (e.g., duplicate slug)  |
| `SlugConflictError`           | 409    | Slug already exists                       |
| `BusinessLogicError`          | 422    | Business rule violation                   |
| `MediaNotReadyError`          | 422    | Media is not ready for use                |
| `ContentAlreadyPublishedError`| 422    | Content is already published              |
| `InternalServiceError`        | 500    | Unexpected internal error                 |

## Type Safety

All types are properly inferred from Drizzle ORM - **zero `any` types**.

```typescript
import type {
  Content,
  MediaItem,
  Organization,
  ContentWithRelations,
  Database,
  ServiceConfig,
  PaginatedResponse,
  ContentFilters,
} from '@codex/content';

// Database type (properly typed from Drizzle)
function createService(db: Database) {
  return createContentService({ db, environment: 'production' });
}

// Content with relations
const content: ContentWithRelations = await contentService.get(id, creatorId);

// Type-safe filters
const filters: ContentFilters = {
  status: 'published', // Type error if invalid value
  contentType: 'video',
  sortBy: 'createdAt',
  sortOrder: 'desc',
};
```

## Transaction Safety

Multi-step operations use database transactions to ensure ACID properties.

```typescript
// Example: Creating content with media validation
// - Validates media exists and is ready
// - Creates content record
// - All within a single transaction
const content = await contentService.create(input, creatorId);
// If media validation fails, content is NOT created (transaction rollback)
```

## Organization Scoping

Content can belong to an organization OR be personal (organizationId = null).

```typescript
// Organization content
const orgContent = await contentService.create(
  {
    ...input,
    organizationId: 'org-uuid',
  },
  creatorId
);

// Personal content
const personalContent = await contentService.create(
  {
    ...input,
    organizationId: null, // or omit entirely
  },
  creatorId
);

// List only organization content
const { items } = await contentService.list(creatorId, {
  organizationId: 'org-uuid',
});

// List only personal content
const { items } = await contentService.list(creatorId, {
  organizationId: null,
});

// List all creator's content (org + personal)
const { items } = await contentService.list(creatorId);
```

## Best Practices

### 1. Always validate input with Zod before calling services

```typescript
import { createContentSchema } from '@codex/content';

const validated = createContentSchema.parse(userInput);
const content = await contentService.create(validated, creatorId);
```

### 2. Use transactions for multi-step operations

Services handle transactions internally, but you can also use them explicitly:

```typescript
import { db } from '@codex/database';

await db.transaction(async (tx) => {
  // Create media item
  const media = await mediaService.create(mediaInput, creatorId);

  // Create content referencing media
  const content = await contentService.create(
    {
      ...contentInput,
      mediaItemId: media.id,
    },
    creatorId
  );

  return { media, content };
});
```

### 3. Handle errors gracefully

```typescript
try {
  const content = await contentService.publish(contentId, creatorId);
  return { success: true, content };
} catch (error) {
  if (error instanceof MediaNotReadyError) {
    // Media is still transcoding - retry later
    return { success: false, error: 'Media is still processing' };
  }
  throw error; // Re-throw unexpected errors
}
```

### 4. Use proper creator scoping

```typescript
// ✅ CORRECT: Services enforce creator scoping
const content = await contentService.get(contentId, creatorId);

// ❌ WRONG: Never bypass service layer
const content = await db.query.content.findFirst({
  where: eq(content.id, contentId),
  // Missing: creatorId check, deletedAt check
});
```

## Testing

Services are designed to be testable with mock databases.

```typescript
import { createContentService } from '@codex/content';
import { mockDatabase } from '@codex/test-utils';

describe('ContentService', () => {
  it('should create content', async () => {
    const db = mockDatabase();
    const service = createContentService({ db, environment: 'test' });

    const content = await service.create(mockInput, 'creator-id');

    expect(content.id).toBeDefined();
    expect(content.status).toBe('draft');
  });
});
```

## API Integration Example

Using services in Hono API endpoints:

```typescript
import { Hono } from 'hono';
import { createContentService } from '@codex/content';
import { db } from '@codex/database';

const app = new Hono();

// Initialize service (do this once, reuse across requests)
const contentService = createContentService({ db, environment: 'production' });

// Create content endpoint
app.post('/api/content', async (c) => {
  const user = c.get('user'); // From auth middleware
  const body = await c.req.json();

  try {
    const content = await contentService.create(body, user.id);
    return c.json({ data: content }, 201);
  } catch (error) {
    if (error instanceof ValidationError) {
      return c.json({ error: error.message }, 400);
    }
    if (error instanceof MediaNotFoundError) {
      return c.json({ error: 'Media item not found' }, 404);
    }
    // Generic error
    return c.json({ error: 'Failed to create content' }, 500);
  }
});

// List content endpoint
app.get('/api/content', async (c) => {
  const user = c.get('user');
  const query = c.req.query();

  const result = await contentService.list(
    user.id,
    {
      status: query.status,
      contentType: query.contentType,
      search: query.search,
    },
    {
      page: parseInt(query.page || '1'),
      limit: parseInt(query.limit || '20'),
    }
  );

  return c.json({ data: result });
});
```

## License

MIT

# @codex/test-utils

Comprehensive test utilities for the Codex Content Management System test suites.

## Overview

This package provides centralized test utilities for testing the Codex platform, including:

- **Test Data Factories**: Generate realistic test data with proper types and unique identifiers
- **Database Utilities**: Setup, cleanup, and management of test databases
- **Custom Assertions**: Type-safe assertion helpers for content, media, and organizations
- **Test Helpers**: Utilities for async testing, error validation, and test isolation

## Installation

This package is automatically available to all workspace packages via `workspace:*`.

Add to your `package.json`:

```json
{
  "devDependencies": {
    "@codex/test-utils": "workspace:*"
  }
}
```

## Quick Start

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  setupTestDatabase,
  cleanupDatabase,
  seedTestUsers,
  createTestContentInput,
  createTestOrganizationInput,
} from '@codex/test-utils';
import { content, organizations } from '@codex/database/schema';
import type { Database } from '@codex/test-utils';

describe('Content Service', () => {
  let db: Database;
  let testUserId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    const [userId] = await seedTestUsers(db, 1);
    testUserId = userId;
  });

  beforeEach(async () => {
    await cleanupDatabase(db);
  });

  afterAll(async () => {
    await cleanupDatabase(db);
  });

  it('should create content', async () => {
    const contentInput = createTestContentInput(testUserId, {
      title: 'My Test Video',
      contentType: 'video',
    });

    const [newContent] = await db.insert(content).values(contentInput).returning();

    expect(newContent.id).toBeDefined();
    expect(newContent.title).toBe('My Test Video');
  });
});
```

## Database Setup

### Environment Configuration

Tests require a database connection string. The package uses the production database client configured via environment variables.

Set in your `.env.dev` file:

```bash
# Database connection method (LOCAL_PROXY or WEBSOCKET_POOL)
DB_METHOD=LOCAL_PROXY

# Local database URL
DATABASE_URL_LOCAL_PROXY=postgresql://user:pass@localhost:5432/codex

# Or WebSocket pool for transaction support
DATABASE_URL=postgres://user:pass@host/db
```

### Vitest Configuration

Configure your `vitest.config.ts` to load environment variables:

```typescript
import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env.dev
config({ path: resolve(__dirname, '../../.env.dev') });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      DATABASE_URL: process.env.DATABASE_URL || '',
      DB_METHOD: process.env.DB_METHOD || 'LOCAL_PROXY',
    },
  },
});
```

### Database Functions

#### `setupTestDatabase()`

Returns the WebSocket-based database client with full transaction support. This client is configured via environment variables.

```typescript
import { setupTestDatabase, type Database } from '@codex/test-utils';

const db: Database = setupTestDatabase();
```

#### `cleanupDatabase(db)`

Cleans all content tables while preserving users. Use this in `beforeEach` when users are seeded once in `beforeAll`.

Deletion order respects foreign key constraints:
1. content (references media_items, organizations, users)
2. media_items (references users)
3. organizations (no foreign keys)

```typescript
await cleanupDatabase(db);
```

#### `cleanupDatabaseComplete(db)`

Deletes ALL test data including users. Only use in `afterAll` or when you need a complete reset.

```typescript
await cleanupDatabaseComplete(db);
```

#### `cleanupTables(db, tables)`

Clean specific tables only:

```typescript
await cleanupTables(db, ['content', 'mediaItems']);
```

#### `seedTestUsers(db, count)`

Creates test users in the `auth.users` table and returns their IDs:

```typescript
const [userId1, userId2, userId3] = await seedTestUsers(db, 3);
```

#### `withTransaction(db, testFn)`

Wraps test code in a transaction and rolls back automatically:

```typescript
import { withTransaction } from '@codex/test-utils';

await withTransaction(db, async (tx) => {
  const [org] = await tx.insert(organizations).values(orgInput).returning();

  // Test operations here
  expect(org.id).toBeDefined();

  // Transaction will auto-rollback
});
```

#### `executeRawSQL(db, query)`

Execute raw SQL for advanced test scenarios:

```typescript
await executeRawSQL(db, 'SELECT * FROM content WHERE status = $1');
```

#### `areTablesEmpty(db)`

Verify that all content tables are empty:

```typescript
const isEmpty = await areTablesEmpty(db);
expect(isEmpty).toBe(true);
```

## Test Data Factories

Factories generate realistic test data with proper types and unique identifiers. All factories support partial overrides.

### Input Factories (for Database Insertion)

Use these to create data for inserting into the database. They return `NewX` types (without ID and timestamps).

#### `createTestOrganizationInput(overrides?)`

```typescript
import { createTestOrganizationInput } from '@codex/test-utils';
import { organizations } from '@codex/database/schema';

const orgInput = createTestOrganizationInput({
  name: 'Custom Organization',
  description: 'A test organization',
});

const [org] = await db.insert(organizations).values(orgInput).returning();
```

#### `createTestMediaItemInput(creatorId, overrides?)`

```typescript
import { createTestMediaItemInput } from '@codex/test-utils';
import { mediaItems } from '@codex/database/schema';

const mediaInput = createTestMediaItemInput(creatorId, {
  mediaType: 'video',
  status: 'ready',
  title: 'My Test Video',
});

const [media] = await db.insert(mediaItems).values(mediaInput).returning();
```

#### `createTestContentInput(creatorId, overrides?)`

```typescript
import { createTestContentInput } from '@codex/test-utils';
import { content } from '@codex/database/schema';

const contentInput = createTestContentInput(creatorId, {
  title: 'My Content',
  contentType: 'video',
  mediaItemId: media.id,
  status: 'published',
});

const [item] = await db.insert(content).values(contentInput).returning();
```

### Mock Factories (with IDs and Timestamps)

Use these to create mock entities for testing logic that doesn't need database interaction. They return full entity types with ID, createdAt, updatedAt, etc.

#### `createTestOrganization(overrides?)`

```typescript
import { createTestOrganization } from '@codex/test-utils';

const mockOrg = createTestOrganization({
  name: 'Mock Organization',
  id: 'specific-id',
});

// mockOrg includes: id, createdAt, updatedAt, deletedAt
```

#### `createTestMediaItem(overrides?)`

```typescript
import { createTestMediaItem } from '@codex/test-utils';

const mockMedia = createTestMediaItem({
  creatorId: 'user-123',
  status: 'ready',
  mediaType: 'audio',
});
```

#### `createTestContent(overrides?)`

```typescript
import { createTestContent } from '@codex/test-utils';

const mockContent = createTestContent({
  creatorId: 'user-123',
  status: 'published',
  publishedAt: new Date(),
});
```

### Batch Factories

Create multiple entities at once:

#### `createTestOrganizations(count, baseOverrides?)`

```typescript
import { createTestOrganizations } from '@codex/test-utils';

const orgs = createTestOrganizations(5, {
  description: 'Batch test org',
});
```

#### `createTestMediaItems(count, baseOverrides?)`

```typescript
import { createTestMediaItems } from '@codex/test-utils';

const mediaItems = createTestMediaItems(10, {
  creatorId: 'user-123',
  status: 'ready',
});
```

#### `createTestContentItems(count, baseOverrides?)`

```typescript
import { createTestContentItems } from '@codex/test-utils';

const contentItems = createTestContentItems(20, {
  creatorId: 'user-123',
  visibility: 'public',
});
```

### Workflow Factory

Create a complete content workflow with related entities:

#### `createTestContentWorkflow(options?)`

```typescript
import { createTestContentWorkflow } from '@codex/test-utils';

const workflow = createTestContentWorkflow({
  withOrganization: true,
  contentType: 'video',
  status: 'published',
});

// Returns: { creatorId, organization?, mediaItem, content }
console.log(workflow.organization?.id);
console.log(workflow.mediaItem.id);
console.log(workflow.content.id);
```

### Utility Functions

#### `createUniqueSlug(prefix?)`

Generate unique slugs to avoid collisions:

```typescript
import { createUniqueSlug } from '@codex/test-utils';

const slug = createUniqueSlug('video'); // video-1234567890-abc12
```

#### `createTestUserId()`

Generate a test user ID in UUID format:

```typescript
import { createTestUserId } from '@codex/test-utils';

const userId = createTestUserId(); // UUID v4 format
```

## Custom Assertions

Type-safe assertion helpers for validating test results.

### Error Assertions

#### `expectError(error, ErrorClass, expectedCode?)`

Assert that an error is an instance of a specific error class:

```typescript
import { expectError } from '@codex/test-utils';
import { ContentNotFoundError } from '@codex/service-errors';

try {
  await service.get('invalid-id');
  expect.fail('Should have thrown');
} catch (error) {
  expectError(error, ContentNotFoundError);
}
```

#### `expectContentServiceError(error, expectedCode)`

Assert error code for content service errors:

```typescript
import { expectContentServiceError } from '@codex/test-utils';

try {
  await service.create(invalidInput);
} catch (error) {
  expectContentServiceError(error, 'VALIDATION_ERROR');
}
```

#### `expectErrorMessage(error, substring)`

Assert that an error message contains a specific substring:

```typescript
import { expectErrorMessage } from '@codex/test-utils';

try {
  await service.update(id, { title: '' });
} catch (error) {
  expectErrorMessage(error, 'title is required');
}
```

### Content Assertions

#### `expectContentEqual(actual, expected)`

Deep equality check for content objects (ignores timestamp variations):

```typescript
import { expectContentEqual } from '@codex/test-utils';

expectContentEqual(actualContent, {
  title: 'Expected Title',
  status: 'published',
  visibility: 'public',
});
```

#### `expectMediaItemEqual(actual, expected)`

Deep equality check for media items:

```typescript
import { expectMediaItemEqual } from '@codex/test-utils';

expectMediaItemEqual(actualMedia, {
  mediaType: 'video',
  status: 'ready',
  mimeType: 'video/mp4',
});
```

#### `expectOrganizationEqual(actual, expected)`

Deep equality check for organizations:

```typescript
import { expectOrganizationEqual } from '@codex/test-utils';

expectOrganizationEqual(actualOrg, {
  name: 'Expected Org',
  slug: 'expected-org',
});
```

### Status Assertions

#### `expectDraft(content)`

Assert content is in draft status:

```typescript
import { expectDraft } from '@codex/test-utils';

expectDraft(content);
// Checks: status === 'draft' && publishedAt === null
```

#### `expectPublished(content)`

Assert content is published:

```typescript
import { expectPublished } from '@codex/test-utils';

expectPublished(content);
// Checks: status === 'published' && publishedAt !== null
```

#### `expectArchived(content)`

Assert content is archived:

```typescript
import { expectArchived } from '@codex/test-utils';

expectArchived(content);
// Checks: status === 'archived'
```

#### `expectMediaStatus(mediaItem, expectedStatus)`

Assert media item status and related fields:

```typescript
import { expectMediaStatus } from '@codex/test-utils';

expectMediaStatus(mediaItem, 'ready');
// For 'ready': also checks hlsMasterPlaylistKey, thumbnailKey, durationSeconds
```

### Soft Delete Assertions

#### `expectNotDeleted(entity)`

Assert entity is not soft-deleted:

```typescript
import { expectNotDeleted } from '@codex/test-utils';

expectNotDeleted(content);
// Checks: deletedAt === null
```

#### `expectDeleted(entity)`

Assert entity is soft-deleted:

```typescript
import { expectDeleted } from '@codex/test-utils';

expectDeleted(content);
// Checks: deletedAt !== null
```

### Pagination Assertions

#### `expectPaginationValid(pagination)`

Validate pagination metadata structure:

```typescript
import { expectPaginationValid } from '@codex/test-utils';

const response = await service.list({ page: 1, limit: 10 });
expectPaginationValid(response.pagination);
// Validates: page, limit, total, totalPages are correct
```

#### `expectSorted(items, field, order)`

Assert array is sorted by a specific field:

```typescript
import { expectSorted } from '@codex/test-utils';

expectSorted(contentItems, 'createdAt', 'desc');
```

### Relation Assertions

#### `expectContentWithRelations(content, options)`

Assert content has required relations populated:

```typescript
import { expectContentWithRelations } from '@codex/test-utils';

expectContentWithRelations(content, {
  expectMediaItem: true,
  expectOrganization: true,
  expectCreator: true,
});
```

#### `expectMediaItemWithRelations(mediaItem, options)`

Assert media item has required relations:

```typescript
import { expectMediaItemWithRelations } from '@codex/test-utils';

expectMediaItemWithRelations(mediaItem, {
  expectCreator: true,
});
```

## Test Helpers

### Async Utilities

#### `waitFor(condition, timeout?)`

Wait for a condition to become true:

```typescript
import { waitFor } from '@codex/test-utils';

await waitFor(async () => {
  const item = await db.query.content.findFirst({ where: eq(content.id, id) });
  return item?.status === 'ready';
}, 5000); // timeout in ms
```

#### `sleep(ms)`

Sleep for specified milliseconds:

```typescript
import { sleep } from '@codex/test-utils';

await sleep(1000); // Wait 1 second
```

### Mock Functions

#### `createMockFn()`

Create a mock function with call tracking:

```typescript
import { createMockFn } from '@codex/test-utils';

const mock = createMockFn<(x: string) => void>();

mock.fn('test');
mock.fn('hello');

expect(mock.callCount()).toBe(2);
expect(mock.lastCall()).toEqual(['hello']);
expect(mock.calls).toHaveLength(2);
```

## Type Imports

Import types from the appropriate packages:

```typescript
// Database types
import type { Database } from '@codex/test-utils';

// Schema types
import type {
  Organization,
  NewOrganization,
  MediaItem,
  NewMediaItem,
  Content,
  NewContent,
} from '@codex/database/schema';

// Pagination types
import type {
  PaginationMetadata,
  PaginatedResponse,
} from '@codex/test-utils';
```

## Complete Example

Here's a comprehensive example showing multiple features:

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  setupTestDatabase,
  cleanupDatabase,
  seedTestUsers,
  createTestOrganizationInput,
  createTestMediaItemInput,
  createTestContentInput,
  createTestContentWorkflow,
  expectContentEqual,
  expectPublished,
  expectPaginationValid,
  type Database,
} from '@codex/test-utils';
import { organizations, mediaItems, content } from '@codex/database/schema';

describe('Content Management', () => {
  let db: Database;
  let creatorId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    const [userId] = await seedTestUsers(db, 1);
    creatorId = userId;
  });

  beforeEach(async () => {
    await cleanupDatabase(db);
  });

  afterAll(async () => {
    await cleanupDatabase(db);
  });

  describe('Organization Management', () => {
    it('should create organization', async () => {
      const orgInput = createTestOrganizationInput({
        name: 'Test Org',
        description: 'Test organization',
      });

      const [org] = await db.insert(organizations).values(orgInput).returning();

      expect(org.id).toBeDefined();
      expect(org.name).toBe('Test Org');
      expect(org.slug).toContain('org-');
    });
  });

  describe('Content Creation Workflow', () => {
    it('should create complete content workflow', async () => {
      // Create organization
      const orgInput = createTestOrganizationInput();
      const [org] = await db.insert(organizations).values(orgInput).returning();

      // Create media item
      const mediaInput = createTestMediaItemInput(creatorId, {
        mediaType: 'video',
        status: 'ready',
      });
      const [media] = await db.insert(mediaItems).values(mediaInput).returning();

      // Create content
      const contentInput = createTestContentInput(creatorId, {
        title: 'My Video',
        contentType: 'video',
        mediaItemId: media.id,
        organizationId: org.id,
        status: 'published',
        publishedAt: new Date(),
      });
      const [newContent] = await db.insert(content).values(contentInput).returning();

      // Assertions
      expectContentEqual(newContent, {
        title: 'My Video',
        contentType: 'video',
        status: 'published',
      });
      expectPublished(newContent);
    });

    it('should use workflow factory', async () => {
      const workflow = createTestContentWorkflow({
        withOrganization: true,
        contentType: 'video',
        status: 'published',
      });

      expect(workflow.organization).toBeDefined();
      expect(workflow.mediaItem.status).toBe('ready');
      expect(workflow.content.status).toBe('published');
    });
  });
});
```

## Best Practices

### 1. Always Clean Up Between Tests

```typescript
beforeEach(async () => {
  await cleanupDatabase(db);
});
```

### 2. Use Unique Slugs

```typescript
const slug = createUniqueSlug('my-content');
```

### 3. Seed Users Once Per Test Suite

```typescript
beforeAll(async () => {
  const [user1, user2] = await seedTestUsers(db, 2);
  testUserId = user1;
});
```

### 4. Use Factory Functions for Test Data

```typescript
const input = createTestMediaItemInput(creatorId, {
  status: 'ready',
  mediaType: 'video',
});
```

### 5. Use Type-Safe Assertions

```typescript
expectContentEqual(actual, expected);
expectPublished(content);
expectPaginationValid(pagination);
```

### 6. Respect Foreign Key Constraints

Use `cleanupDatabase()` which handles deletion order correctly:
- content (depends on media, org, user)
- mediaItems (depends on user)
- organizations (no dependencies)
- users (preserved by cleanupDatabase, deleted by cleanupDatabaseComplete)

### 7. Use Transactions for Test Isolation

```typescript
await withTransaction(db, async (tx) => {
  // Operations here will be rolled back
});
```

## Troubleshooting

### Database Connection Errors

**Problem**: Cannot connect to database

**Solution**: Ensure environment variables are set in `.env.dev` and loaded in `vitest.config.ts`:

```typescript
env: {
  DATABASE_URL: process.env.DATABASE_URL || '',
  DB_METHOD: process.env.DB_METHOD || 'LOCAL_PROXY',
}
```

### Foreign Key Constraint Errors

**Problem**: Cannot delete/insert due to foreign key constraints

**Solution**: Use `cleanupDatabase()` which handles deletion order automatically. For manual cleanup, delete in this order:
1. content
2. mediaItems
3. organizations
4. users

### Test Isolation Issues

**Problem**: Tests interfere with each other

**Solution**: Always clean up in `beforeEach`:

```typescript
beforeEach(async () => {
  await cleanupDatabase(db);
});
```

### Slug Uniqueness Errors

**Problem**: Unique constraint violations on slugs

**Solution**: Always use `createUniqueSlug()`:

```typescript
const slug = createUniqueSlug('prefix'); // Guaranteed unique
```

### Transaction Support Issues

**Problem**: Transaction methods not available

**Solution**: Use `setupTestDatabase()` which returns the WebSocket client with transaction support.

## Migration from Older Versions

### Worker Integration Testing

**Note**: Worker integration test utilities (Miniflare and Wrangler Dev helpers) have been removed from this package in favor of `@cloudflare/vitest-pool-workers` for unit testing in the actual Workers runtime (workerd).

For worker integration testing, use the utilities in `@codex/worker-utils/test-utils` instead.

## API Reference

### Database Functions

| Function | Description | Returns |
|----------|-------------|---------|
| `setupTestDatabase()` | Setup database client | `Database` |
| `cleanupDatabase(db)` | Clean content tables (preserve users) | `Promise<void>` |
| `cleanupDatabaseComplete(db)` | Clean all tables including users | `Promise<void>` |
| `cleanupTables(db, tables)` | Clean specific tables | `Promise<void>` |
| `seedTestUsers(db, count)` | Create test users | `Promise<string[]>` |
| `withTransaction(db, fn)` | Run test in transaction | `Promise<T>` |
| `executeRawSQL(db, query)` | Execute raw SQL | `Promise<void>` |
| `areTablesEmpty(db)` | Check if tables empty | `Promise<boolean>` |

### Factory Functions - Input (for DB Insertion)

| Function | Parameters | Returns |
|----------|------------|---------|
| `createTestOrganizationInput(overrides?)` | `Partial<NewOrganization>` | `NewOrganization` |
| `createTestMediaItemInput(creatorId, overrides?)` | `string, Partial<NewMediaItem>` | `NewMediaItem` |
| `createTestContentInput(creatorId, overrides?)` | `string, Partial<NewContent>` | `NewContent` |

### Factory Functions - Mocks (with IDs)

| Function | Parameters | Returns |
|----------|------------|---------|
| `createTestOrganization(overrides?)` | `Partial<Organization>` | `Organization` |
| `createTestMediaItem(overrides?)` | `Partial<MediaItem>` | `MediaItem` |
| `createTestContent(overrides?)` | `Partial<Content>` | `Content` |

### Batch Factory Functions

| Function | Parameters | Returns |
|----------|------------|---------|
| `createTestOrganizations(count, overrides?)` | `number, Partial<Organization>` | `Organization[]` |
| `createTestMediaItems(count, overrides?)` | `number, Partial<MediaItem>` | `MediaItem[]` |
| `createTestContentItems(count, overrides?)` | `number, Partial<Content>` | `Content[]` |
| `createTestContentWorkflow(options?)` | `WorkflowOptions` | `Workflow` |

### Utility Functions

| Function | Parameters | Returns |
|----------|------------|---------|
| `createUniqueSlug(prefix?)` | `string?` | `string` |
| `createTestUserId()` | - | `string` |

### Assertion Functions

| Function | Parameters | Description |
|----------|------------|-------------|
| `expectError(error, ErrorClass, code?)` | `unknown, ErrorClass, string?` | Assert error class |
| `expectContentServiceError(error, code)` | `unknown, string` | Assert service error code |
| `expectErrorMessage(error, substring)` | `unknown, string` | Assert error message |
| `expectContentEqual(actual, expected)` | `Content, Content` | Deep equality check |
| `expectMediaItemEqual(actual, expected)` | `MediaItem, MediaItem` | Deep equality check |
| `expectOrganizationEqual(actual, expected)` | `Organization, Organization` | Deep equality check |
| `expectDraft(content)` | `Content` | Assert draft status |
| `expectPublished(content)` | `Content` | Assert published status |
| `expectArchived(content)` | `Content` | Assert archived status |
| `expectMediaStatus(media, status)` | `MediaItem, string` | Assert media status |
| `expectNotDeleted(entity)` | `Entity` | Assert not soft-deleted |
| `expectDeleted(entity)` | `Entity` | Assert soft-deleted |
| `expectPaginationValid(pagination)` | `PaginationMetadata` | Validate pagination |
| `expectSorted(items, field, order)` | `T[], keyof T, 'asc'|'desc'` | Assert sorted |
| `expectContentWithRelations(content, opts)` | `Content, Options` | Assert relations |
| `expectMediaItemWithRelations(media, opts)` | `MediaItem, Options` | Assert relations |

### Helper Functions

| Function | Parameters | Returns |
|----------|------------|---------|
| `waitFor(condition, timeout?)` | `() => boolean, number?` | `Promise<void>` |
| `sleep(ms)` | `number` | `Promise<void>` |
| `createMockFn<T>()` | - | `MockFunction<T>` |

## Dependencies

This package depends on:

- `@codex/database`: Database client and schema types
- `@neondatabase/serverless`: Neon database driver
- `drizzle-orm`: ORM for database operations
- `vitest`: Testing framework (dev dependency)

## License

Internal package for Codex platform. Not published to npm.

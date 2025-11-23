# @codex/test-utils - Testing Utilities Package

## Overview

Centralized testing utilities for the Codex platform. Provides reusable database setup, test data factories, and assertion helpers to eliminate boilerplate across all test suites.

**Core purpose**: Enable rapid, isolated integration testing with automatic database cleanup, realistic test data generation, and domain-specific assertion helpers.

**Key capabilities**:
- Ephemeral database isolation via neon-testing (CI) with optional local cost optimization
- Complete test data factories for content, media, organizations, and users
- Service and database context setup helpers with automatic lifecycle management
- Type-safe assertion helpers for content domain
- Transaction wrappers and database utility functions

**Primary users**: All packages using Vitest for integration/unit testing (identity, content management, media services).

---

## Public API

### Core Functions by Category

| Category | Export | Purpose |
|----------|--------|---------|
| **Database Setup** | `setupTestDatabase()` | Get WebSocket DB client with transaction support |
| **Database Setup** | `withNeonTestBranch()` | Enable ephemeral Neon branches for CI isolation |
| **Database Setup** | `validateDatabaseConnection()` | Check database health with retry logic |
| **Database Cleanup** | `teardownTestDatabase()` | Close DB connection pool for clean exit |
| **Database Cleanup** | `cleanupDatabase()` | Delete content data, preserve users |
| **Database Cleanup** | `cleanupDatabaseComplete()` | Delete all data including users |
| **Database Cleanup** | `cleanupTables()` | Delete specific tables with FK respect |
| **Database Utilities** | `seedTestUsers()` | Create test users in auth.users table |
| **Database Utilities** | `withTransaction()` | Run test in transaction with auto-rollback |
| **Database Utilities** | `executeRawSQL()` | Execute raw SQL for complex scenarios |
| **Database Utilities** | `areTablesEmpty()` | Verify content tables are empty |
| **Context Setup** | `createDatabaseTestContext()` | Database-only context (no service) |
| **Context Setup** | `createServiceTestContext()` | Database + single service context |
| **Context Setup** | `createIntegrationTestContext()` | Database + multiple services context |
| **Factories** | `createTestOrganization()` | Full Organization entity with ID |
| **Factories** | `createTestOrganizationInput()` | NewOrganization for DB insertion |
| **Factories** | `createTestMediaItem()` | Full MediaItem entity with ID |
| **Factories** | `createTestMediaItemInput()` | NewMediaItem for DB insertion |
| **Factories** | `createTestContent()` | Full Content entity with ID |
| **Factories** | `createTestContentInput()` | NewContent for DB insertion |
| **Factories** | `createTestUserId()` | UUID formatted test user ID |
| **Factories** | `createTestOrganizations()` | Batch create organizations |
| **Factories** | `createTestMediaItems()` | Batch create media items |
| **Factories** | `createTestContentItems()` | Batch create content items |
| **Factories** | `createTestContentWorkflow()` | Complete org + media + content setup |
| **Factories** | `createUniqueSlug()` | Generate unique slug with timestamp |
| **Assertions** | `expectContentServiceError()` | Assert error code matches |
| **Assertions** | `expectContentEqual()` | Deep equality for Content |
| **Assertions** | `expectMediaItemEqual()` | Deep equality for MediaItem |
| **Assertions** | `expectOrganizationEqual()` | Deep equality for Organization |
| **Assertions** | `expectPaginationValid()` | Validate pagination structure |
| **Assertions** | `expectContentWithRelations()` | Assert relations populated |
| **Assertions** | `expectMediaItemWithRelations()` | Assert media relations |
| **Assertions** | `expectSorted()` | Assert array sort order |
| **Assertions** | `expectDraft()` | Assert content is draft status |
| **Assertions** | `expectPublished()` | Assert content is published |
| **Assertions** | `expectArchived()` | Assert content is archived |
| **Assertions** | `expectMediaStatus()` | Assert media processing status |
| **Assertions** | `expectNotDeleted()` | Assert entity not soft-deleted |
| **Assertions** | `expectDeleted()` | Assert entity is soft-deleted |
| **Helpers** | `waitFor()` | Wait for condition with timeout |
| **Helpers** | `sleep()` | Sleep for milliseconds |
| **Helpers** | `createMockFn()` | Mock function with call tracking |
| **Helpers** | `expectError()` | Assert error instance type |
| **Helpers** | `expectErrorMessage()` | Assert error message contains text |

### Type Definitions

**ServiceTestContext\<T\>**
```typescript
{
  db: Database;           // WebSocket database client
  service: T;             // Service instance (generic type)
  creatorId: string;      // First test user ID
  otherCreatorId: string; // Second test user ID
  creatorIds: string[];   // All test user IDs
}
```

**Database**
```typescript
// Type alias for DatabaseWs from @codex/database
// Supports full Drizzle ORM query builder + transactions
```

**PaginationMetadata**
```typescript
{
  page: number;         // Current page (1-based)
  limit: number;        // Items per page
  total: number;        // Total items across all pages
  totalPages: number;   // Ceiling(total / limit)
}
```

**ContentServiceErrorCode**
```typescript
type = 'NOT_FOUND'
     | 'VALIDATION_ERROR'
     | 'FORBIDDEN'
     | 'CONFLICT'
     | 'BUSINESS_LOGIC_ERROR'
     | 'INTERNAL_ERROR'
```

---

## Database Setup & Lifecycle

### Ephemeral Branch Strategy

The package uses a hybrid testing strategy to optimize costs:

**CI Environment**:
- neon-testing creates ephemeral Neon branches
- Each test file gets its own isolated database
- Complete isolation - no cleanup needed between files
- Uses NEON_PARENT_BRANCH_ID if provided, otherwise project default

**Local Development**:
- Uses existing DATABASE_URL from .env.dev (LOCAL_PROXY method)
- No ephemeral branch creation (FREE)
- Tests share database but helpers still work
- Cleanup utilities optional but available

### Setup Neon Testing

**IMPORTANT**: Call at module level, not in beforeAll.

```typescript
import { withNeonTestBranch, setupTestDatabase, teardownTestDatabase } from '@codex/test-utils';

// Call at module level (activates only in CI)
withNeonTestBranch();

describe('MyService', () => {
  let db: Database;

  beforeAll(async () => {
    db = setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  // Tests run with isolated database in CI
  // Local uses shared DB via .env.dev
});
```

### Required Environment Variables

**CI**:
- `CI=true` - Activates ephemeral branch creation
- `NEON_API_KEY` - Neon API authentication
- `NEON_PROJECT_ID` - Neon project identifier
- `NEON_PARENT_BRANCH_ID` (optional) - Parent branch for cloning (ensures schema)
- `DATABASE_URL` - Connection string (auto-generated by neon-testing)

**Local Development**:
- `DATABASE_URL` - From .env.dev (must support transaction pool)
- `DB_METHOD=LOCAL_PROXY` - Uses local connection without branch creation

### Validate Connection

Check database health before running tests:

```typescript
import { validateDatabaseConnection } from '@codex/test-utils';

beforeAll(async () => {
  db = setupTestDatabase();

  try {
    await validateDatabaseConnection(db, 3, 1000);
  } catch (error) {
    console.error('Database connection failed:', error);
    throw error;
  }
});
```

**Parameters**:
- `db: Database` - Database client to test
- `retries: number` - Retry attempts (default: 3)
- `delayMs: number` - Delay between retries (default: 1000)

**Behavior**: Tests basic connectivity with retries. Throws if all attempts fail.

---

## Test Context Helpers

Eliminates boilerplate beforeAll/afterAll lifecycle code.

### Database-Only Context

Use when testing raw database queries without a service:

```typescript
import { createDatabaseTestContext } from '@codex/test-utils';

const getContext = createDatabaseTestContext(2); // Create 2 test users

it('should query content by creator', async () => {
  const { db, creatorId } = getContext();

  const result = await db.query.content.findFirst({
    where: eq(content.creatorId, creatorId)
  });

  expect(result).toBeDefined();
});
```

**Features**:
- beforeAll: Initializes DB, seeds users
- afterAll: Closes DB connection
- Returns function providing context each test

### Service Context

Most common pattern - single service with database:

```typescript
import { createServiceTestContext } from '@codex/test-utils';
import { ContentService } from '@codex/content';

const getContext = createServiceTestContext(
  (db) => new ContentService({ db, environment: 'test' }),
  2 // Create 2 test users
);

it('should create content', async () => {
  const { service, db, creatorId, otherCreatorId } = getContext();

  const content = await service.create({
    title: 'Test',
    contentType: 'video'
  }, creatorId);

  expect(content.id).toBeDefined();
  expect(content.creatorId).toBe(creatorId);
});
```

**Parameters**:
- `createService: (db) => T` - Factory function creating service instance
- `userCount: number` - Number of test users (default: 2)

**Returns**: Function providing `ServiceTestContext<T>`

### Integration Context

Test interactions between multiple services:

```typescript
import { createIntegrationTestContext } from '@codex/test-utils';

const getContext = createIntegrationTestContext(
  (db) => ({
    content: new ContentService({ db, environment: 'test' }),
    media: new MediaItemService({ db, environment: 'test' }),
    organization: new OrganizationService({ db, environment: 'test' }),
  }),
  3 // Create 3 test users for cross-service scenarios
);

it('should create content with media', async () => {
  const { services, creatorId } = getContext();

  const media = await services.media.create({
    title: 'Video',
    mediaType: 'video'
  }, creatorId);

  const content = await services.content.create({
    title: 'Article',
    mediaItemId: media.id
  }, creatorId);

  expect(content.mediaItemId).toBe(media.id);
});
```

---

## Factory Functions

Generate realistic test data with automatic defaults and overrides.

### Slug Generation

Create unique, consistent slugs for test isolation:

```typescript
import { createUniqueSlug } from '@codex/test-utils';

const slug1 = createUniqueSlug('content');     // content-1700000000-abc12
const slug2 = createUniqueSlug('org');        // org-1700000000-xyz98
const slug3 = createUniqueSlug();             // test-1700000000-m4k9e
```

**Returns**: Timestamped slug in format `{prefix}-{timestamp}-{random}`

### Organization Factories

**For database insertion (NewOrganization)**:

```typescript
import { createTestOrganizationInput } from '@codex/test-utils';

const input = createTestOrganizationInput({
  name: 'Custom Organization',
  description: 'Custom description'
});

const [org] = await db.insert(organizations).values(input).returning();
```

**For mocking (full entity with ID)**:

```typescript
import { createTestOrganization } from '@codex/test-utils';

const mockOrg = createTestOrganization({
  name: 'My Org',
  websiteUrl: 'https://example.com'
});

// mockOrg has: id, timestamps, all fields
```

**Default values**:
- `name`: Auto-generated "Test Organization [RANDOM]"
- `slug`: Unique slug
- `description`: "A test organization for automated testing"
- `logoUrl`: null
- `websiteUrl`: null

### Media Item Factories

**For database insertion (NewMediaItem)**:

```typescript
import { createTestMediaItemInput } from '@codex/test-utils';

const creatorId = 'test-user-123';
const input = createTestMediaItemInput(creatorId, {
  mediaType: 'audio',
  fileSizeBytes: 5 * 1024 * 1024
});

const [media] = await db
  .insert(mediaItems)
  .values(input)
  .returning();
```

**For mocking (full entity)**:

```typescript
import { createTestMediaItem } from '@codex/test-utils';

const video = createTestMediaItem({
  creatorId: 'user-id',
  mediaType: 'video',
  status: 'ready'
});

// Ready videos have: duration, dimensions, HLS key, thumbnail key
```

**Default values**:
- `mediaType`: 'video'
- `status` (Input): 'uploading'
- `status` (Mock): 'ready'
- `fileSizeBytes`: 10MB
- `mimeType`: Matches mediaType (video/mp4 or audio/mpeg)
- `durationSeconds` (Ready): 120 seconds
- `width/height` (Ready): 1920x1080 for video, null for audio
- `hlsMasterPlaylistKey` (Ready): `hls/{id}/master.m3u8`
- `thumbnailKey` (Ready): `thumbnails/{id}/thumb.jpg`

### Content Factories

**For database insertion (NewContent)**:

```typescript
import { createTestContentInput } from '@codex/test-utils';

const creatorId = 'test-user-123';
const input = createTestContentInput(creatorId, {
  title: 'My Article',
  contentType: 'written',
  category: 'technology'
});

const [content] = await db
  .insert(schema.content)
  .values(input)
  .returning();
```

**For mocking (full entity)**:

```typescript
import { createTestContent } from '@codex/test-utils';

const draft = createTestContent({
  title: 'Draft Post',
  status: 'draft'
});

const published = createTestContent({
  title: 'Live Post',
  status: 'published',
  publishedAt: new Date()
});
```

**Default values**:
- `contentType`: 'video'
- `status`: 'draft'
- `visibility`: 'public'
- `priceCents`: 0
- `viewCount`: 0
- `purchaseCount`: 0
- `tags`: ['test', 'automation']
- `category`: 'test-category'
- `contentBody`: Only for written type
- `publishedAt`: null (for draft)

### User ID Factory

```typescript
import { createTestUserId } from '@codex/test-utils';

const userId1 = createTestUserId(); // Random UUID
const userId2 = createTestUserId();
```

### Batch Factories

Create multiple entities with consistent overrides:

```typescript
import {
  createTestOrganizations,
  createTestMediaItems,
  createTestContentItems
} from '@codex/test-utils';

// Create 5 organizations
const orgs = createTestOrganizations(5, { /* base overrides */ });

// Create 10 media items
const medias = createTestMediaItems(10, {
  creatorId: userId,
  mediaType: 'audio'
});

// Create 20 content items
const articles = createTestContentItems(20, {
  contentType: 'written',
  visibility: 'public'
});
```

### Complete Content Workflow

Set up related entities (org → media → content) in one call:

```typescript
import { createTestContentWorkflow } from '@codex/test-utils';

const workflow = createTestContentWorkflow({
  creatorId: 'user-123',
  withOrganization: true,
  contentType: 'video',
  status: 'published'
});

// workflow contains:
// - creatorId
// - organization (if withOrganization=true)
// - mediaItem (with status='ready')
// - content (with mediaItemId linked)
```

---

## Database Cleanup & Utilities

### Cleanup Strategies

**With neon-testing (CI)**:
- Each test file gets fresh database - cleanup optional
- Use only if cleaning between tests in same file
- No retry logic needed

**Local development**:
- Tests share database - cleanup helps isolation
- Utilities available if needed but not required

### Clean Content Data

Delete content tables, preserve users:

```typescript
import { cleanupDatabase } from '@codex/test-utils';

afterEach(async () => {
  await cleanupDatabase(db);
});
```

**Deletion order** (respects foreign keys):
1. content
2. media_items
3. organizations
(Users preserved)

### Clean All Data

Complete reset including users:

```typescript
import { cleanupDatabaseComplete } from '@codex/test-utils';

afterAll(async () => {
  await cleanupDatabaseComplete(db);
});
```

### Clean Specific Tables

Delete only specified tables:

```typescript
import { cleanupTables } from '@codex/test-utils';

await cleanupTables(db, ['content', 'mediaItems']);
// Respects foreign key order automatically
```

### Transaction Wrapper

Run test in transaction with automatic rollback:

```typescript
import { withTransaction } from '@codex/test-utils';

it('should rollback on error', async () => {
  const result = await withTransaction(db, async (tx) => {
    await tx.insert(organizations).values({ /* ... */ });
    // Transaction auto-rollbacks
    return 'test';
  });
});
```

**Use case**: Tests that verify behavior without leaving traces.

### Raw SQL Execution

Execute complex SQL for advanced scenarios:

```typescript
import { executeRawSQL } from '@codex/test-utils';

await executeRawSQL(db, `
  UPDATE content SET view_count = 100 WHERE creator_id = $1
`);
```

### Verify Empty Tables

Check if content tables are empty:

```typescript
import { areTablesEmpty } from '@codex/test-utils';

const empty = await areTablesEmpty(db);
if (!empty) {
  console.log('Warning: tables contain data');
}
```

### Seed Test Users

Create users in auth.users table:

```typescript
import { seedTestUsers } from '@codex/test-utils';

const userIds = await seedTestUsers(db, 3);
// Returns: ['test-user-123-abc', 'test-user-123-def', 'test-user-123-ghi']
```

**Parameters**:
- `db: Database` - Database client
- `count: number` - Number of users to create

**Returns**: Array of user IDs (format: `test-user-{timestamp}-{random}`)

---

## Assertion Helpers

Type-safe domain-specific assertions using Vitest.

### Content Service Errors

Assert expected error codes:

```typescript
import { expectContentServiceError } from '@codex/test-utils';
import { expect } from 'vitest';

it('should validate input', async () => {
  try {
    await service.create({ invalid: 'data' }, creatorId);
    expect.fail('Should throw error');
  } catch (error) {
    expectContentServiceError(error, 'VALIDATION_ERROR');
  }
});
```

**Error codes**:
- `NOT_FOUND` - Entity doesn't exist
- `VALIDATION_ERROR` - Input validation failed
- `FORBIDDEN` - Authorization check failed
- `CONFLICT` - Uniqueness constraint violated
- `BUSINESS_LOGIC_ERROR` - Domain rule violated
- `INTERNAL_ERROR` - Unexpected server error

### Deep Equality Checks

Compare entities ignoring timestamps:

```typescript
import { expectContentEqual } from '@codex/test-utils';

const actual = await service.create(input, creatorId);
expectContentEqual(actual, {
  title: input.title,
  contentType: input.contentType,
  status: 'draft'
});
```

**Available helpers**:
- `expectContentEqual(actual, expected)` - Content comparison
- `expectMediaItemEqual(actual, expected)` - MediaItem comparison
- `expectOrganizationEqual(actual, expected)` - Organization comparison

### Pagination Validation

Verify pagination structure:

```typescript
import { expectPaginationValid } from '@codex/test-utils';

const { items, pagination } = await service.list({ page: 1, limit: 10 });
expectPaginationValid(pagination);
// Verifies: page >= 1, limit >= 1, total >= 0, totalPages = ceil(total/limit)
```

### Relations Populated

Assert required relations are loaded:

```typescript
import { expectContentWithRelations } from '@codex/test-utils';

const content = await service.getWithRelations(id, creatorId);
expectContentWithRelations(content, {
  expectMediaItem: true,
  expectCreator: true,
  expectOrganization: false
});
```

**Checks relation objects exist with id fields**.

### Sorting

Verify array is sorted correctly:

```typescript
import { expectSorted } from '@codex/test-utils';

const items = await service.list({ sortBy: 'createdAt', order: 'desc' });
expectSorted(items, 'createdAt', 'desc');
```

### Content Status Assertions

Check specific content states:

```typescript
import {
  expectDraft,
  expectPublished,
  expectArchived
} from '@codex/test-utils';

const draft = await service.get(id, creatorId);
expectDraft(draft);
// Asserts: status === 'draft' && publishedAt === null

const published = await service.publish(id, creatorId);
expectPublished(published);
// Asserts: status === 'published' && publishedAt !== null
```

### Media Status

Assert media processing status:

```typescript
import { expectMediaStatus } from '@codex/test-utils';

const media = await service.get(id, creatorId);
expectMediaStatus(media, 'ready');
// For 'ready': verifies hlsMasterPlaylistKey, thumbnailKey, durationSeconds
```

### Soft Delete

Assert soft-delete state:

```typescript
import { expectNotDeleted, expectDeleted } from '@codex/test-utils';

const active = await service.get(id, creatorId);
expectNotDeleted(active);

const removed = await service.delete(id, creatorId);
expectDeleted(removed);
```

### Generic Error Type

Assert error instance:

```typescript
import { expectError } from '@codex/test-utils';

try {
  await service.get('invalid', creatorId);
  expect.fail('Should throw');
} catch (error) {
  expectError(error, ContentNotFoundError);
}
```

### Error Message

Assert error message contains text:

```typescript
import { expectErrorMessage } from '@codex/test-utils';

try {
  await service.create(input, creatorId);
} catch (error) {
  expectErrorMessage(error, 'Slug already exists');
}
```

---

## Helper Utilities

### Wait for Condition

Poll condition with timeout:

```typescript
import { waitFor } from '@codex/test-utils';

it('should process content async', async () => {
  const content = await service.create(input, creatorId);

  await waitFor(async () => {
    const updated = await service.get(content.id, creatorId);
    return updated.status === 'published';
  }, 5000); // 5 second timeout
});
```

**Parameters**:
- `condition: () => boolean | Promise<boolean>` - Check function
- `timeout: number` - Max wait in ms (default: 5000)

**Behavior**: Polls every 100ms until true or timeout.

### Sleep

Delay for timing-dependent tests:

```typescript
import { sleep } from '@codex/test-utils';

it('should handle race conditions', async () => {
  const operation = service.update(id, data, creatorId);

  await sleep(100); // Small delay

  const result = await operation;
  expect(result.updatedAt).toBeDefined();
});
```

### Mock Function

Track function calls:

```typescript
import { createMockFn } from '@codex/test-utils';

const { fn, calls, callCount, lastCall } = createMockFn<
  (id: string, data: unknown) => void
>();

fn('id1', { name: 'test' });
fn('id2', { name: 'test2' });

expect(callCount()).toBe(2);
expect(lastCall()).toEqual(['id2', { name: 'test2' }]);
```

---

## Usage Examples

### Basic Service Test

```typescript
import {
  createServiceTestContext,
  createTestContentInput,
  expectContentEqual,
  expectDraft,
  withNeonTestBranch
} from '@codex/test-utils';
import { ContentService } from '@codex/content';
import { describe, expect, it } from 'vitest';

withNeonTestBranch();

describe('ContentService', () => {
  const getContext = createServiceTestContext(
    (db) => new ContentService({ db, environment: 'test' })
  );

  it('should create content in draft status', async () => {
    const { service, creatorId } = getContext();

    const input = createTestContentInput(creatorId, {
      title: 'My Article',
      contentType: 'written'
    });

    const content = await service.create(input, creatorId);

    expect(content.id).toBeDefined();
    expect(content.title).toBe(input.title);
    expectDraft(content);
  });

  it('should publish content', async () => {
    const { service, creatorId } = getContext();

    const draft = await service.create(
      createTestContentInput(creatorId),
      creatorId
    );

    const published = await service.publish(draft.id, creatorId);
    expectPublished(published);
  });
});
```

### Content with Media Test

```typescript
import {
  createServiceTestContext,
  createTestMediaItem,
  createTestContentInput,
  expectMediaStatus
} from '@codex/test-utils';

const getContext = createServiceTestContext(
  (db) => new ContentService({ db, environment: 'test' })
);

it('should create content with media', async () => {
  const { service, creatorId } = getContext();

  const media = createTestMediaItem({
    creatorId,
    mediaType: 'video',
    status: 'ready'
  });

  const content = await service.create(
    createTestContentInput(creatorId, {
      mediaItemId: media.id
    }),
    creatorId
  );

  expect(content.mediaItemId).toBe(media.id);
  expectMediaStatus(media, 'ready');
});
```

### Error Handling Test

```typescript
import {
  createServiceTestContext,
  expectContentServiceError
} from '@codex/test-utils';

const getContext = createServiceTestContext(
  (db) => new ContentService({ db, environment: 'test' })
);

it('should reject invalid input', async () => {
  const { service, creatorId } = getContext();

  try {
    await service.create({}, creatorId);
    expect.fail('Should have thrown');
  } catch (error) {
    expectContentServiceError(error, 'VALIDATION_ERROR');
  }
});

it('should not allow access to others content', async () => {
  const { service, creatorId, otherCreatorId } = getContext();

  const content = await service.create(
    createTestContentInput(creatorId),
    creatorId
  );

  try {
    await service.delete(content.id, otherCreatorId);
    expect.fail('Should have thrown');
  } catch (error) {
    expectContentServiceError(error, 'FORBIDDEN');
  }
});
```

### Integration Test with Multiple Services

```typescript
import {
  createIntegrationTestContext,
  createTestContentWorkflow
} from '@codex/test-utils';
import { ContentService } from '@codex/content';
import { MediaItemService } from '@codex/media';

const getContext = createIntegrationTestContext(
  (db) => ({
    content: new ContentService({ db, environment: 'test' }),
    media: new MediaItemService({ db, environment: 'test' })
  })
);

it('should create content referencing media', async () => {
  const { services, creatorId } = getContext();

  const media = await services.media.create({
    title: 'Test Video',
    mediaType: 'video'
  }, creatorId);

  const content = await services.content.create({
    title: 'Article',
    mediaItemId: media.id
  }, creatorId);

  expect(content.mediaItemId).toBe(media.id);
});
```

### List Pagination Test

```typescript
import {
  createServiceTestContext,
  createTestContentInput,
  expectPaginationValid,
  expectSorted
} from '@codex/test-utils';

const getContext = createServiceTestContext(
  (db) => new ContentService({ db, environment: 'test' })
);

it('should paginate content', async () => {
  const { service, creatorId } = getContext();

  // Create 15 items
  for (let i = 0; i < 15; i++) {
    await service.create(
      createTestContentInput(creatorId, { title: `Item ${i}` }),
      creatorId
    );
  }

  const page1 = await service.list(
    { page: 1, limit: 10 },
    creatorId
  );

  expectPaginationValid(page1.pagination);
  expect(page1.items.length).toBe(10);
  expect(page1.pagination.total).toBe(15);
  expect(page1.pagination.totalPages).toBe(2);

  const page2 = await service.list(
    { page: 2, limit: 10 },
    creatorId
  );

  expect(page2.items.length).toBe(5);
});
```

### Raw Database Query Test

```typescript
import {
  createDatabaseTestContext,
  createTestContentInput,
  cleanupDatabase
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import * as schema from '@codex/database/schema';

const getContext = createDatabaseTestContext(1);

it('should query by creator', async () => {
  const { db, creatorId } = getContext();

  // Insert directly
  const input = createTestContentInput(creatorId);
  const [created] = await db
    .insert(schema.content)
    .values(input)
    .returning();

  // Query
  const result = await db.query.content.findFirst({
    where: eq(schema.content.creatorId, creatorId)
  });

  expect(result?.id).toBe(created.id);
});
```

---

## Integration with Vitest

### Test File Setup Pattern

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  withNeonTestBranch,
  setupTestDatabase,
  teardownTestDatabase,
  validateDatabaseConnection,
  type Database
} from '@codex/test-utils';

// Enable ephemeral branches (module level)
withNeonTestBranch();

describe('MyService', () => {
  let db: Database;

  beforeAll(async () => {
    db = setupTestDatabase();

    // Optional: validate connection
    try {
      await validateDatabaseConnection(db);
    } catch (error) {
      throw new Error(`DB setup failed: ${(error as Error).message}`);
    }
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  // Tests here
});
```

### Test Configuration

Vitest config should include:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: [],
    testTimeout: 10000, // Increase for database tests
  }
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test src/services/__tests__/content.test.ts

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

---

## Best Practices

### 1. Use Context Helpers

**Good**:
```typescript
const getContext = createServiceTestContext(
  (db) => new ContentService({ db, environment: 'test' })
);

it('test', () => {
  const { service, creatorId } = getContext();
});
```

**Bad**:
```typescript
let service: ContentService;
let db: Database;
let creatorId: string;

beforeAll(async () => {
  // Manual setup...
});
```

### 2. Embrace Isolation

With neon-testing in CI:
- Don't cleanup between tests (each file gets fresh DB)
- Keep tests independent (don't rely on order)
- Use unique slugs automatically (built into factories)

### 3. Override Only What Changes

```typescript
// Good: minimal overrides
const content = createTestContent({
  creatorId: 'specific-user',
  contentType: 'written'
});

// Bad: redundant defaults
const content = createTestContent({
  creatorId: 'specific-user',
  title: 'Test Content 1234567890',
  description: 'Test content for automated testing',
  mediaType: 'video',
  // ... all defaults repeated
});
```

### 4. Use Domain Assertions

```typescript
// Good: clear intent
expectPublished(content);
expectMediaStatus(media, 'ready');
expectPaginationValid(page.pagination);

// Bad: generic assertions
expect(content.status).toBe('published');
expect(media.status).toBe('ready');
expect(pagination.page).toBeDefined();
```

### 5. Type Safety

```typescript
// TypeScript catches factory mistakes
const org = createTestOrganization({
  name: 'Org'
  // TS error: missing 'slug' field if required
});

// Overrides are type-safe
const content = createTestContent({
  nonExistentField: 'value' // TS error
});
```

### 6. Scoping and Creator IDs

```typescript
// All test data respects creator scoping
const { service, creatorId, otherCreatorId } = getContext();

// Creator 1's content
const content1 = await service.create(input, creatorId);

// Creator 2 cannot modify creator 1's content
try {
  await service.delete(content1.id, otherCreatorId);
  expect.fail('Should block');
} catch (error) {
  expectContentServiceError(error, 'FORBIDDEN');
}
```

### 7. Verify Error Codes

```typescript
// Be specific with error assertions
try {
  await service.create({}, creatorId);
} catch (error) {
  // Check exact error type
  expectContentServiceError(error, 'VALIDATION_ERROR');
  // NOT just: expect(error).toBeDefined()
}
```

### 8. Database Connection Validation

```typescript
// Always validate before tests run
beforeAll(async () => {
  db = setupTestDatabase();
  await validateDatabaseConnection(db, 3, 1000);
});
```

### 9. Complete Workflows

```typescript
// Use workflow factory for realistic scenarios
const { creatorId, mediaItem, content } = createTestContentWorkflow({
  contentType: 'video',
  status: 'published'
});

// All entities properly linked and ready to use
```

### 10. Error Message Precision

```typescript
// Include expected codes in error messages
try {
  await service.create(input, creatorId);
} catch (error) {
  expectContentServiceError(error, 'CONFLICT');
  expectErrorMessage(error, 'Slug already exists');
}
```

---

## Common Testing Patterns

### Pattern 1: Create-Read-Update-Delete

```typescript
const { service, creatorId } = getContext();

// CREATE
const content = await service.create(
  createTestContentInput(creatorId, { title: 'Original' }),
  creatorId
);
expect(content.id).toBeDefined();

// READ
const fetched = await service.get(content.id, creatorId);
expect(fetched.title).toBe('Original');

// UPDATE
const updated = await service.update(
  content.id,
  { title: 'Updated' },
  creatorId
);
expect(updated.title).toBe('Updated');

// DELETE
await service.delete(content.id, creatorId);
const deleted = await service.get(content.id, creatorId);
expectDeleted(deleted);
```

### Pattern 2: Batch Operations

```typescript
const { service, creatorId } = getContext();

// Create multiple
const items = await Promise.all(
  Array.from({ length: 5 }, (_, i) =>
    service.create(
      createTestContentInput(creatorId, { title: `Item ${i}` }),
      creatorId
    )
  )
);

// Verify count
const list = await service.list({ limit: 10 }, creatorId);
expect(list.items.length).toBe(5);
```

### Pattern 3: Cross-Creator Isolation

```typescript
const { service, creatorId, otherCreatorId } = getContext();

// Creator 1 creates
const content = await service.create(
  createTestContentInput(creatorId),
  creatorId
);

// Creator 2 cannot see
const notFound = await service.get(content.id, otherCreatorId);
expect(notFound).toBeNull();

// Creator 2 cannot modify
try {
  await service.update(content.id, { title: 'Hacked' }, otherCreatorId);
  expect.fail('Should block');
} catch (error) {
  expectContentServiceError(error, 'FORBIDDEN');
}
```

### Pattern 4: Conditional Fields

```typescript
const { service, creatorId } = getContext();

// Written content has body
const article = await service.create(
  createTestContentInput(creatorId, {
    contentType: 'written',
    contentBody: 'Article text here'
  }),
  creatorId
);
expect(article.contentBody).toBeDefined();

// Video content doesn't
const video = await service.create(
  createTestContentInput(creatorId, {
    contentType: 'video'
  }),
  creatorId
);
expect(video.contentBody).toBeNull();
```

### Pattern 5: Relationship Integrity

```typescript
const { service, creatorId } = getContext();
const media = createTestMediaItem({ creatorId, status: 'ready' });

// Content can reference media
const content = await service.create(
  createTestContentInput(creatorId, { mediaItemId: media.id }),
  creatorId
);
expect(content.mediaItemId).toBe(media.id);

// Content requires valid media
try {
  await service.create(
    createTestContentInput(creatorId, {
      mediaItemId: 'invalid-id'
    }),
    creatorId
  );
  expect.fail('Should validate');
} catch (error) {
  expectContentServiceError(error, 'VALIDATION_ERROR');
}
```

### Pattern 6: State Transitions

```typescript
const { service, creatorId } = getContext();

// Start as draft
let content = await service.create(
  createTestContentInput(creatorId),
  creatorId
);
expectDraft(content);

// Transition to published
content = await service.publish(content.id, creatorId);
expectPublished(content);
expect(content.publishedAt).toBeDefined();

// Transition to archived
content = await service.archive(content.id, creatorId);
expectArchived(content);
```

---

## Dependencies

### Internal
- `@codex/database` - Database client and schema types

### External
- `@neondatabase/serverless` - WebSocket database connections
- `drizzle-orm` - SQL query builder
- `neon-testing` - Ephemeral branch fixture
- `vitest` - Test framework (dev only)
- `ws` - WebSocket implementation for Node.js

---

## Performance Notes

### Local Development (Cost Optimized)
- No ephemeral branches (FREE)
- Shared test database
- Fastest execution
- Optional cleanup between tests

### CI (Isolated)
- Fresh database per test file
- Complete test isolation
- Slightly slower (branch provisioning)
- No cleanup needed

### Optimization Tips
1. **Batch operations**: Use factories for multiple entities
2. **Reuse context**: getContext() same instance per test
3. **Skip cleanup**: With neon-testing, cleanup optional
4. **Connection validation**: Catch issues early with validateDatabaseConnection

---

## Troubleshooting

### Database Connection Failed
Check environment variables:
- `DATABASE_URL` - Valid connection string
- `DB_METHOD` - LOCAL_PROXY for local, CI mode for ephemeral
- `NEON_API_KEY` and `NEON_PROJECT_ID` - Required in CI
- `CI=true` - Must be set to enable ephemeral branches

### Tests Hanging
- Ensure `teardownTestDatabase()` called in afterAll
- Check database connection pool not exhausted
- Verify `validateDatabaseConnection()` passes

### Foreign Key Constraint Errors
- Use cleanup functions which delete in correct order
- Or use `withTransaction()` for auto-rollback
- Verify data relationships match schema constraints

### Unique Constraint Violations
- Factory functions generate unique slugs automatically
- Don't reuse IDs across tests
- Use fresh userIds via seedTestUsers

### Timeout Errors
- Increase test timeout in vitest config: `testTimeout: 10000`
- Database connection may be slow - validate with validateDatabaseConnection
- Complex operations may need longer timeout

---

## API Reference Quick Index

| Need | Export | Import |
|------|--------|--------|
| Setup test DB | `setupTestDatabase()` | `@codex/test-utils` |
| Enable CI isolation | `withNeonTestBranch()` | `@codex/test-utils` |
| Close DB | `teardownTestDatabase()` | `@codex/test-utils` |
| Create context | `createServiceTestContext()` | `@codex/test-utils` |
| Create org | `createTestOrganization()` | `@codex/test-utils` |
| Create media | `createTestMediaItem()` | `@codex/test-utils` |
| Create content | `createTestContent()` | `@codex/test-utils` |
| Assert error | `expectContentServiceError()` | `@codex/test-utils` |
| Assert published | `expectPublished()` | `@codex/test-utils` |
| Wait for async | `waitFor()` | `@codex/test-utils` |
| Get unique slug | `createUniqueSlug()` | `@codex/test-utils` |

---

## Support & Maintenance

This package is actively maintained. Report issues or request features in the Codex repository.

**Common Updates**:
- New factories when schema changes
- New assertions for new error types
- Database optimization improvements
- Vitest version compatibility

**Versioning**: Follows semantic versioning. Breaking changes only in major versions.

**Testing**: All utilities are tested via their usage in dependent packages.

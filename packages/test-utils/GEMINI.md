# @codex/test-utils - Testing Utilities Package

## Overview

Centralized test infrastructure for Codex platform integration tests. Provides database setup, test data factories, and assertion helpers that eliminate boilerplate across all test suites.

**Core purpose**: Enable rapid, isolated integration testing with automatic lifecycle management, realistic test data generation, and domain-specific assertion helpers.

**Key capabilities**:
- Workflow-level Neon database isolation (GitHub Actions creates one branch per test domain)
- Complete test data factories for content, media, organizations, and users
- Service and database context setup helpers with automatic lifecycle management
- Type-safe assertion helpers for content domain
- Transaction wrappers and database utility functions

**Primary users**: All packages using Vitest for integration/unit testing (content, identity, access, purchase).

---

## Public API

### Core Functions by Category

| Category | Export | Purpose |
|----------|--------|---------|
| **Database Setup** | `setupTestDatabase()` | Get WebSocket DB client with transaction support |
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
export type Database = DatabaseWs;
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

### Neon Branch Strategy

The package uses a cost-optimized testing strategy:

**CI Environment**:
- GitHub Actions creates one Neon branch per test domain (not per file)
- Domains: ci-unit-tests, ci-auth-tests, ci-content-api-tests, ci-identity-api-tests, ci-ecom-api-tests, ci-e2e-api-tests, ci-e2e-web-tests
- Tests within a domain share the branch for cost optimization
- DATABASE_URL automatically provided by workflow
- Branches cleaned up after workflow completes

**Local Development**:
- Uses DATABASE_URL from .env.dev (LOCAL_PROXY method)
- No ephemeral branch creation (FREE, unlimited test runs)
- Tests share database; cleanup helpers available if isolation needed
- Fast execution with no provisioning delay

### Setup Database Connection

```typescript
import { setupTestDatabase, validateDatabaseConnection } from '@codex/test-utils';

beforeAll(async () => {
  const db = setupTestDatabase();

  // Optional: validate connection before tests
  try {
    await validateDatabaseConnection(db, 3, 1000);
  } catch (error) {
    console.error('Database connection failed:', error);
    throw error;
  }
});
```

**setupTestDatabase()**: Returns WebSocket database client (dbWs from @codex/database) with full transaction support. Automatically configured via environment variables.

**validateDatabaseConnection(db, retries, delayMs)**: Tests connectivity with retry logic.
- `retries` (default: 3) - Retry attempts
- `delayMs` (default: 1000) - Delay between retries in milliseconds
- Throws if all attempts fail

### Teardown Database

```typescript
import { teardownTestDatabase } from '@codex/test-utils';

afterAll(async () => {
  await teardownTestDatabase();
});
```

Closes database pool connection to allow clean process exit.

### Required Environment Variables

**Local Development**:
- `DATABASE_URL` - Connection string (must support transaction pool, use LOCAL_PROXY)
- `DB_METHOD=LOCAL_PROXY` - Enables local proxy configuration

**CI/CD**:
- `DATABASE_URL` - Auto-provided by GitHub Actions workflow (branch-created Neon)
- `CI=true` - Indicates CI environment (optional, auto-detected)

---

## Test Context Helpers

Eliminates boilerplate beforeAll/afterAll lifecycle code by wrapping setup/teardown.

### Database-Only Context

Use when testing raw database queries without a service:

```typescript
import { createDatabaseTestContext } from '@codex/test-utils';

const getContext = createDatabaseTestContext(2); // Create 2 test users

describe('ContentQueries', () => {
  it('should query content by creator', async () => {
    const { db, creatorId } = getContext();

    const result = await db.query.content.findFirst({
      where: eq(content.creatorId, creatorId)
    });

    expect(result).toBeDefined();
  });
});
```

**Signature**:
```typescript
createDatabaseTestContext(userCount: number = 2):
  () => {
    db: Database;
    creatorId: string;
    otherCreatorId: string;
    creatorIds: string[];
  }
```

**Lifecycle Management**:
- beforeAll: Initializes DB, seeds users
- afterAll: Closes DB connection
- Returns function that provides fresh context each test

### Service Context

Most common pattern - single service with database:

```typescript
import { createServiceTestContext } from '@codex/test-utils';
import { ContentService } from '@codex/content';

const getContext = createServiceTestContext(
  (db) => new ContentService({ db, environment: 'test' }),
  2 // Create 2 test users
);

describe('ContentService', () => {
  it('should create content', async () => {
    const { service, db, creatorId, otherCreatorId } = getContext();

    const content = await service.create({
      title: 'Test',
      contentType: 'video'
    }, creatorId);

    expect(content.id).toBeDefined();
    expect(content.creatorId).toBe(creatorId);
  });

  it('should enforce creator isolation', async () => {
    const { service, creatorId, otherCreatorId } = getContext();

    const content = await service.create({
      title: 'Test'
    }, creatorId);

    try {
      await service.delete(content.id, otherCreatorId);
      expect.fail('Should block');
    } catch (error) {
      expectContentServiceError(error, 'FORBIDDEN');
    }
  });
});
```

**Signature**:
```typescript
createServiceTestContext<T>(
  createService: (db: Database) => T,
  userCount: number = 2
): () => ServiceTestContext<T>
```

**Returns**: Function providing ServiceTestContext with db, service instance, and user IDs.

### Integration Context

Test interactions between multiple services:

```typescript
import { createIntegrationTestContext } from '@codex/test-utils';
import { ContentService } from '@codex/content';
import { MediaItemService } from '@codex/content';

const getContext = createIntegrationTestContext(
  (db) => ({
    content: new ContentService({ db, environment: 'test' }),
    media: new MediaItemService({ db, environment: 'test' })
  }),
  3 // Create 3 test users
);

describe('ContentWorkflow', () => {
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
});
```

**Signature**:
```typescript
createIntegrationTestContext<T extends Record<string, unknown>>(
  createServices: (db: Database) => T,
  userCount: number = 2
): () => {
  db: Database;
  services: T;
  creatorId: string;
  otherCreatorId: string;
  creatorIds: string[];
}
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

**Signature**:
```typescript
createUniqueSlug(prefix: string = 'test'): string
```

Returns: Timestamped slug in format `{prefix}-{timestamp}-{random}` ensuring uniqueness.

### Organization Factories

**For database insertion (NewOrganization)**:

```typescript
import { createTestOrganizationInput } from '@codex/test-utils';

const input = createTestOrganizationInput({
  name: 'Custom Organization',
  description: 'Custom description'
});

const [org] = await db.insert(schema.organizations).values(input).returning();
```

**Signature**:
```typescript
createTestOrganizationInput(overrides?: Partial<NewOrganization>): NewOrganization
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

**Signature**:
```typescript
createTestOrganization(overrides?: Partial<Organization>): Organization
```

**Default values**:
- `name`: Auto-generated "Test Organization [RANDOM]"
- `slug`: Unique slug via createUniqueSlug('org')
- `description`: "A test organization for automated testing"
- `logoUrl`: null
- `websiteUrl`: null
- `createdAt`, `updatedAt`: Current timestamp
- `deletedAt`: null

### Media Item Factories

**For database insertion (NewMediaItem)**:

```typescript
import { createTestMediaItemInput } from '@codex/test-utils';

const creatorId = 'test-user-123';
const input = createTestMediaItemInput(creatorId, {
  mediaType: 'audio',
  fileSizeBytes: 5 * 1024 * 1024
});

const [media] = await db.insert(schema.mediaItems).values(input).returning();
```

**Signature**:
```typescript
createTestMediaItemInput(
  creatorId: string,
  overrides?: Partial<NewMediaItem>
): NewMediaItem
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

**Signature**:
```typescript
createTestMediaItem(overrides?: Partial<MediaItem>): MediaItem
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
- `r2Key`: `originals/{uuid}/{mediaType}.mp4`

### Content Factories

**For database insertion (NewContent)**:

```typescript
import { createTestContentInput } from '@codex/test-utils';

const creatorId = 'test-user-123';
const input = createTestContentInput(creatorId, {
  title: 'My Article',
  contentType: 'written'
});

const [content] = await db.insert(schema.content).values(input).returning();
```

**Signature**:
```typescript
createTestContentInput(
  creatorId: string,
  overrides?: Partial<NewContent>
): NewContent
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

**Signature**:
```typescript
createTestContent(overrides?: Partial<Content>): Content
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
- `contentBody`: Populated only for written type
- `publishedAt`: null (for draft)
- `organizationId`: null
- `mediaItemId`: null
- `createdAt`, `updatedAt`: Current timestamp
- `deletedAt`: null

### User ID Factory

```typescript
import { createTestUserId } from '@codex/test-utils';

const userId1 = createTestUserId(); // Random UUID
const userId2 = createTestUserId();
```

**Signature**:
```typescript
createTestUserId(): string
```

Returns: UUID formatted string.

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

**Signatures**:
```typescript
createTestOrganizations(count: number, baseOverrides?: Partial<Organization>): Organization[]
createTestMediaItems(count: number, baseOverrides?: Partial<MediaItem>): MediaItem[]
createTestContentItems(count: number, baseOverrides?: Partial<Content>): Content[]
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

**Signature**:
```typescript
createTestContentWorkflow(options?: {
  creatorId?: string;
  withOrganization?: boolean;
  contentType?: 'video' | 'audio';
  status?: 'draft' | 'published' | 'archived';
}): {
  creatorId: string;
  organization?: Organization;
  mediaItem: MediaItem;
  content: Content;
}
```

**Returns**: Object with all related entities properly linked:
- Media item always status='ready'
- Content references the media item
- Content status matches options.status
- publishedAt set if status='published'

---

## Database Cleanup & Utilities

### Cleanup Strategies

**With shared branches (CI)**: Tests share branch within domain; cleanup optional but available for test isolation within same file.

**Local development**: Tests share database; cleanup helps ensure isolation if needed.

### Clean Content Data

Delete content tables, preserve users:

```typescript
import { cleanupDatabase } from '@codex/test-utils';

afterEach(async () => {
  await cleanupDatabase(db);
});
```

**Signature**:
```typescript
cleanupDatabase(db: Database): Promise<void>
```

**Deletion order** (respects foreign keys):
1. content
2. mediaItems
3. organizations
(Users preserved for reuse across tests)

### Clean All Data

Complete reset including users:

```typescript
import { cleanupDatabaseComplete } from '@codex/test-utils';

afterAll(async () => {
  await cleanupDatabaseComplete(db);
});
```

**Signature**:
```typescript
cleanupDatabaseComplete(db: Database): Promise<void>
```

Use only in afterAll or when needing complete reset.

### Clean Specific Tables

Delete only specified tables:

```typescript
import { cleanupTables } from '@codex/test-utils';

await cleanupTables(db, ['content', 'mediaItems']);
// Respects foreign key order automatically
```

**Signature**:
```typescript
cleanupTables(
  db: Database,
  tables: ('content' | 'mediaItems' | 'organizations' | 'users')[]
): Promise<void>
```

### Transaction Wrapper

Run test in transaction with automatic rollback:

```typescript
import { withTransaction } from '@codex/test-utils';

it('should rollback on error', async () => {
  const result = await withTransaction(db, async (tx) => {
    await tx.insert(schema.organizations).values({ /* ... */ });
    // Transaction auto-rollbacks
    return 'test';
  });
});
```

**Signature**:
```typescript
withTransaction<T>(
  db: Database,
  testFn: (tx: TransactionClient) => Promise<T>
): Promise<T>
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

**Signature**:
```typescript
executeRawSQL(db: Database, query: string): Promise<void>
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

**Signature**:
```typescript
areTablesEmpty(db: Database): Promise<boolean>
```

Returns: true if content, mediaItems, and organizations tables all empty.

### Seed Test Users

Create users in auth.users table:

```typescript
import { seedTestUsers } from '@codex/test-utils';

const userIds = await seedTestUsers(db, 3);
// Returns: ['test-user-123-abc', 'test-user-123-def', 'test-user-123-ghi']
```

**Signature**:
```typescript
seedTestUsers(db: Database, count: number = 1): Promise<string[]>
```

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

**Signature**:
```typescript
expectContentServiceError(
  error: unknown,
  expectedCode: ContentServiceErrorCode
): void
```

**Error codes**:
- `NOT_FOUND` - Entity doesn't exist (404)
- `VALIDATION_ERROR` - Input validation failed (400)
- `FORBIDDEN` - Authorization check failed (403)
- `CONFLICT` - Uniqueness constraint violated (409)
- `BUSINESS_LOGIC_ERROR` - Domain rule violated (422)
- `INTERNAL_ERROR` - Unexpected server error (500)

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

**Signatures**:
```typescript
expectContentEqual(actual: Partial<Content>, expected: Partial<Content>): void
expectMediaItemEqual(actual: Partial<MediaItem>, expected: Partial<MediaItem>): void
expectOrganizationEqual(actual: Partial<Organization>, expected: Partial<Organization>): void
```

**Behavior**: Compares provided fields only; ignores undefined fields in expected.

### Pagination Validation

Verify pagination structure:

```typescript
import { expectPaginationValid } from '@codex/test-utils';

const { items, pagination } = await service.list({ page: 1, limit: 10 });
expectPaginationValid(pagination);
// Verifies: page >= 1, limit >= 1, total >= 0, totalPages = ceil(total/limit)
```

**Signature**:
```typescript
expectPaginationValid(pagination: PaginationMetadata): void
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

**Signatures**:
```typescript
expectContentWithRelations(content: Content & { mediaItem?, organization?, creator? }, options?: {
  expectMediaItem?: boolean;
  expectOrganization?: boolean;
  expectCreator?: boolean;
}): void

expectMediaItemWithRelations(mediaItem: MediaItem & { creator? }, options?: {
  expectCreator?: boolean;
}): void
```

### Sorting

Verify array is sorted correctly:

```typescript
import { expectSorted } from '@codex/test-utils';

const items = await service.list({ sortBy: 'createdAt', order: 'desc' });
expectSorted(items, 'createdAt', 'desc');
```

**Signature**:
```typescript
expectSorted<T>(items: T[], field: keyof T, order: 'asc' | 'desc'): void
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

**Signatures**:
```typescript
expectDraft(content: Partial<Content>): void
expectPublished(content: Partial<Content>): void
expectArchived(content: Partial<Content>): void
```

### Media Status

Assert media processing status:

```typescript
import { expectMediaStatus } from '@codex/test-utils';

const media = await service.get(id, creatorId);
expectMediaStatus(media, 'ready');
// For 'ready': verifies hlsMasterPlaylistKey, thumbnailKey, durationSeconds
```

**Signature**:
```typescript
expectMediaStatus(
  mediaItem: Partial<MediaItem>,
  expectedStatus: 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed'
): void
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

**Signatures**:
```typescript
expectNotDeleted(entity: { deletedAt: Date | null }): void
expectDeleted(entity: { deletedAt: Date | null }): void
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

**Signature**:
```typescript
expectError<T extends new (...args: never[]) => Error>(
  error: unknown,
  ErrorClass: T,
  expectedCode?: string
): asserts error is InstanceType<T>
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

**Signature**:
```typescript
expectErrorMessage(error: unknown, expectedSubstring: string): void
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

**Signature**:
```typescript
waitFor(condition: () => boolean | Promise<boolean>, timeout?: number): Promise<void>
```

**Behavior**: Polls every 100ms until condition true or timeout exceeded (default: 5000ms).

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

**Signature**:
```typescript
sleep(ms: number): Promise<void>
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

**Signature**:
```typescript
createMockFn<T extends (...args: never[]) => unknown>(): {
  fn: T;
  calls: Array<Parameters<T>>;
  callCount: () => number;
  lastCall: () => Parameters<T> | undefined;
}
```

---

## Usage Examples

### Basic Service Test

```typescript
import {
  createServiceTestContext,
  createTestContentInput,
  expectDraft,
  expectPublished
} from '@codex/test-utils';
import { ContentService } from '@codex/content';
import { describe, it, expect } from 'vitest';

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
import { ContentService } from '@codex/content';

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
  expectContentServiceError,
  expectForbidden
} from '@codex/test-utils';
import { ContentService } from '@codex/content';

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
import { MediaItemService } from '@codex/content';

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
  expectPaginationValid
} from '@codex/test-utils';
import { ContentService } from '@codex/content';

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
  createTestContentInput
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
  setupTestDatabase,
  teardownTestDatabase,
  validateDatabaseConnection,
  type Database
} from '@codex/test-utils';

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

### 2. Override Only What Changes

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

### 3. Use Domain Assertions

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

### 4. Type Safety

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

### 5. Scoping and Creator IDs

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

### 6. Verify Error Codes

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

### 7. Database Connection Validation

```typescript
// Always validate before tests run
beforeAll(async () => {
  db = setupTestDatabase();
  await validateDatabaseConnection(db, 3, 1000);
});
```

### 8. Complete Workflows

```typescript
// Use workflow factory for realistic scenarios
const { creatorId, mediaItem, content } = createTestContentWorkflow({
  contentType: 'video',
  status: 'published'
});

// All entities properly linked and ready to use
```

### 9. Error Message Precision

```typescript
// Include expected codes in error messages
try {
  await service.create(input, creatorId);
} catch (error) {
  expectContentServiceError(error, 'CONFLICT');
  expectErrorMessage(error, 'Slug already exists');
}
```

### 10. Batch Operations

```typescript
// Create multiple for testing list operations
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

---

## Dependencies

### Internal
- `@codex/database` - Database client (dbWs) and schema types

### External
- `@neondatabase/serverless` - WebSocket database connections
- `drizzle-orm` - SQL query builder
- `vitest` - Test framework (dev only)
- `ws` - WebSocket implementation for Node.js

---

## Performance Notes

### Local Development (Cost Optimized)
- No ephemeral branches (FREE)
- Shared test database
- Fastest execution
- Optional cleanup between tests

### CI (Cost Optimized)
- Shared branch per test domain (not per file)
- Tests share branch within domain
- Slightly slower (branch provisioning once per workflow)
- Automatic cleanup after workflow

### Optimization Tips
1. **Batch operations**: Use factories for multiple entities
2. **Reuse context**: getContext() returns same instance per test
3. **Skip cleanup**: With shared branches, cleanup optional (cleanup at teardownTestDatabase)
4. **Connection validation**: Catch issues early with validateDatabaseConnection

---

## Troubleshooting

### Database Connection Failed
Check environment variables:
- `DATABASE_URL` - Valid connection string
- `DB_METHOD=LOCAL_PROXY` - Required for local development
- Verify connection string format and credentials

### Tests Hanging
- Ensure `teardownTestDatabase()` called in afterAll
- Check database connection pool not exhausted
- Verify `validateDatabaseConnection()` passes
- Increase testTimeout in vitest config if needed

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

## Changelog

### Recent Changes
- Neon branching moved to GitHub Actions workflow level (cost optimization)
- withNeonTestBranch() now deprecated (no-op for backwards compatibility)
- Tests share branch per domain instead of per-file ephemeral branches

### Version
- @codex/test-utils v0.1.0
- Stable API for integration testing

---

## Support & Maintenance

This package is actively maintained. Report issues or request features in the Codex repository.

**Common Updates**:
- New factories when schema changes
- New assertions for new error types
- Database optimization improvements
- Vitest version compatibility

**Testing**: All utilities are tested via their usage in dependent packages.

---

**Last Updated**: 2024-12-14
**Status**: Stable
**Maintained by**: Codex Documentation Team

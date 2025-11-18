# Database Test Integration Guide

**Complete Reference for @codex/test-utils Database Integration**

Last Updated: 2025-11-11
Package: `@codex/test-utils`
Target: Content Management Service Testing

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Setup Instructions](#setup-instructions)
4. [Database Utilities](#database-utilities)
5. [Test Data Factories](#test-data-factories)
6. [Test Helpers](#test-helpers)
7. [Best Practices](#best-practices)
8. [Common Patterns](#common-patterns)
9. [Troubleshooting](#troubleshooting)
10. [Performance Considerations](#performance-considerations)

---

## Overview

### What This Package Provides

The `@codex/test-utils` package provides a complete testing infrastructure for database-integrated tests across the Codex platform. It handles:

- **Database Connection Management**: Proper connection setup/teardown for tests
- **Test Data Factories**: Type-safe factories for generating realistic test data
- **Data Cleanup**: Efficient cleanup between tests without full schema recreation
- **Test Helpers**: Assertion utilities and common test patterns
- **Type Safety**: Full TypeScript type safety using actual database types

### Design Principles

1. **Use Real Database Types**: Import types directly from `@codex/database/schema` - never recreate types
2. **Test Isolation**: Each test gets a clean database state
3. **Performance**: Reuse database connections, avoid schema recreation
4. **Type Safety**: No `any` types - full type inference throughout
5. **Realistic Data**: Factories generate data that matches production constraints

---

## Architecture

### Database Connection Strategy

**Uses Neon Serverless HTTP Driver**

The test utilities use the same Neon serverless driver as production, configured via environment variables:

```typescript
// packages/test-utils/src/database.ts
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from '@codex/database/schema';

// Create connection
const sqlClient = neon(connectionString);
const db = drizzle({ client: sqlClient, schema });
```

**Key Points:**
- Uses HTTP-based connection (no persistent connection pooling needed)
- Stateless connections - no cleanup required on close
- Same driver as production for consistency
- Works with both local Neon proxy and remote Neon branches

### Environment Variable Configuration

The database connection uses these environment variables (in order of precedence):

1. `DATABASE_URL_TEST` - Dedicated test database (recommended)
2. `DATABASE_URL` - Falls back to default database
3. `DB_METHOD` - Controls connection strategy (from `@codex/database/config/env.config.ts`)

**DB_METHOD Values:**
- `LOCAL_PROXY` - Local PostgreSQL via Neon proxy (Docker Compose)
- `NEON_BRANCH` - Remote ephemeral Neon branch (CI/testing)
- `PRODUCTION` - Production database (never use for tests!)

### Type System

All types come directly from the database schema:

```typescript
import type {
  Organization,
  MediaItem,
  Content,
  NewOrganization,
  NewMediaItem,
  NewContent,
} from '@codex/database/schema';
```

**Type Categories:**
- **Select Types** (`Organization`, `MediaItem`, `Content`): Full entity with all fields including `id` and timestamps
- **Insert Types** (`NewOrganization`, `NewMediaItem`, `NewContent`): Data for insertion without generated fields
- **Database Type** (`typeof db`): The Drizzle database client type

---

## Setup Instructions

### 1. Environment Configuration

#### Option A: Use Dedicated Test Database (Recommended)

Create `.env.test` in project root:

```bash
# Test Database Configuration
DB_METHOD=NEON_BRANCH
DATABASE_URL_TEST=postgresql://neondb_owner:***@***-pooler.us-east-2.aws.neon.tech/neondb
```

**Advantages:**
- Complete isolation from development database
- Safe to run destructive test operations
- No risk of corrupting development data
- Can be reset completely if needed

#### Option B: Use Local Proxy (Shared with Development)

Use existing `.env.dev`:

```bash
# Development Database (shared with tests)
DB_METHOD=LOCAL_PROXY
DATABASE_URL_LOCAL_PROXY=postgres://postgres:postgres@db.localtest.me:5432/main
```

**Advantages:**
- No additional database setup required
- Works with existing Docker Compose setup
- Good for quick local development

**Disadvantages:**
- Tests share database with development
- Need careful cleanup to avoid conflicts
- Development data may interfere with tests

### 2. Install Dependencies

```bash
# Install test-utils package in your package
pnpm add -D @codex/test-utils
```

### 3. Configure Vitest

**In your package's `vitest.config.ts`:**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',

    // Load environment variables for tests
    env: {
      DB_METHOD: 'NEON_BRANCH', // or 'LOCAL_PROXY'
    },

    // Timeout for database operations
    testTimeout: 10000, // 10 seconds

    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
});
```

### 4. Test File Structure

**Recommended structure for service tests:**

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  setupTestDatabase,
  cleanupDatabase,
  seedTestUsers,
  createTestOrganizationInput,
  createTestMediaItemInput,
  createTestContentInput,
  expectContentServiceError,
  createUniqueSlug,
} from '@codex/test-utils';
import type { Database } from '@codex/database';
import { MyService } from '../my-service';

describe('MyService', () => {
  let db: Database;
  let service: MyService;
  let creatorId: string;

  beforeAll(async () => {
    // Setup database and service once
    db = setupTestDatabase();
    service = new MyService({ db, environment: 'test' });

    // Create test user(s)
    const [userId] = await seedTestUsers(db, 1);
    creatorId = userId;
  });

  beforeEach(async () => {
    // Clean database before each test
    await cleanupDatabase(db);
  });

  afterAll(async () => {
    // Final cleanup (optional, but good practice)
    await cleanupDatabase(db);
  });

  it('should create entity', async () => {
    // Test implementation
  });
});
```

---

## Database Utilities

### Core Functions

#### `setupTestDatabase(): Database`

Creates and configures a test database connection.

**Features:**
- Reads connection string from environment
- Configures Neon client for testing
- Enables connection caching for performance
- Returns fully-typed Drizzle database client

**Usage:**
```typescript
const db = setupTestDatabase();
// db is typed as: ReturnType<typeof drizzle<typeof schema>>
```

**Configuration:**
```typescript
// Automatically configures:
neonConfig.fetchConnectionCache = true; // Cache connections
```

#### `cleanupDatabase(db: Database): Promise<void>`

Cleans all content-related tables in correct order to respect foreign key constraints.

**Tables Cleaned (in order):**
1. `content` (references media_items and organizations)
2. `mediaItems` (references users)
3. `organizations` (standalone)

**Important:** Does NOT clean `users` table - use `seedTestUsers()` to create users once in `beforeAll()`.

**Usage:**
```typescript
beforeEach(async () => {
  await cleanupDatabase(db);
});
```

**Why Use This Instead of Transactions?**
- Neon HTTP driver has limited transaction support for rollback-based isolation
- Delete-based cleanup is reliable and fast enough for most tests
- Allows tests to verify actual database state (not just transaction state)
- Works consistently across all database drivers

#### `cleanupTables(db: Database, tables: string[]): Promise<void>`

Clean specific tables only (more efficient for targeted cleanup).

**Usage:**
```typescript
// Only clean content table
await cleanupTables(db, ['content']);

// Clean media and organizations
await cleanupTables(db, ['mediaItems', 'organizations']);
```

#### `seedTestUsers(db: Database, count: number): Promise<string[]>`

Create test users in the auth.users table.

**Returns:** Array of user IDs

**Usage:**
```typescript
// Create one user
const [userId] = await seedTestUsers(db, 1);

// Create multiple users
const [user1, user2, user3] = await seedTestUsers(db, 3);
```

**Generated User Data:**
```typescript
{
  id: 'test-user-{timestamp}-{random}',
  email: 'test-{timestamp}-{random}@example.com',
  name: 'Test User {index}'
}
```

#### `closeTestDatabase(db: Database): Promise<void>`

Close database connection (placeholder for API consistency).

**Note:** Neon HTTP connections are stateless, so this doesn't actually close anything. It exists for:
- API consistency with other database drivers
- Future-proofing if driver changes
- Explicit cleanup documentation

**Usage:**
```typescript
afterAll(async () => {
  await closeTestDatabase(db);
});
```

### Advanced Functions

#### `withTransaction<T>(db: Database, testFn: Function): Promise<T>`

Run test code inside a transaction (auto-rollback).

**Usage:**
```typescript
await withTransaction(db, async (tx) => {
  // Create data
  const [org] = await tx.insert(organizations).values(...).returning();

  // Test code here

  // Transaction will rollback automatically
});
```

**When to Use:**
- Tests that need complete isolation
- Tests that shouldn't leave any trace
- Parallel test execution

**Limitations:**
- Neon HTTP driver has limited transaction support
- Some DDL operations may not rollback
- Nested transactions not supported

#### `executeRawSQL(db: Database, query: string): Promise<void>`

Execute raw SQL for complex test scenarios.

**Usage:**
```typescript
await executeRawSQL(db, `
  UPDATE content
  SET status = 'archived'
  WHERE created_at < NOW() - INTERVAL '30 days'
`);
```

**Warning:** Use sparingly - prefer Drizzle query builder for type safety.

#### `areTablesEmpty(db: Database): Promise<boolean>`

Verify all content tables are empty (useful for testing cleanup).

**Usage:**
```typescript
await cleanupDatabase(db);
expect(await areTablesEmpty(db)).toBe(true);
```

---

## Test Data Factories

### Factory Philosophy

**Two Factory Types:**

1. **Input Factories** (`createTestXInput`): For database insertion (NewX types)
2. **Mock Factories** (`createTestX`): For mocking existing entities (full types with ID)

### Organization Factories

#### `createTestOrganizationInput(overrides?): NewOrganization`

Create organization data for insertion.

**Default Data:**
```typescript
{
  name: 'Test Organization XYZ123456',  // Unique name
  slug: 'org-123456-abc12',            // Unique slug
  description: 'A test organization for automated testing',
  logoUrl: null,
  websiteUrl: null,
}
```

**Usage:**
```typescript
// Default organization
const orgInput = createTestOrganizationInput();
const [org] = await db.insert(organizations).values(orgInput).returning();

// Custom organization
const customOrg = createTestOrganizationInput({
  name: 'My Custom Org',
  websiteUrl: 'https://example.com'
});
```

#### `createTestOrganization(overrides?): Organization`

Create mock organization (includes id and timestamps).

**Usage:**
```typescript
// For mocking in tests (not inserted to DB)
const mockOrg = createTestOrganization({
  name: 'Mock Organization'
});
```

### Media Item Factories

#### `createTestMediaItemInput(creatorId, overrides?): NewMediaItem`

Create media item data for insertion.

**Required:** `creatorId: string`

**Default Data:**
```typescript
{
  creatorId: '<provided>',
  title: 'Test video 1699564832000',
  description: 'Test video for automated testing',
  mediaType: 'video',
  status: 'uploading',  // Always starts as uploading
  r2Key: 'originals/{uuid}/video.mp4',
  fileSizeBytes: 10485760,  // 10MB
  mimeType: 'video/mp4',
  durationSeconds: null,
  width: null,
  height: null,
  hlsMasterPlaylistKey: null,
  thumbnailKey: null,
  uploadedAt: null,
}
```

**Usage:**
```typescript
// Video media
const videoInput = createTestMediaItemInput(creatorId, {
  mediaType: 'video',
  status: 'ready',
});

// Audio media
const audioInput = createTestMediaItemInput(creatorId, {
  mediaType: 'audio',
  mimeType: 'audio/mpeg',
});

// Insert to database
const [media] = await db.insert(mediaItems).values(videoInput).returning();
```

**Media Status Progression:**
- `uploading` → Initial state
- `uploaded` → File received
- `transcoding` → Processing HLS
- `ready` → Ready for playback
- `failed` → Processing failed

#### `createTestMediaItem(overrides?): MediaItem`

Create mock media item (includes id and timestamps).

**Default Status:** `ready` (unlike input factory which defaults to `uploading`)

**Usage:**
```typescript
const mockMedia = createTestMediaItem({
  creatorId: userId,
  status: 'ready',
});
```

### Content Factories

#### `createTestContentInput(creatorId, overrides?): NewContent`

Create content data for insertion.

**Required:** `creatorId: string`

**Default Data:**
```typescript
{
  creatorId: '<provided>',
  organizationId: null,
  mediaItemId: null,
  title: 'Test Content 1699564832000',
  slug: 'content-123456-abc12',  // Unique slug
  description: 'Test content for automated testing',
  contentType: 'video',
  thumbnailUrl: null,
  contentBody: null,
  category: 'test-category',
  tags: ['test', 'automation'],
  visibility: 'public',
  priceCents: 0,
  status: 'draft',
  publishedAt: null,
  viewCount: 0,
  purchaseCount: 0,
}
```

**Usage:**
```typescript
// Video content with media
const contentInput = createTestContentInput(creatorId, {
  contentType: 'video',
  mediaItemId: media.id,
  visibility: 'public',
});

// Written content (no media)
const writtenInput = createTestContentInput(creatorId, {
  contentType: 'written',
  contentBody: 'This is the article content...',
});

// Paid content
const paidInput = createTestContentInput(creatorId, {
  visibility: 'purchased_only',
  priceCents: 999,  // $9.99
});

// Organization content
const orgContent = createTestContentInput(creatorId, {
  organizationId: org.id,
});
```

#### `createTestContent(overrides?): Content`

Create mock content (includes id and timestamps).

**Usage:**
```typescript
const mockContent = createTestContent({
  title: 'Mock Content',
  status: 'published',
});
```

### Batch Factories

#### `createTestOrganizations(count, overrides?): Organization[]`

Create multiple mock organizations.

```typescript
const orgs = createTestOrganizations(3);
// Returns array of 3 organizations
```

#### `createTestMediaItems(count, overrides?): MediaItem[]`

Create multiple mock media items.

```typescript
const mediaItems = createTestMediaItems(5, { mediaType: 'video' });
```

#### `createTestContentItems(count, overrides?): Content[]`

Create multiple mock content items.

```typescript
const contents = createTestContentItems(10, { status: 'published' });
```

### Workflow Factory

#### `createTestContentWorkflow(options?): { creatorId, organization?, mediaItem, content }`

Create a complete content workflow with related entities.

**Options:**
```typescript
{
  creatorId?: string;           // Auto-generated if not provided
  withOrganization?: boolean;   // Include organization
  contentType?: 'video' | 'audio';
  status?: 'draft' | 'published' | 'archived';
}
```

**Usage:**
```typescript
// Complete workflow
const workflow = createTestContentWorkflow({
  withOrganization: true,
  contentType: 'video',
  status: 'published',
});

// Access entities
workflow.creatorId;      // string
workflow.organization;   // Organization | undefined
workflow.mediaItem;      // MediaItem
workflow.content;        // Content
```

**Note:** This creates mock objects, not database records. Use for mocking, not database insertion.

### Helper Functions

#### `createUniqueSlug(prefix?): string`

Generate unique slug for tests.

```typescript
const slug = createUniqueSlug('video');
// Returns: 'video-1699564832000-abc12'
```

**Format:** `{prefix}-{timestamp}-{random}`

**Uniqueness:** Timestamp + random string ensures no collisions.

#### `createTestUserId(): string`

Generate UUID-format user ID.

```typescript
const userId = createTestUserId();
// Returns: '550e8400-e29b-41d4-a716-446655440000'
```

---

## Test Helpers

### Error Assertions

#### `expectContentServiceError(error, expectedCode)`

Assert error is ContentServiceError with expected code.

**Error Codes:**
- `NOT_FOUND`
- `VALIDATION_ERROR`
- `FORBIDDEN`
- `CONFLICT`
- `BUSINESS_LOGIC_ERROR`
- `INTERNAL_ERROR`

**Usage:**
```typescript
try {
  await service.get('invalid-id', creatorId);
  expect.fail('Should have thrown');
} catch (error) {
  expectContentServiceError(error, 'NOT_FOUND');
}
```

#### `expectError(error, ErrorClass)`

Assert error is instance of specific class.

**Usage:**
```typescript
import { ContentNotFoundError } from '@codex/content/errors';

await expect(service.get('invalid', userId))
  .rejects.toThrow(ContentNotFoundError);
```

### Entity Assertions

#### `expectContentEqual(actual, expected)`

Compare content objects (ignores timestamp variations).

**Usage:**
```typescript
expectContentEqual(result, {
  id: content.id,
  title: 'Expected Title',
  status: 'published',
});
```

#### `expectMediaItemEqual(actual, expected)`

Compare media item objects.

#### `expectOrganizationEqual(actual, expected)`

Compare organization objects.

### Pagination Assertions

#### `expectPaginationValid(pagination)`

Validate pagination structure and math.

**Validates:**
- Page >= 1
- Limit >= 1
- Total >= 0
- TotalPages = ceil(total / limit)

**Usage:**
```typescript
const result = await service.list(creatorId);
expectPaginationValid(result.pagination);
```

### Relation Assertions

#### `expectContentWithRelations(content, options)`

Assert content has expected relations populated.

**Options:**
```typescript
{
  expectMediaItem?: boolean;
  expectOrganization?: boolean;
  expectCreator?: boolean;
}
```

**Usage:**
```typescript
expectContentWithRelations(content, {
  expectMediaItem: true,
  expectOrganization: false,
});
```

### Status Assertions

#### `expectDraft(content)`

Assert content is in draft status.

```typescript
expectDraft(content);
// Checks: status === 'draft' && publishedAt === null
```

#### `expectPublished(content)`

Assert content is published.

```typescript
expectPublished(content);
// Checks: status === 'published' && publishedAt !== null
```

#### `expectMediaStatus(mediaItem, expectedStatus)`

Assert media item status with validation.

```typescript
expectMediaStatus(mediaItem, 'ready');
// For 'ready', also checks HLS keys are populated
```

### Deletion Assertions

#### `expectNotDeleted(entity)`

Assert entity is not soft-deleted.

```typescript
expectNotDeleted(content);
// Checks: deletedAt === null
```

#### `expectDeleted(entity)`

Assert entity is soft-deleted.

```typescript
expectDeleted(content);
// Checks: deletedAt !== null
```

### Sorting Assertions

#### `expectSorted(items, field, order)`

Assert array is sorted by field.

**Usage:**
```typescript
expectSorted(contents, 'createdAt', 'desc');
expectSorted(organizations, 'name', 'asc');
```

### Utility Functions

#### `waitFor(condition, timeout?)`

Wait for async condition to be true.

**Usage:**
```typescript
await waitFor(async () => {
  const media = await service.getMedia(mediaId);
  return media.status === 'ready';
}, 5000); // 5 second timeout
```

#### `sleep(ms)`

Sleep for milliseconds.

```typescript
await sleep(1000); // Wait 1 second
```

---

## Best Practices

### 1. Database Connection Management

**DO:**
```typescript
// Setup once in beforeAll
beforeAll(async () => {
  db = setupTestDatabase();
  service = new MyService({ db });
  [userId] = await seedTestUsers(db, 1);
});
```

**DON'T:**
```typescript
// Don't create new connection in each test
it('test', async () => {
  const db = setupTestDatabase(); // WRONG - creates new connection
});
```

### 2. Test User Management

**DO:**
```typescript
// Create users once in beforeAll
beforeAll(async () => {
  const [user1, user2] = await seedTestUsers(db, 2);
  creatorId = user1;
  otherCreatorId = user2;
});

// Reuse across tests
it('test 1', async () => {
  await service.create(..., creatorId);
});
```

**DON'T:**
```typescript
// Don't create users in each test
it('test', async () => {
  const [userId] = await seedTestUsers(db, 1); // WRONG - creates users repeatedly
});
```

### 3. Data Cleanup

**DO:**
```typescript
// Clean before each test
beforeEach(async () => {
  await cleanupDatabase(db);
});

// Targeted cleanup for specific tests
it('test', async () => {
  await cleanupTables(db, ['content']); // Only clean what's needed
});
```

**DON'T:**
```typescript
// Don't forget cleanup
it('test 1', async () => {
  await service.create(...);
  // No cleanup - affects next test
});
```

### 4. Factory Usage

**DO:**
```typescript
// Use input factories for database insertion
const orgInput = createTestOrganizationInput({ name: 'Custom' });
const [org] = await db.insert(organizations).values(orgInput).returning();

// Use mock factories for test doubles
const mockOrg = createTestOrganization({ name: 'Mock' });
jest.spyOn(service, 'getOrg').mockResolvedValue(mockOrg);
```

**DON'T:**
```typescript
// Don't manually create test data
const org = {
  name: 'Test',
  slug: 'test', // WRONG - may not be unique
  // Missing required fields
};
```

### 5. Slug Uniqueness

**DO:**
```typescript
// Always use createUniqueSlug
const slug = createUniqueSlug('content');
```

**DON'T:**
```typescript
// Don't hardcode slugs
const slug = 'test-content'; // WRONG - causes conflicts
```

### 6. Type Safety

**DO:**
```typescript
import type { Database } from '@codex/database';
import type { Organization, NewOrganization } from '@codex/database/schema';

let db: Database;
const input: NewOrganization = createTestOrganizationInput();
```

**DON'T:**
```typescript
// Don't use any or recreate types
let db: any; // WRONG
interface MyOrganization { ... } // WRONG - type already exists
```

### 7. Test Organization

**DO:**
```typescript
describe('ContentService', () => {
  describe('create', () => {
    describe('valid inputs', () => {
      it('should create video content', async () => {
        // Arrange
        const input = createTestContentInput(creatorId);

        // Act
        const result = await service.create(input, creatorId);

        // Assert
        expect(result.id).toBeDefined();
      });
    });

    describe('validation', () => {
      it('should reject invalid slug', async () => {
        // Test validation
      });
    });
  });
});
```

**Pattern:**
- Arrange → Act → Assert
- Nested describes for organization
- Descriptive test names

### 8. Async/Await

**DO:**
```typescript
it('should create content', async () => {
  const result = await service.create(input, userId);
  expect(result).toBeDefined();
});
```

**DON'T:**
```typescript
it('should create content', () => {
  service.create(input, userId).then(result => {
    expect(result).toBeDefined(); // WRONG - hard to debug failures
  });
});
```

---

## Common Patterns

### Pattern 1: Service Test Setup

```typescript
describe('MyService', () => {
  let db: Database;
  let service: MyService;
  let userId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new MyService({ db, environment: 'test' });
    [userId] = await seedTestUsers(db, 1);
  });

  beforeEach(async () => {
    await cleanupDatabase(db);
  });

  afterAll(async () => {
    await cleanupDatabase(db);
  });
});
```

### Pattern 2: Create and Verify Entity

```typescript
it('should create organization', async () => {
  // Arrange
  const input = createTestOrganizationInput({
    name: 'Test Org',
  });

  // Act
  const [org] = await db
    .insert(organizations)
    .values(input)
    .returning();

  // Assert
  expect(org.id).toBeDefined();
  expect(org.name).toBe('Test Org');
  expect(org.createdAt).toBeInstanceOf(Date);
});
```

### Pattern 3: Test Foreign Key Relationships

```typescript
it('should create content with media', async () => {
  // Arrange: Create media first
  const [media] = await db
    .insert(mediaItems)
    .values(createTestMediaItemInput(userId, { status: 'ready' }))
    .returning();

  // Arrange: Create content referencing media
  const contentInput = createTestContentInput(userId, {
    mediaItemId: media.id,
  });

  // Act
  const [content] = await db
    .insert(content)
    .values(contentInput)
    .returning();

  // Assert
  expect(content.mediaItemId).toBe(media.id);
});
```

### Pattern 4: Test Scoping/Isolation

```typescript
it('should not access other creator content', async () => {
  // Arrange: Create content for other creator
  const [otherUserId] = await seedTestUsers(db, 1);
  const [otherContent] = await db
    .insert(content)
    .values(createTestContentInput(otherUserId))
    .returning();

  // Act: Try to access as different creator
  const result = await service.get(otherContent.id, userId);

  // Assert
  expect(result).toBeNull();
});
```

### Pattern 5: Test Pagination

```typescript
it('should paginate results', async () => {
  // Arrange: Create 10 items
  for (let i = 0; i < 10; i++) {
    await db
      .insert(content)
      .values(createTestContentInput(userId));
  }

  // Act: Get page 1
  const page1 = await service.list(userId, {}, { page: 1, limit: 3 });

  // Assert
  expect(page1.items).toHaveLength(3);
  expect(page1.pagination.total).toBe(10);
  expect(page1.pagination.totalPages).toBe(4);

  // Act: Get page 2
  const page2 = await service.list(userId, {}, { page: 2, limit: 3 });

  // Assert
  expect(page2.items).toHaveLength(3);
  expect(page1.items[0].id).not.toBe(page2.items[0].id);
});
```

### Pattern 6: Test Status Transitions

```typescript
it('should transition from draft to published', async () => {
  // Arrange: Create draft content
  const [draft] = await db
    .insert(content)
    .values(createTestContentInput(userId))
    .returning();

  expectDraft(draft);

  // Act: Publish
  const published = await service.publish(draft.id, userId);

  // Assert
  expectPublished(published);
  expect(published.publishedAt).toBeInstanceOf(Date);
});
```

### Pattern 7: Test Error Conditions

```typescript
it('should throw NotFoundError for invalid ID', async () => {
  // Act & Assert
  await expect(
    service.get('00000000-0000-0000-0000-000000000000', userId)
  ).rejects.toThrow(ContentNotFoundError);
});
```

### Pattern 8: Test Soft Deletion

```typescript
it('should soft delete content', async () => {
  // Arrange: Create content
  const [item] = await db
    .insert(content)
    .values(createTestContentInput(userId))
    .returning();

  expectNotDeleted(item);

  // Act: Delete
  await service.delete(item.id, userId);

  // Assert: Should not be retrievable
  const result = await service.get(item.id, userId);
  expect(result).toBeNull();

  // Assert: But exists in database with deletedAt set
  const [deleted] = await db
    .select()
    .from(content)
    .where(eq(content.id, item.id));

  expectDeleted(deleted);
});
```

---

## Troubleshooting

### Issue: "DATABASE_URL not found"

**Error:**
```
Error: Database connection string not found. Set DATABASE_URL_TEST or DATABASE_URL environment variable.
```

**Solution:**
1. Create `.env.test` file with `DATABASE_URL_TEST`
2. Or set `DATABASE_URL` in `.env.dev`
3. Ensure environment file is loaded (check `vitest.config.ts`)

### Issue: "Foreign key constraint violation"

**Error:**
```
ERROR: insert or update on table "content" violates foreign key constraint "content_media_item_id_fkey"
```

**Cause:** Trying to reference non-existent entity.

**Solution:**
```typescript
// Create referenced entity FIRST
const [media] = await db
  .insert(mediaItems)
  .values(createTestMediaItemInput(userId))
  .returning();

// THEN reference it
const contentInput = createTestContentInput(userId, {
  mediaItemId: media.id, // Valid reference
});
```

### Issue: "Unique constraint violation"

**Error:**
```
ERROR: duplicate key value violates unique constraint "organizations_slug_key"
```

**Cause:** Using same slug twice.

**Solution:**
```typescript
// Always use createUniqueSlug()
const slug = createUniqueSlug('org');
```

### Issue: Tests interfere with each other

**Symptom:** Tests pass individually but fail when run together.

**Cause:** Not cleaning database between tests.

**Solution:**
```typescript
beforeEach(async () => {
  await cleanupDatabase(db);
});
```

### Issue: Slow tests

**Symptom:** Tests take too long to run.

**Optimization 1:** Use `cleanupTables()` instead of full cleanup
```typescript
// Before
beforeEach(async () => {
  await cleanupDatabase(db); // Cleans everything
});

// After
beforeEach(async () => {
  await cleanupTables(db, ['content']); // Only clean what changes
});
```

**Optimization 2:** Create users once, reuse them
```typescript
beforeAll(async () => {
  [userId] = await seedTestUsers(db, 1); // Once
});

// Don't do this in beforeEach or in each test
```

**Optimization 3:** Batch inserts
```typescript
// Before
for (let i = 0; i < 10; i++) {
  await db.insert(content).values(createTestContentInput(userId));
}

// After
const inputs = Array.from({ length: 10 }, () =>
  createTestContentInput(userId)
);
await db.insert(content).values(inputs);
```

### Issue: Type errors with database client

**Error:**
```
Type 'any' is not assignable to type 'Database'
```

**Solution:**
```typescript
// Correct import
import type { Database } from '@codex/database';
import { db as dbType } from '@codex/database';

// Correct type
let db: typeof dbType;

// Or use the exported type from test-utils
import type { Database } from '@codex/test-utils';
```

### Issue: "Cannot find module '@codex/database/schema'"

**Error:**
```
Cannot find module '@codex/database/schema' or its corresponding type declarations
```

**Solution:**

Check `package.json` exports in `@codex/database`:
```json
{
  "exports": {
    ".": "./src/index.ts",
    "./schema": "./src/schema/index.ts"
  }
}
```

### Issue: Connection timeouts

**Error:**
```
Timeout waiting for database connection
```

**Causes:**
1. Database not running (if using LOCAL_PROXY)
2. Wrong DATABASE_URL
3. Network issues (if using NEON_BRANCH)

**Solutions:**

For LOCAL_PROXY:
```bash
# Check Docker Compose is running
docker compose ps

# Start database if needed
docker compose up -d
```

For NEON_BRANCH:
```bash
# Verify connection string
psql $DATABASE_URL_TEST -c "SELECT 1"
```

---

## Performance Considerations

### Connection Reuse

**Good:** One connection per test suite
```typescript
beforeAll(async () => {
  db = setupTestDatabase(); // Called once
});
```

**Bad:** New connection per test
```typescript
it('test', async () => {
  const db = setupTestDatabase(); // Called for each test
});
```

### Cleanup Strategy

**Fastest:** Targeted table cleanup
```typescript
await cleanupTables(db, ['content']); // ~10-50ms
```

**Fast:** Full content cleanup
```typescript
await cleanupDatabase(db); // ~50-100ms
```

**Slow:** Transaction rollback (limited support)
```typescript
await withTransaction(db, async (tx) => {
  // Test code
}); // ~100-200ms
```

**Slowest:** Drop and recreate schema
```typescript
// DON'T DO THIS - takes seconds
await db.execute(sql`DROP SCHEMA public CASCADE`);
await db.execute(sql`CREATE SCHEMA public`);
await migrate(db);
```

### Batch Operations

**Good:** Single insert with array
```typescript
const items = Array.from({ length: 100 }, () => createTestContentInput(userId));
await db.insert(content).values(items); // ~100ms
```

**Bad:** Loop with individual inserts
```typescript
for (let i = 0; i < 100; i++) {
  await db.insert(content).values(createTestContentInput(userId)); // ~10 seconds
}
```

### Test Parallelization

Vitest runs tests in parallel by default. For database tests:

**Configure test pool size:**
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 4, // Adjust based on database connection limits
      },
    },
  },
});
```

**For Neon:**
- Free tier: 1 connection limit (run tests sequentially)
- Pro tier: Multiple connections (parallel tests okay)

---

## Summary

### Quick Reference

**Setup:**
```typescript
import { setupTestDatabase, cleanupDatabase, seedTestUsers } from '@codex/test-utils';

let db = setupTestDatabase();
let [userId] = await seedTestUsers(db, 1);
```

**Cleanup:**
```typescript
await cleanupDatabase(db);
```

**Factories:**
```typescript
createTestOrganizationInput()
createTestMediaItemInput(userId)
createTestContentInput(userId)
```

**Helpers:**
```typescript
createUniqueSlug('prefix')
expectContentServiceError(error, 'NOT_FOUND')
expectPublished(content)
```

### Key Principles

1. **One connection per suite** - Setup in `beforeAll()`
2. **Clean between tests** - Use `beforeEach(async () => await cleanupDatabase(db))`
3. **Reuse users** - Create once, use everywhere
4. **Use factories** - Never manually create test data
5. **Type safety** - Import types from `@codex/database/schema`
6. **Unique slugs** - Always use `createUniqueSlug()`

---

## Additional Resources

- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [Vitest Documentation](https://vitest.dev/)
- [Neon Serverless Driver](https://github.com/neondatabase/serverless)
- [Project Database Schema](../../design/database/database-schema.md)
- [Environment Management](../../design/infrastructure/EnvironmentManagement.md)

---

**Need Help?**

Check:
1. This guide's [Troubleshooting](#troubleshooting) section
2. Existing tests in `packages/content/src/__tests__/`
3. Project documentation in `design/` directory

For questions about database integration, refer to the Systems Integration Engineer role documentation.

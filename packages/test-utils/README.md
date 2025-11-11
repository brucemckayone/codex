# @codex/test-utils

Comprehensive test utilities for the Codex Content Management System test suites.

## Overview

This package provides centralized test utilities including:
- Database setup and cleanup
- Test data factories
- Custom assertion helpers
- Miniflare helpers for Cloudflare Workers testing

## Installation

This package is automatically available to all workspace packages via `workspace:*`.

Add to your package.json:

```json
{
  "devDependencies": {
    "@codex/test-utils": "workspace:*"
  }
}
```

## Database Setup

### Environment Variables

Tests require a database connection string. Set one of the following:
- `DATABASE_URL_TEST` - Dedicated test database (recommended)
- `DATABASE_URL` - Falls back to this if _TEST is not set
- `DATABASE_URL_LOCAL_PROXY` - Local proxy database

Configure in your vitest.config.ts:

```typescript
import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../../.env.dev') });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      DATABASE_URL: process.env.DATABASE_URL || process.env.DATABASE_URL_LOCAL_PROXY || '',
    },
  },
});
```

### Basic Usage

```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  setupTestDatabase,
  cleanupDatabase,
  seedTestUsers,
} from '@codex/test-utils';
import type { Database } from '@codex/database';

describe('MyService', () => {
  let db: Database;
  let testUserId: string;

  beforeAll(async () => {
    // Setup database connection
    db = setupTestDatabase();
    
    // Create test users
    const [userId] = await seedTestUsers(db, 1);
    testUserId = userId;
  });

  beforeEach(async () => {
    // Clean up between tests
    await cleanupDatabase(db);
  });

  afterAll(async () => {
    // Final cleanup
    await cleanupDatabase(db);
  });

  it('should work with test data', async () => {
    // Your test here
  });
});
```

## Test Data Factories

### Creating Test Input (for database insertion)

```typescript
import {
  createTestOrganizationInput,
  createTestMediaItemInput,
  createTestContentInput,
  createUniqueSlug,
} from '@codex/test-utils';
import { organizations, mediaItems, content } from '@codex/database/schema';

// Create organization
const orgInput = createTestOrganizationInput({
  name: 'Custom Organization Name',
});
const [org] = await db.insert(organizations).values(orgInput).returning();

// Create media item
const mediaInput = createTestMediaItemInput(creatorId, {
  mediaType: 'video',
  status: 'ready',
});
const [media] = await db.insert(mediaItems).values(mediaInput).returning();

// Create content
const contentInput = createTestContentInput(creatorId, {
  title: 'My Test Content',
  slug: createUniqueSlug('test'),
  contentType: 'video',
  mediaItemId: media.id,
  organizationId: org.id,
});
const [item] = await db.insert(content).values(contentInput).returning();
```

### Creating Mock Entities (with IDs and timestamps)

```typescript
import {
  createTestOrganization,
  createTestMediaItem,
  createTestContent,
} from '@codex/test-utils';

// Create mock entities for testing logic that doesn't need database
const mockOrg = createTestOrganization({
  name: 'Mock Organization',
});

const mockMedia = createTestMediaItem({
  creatorId: 'user-123',
  status: 'ready',
});

const mockContent = createTestContent({
  creatorId: 'user-123',
  mediaItemId: mockMedia.id,
  organizationId: mockOrg.id,
});
```

### Unique Slugs

Always use `createUniqueSlug()` to avoid collisions:

```typescript
import { createUniqueSlug } from '@codex/test-utils';

const slug1 = createUniqueSlug('video'); // video-1762847839546-abc12
const slug2 = createUniqueSlug('audio'); // audio-1762847839546-def34
```

## Custom Assertions

### Error Assertions

```typescript
import {
  expectError,
  expectContentServiceError,
  expectErrorMessage,
} from '@codex/test-utils';
import {
  ContentNotFoundError,
  MediaNotReadyError,
} from '@codex/content/errors';

// Assert error class
await expect(async () => {
  await service.get('invalid-id');
}).rejects.toThrow(ContentNotFoundError);

// Or use expectError helper
try {
  await service.get('invalid-id');
} catch (error) {
  expectError(error, ContentNotFoundError);
}

// Assert error code
try {
  await service.create(invalidInput);
} catch (error) {
  expectContentServiceError(error, 'VALIDATION_ERROR');
}

// Assert error message contains substring
try {
  await service.update('id', { title: '' });
} catch (error) {
  expectErrorMessage(error, 'title is required');
}
```

## Database Utilities

### Cleanup Functions

```typescript
import {
  cleanupDatabase,
  cleanupTables,
  areTablesEmpty,
} from '@codex/test-utils';

// Clean all content tables
await cleanupDatabase(db);

// Clean specific tables
await cleanupTables(db, ['content', 'mediaItems']);

// Verify cleanup
const isEmpty = await areTablesEmpty(db);
expect(isEmpty).toBe(true);
```

### Seed Test Users

```typescript
import { seedTestUsers } from '@codex/test-utils';

// Create multiple test users
const [user1, user2, user3] = await seedTestUsers(db, 3);

// Each user has unique ID and email
console.log(user1); // test-user-1762847839546-abc12
```

### Transaction Helpers

```typescript
import { withTransaction } from '@codex/test-utils';

// Run test in transaction (auto-rollback)
await withTransaction(db, async (tx) => {
  const [org] = await tx.insert(organizations).values(orgInput).returning();
  
  // Do test operations
  expect(org.id).toBeDefined();
  
  // Transaction will auto-rollback after this function
});
```

## Available Functions

### Database Functions
- `setupTestDatabase()`: Create database client for tests
- `cleanupDatabase(db)`: Clean all content tables
- `cleanupTables(db, tables)`: Clean specific tables
- `seedTestUsers(db, count)`: Create test users
- `areTablesEmpty(db)`: Check if tables are empty
- `withTransaction(db, fn)`: Run test in transaction
- `executeRawSQL(db, query)`: Execute raw SQL
- `closeTestDatabase(db)`: Close database connection

### Factory Functions (Input - for DB insertion)
- `createTestOrganizationInput(overrides)`: NewOrganization
- `createTestMediaItemInput(creatorId, overrides)`: NewMediaItem
- `createTestContentInput(creatorId, overrides)`: NewContent

### Factory Functions (Mocks - with IDs)
- `createTestOrganization(overrides)`: Organization
- `createTestMediaItem(overrides)`: MediaItem
- `createTestContent(overrides)`: Content

### Batch Factories
- `createTestOrganizations(count, overrides)`: Organization[]
- `createTestMediaItems(count, overrides)`: MediaItem[]
- `createTestContentItems(count, overrides)`: Content[]
- `createTestContentWorkflow(options)`: Full workflow with org, media, content

### Helper Functions
- `createUniqueSlug(prefix)`: Generate unique slug
- `createTestUserId()`: Generate test user ID

### Assertion Helpers
- `expectError(error, ErrorClass, code?)`: Assert error class
- `expectContentServiceError(error, code)`: Assert service error
- `expectErrorMessage(error, substring)`: Assert error message
- `waitFor(condition, timeout)`: Wait for async condition
- `sleep(ms)`: Sleep for milliseconds

## Type Imports

```typescript
import type { Database } from '@codex/database';
import type {
  Organization,
  NewOrganization,
  MediaItem,
  NewMediaItem,
  Content,
  NewContent,
} from '@codex/database/schema';
```

## Best Practices

1. **Always clean up between tests**
   ```typescript
   beforeEach(async () => {
     await cleanupDatabase(db);
   });
   ```

2. **Use unique slugs**
   ```typescript
   const slug = createUniqueSlug('my-content');
   ```

3. **Seed users once per test suite**
   ```typescript
   beforeAll(async () => {
     [userId1, userId2] = await seedTestUsers(db, 2);
   });
   ```

4. **Use factory functions for test data**
   ```typescript
   const input = createTestMediaItemInput(creatorId, {
     status: 'ready',
   });
   ```

5. **Use type-safe assertions**
   ```typescript
   await expect(service.get('id')).rejects.toThrow(NotFoundError);
   ```

## Troubleshooting

### Database connection errors

Ensure DATABASE_URL is set in your vitest.config.ts:

```typescript
env: {
  DATABASE_URL: process.env.DATABASE_URL || process.env.DATABASE_URL_LOCAL_PROXY || '',
},
```

### Foreign key constraint errors

Ensure proper cleanup order (content → media → organizations → users):

```typescript
await cleanupDatabase(db); // Already handles this order
```

### Test isolation issues

Always clean up between tests:

```typescript
beforeEach(async () => {
  await cleanupDatabase(db);
});
```

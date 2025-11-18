# @codex/database

Database package for the Codex platform. Provides a type-safe database client, schema definitions, migrations, and utilities for PostgreSQL/Neon database operations using Drizzle ORM.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Database Clients](#database-clients)
- [Schema Overview](#schema-overview)
- [Migrations](#migrations)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Usage Examples](#usage-examples)
- [Error Handling](#error-handling)
- [Database Triggers](#database-triggers)
- [Testing](#testing)
- [Dependencies](#dependencies)

## Installation

```bash
pnpm add @codex/database
```

## Quick Start

```typescript
import { dbHttp, dbWs, schema } from '@codex/database';
import { eq } from 'drizzle-orm';

// Simple query with HTTP client
const users = await dbHttp.select().from(schema.users);

// Transaction with WebSocket client
await dbWs.transaction(async (tx) => {
  await tx.insert(schema.users).values({ name: 'John', email: 'john@example.com' });
  await tx.insert(schema.organizations).values({ name: 'Acme Inc', slug: 'acme' });
});
```

## Database Clients

The package provides two database clients optimized for different use cases:

### HTTP Client (`dbHttp`)

**Use for:**
- Production Cloudflare Workers (stateless, optimized for edge)
- One-off queries
- Simple CRUD operations

**Features:**
- Stateless connection
- Low latency for edge deployments
- Optimized for serverless environments

**Limitations:**
- Does NOT support `db.transaction()`
- Cannot use interactive transactions

```typescript
import { dbHttp } from '@codex/database';

// Simple queries work great
const users = await dbHttp.select().from(schema.users).where(eq(schema.users.id, userId));
```

### WebSocket Client (`dbWs`)

**Use for:**
- Tests (full transaction support)
- Local development
- Operations requiring `db.transaction()`
- Multi-step operations requiring atomicity

**Features:**
- Full transaction support
- Interactive sessions with BEGIN/COMMIT/ROLLBACK
- Works in Node.js and Cloudflare Workers

```typescript
import { dbWs } from '@codex/database';

// Transactions are fully supported
await dbWs.transaction(async (tx) => {
  const [user] = await tx.insert(schema.users).values({
    name: 'John',
    email: 'john@example.com'
  }).returning();

  await tx.insert(schema.organizations).values({
    name: 'Acme Inc',
    slug: 'acme',
    ownerId: user.id
  });
});
```

### Default Client (`db`)

An alias for `dbHttp` provided for backward compatibility.

```typescript
import { db } from '@codex/database';

// Same as dbHttp
const users = await db.select().from(schema.users);
```

## Schema Overview

The database schema is organized into three main domains:

### Authentication Tables

Managed by [better-auth](https://github.com/better-auth/better-auth):

- **users** - User accounts with email verification
- **accounts** - OAuth provider accounts linked to users
- **sessions** - User session management with tokens
- **verification_tokens** - Email verification and password reset tokens

```typescript
import { schema } from '@codex/database';

// Type-safe user operations
const user = await dbHttp.select().from(schema.users)
  .where(eq(schema.users.email, 'user@example.com'));
```

### Content Tables

Core content management tables:

- **organizations** - Creator organizations with branding
- **media_items** - Uploaded video/audio files stored in R2
- **content** - Published content items (video, audio, written)

```typescript
// Create content with media
const [content] = await dbHttp.insert(schema.content).values({
  creatorId: user.id,
  organizationId: org.id,
  mediaItemId: media.id,
  title: 'My Video',
  slug: 'my-video',
  contentType: 'video',
  status: 'draft'
}).returning();
```

### Key Features

- **Soft Deletes** - All tables have `deletedAt` timestamp
- **Automatic Timestamps** - `createdAt` and `updatedAt` managed automatically
- **Type Safety** - Full TypeScript type inference from schema
- **Relations** - Drizzle ORM relations for joins
- **Constraints** - CHECK constraints for status/type validation
- **Indexes** - Optimized indexes for common queries

## Migrations

Migrations are managed using Drizzle Kit and stored in `src/migrations/`.

### Available Scripts

```bash
# Generate new migration from schema changes
pnpm db:gen:drizzle

# Generate auth-related migrations
pnpm db:gen:auth

# Generate all migrations
pnpm db:gen

# Apply migrations to database
pnpm db:migrate

# Open Drizzle Studio (database GUI)
pnpm db:studio

# Push schema changes directly (dev only)
pnpm db:push
```

### Migration Workflow

1. **Modify Schema** - Edit files in `src/schema/`
2. **Generate Migration** - Run `pnpm db:gen`
3. **Review SQL** - Check generated SQL in `src/migrations/`
4. **Apply Migration** - Run `pnpm db:migrate`

```bash
# Example workflow
pnpm db:gen:drizzle  # Generates 0005_new_feature.sql
pnpm db:migrate      # Applies migration to database
```

### Migration Files

Migrations are numbered sequentially:

```
src/migrations/
├── 0000_clammy_dreadnoughts.sql      # Initial test table
├── 0001_soft_mauler.sql              # Auth tables (better-auth)
├── 0002_curved_darwin.sql            # Content tables
├── 0003_purple_scourge.sql           # Schema updates
├── 0004_add_org_deletion_trigger.sql # Custom trigger
└── meta/
    ├── _journal.json                 # Migration metadata
    └── 0000_snapshot.json            # Schema snapshots
```

## Configuration

The package supports multiple database connection strategies via environment variables:

### Environment Variables

```bash
# Connection strategy
DB_METHOD=LOCAL_PROXY | NEON_BRANCH | PRODUCTION

# Database URLs
DATABASE_URL=postgresql://...              # For NEON_BRANCH and PRODUCTION
DATABASE_URL_LOCAL_PROXY=postgresql://...  # For LOCAL_PROXY mode

# Optional
NODE_ENV=development | production
```

### Connection Strategies

#### LOCAL_PROXY

For local development with Docker Compose PostgreSQL:

```bash
DB_METHOD=LOCAL_PROXY
DATABASE_URL_LOCAL_PROXY=postgresql://postgres:password@db.localtest.me:5432/codex
```

#### NEON_BRANCH

For CI/CD and ephemeral branch databases:

```bash
DB_METHOD=NEON_BRANCH
DATABASE_URL=postgresql://user:pass@ep-xyz.us-east-2.aws.neon.tech/dbname
```

#### PRODUCTION

For production Neon database:

```bash
DB_METHOD=PRODUCTION
DATABASE_URL=postgresql://user:pass@ep-abc.us-east-2.aws.neon.tech/dbname
```

### Environment Loading Strategy

The package does NOT load `.env` files directly. Environment variables must be provided by:

- **Tests**: Loaded by root `vitest.setup.ts`
- **Local Dev**: Set in shell or `.env.dev`
- **CI/CD**: GitHub Actions environment variables
- **Production**: Wrangler secrets

## API Reference

### Exports

```typescript
// Database clients
export { db, dbHttp, dbWs, sql } from '@codex/database';

// Schema (all tables and relations)
export { schema } from '@codex/database';

// Specific schema imports
export { users, sessions, accounts } from '@codex/database/schema';
export { organizations, mediaItems, content } from '@codex/database/schema';

// Error utilities
export {
  isUniqueViolation,
  isForeignKeyViolation,
  isNotNullViolation
} from '@codex/database';

// Triggers metadata
export { triggers } from '@codex/database';

// Types
export type { Database, DatabaseWs } from '@codex/database';
```

### Type Inference

Drizzle ORM provides full type inference:

```typescript
import { schema } from '@codex/database';

// Infer types from schema
type User = typeof schema.users.$inferSelect;
type NewUser = typeof schema.users.$inferInsert;
type Content = typeof schema.content.$inferSelect;
type NewContent = typeof schema.content.$inferInsert;

// Use in your application
function createUser(data: NewUser): Promise<User> {
  return dbHttp.insert(schema.users).values(data).returning();
}
```

## Usage Examples

### Basic CRUD Operations

```typescript
import { dbHttp, schema } from '@codex/database';
import { eq } from 'drizzle-orm';

// Create
const [user] = await dbHttp.insert(schema.users).values({
  name: 'Jane Doe',
  email: 'jane@example.com',
  emailVerified: false
}).returning();

// Read
const users = await dbHttp.select().from(schema.users)
  .where(eq(schema.users.email, 'jane@example.com'));

// Update
await dbHttp.update(schema.users)
  .set({ emailVerified: true })
  .where(eq(schema.users.id, user.id));

// Delete (soft delete recommended)
await dbHttp.update(schema.users)
  .set({ deletedAt: new Date() })
  .where(eq(schema.users.id, user.id));
```

### Transactions

```typescript
import { dbWs, schema } from '@codex/database';

// Multi-step operation with rollback on error
await dbWs.transaction(async (tx) => {
  // Create organization
  const [org] = await tx.insert(schema.organizations).values({
    name: 'Acme Inc',
    slug: 'acme',
    description: 'A great company'
  }).returning();

  // Create content for organization
  await tx.insert(schema.content).values({
    creatorId: userId,
    organizationId: org.id,
    title: 'Welcome Video',
    slug: 'welcome',
    contentType: 'video',
    status: 'draft'
  });

  // If any operation fails, entire transaction is rolled back
});
```

### Complex Queries with Joins

```typescript
import { dbHttp, schema } from '@codex/database';
import { eq } from 'drizzle-orm';

// Query with relations
const contentWithRelations = await dbHttp.query.content.findMany({
  where: eq(schema.content.status, 'published'),
  with: {
    creator: true,
    organization: true,
    mediaItem: true
  },
  orderBy: (content, { desc }) => [desc(content.publishedAt)],
  limit: 10
});

// Manual join
const results = await dbHttp
  .select({
    content: schema.content,
    media: schema.mediaItems,
    creator: schema.users
  })
  .from(schema.content)
  .leftJoin(schema.mediaItems, eq(schema.content.mediaItemId, schema.mediaItems.id))
  .leftJoin(schema.users, eq(schema.content.creatorId, schema.users.id))
  .where(eq(schema.content.status, 'published'));
```

### Filtering and Pagination

```typescript
import { dbHttp, schema } from '@codex/database';
import { eq, and, ilike, desc, count } from 'drizzle-orm';

// Build dynamic filters
const filters = [];
if (organizationId) {
  filters.push(eq(schema.content.organizationId, organizationId));
}
if (searchTerm) {
  filters.push(ilike(schema.content.title, `%${searchTerm}%`));
}

// Get paginated results
const page = 1;
const pageSize = 20;
const offset = (page - 1) * pageSize;

const [results, [{ total }]] = await Promise.all([
  dbHttp.select().from(schema.content)
    .where(and(...filters))
    .orderBy(desc(schema.content.publishedAt))
    .limit(pageSize)
    .offset(offset),

  dbHttp.select({ total: count() }).from(schema.content)
    .where(and(...filters))
]);
```

### Working with Media Items

```typescript
import { dbHttp, schema } from '@codex/database';
import { eq, and } from 'drizzle-orm';

// Create media item
const [media] = await dbHttp.insert(schema.mediaItems).values({
  creatorId: userId,
  title: 'My Video',
  mediaType: 'video',
  status: 'uploading',
  r2Key: `originals/${mediaId}/video.mp4`,
  fileSizeBytes: 1024000,
  mimeType: 'video/mp4'
}).returning();

// Update media status after processing
await dbHttp.update(schema.mediaItems)
  .set({
    status: 'ready',
    durationSeconds: 120,
    width: 1920,
    height: 1080,
    hlsMasterPlaylistKey: `hls/${mediaId}/master.m3u8`,
    thumbnailKey: `thumbnails/${mediaId}/thumb.jpg`,
    uploadedAt: new Date()
  })
  .where(eq(schema.mediaItems.id, mediaId));

// Query ready media for creator
const readyMedia = await dbHttp.select().from(schema.mediaItems)
  .where(and(
    eq(schema.mediaItems.creatorId, userId),
    eq(schema.mediaItems.status, 'ready')
  ));
```

### Soft Deletes

```typescript
import { dbHttp, schema } from '@codex/database';
import { eq, isNull } from 'drizzle-orm';

// Soft delete
await dbHttp.update(schema.content)
  .set({ deletedAt: new Date() })
  .where(eq(schema.content.id, contentId));

// Query only non-deleted records
const activeContent = await dbHttp.select().from(schema.content)
  .where(isNull(schema.content.deletedAt));

// Restore soft-deleted record
await dbHttp.update(schema.content)
  .set({ deletedAt: null })
  .where(eq(schema.content.id, contentId));
```

## Error Handling

The package provides utilities for handling database-specific errors:

```typescript
import {
  isUniqueViolation,
  isForeignKeyViolation,
  isNotNullViolation,
  getConstraintName,
  getErrorDetail
} from '@codex/database';

try {
  await dbHttp.insert(schema.users).values({
    email: 'existing@example.com'
  });
} catch (error) {
  if (isUniqueViolation(error)) {
    console.error('Email already exists');
    console.error('Constraint:', getConstraintName(error));
  } else if (isForeignKeyViolation(error)) {
    console.error('Referenced record does not exist');
  } else if (isNotNullViolation(error)) {
    console.error('Required field is missing');
  } else {
    throw error; // Unknown error
  }
}
```

### Common Error Codes

- `23505` - Unique violation (duplicate key)
- `23503` - Foreign key violation (referenced record doesn't exist)
- `23502` - Not-null violation (required field missing)

## Database Triggers

The package includes custom database triggers for business logic:

### Organization Deletion Trigger

**Purpose**: Prevents published organization content from auto-appearing on creator's personal page when the organization is deleted.

**Trigger**: `trigger_unpublish_on_org_delete`
**Function**: `unpublish_content_on_org_delete()`
**Event**: BEFORE UPDATE on `content` table

**Behavior**: When `organization_id` changes from NOT NULL to NULL (organization deleted), automatically sets:
- `status = 'draft'`
- `published_at = NULL`

```typescript
import { triggers } from '@codex/database';

// Access trigger metadata
const orgTrigger = triggers.DATABASE_TRIGGERS.unpublish_content_on_org_delete;

console.log(orgTrigger.description);
console.log(orgTrigger.businessReason);
```

### Trigger Utilities

```typescript
import {
  getTriggerMetadata,
  getTriggersForTable,
  getAllTriggerNames
} from '@codex/database';

// Get specific trigger
const trigger = getTriggerMetadata('unpublish_content_on_org_delete');

// Get all triggers for a table
const contentTriggers = getTriggersForTable('content');

// List all trigger names
const allTriggers = getAllTriggerNames();
```

## Testing

```bash
# Run tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage
```

### Testing with Transactions

For tests requiring transaction support, use `dbWs`:

```typescript
import { dbWs, schema } from '@codex/database';
import { describe, it, expect } from 'vitest';

describe('Content Service', () => {
  it('should create content atomically', async () => {
    await dbWs.transaction(async (tx) => {
      const [org] = await tx.insert(schema.organizations).values({
        name: 'Test Org',
        slug: 'test-org'
      }).returning();

      const [content] = await tx.insert(schema.content).values({
        creatorId: 'user-123',
        organizationId: org.id,
        title: 'Test Content',
        slug: 'test-content',
        contentType: 'video',
        status: 'draft'
      }).returning();

      expect(content.organizationId).toBe(org.id);
    });
  });
});
```

### Connection Testing

```typescript
import { testDbConnection } from '@codex/database';

// Test database connectivity
const isConnected = await testDbConnection();
if (!isConnected) {
  throw new Error('Database connection failed');
}
```

## Dependencies

### Core Dependencies

- **drizzle-orm** (0.44.7) - Type-safe ORM
- **@neondatabase/serverless** (^0.10.4) - Neon PostgreSQL driver
- **better-auth** (^1.3.34) - Authentication library

### Dev Dependencies

- **drizzle-kit** (^0.31.6) - Migration and schema tools
- **vitest** (^4.0.2) - Testing framework
- **typescript** (^5.6.3) - Type safety

## Package Exports

The package provides two main export paths:

```typescript
// Main exports
import { db, dbHttp, dbWs, schema } from '@codex/database';

// Schema-specific exports
import { users, content, organizations } from '@codex/database/schema';
```

### package.json exports

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./schema": "./src/schema/index.ts"
  }
}
```

## Integration with Other Packages

The database package is used throughout the Codex platform:

### Service Layer (`@codex/content`, `@codex/identity`)

```typescript
import { dbHttp } from '@codex/database';
import { schema } from '@codex/database';
import { ContentService } from '@codex/content';

const service = new ContentService({
  db: dbHttp,
  environment: 'production'
});
```

### Cloudflare Workers (`workers/content-api`, `workers/identity-api`)

```typescript
import { dbHttp } from '@codex/database';

app.post('/api/content', async (c) => {
  const content = await dbHttp.insert(schema.content).values({...});
  return c.json(content);
});
```

### Authentication (`@codex/security`)

```typescript
import { auth } from '@codex/database/auth';

// Better-auth integration
const session = await auth.api.getSession({ headers: request.headers });
```

## Best Practices

1. **Use the Right Client**
   - `dbHttp` for production workers and simple queries
   - `dbWs` for tests and transactions

2. **Leverage Type Safety**
   - Use `$inferSelect` and `$inferInsert` for type inference
   - Avoid `any` types

3. **Handle Errors Gracefully**
   - Use error utilities (`isUniqueViolation`, etc.)
   - Provide meaningful error messages

4. **Use Transactions When Needed**
   - Multi-step operations should use `dbWs.transaction()`
   - Ensures atomicity and consistency

5. **Soft Delete by Default**
   - Set `deletedAt` instead of hard deletes
   - Allows recovery and audit trails

6. **Follow Migration Workflow**
   - Always generate migrations for schema changes
   - Review generated SQL before applying
   - Never edit applied migrations

## Troubleshooting

### Connection Issues

```typescript
import { testDbConnection } from '@codex/database';

try {
  await testDbConnection();
  console.log('Database connected successfully');
} catch (error) {
  console.error('Connection failed:', error.message);
  // Check DB_METHOD and DATABASE_URL environment variables
}
```

### Transaction Errors

If you get "transaction not supported" errors, ensure you're using `dbWs`:

```typescript
// Wrong - dbHttp doesn't support transactions
await dbHttp.transaction(async (tx) => { ... });

// Correct
await dbWs.transaction(async (tx) => { ... });
```

### Migration Conflicts

If migrations fail:

1. Check database schema manually
2. Verify migration journal in `meta/_journal.json`
3. Use `pnpm db:studio` to inspect database
4. Roll back problematic migration if needed

## License

Internal package for Codex platform.

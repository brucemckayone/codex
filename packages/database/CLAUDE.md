# @codex/database

Foundation package providing database ORM layer, connection management, and schema definitions for the Codex platform.

**Purpose**: Type-safe PostgreSQL/Neon data access layer with two connection modes (HTTP for production, WebSocket for transactions), complete schema definitions, query utilities, and error handling.

**Status**: Foundation package - depended on by all service layers and workers

**Latest Version**: 0.1.0

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Public API](#public-api)
- [Database Clients](#database-clients)
- [Query Utilities](#query-utilities)
- [Error Handling](#error-handling)
- [Data Models](#data-models)
- [Usage Examples](#usage-examples)
- [Integration Points](#integration-points)
- [Configuration](#configuration)
- [Migrations](#migrations)
- [Performance Notes](#performance-notes)
- [Testing](#testing)

## Overview

@codex/database is the foundational data access layer for Codex. It provides:

- **Database Clients**: Two connection modes
  - `dbHttp`: Stateless HTTP client for production (Cloudflare Workers)
  - `dbWs`: Stateful WebSocket client with transaction support (tests, local dev)
- **Schema Definitions**: Complete Drizzle ORM schema for all business domains
- **Query Utilities**: Reusable helpers for soft-delete filtering, scoping, and pagination
- **Error Detection**: Type-safe PostgreSQL error detection and handling
- **Type Safety**: Full TypeScript inference for all database operations

All database interaction in Codex flows through this package. It integrates with Neon's serverless PostgreSQL, supporting local development, ephemeral test branches, and production deployments.

## Quick Start

```typescript
import { dbHttp, dbWs, schema } from '@codex/database';
import { eq } from 'drizzle-orm';

// HTTP client - simple queries, production workers
const users = await dbHttp.select().from(schema.users);

// WebSocket client - transactions, tests
await dbWs.transaction(async (tx) => {
  await tx.insert(schema.users).values({ name: 'John', email: 'john@example.com' });
  await tx.insert(schema.organizations).values({ name: 'Acme', slug: 'acme' });
});

// Query utilities for common patterns
import { scopedNotDeleted, withPagination } from '@codex/database';

const pagination = withPagination({ page: 1, limit: 20 });
const content = await dbHttp.query.content.findMany({
  where: scopedNotDeleted(schema.content, userId),
  limit: pagination.limit,
  offset: pagination.offset,
});
```

## Public API

All exports are available at `@codex/database`:

### Database Clients

| Export | Type | Purpose |
|--------|------|---------|
| `dbHttp` | Database Client | Stateless queries, production workers, HTTP API |
| `dbWs` | Database Client | Transactions, tests, local development, WebSocket |
| `Database` | Type | HTTP client type for imports |
| `DatabaseWs` | Type | WebSocket client type for imports |

### Query Utility Functions

| Export | Signature | Purpose |
|--------|-----------|---------|
| `whereNotDeleted()` | `(table) => SQL` | Filter soft-deleted records (deletedAt IS NULL) |
| `withCreatorScope()` | `(table, creatorId) => SQL` | Scope to creator-owned resources |
| `withOrgScope()` | `(table, orgId) => SQL` | Scope to organization-owned resources |
| `scopedNotDeleted()` | `(table, creatorId) => SQL` | Combined: non-deleted + creator scope |
| `orgScopedNotDeleted()` | `(table, orgId) => SQL` | Combined: non-deleted + org scope |
| `withPagination()` | `(options) => {limit, offset}` | Convert page/limit to SQL offset |

### Error Detection Functions

| Export | Purpose |
|--------|---------|
| `isUniqueViolation()` | Detect unique constraint violations (23505) |
| `isForeignKeyViolation()` | Detect foreign key violations (23503) |
| `isNotNullViolation()` | Detect not-null constraint violations (23502) |
| `getConstraintName()` | Extract constraint name from error |
| `getErrorDetail()` | Extract detail message from error |

### Utility Functions

| Export | Purpose |
|--------|---------|
| `testDbConnection()` | Verify database connectivity |
| `closeDbPool()` | Close WebSocket pool (test cleanup) |

### Schema Exports

Access via `import { schema }` or individual imports:

| Table | Purpose | Primary Key |
|-------|---------|-------------|
| `users` | User identity and profile | `id: text` |
| `accounts` | OAuth provider accounts | `id: text` |
| `sessions` | User session management | `id: text` |
| `verificationTokens` | Email verification tokens | `id: text` |
| `organizations` | Teams/organizations | `id: uuid` |
| `organizationMemberships` | Organization membership | `id: uuid` |
| `mediaItems` | Video/audio uploads | `id: uuid` |
| `content` | Published content | `id: uuid` |
| `contentAccess` | User access grants | `id: uuid` |
| `purchases` | Purchase transactions | `id: uuid` |
| `videoPlayback` | Video playback progress | `id: uuid` |

### Type Exports

```typescript
// Identity
type User = typeof schema.users.$inferSelect;
type NewUser = typeof schema.users.$inferInsert;

// Organizations
type Organization = typeof schema.organizations.$inferSelect;
type NewOrganization = typeof schema.organizations.$inferInsert;
type OrganizationMembership = typeof schema.organizationMemberships.$inferSelect;

// Content
type Content = typeof schema.content.$inferSelect;
type NewContent = typeof schema.content.$inferInsert;
type MediaItem = typeof schema.mediaItems.$inferSelect;

// E-commerce
type Purchase = typeof schema.purchases.$inferSelect;
type NewPurchase = typeof schema.purchases.$inferInsert;

// Video
type VideoPlayback = typeof schema.videoPlayback.$inferSelect;
```

## Database Clients

### dbHttp: Production HTTP Client

Stateless HTTP-based client optimized for Cloudflare Workers and one-off queries.

**Use cases:**
- Production Cloudflare Workers (workers/content-api, workers/identity-api)
- One-off queries and simple CRUD operations
- Read-only operations
- Minimal latency for edge deployments

**Features:**
- Stateless connection (no persistent pool)
- Lazy initialization (first use only)
- Optimized for serverless/edge environments
- Uses Neon HTTP API

**Limitations:**
- `dbHttp.transaction()` is NOT supported (throws error)
- Cannot use `db.transaction()` for multi-step atomic operations
- Use `dbWs` for transactions

**Example:**

```typescript
import { dbHttp, schema } from '@codex/database';
import { eq } from 'drizzle-orm';

// Simple queries work perfectly
const users = await dbHttp.select().from(schema.users);

// CRUD operations
const [user] = await dbHttp.insert(schema.users).values({
  id: 'user-123',
  name: 'John Doe',
  email: 'john@example.com',
}).returning();

// Update
await dbHttp.update(schema.users)
  .set({ emailVerified: true })
  .where(eq(schema.users.id, 'user-123'));

// Delete (soft delete recommended)
await dbHttp.update(schema.users)
  .set({ deletedAt: new Date() })
  .where(eq(schema.users.id, 'user-123'));

// Raw SQL
import { sql } from 'drizzle-orm';
const result = await dbHttp.execute(sql`SELECT COUNT(*) FROM users`);
```

### dbWs: WebSocket Client with Transactions

Stateful WebSocket-based client with full transaction support. Maintains a connection pool for atomic multi-step operations.

**Use cases:**
- Test suites (full transaction support)
- Local development
- Operations requiring atomicity (multiple tables)
- Operations requiring BEGIN/COMMIT/ROLLBACK

**Features:**
- Full transaction support with BEGIN/COMMIT/ROLLBACK
- Connection pooling for connection reuse
- Interactive sessions
- Works in Node.js and Cloudflare Workers

**Pool Lifecycle:**
- Lazily initialized on first dbWs call
- Must call `closeDbPool()` in test teardown (prevents hanging processes)
- Maintains connection state across requests

**Example:**

```typescript
import { dbWs, schema } from '@codex/database';

// Transactions: Multiple operations as single atomic unit
await dbWs.transaction(async (tx) => {
  // All operations succeed or all roll back

  // Create user
  const [user] = await tx.insert(schema.users).values({
    id: 'user-123',
    name: 'John Doe',
    email: 'john@example.com',
  }).returning();

  // Create organization membership
  await tx.insert(schema.organizationMemberships).values({
    organizationId: 'org-456',
    userId: user.id,
    role: 'owner',
  });

  // If any operation fails, entire transaction rolls back
});

// Can use same methods as dbHttp outside transactions
const user = await dbWs.query.users.findFirst({
  where: (u) => eq(u.id, 'user-123'),
});
```

## Query Utilities

### whereNotDeleted()

Filter soft-deleted records by checking `deletedAt IS NULL`.

```typescript
import { whereNotDeleted } from '@codex/database';
import { dbWs, schema } from '@codex/database';

// Get all non-deleted content
const activeContent = await dbWs.query.content.findMany({
  where: whereNotDeleted(schema.content),
});

// Combine with other conditions
import { and, eq } from 'drizzle-orm';

const item = await dbWs.query.content.findFirst({
  where: and(
    whereNotDeleted(schema.content),
    eq(schema.content.id, contentId)
  ),
});
```

### withCreatorScope()

Scope queries to creator-owned resources using `creatorId = value`.

```typescript
import { withCreatorScope } from '@codex/database';
import { dbWs, schema } from '@codex/database';

// Get all content for a specific creator
const creatorContent = await dbWs.query.content.findMany({
  where: withCreatorScope(schema.content, userId),
});
```

### withOrgScope()

Scope queries to organization-owned resources using `organizationId = value`.

```typescript
import { withOrgScope } from '@codex/database';
import { dbWs, schema } from '@codex/database';

// Get all content for an organization
const orgContent = await dbWs.query.content.findMany({
  where: withOrgScope(schema.content, orgId),
});
```

### scopedNotDeleted()

Combined helper for creator-owned resources (non-deleted + creator scope).

```typescript
import { scopedNotDeleted } from '@codex/database';
import { dbWs, schema } from '@codex/database';
import { and, eq } from 'drizzle-orm';

// Get creator's non-deleted content
const items = await dbWs.query.content.findMany({
  where: scopedNotDeleted(schema.content, userId),
});

// Combine with additional conditions
const item = await dbWs.query.content.findFirst({
  where: and(
    scopedNotDeleted(schema.content, userId),
    eq(schema.content.slug, slug)
  ),
});
```

### orgScopedNotDeleted()

Combined helper for organization-owned resources (non-deleted + org scope).

```typescript
import { orgScopedNotDeleted } from '@codex/database';
import { dbWs, schema } from '@codex/database';
import { and, eq } from 'drizzle-orm';

// Get organization's non-deleted content
const items = await dbWs.query.content.findMany({
  where: orgScopedNotDeleted(schema.content, orgId),
});

// Get specific organization content
const item = await dbWs.query.content.findFirst({
  where: and(
    orgScopedNotDeleted(schema.content, orgId),
    eq(schema.content.slug, slug)
  ),
});
```

### withPagination()

Convert page-based pagination (1-indexed pages, limit per page) to SQL offset-based pagination.

```typescript
import { withPagination } from '@codex/database';
import { dbWs, schema } from '@codex/database';
import { desc } from 'drizzle-orm';

// User requests page 2 with 20 items per page
const pagination = withPagination({ page: 2, limit: 20 });
// Returns: { limit: 20, offset: 20 } (skip first 20, get next 20)

const items = await dbWs.query.content.findMany({
  where: whereNotDeleted(schema.content),
  limit: pagination.limit,
  offset: pagination.offset,
  orderBy: [desc(schema.content.createdAt)],
});
```

## Error Handling

### PostgreSQL Error Categories

All database errors are PostgreSQL errors. The @codex/database package provides type-safe detection functions.

#### Unique Constraint Violations (23505)

Occurs when inserting/updating a value that must be unique.

```typescript
import { isUniqueViolation } from '@codex/database';

try {
  await dbWs.insert(schema.users).values({
    email: 'duplicate@example.com', // Already exists
  });
} catch (error) {
  if (isUniqueViolation(error)) {
    // Handle: suggest to user email is already registered
    return { error: 'Email already in use', code: 'DUPLICATE_EMAIL' };
  }
  throw error;
}
```

**Common occurrences:**
- Duplicate email
- Duplicate slug in organization
- Duplicate session token
- Duplicate organization membership

#### Foreign Key Violations (23503)

Occurs when referencing a non-existent parent record.

```typescript
import { isForeignKeyViolation } from '@codex/database';

try {
  await dbWs.insert(schema.content).values({
    creatorId: 'non-existent-user',
  });
} catch (error) {
  if (isForeignKeyViolation(error)) {
    // Handle: referenced record doesn't exist
    return { error: 'User not found', code: 'INVALID_CREATOR' };
  }
  throw error;
}
```

**Common occurrences:**
- Creator doesn't exist
- Organization doesn't exist
- Referenced media item doesn't exist

#### Not-Null Violations (23502)

Occurs when inserting NULL into a NOT NULL column.

```typescript
import { isNotNullViolation } from '@codex/database';

try {
  await dbWs.insert(schema.users).values({
    // name is required - missing!
    email: 'test@example.com',
  });
} catch (error) {
  if (isNotNullViolation(error)) {
    // Handle: required field missing
    return { error: 'Name is required', code: 'MISSING_FIELD' };
  }
  throw error;
}
```

**Common occurrences:**
- Missing required field in insert
- NULL in non-nullable column

#### Check Constraint Violations (23514)

Occurs when data violates a CHECK constraint (invalid enum value, negative price, etc).

```typescript
try {
  await dbWs.insert(schema.content).values({
    status: 'invalid-status', // Must be: draft|published|archived
  });
} catch (error) {
  // Check constraint violation
  if ('code' in error && error.code === '23514') {
    return { error: 'Invalid status value' };
  }
  throw error;
}
```

### Error Detection Pattern

Best practice for database operations:

```typescript
import {
  isUniqueViolation,
  isForeignKeyViolation,
  isNotNullViolation,
  getErrorDetail,
} from '@codex/database';

async function safeInsertContent(content: NewContent) {
  try {
    return await db.insert(schema.content).values(content).returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        'Content with this slug already exists',
        'DUPLICATE_SLUG',
        409
      );
    }

    if (isForeignKeyViolation(error)) {
      const detail = getErrorDetail(error);
      throw new AppError(
        `Referenced resource not found: ${detail}`,
        'INVALID_REFERENCE',
        404
      );
    }

    if (isNotNullViolation(error)) {
      throw new AppError('Missing required field', 'VALIDATION_ERROR', 400);
    }

    // Re-throw unknown errors
    throw error;
  }
}
```

## Data Models

### Identity Tables

#### users

User identity and profile information.

**Columns:**
- `id: text` - User ID (primary key)
- `name: text` - User's display name (required)
- `email: text` - Email address (unique, required)
- `emailVerified: boolean` - Email verification status (default: false)
- `image: text` - Profile image URL (optional)
- `createdAt: timestamp` - Creation timestamp (auto)
- `updatedAt: timestamp` - Last update timestamp (auto)

**Constraints:**
- Unique email per user
- Email and name required

**Type Exports:**
```typescript
type User = typeof schema.users.$inferSelect;
type NewUser = typeof schema.users.$inferInsert;
```

#### accounts

OAuth provider accounts and credentials (Better Auth integration).

**Columns:**
- `id: text` - Primary key
- `accountId: text` - Provider account ID (required)
- `providerId: text` - Provider name: google, github, etc (required)
- `userId: text` - Associated user (FK -> users, cascade delete)
- `accessToken: text` - OAuth access token (optional)
- `refreshToken: text` - Refresh token (optional)
- `idToken: text` - ID token (optional)
- `accessTokenExpiresAt: timestamp` - Token expiration
- `refreshTokenExpiresAt: timestamp` - Refresh token expiration
- `scope: text` - OAuth scopes
- `password: text` - Password for password auth (optional)
- `createdAt: timestamp` - Creation timestamp (auto)
- `updatedAt: timestamp` - Last update timestamp (auto)

#### sessions

User session management.

**Columns:**
- `id: text` - Primary key
- `expiresAt: timestamp` - Session expiration (required)
- `token: text` - Session token (unique, required)
- `createdAt: timestamp` - Creation timestamp (auto)
- `updatedAt: timestamp` - Last update timestamp (auto)
- `ipAddress: text` - Client IP (optional)
- `userAgent: text` - Client user agent (optional)
- `userId: text` - Session owner (FK -> users, cascade delete)

#### verificationTokens

Email verification tokens.

**Columns:**
- `id: text` - Primary key
- `identifier: text` - Email or identifier (required)
- `value: text` - Token value (required)
- `expiresAt: timestamp` - Token expiration (required)
- `createdAt: timestamp` - Creation timestamp (auto)
- `updatedAt: timestamp` - Last update timestamp (auto)

### Organization Tables

#### organizations

Teams/organizations for collaborative content.

**Columns:**
- `id: uuid` - Primary key (default: random)
- `name: varchar[255]` - Organization name (required)
- `slug: varchar[255]` - URL-safe slug (unique, required)
- `description: text` - Organization description (optional)
- `logoUrl: text` - Logo image URL (optional)
- `websiteUrl: text` - Organization website (optional)
- `createdAt: timestamp` - Creation time (auto)
- `updatedAt: timestamp` - Last update (auto)
- `deletedAt: timestamp` - Soft-delete marker (optional)

**Indexes:**
- Index on slug for efficient lookup by URL

**Type Exports:**
```typescript
type Organization = typeof schema.organizations.$inferSelect;
type NewOrganization = typeof schema.organizations.$inferInsert;
```

#### organizationMemberships

User membership in organizations with roles and status.

**Columns:**
- `id: uuid` - Primary key
- `organizationId: uuid` - Organization (FK -> organizations, cascade delete)
- `userId: text` - User (FK -> users, cascade delete)
- `role: varchar[50]` - Role: owner, admin, creator, subscriber, member (default: member)
- `status: varchar[50]` - Status: active, inactive, invited (default: active)
- `invitedBy: text` - Who invited this user (FK -> users, set null on delete)
- `createdAt: timestamp` - Creation timestamp (auto)
- `updatedAt: timestamp` - Last update timestamp (auto)

**Constraints:**
- Unique (organizationId, userId) - one membership per user per org
- CHECK role: owner, admin, creator, subscriber, member
- CHECK status: active, inactive, invited

**Indexes:**
- Unique on (organizationId, userId)
- Index on organizationId
- Index on userId
- Composite index on (organizationId, role) for role queries
- Composite index on (organizationId, status) for status queries

**Type Exports:**
```typescript
type OrganizationMembership = typeof schema.organizationMemberships.$inferSelect;
type NewOrganizationMembership = typeof schema.organizationMemberships.$inferInsert;
```

### Content Tables

#### mediaItems

Video/audio upload metadata (separated from content for reusability).

**Columns:**
- `id: uuid` - Primary key
- `creatorId: text` - Uploader (FK -> users, restrict delete)
- `title: varchar[255]` - Media title (required)
- `description: text` - Media description (optional)
- `mediaType: varchar[50]` - video or audio (required)
- `status: varchar[50]` - uploading|uploaded|transcoding|ready|failed (default: uploading)
- `r2Key: varchar[500]` - S3/R2 storage key (required)
- `fileSizeBytes: bigint` - File size in bytes (optional)
- `mimeType: varchar[100]` - MIME type (optional)
- `durationSeconds: integer` - Duration in seconds (optional)
- `width: integer` - Video width (optional)
- `height: integer` - Video height (optional)
- `hlsMasterPlaylistKey: varchar[500]` - HLS master playlist key (optional)
- `thumbnailKey: varchar[500]` - Thumbnail S3 key (optional)
- `uploadedAt: timestamp` - Upload completion time (optional)
- `createdAt: timestamp` - Creation timestamp (auto)
- `updatedAt: timestamp` - Last update timestamp (auto)
- `deletedAt: timestamp` - Soft-delete marker (optional)

**Constraints:**
- CHECK status: uploading, uploaded, transcoding, ready, failed
- CHECK mediaType: video, audio

**Indexes:**
- Index on creatorId
- Composite index on (creatorId, status)
- Composite index on (creatorId, mediaType)

**Type Exports:**
```typescript
type MediaItem = typeof schema.mediaItems.$inferSelect;
type NewMediaItem = typeof schema.mediaItems.$inferInsert;
```

#### content

Published content (references mediaItems).

**Columns:**
- `id: uuid` - Primary key
- `creatorId: text` - Content creator (FK -> users, restrict delete)
- `organizationId: uuid` - Organization (FK -> organizations, set null) (optional)
- `mediaItemId: uuid` - Media reference (FK -> mediaItems, set null) (optional)
- `title: varchar[500]` - Content title (required)
- `slug: varchar[500]` - URL slug (unique per org/creator, required)
- `description: text` - Content description (optional)
- `contentType: varchar[50]` - video, audio, or written (required)
- `thumbnailUrl: text` - Custom thumbnail URL (optional)
- `contentBody: text` - Written content body (optional)
- `category: varchar[100]` - Content category (optional)
- `tags: jsonb[]` - Array of tag strings (default: [])
- `visibility: varchar[50]` - public, private, members_only, purchased_only (default: purchased_only)
- `priceCents: integer` - Price in cents (NULL=free) (optional)
- `status: varchar[50]` - draft, published, or archived (default: draft)
- `publishedAt: timestamp` - Publication time (optional)
- `viewCount: integer` - View count (default: 0)
- `purchaseCount: integer` - Number of purchases (default: 0)
- `createdAt: timestamp` - Creation timestamp (auto)
- `updatedAt: timestamp` - Last update timestamp (auto)
- `deletedAt: timestamp` - Soft-delete marker (optional)

**Constraints:**
- CHECK status: draft, published, archived
- CHECK visibility: public, private, members_only, purchased_only
- CHECK contentType: video, audio, written
- CHECK priceCents >= 0
- Unique slug per organization (for org content)
- Unique slug per creator (for personal content)

**Indexes:**
- Index on creatorId
- Index on organizationId
- Index on mediaItemId
- Composite index on (slug, organizationId)
- Index on status
- Index on publishedAt
- Index on category
- Partial unique on slug+organizationId (where organizationId IS NOT NULL)
- Partial unique on slug+creatorId (where organizationId IS NULL)

**Type Exports:**
```typescript
type Content = typeof schema.content.$inferSelect;
type NewContent = typeof schema.content.$inferInsert;
```

### E-Commerce Tables

#### contentAccess

User access grants to content (purchases, subscriptions, complimentary).

**Columns:**
- `id: uuid` - Primary key
- `userId: text` - Access holder (FK -> users, cascade delete)
- `contentId: uuid` - Content being accessed (FK -> content, cascade delete)
- `organizationId: uuid` - Content's organization (FK -> organizations, cascade delete)
- `accessType: varchar[50]` - purchased, subscription, complimentary, or preview (required)
- `expiresAt: timestamp` - Expiration time (NULL = permanent) (optional)
- `createdAt: timestamp` - Creation timestamp (auto)
- `updatedAt: timestamp` - Last update timestamp (auto)

**Constraints:**
- Unique (userId, contentId) - one access record per user per content
- CHECK accessType: purchased, subscription, complimentary, preview

**Indexes:**
- Index on userId
- Index on contentId
- Index on organizationId

**Type Exports:**
```typescript
type ContentAccess = typeof schema.contentAccess.$inferSelect;
type NewContentAccess = typeof schema.contentAccess.$inferInsert;
```

#### purchases

Purchase transaction records.

**Columns:**
- `id: uuid` - Primary key
- `customerId: text` - Buyer (FK -> users, cascade delete)
- `contentId: uuid` - Content purchased (FK -> content, restrict delete)
- `organizationId: uuid` - Creator's organization (FK -> organizations, restrict delete)
- `amountPaidCents: integer` - Amount in cents (required)
- `currency: varchar[3]` - Currency code (default: usd)
- `stripePaymentIntentId: varchar[255]` - Stripe reference (unique, required)
- `status: varchar[50]` - pending, completed, refunded, or failed (required)
- `createdAt: timestamp` - Creation timestamp (auto)
- `updatedAt: timestamp` - Last update timestamp (auto)

**Constraints:**
- CHECK amountPaidCents >= 0
- CHECK status: pending, completed, refunded, failed

**Indexes:**
- Index on customerId
- Index on contentId
- Index on organizationId
- Index on stripePaymentIntentId
- Index on createdAt

**Type Exports:**
```typescript
type Purchase = typeof schema.purchases.$inferSelect;
type NewPurchase = typeof schema.purchases.$inferInsert;
```

### Playback Tables

#### videoPlayback

Video playback progress for resume functionality.

**Columns:**
- `id: uuid` - Primary key
- `userId: text` - Watcher (FK -> users, cascade delete)
- `contentId: uuid` - Video content (FK -> content, cascade delete)
- `positionSeconds: integer` - Current position in seconds (default: 0)
- `durationSeconds: integer` - Total duration in seconds (required)
- `completed: boolean` - Watched >= 95% (auto-set, default: false)
- `updatedAt: timestamp` - Last update timestamp (auto)
- `createdAt: timestamp` - Creation timestamp (auto)

**Constraints:**
- Unique (userId, contentId) - one playback record per user per video

**Indexes:**
- Index on userId
- Index on contentId

**Update Pattern:**
Frontend sends update every 30 seconds. Backend upserts the playback record. When position >= 95% of duration, `completed` is set to true.

**Type Exports:**
```typescript
type VideoPlayback = typeof schema.videoPlayback.$inferSelect;
type NewVideoPlayback = typeof schema.videoPlayback.$inferInsert;
```

## Usage Examples

### Basic CRUD Operations

```typescript
import { dbHttp, schema } from '@codex/database';
import { eq } from 'drizzle-orm';

// Create
const [user] = await dbHttp.insert(schema.users).values({
  id: 'user-123',
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
  .where(eq(schema.users.id, 'user-123'));

// Delete (soft delete - recommended)
await dbHttp.update(schema.users)
  .set({ deletedAt: new Date() })
  .where(eq(schema.users.id, 'user-123'));
```

### Creator-Scoped Content Query

```typescript
import { dbWs, schema, scopedNotDeleted } from '@codex/database';
import { desc } from 'drizzle-orm';

// Get creator's published content, newest first
const myContent = await dbWs.query.content.findMany({
  where: scopedNotDeleted(schema.content, userId),
  orderBy: [desc(schema.content.createdAt)],
  limit: 50,
});
```

### Organization-Scoped Query with Pagination

```typescript
import { dbWs, schema, orgScopedNotDeleted, withPagination } from '@codex/database';
import { desc } from 'drizzle-orm';

// Get organization content with pagination
const pagination = withPagination({ page: 1, limit: 20 });
const content = await dbWs.query.content.findMany({
  where: orgScopedNotDeleted(schema.content, orgId),
  limit: pagination.limit,
  offset: pagination.offset,
  orderBy: [desc(schema.content.publishedAt)],
});
```

### Transaction: Create Content with Media

```typescript
import { dbWs, schema } from '@codex/database';
import { v4 as uuid } from 'uuid';

await dbWs.transaction(async (tx) => {
  // 1. Create media item
  const mediaId = uuid();
  await tx.insert(schema.mediaItems).values({
    id: mediaId,
    creatorId: userId,
    title: 'My Video',
    mediaType: 'video',
    status: 'uploading',
    r2Key: `originals/${mediaId}/video.mp4`,
  });

  // 2. Create content that references media
  await tx.insert(schema.content).values({
    id: uuid(),
    creatorId: userId,
    organizationId: orgId,
    mediaItemId: mediaId,
    title: 'My Video',
    slug: 'my-video',
    contentType: 'video',
    status: 'draft',
  });

  // If either fails, entire transaction rolls back
});
```

### Relational Queries

```typescript
import { dbWs, schema } from '@codex/database';

// Get organization with all members
const org = await dbWs.query.organizations.findFirst({
  where: (o) => eq(o.id, orgId),
  with: {
    memberships: {
      with: {
        user: true,
      },
    },
  },
});

// Get content with creator info and media
const contentWithRelations = await dbWs.query.content.findFirst({
  where: (c) => eq(c.id, contentId),
  with: {
    creator: true,
    organization: true,
    mediaItem: true,
  },
});
```

### Error Handling: Safe Insert with Fallback

```typescript
import { dbWs, schema, isUniqueViolation } from '@codex/database';
import { eq } from 'drizzle-orm';

async function createUser(email: string, name: string) {
  try {
    const result = await dbWs.insert(schema.users).values({
      id: `user-${Date.now()}`,
      email,
      name,
    }).returning();
    return { success: true, user: result[0] };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // User already exists, get existing record
      const existing = await dbWs.query.users.findFirst({
        where: (u) => eq(u.email, email),
      });
      return { success: false, reason: 'already_exists', user: existing };
    }
    throw error;
  }
}
```

## Integration Points

### Packages Using @codex/database

| Package | Purpose | Connection | Usage |
|---------|---------|-----------|-------|
| @codex/identity | User/org management | dbWs/dbHttp | Read/write users, organizations |
| @codex/content | Content management | dbWs/dbHttp | CRUD operations on content, media |
| @codex/access | Access control | dbWs/dbHttp | Query/grant content access |
| @codex/security | Auth/security | dbWs/dbHttp | Manage sessions, verify tokens |
| @codex/test-utils | Test utilities | dbWs | Database setup/teardown |
| @codex/service-errors | Error handling | dbHttp | Detect constraint violations |
| @codex/worker-utils | Worker helpers | dbHttp/dbWs | Inject database clients |

### Workers Using @codex/database

| Worker | Connection Type | Purpose |
|--------|-----------------|---------|
| workers/auth | dbWs/dbHttp | Authentication, session management |
| workers/identity-api | dbHttp | User/organization API endpoints |
| workers/content-api | dbHttp | Content, media, access endpoints |
| workers/ecom-api | dbHttp | Payment processing |

### Dependency Direction

All packages and workers depend on @codex/database for data access. It is a foundation package with minimal dependencies (only Drizzle ORM and Neon serverless driver).

## Configuration

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

**Configuration:**
- Uses local PostgreSQL instance
- HTTP proxy for Neon compatibility
- Non-secure WebSocket (ws:// not wss://)
- Disabled in production

#### NEON_BRANCH

For CI/CD and ephemeral branch databases:

```bash
DB_METHOD=NEON_BRANCH
DATABASE_URL=postgresql://user:pass@ep-xyz.us-east-2.aws.neon.tech/dbname
```

**Configuration:**
- Neon ephemeral branch
- Connection caching for read-your-writes consistency
- Full WebSocket support (wss://)
- Parallel test support

#### PRODUCTION

For production Neon database:

```bash
DB_METHOD=PRODUCTION
DATABASE_URL=postgresql://user:pass@ep-abc.us-east-2.aws.neon.tech/dbname
```

**Configuration:**
- Production Neon database
- HTTP pooling optimized for edge
- Full WebSocket support (wss://)

### Environment Loading Strategy

The package does NOT load `.env` files directly. Environment variables must be provided by:

- **Tests**: Loaded by root `vitest.setup.ts`
- **Local Dev**: Set in shell or `.env.dev`
- **CI/CD**: GitHub Actions environment variables
- **Production**: Wrangler secrets

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
pnpm db:gen:drizzle  # Generates migration file
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

## Performance Notes

### Query Optimization

1. **Use Indexes for Common Queries**
   - All tables have indexes on foreign keys and commonly filtered columns
   - Use indexed columns in WHERE clauses (creatorId, organizationId, status, etc)

2. **Soft-Delete Performance**
   - Use `whereNotDeleted()` helper in all queries
   - Indexes are optimized for soft-delete patterns
   - Deleted records remain in database (historical record)

3. **Pagination**
   - Use `withPagination()` helper for consistent offset calculation
   - Default limit: 20-50 items per page
   - Use indexes on sort columns (publishedAt, createdAt)

4. **N+1 Query Prevention**
   - Use Drizzle's `with:` syntax for relational queries
   - Single query fetches related data instead of multiple queries

   ```typescript
   // Good: Single query with relations
   const content = await db.query.content.findFirst({
     where: (c) => eq(c.id, contentId),
     with: { creator: true, organization: true },
   });

   // Bad: Multiple queries (N+1 problem)
   const content = await db.query.content.findFirst({
     where: (c) => eq(c.id, contentId),
   });
   const creator = await db.query.users.findFirst({
     where: (u) => eq(u.id, content.creatorId),
   });
   ```

5. **Transaction Scope**
   - Keep transactions small and focused
   - Minimize locks held by transaction
   - Don't do network I/O inside transactions

   ```typescript
   // Good: Minimal transaction scope
   const mediaUrl = await uploadToR2(file);
   await db.transaction(async (tx) => {
     await tx.insert(schema.mediaItems).values({
       r2Key: mediaUrl,
       // ...
     });
   });

   // Bad: Network I/O inside transaction
   await db.transaction(async (tx) => {
     await tx.insert(schema.mediaItems).values({ /* ... */ });
     const signed = await generateSignedUrl(); // Network call!
   });
   ```

### Connection Management

1. **HTTP Client (dbHttp)**
   - Stateless - no persistent connections
   - Fast for serverless/edge (low latency)
   - Optimal for Cloudflare Workers

2. **WebSocket Client (dbWs)**
   - Maintains connection pool
   - Full transaction support
   - Call `closeDbPool()` after tests complete

3. **Connection Caching**
   - Neon enables connection caching for read-your-writes consistency
   - Configured for NEON_BRANCH (test) mode
   - Ensures consistent reads after writes

## Testing

### Test Setup

Tests use `dbWs` (WebSocket client) with full transaction support.

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dbWs, schema, closeDbPool } from '@codex/database';
import { eq } from 'drizzle-orm';

describe('Content Service', () => {
  afterAll(async () => {
    // CRITICAL: Close pool to allow clean test exit
    await closeDbPool();
  });

  it('should create and retrieve content', async () => {
    await dbWs.transaction(async (tx) => {
      // Create test content
      const result = await tx
        .insert(schema.content)
        .values({
          id: 'content-123',
          creatorId: 'user-123',
          title: 'Test Content',
          slug: 'test-content',
          contentType: 'video',
          status: 'draft',
        })
        .returning();

      // Retrieve it
      const retrieved = await tx.query.content.findFirst({
        where: (c) => eq(c.id, 'content-123'),
      });

      expect(retrieved).toBeDefined();
      expect(retrieved?.title).toBe('Test Content');

      // Transaction auto-rolls back after test
    });
  });
});
```

### Test Database Configuration

The test database is configured by environment:

1. **CI/CD (GitHub Actions)**
   - Uses `NEON_BRANCH` method
   - Neon creates ephemeral database branches
   - Parallel tests get separate branches

2. **Local Development**
   - Uses `LOCAL_PROXY` method
   - Docker Compose PostgreSQL instance
   - HTTP proxy for Neon compatibility

### Cleanup Best Practices

```typescript
import { afterAll } from 'vitest';
import { closeDbPool } from '@codex/database';

describe('My Test Suite', () => {
  afterAll(async () => {
    // CRITICAL: Close pool to prevent hanging test process
    await closeDbPool();
  });

  // Your tests...
});
```

### Mocking Database in Unit Tests

For unit tests that don't need real database:

```typescript
import { vi } from 'vitest';
import type { Database } from '@codex/database';

// Mock the database client
const mockDb: Partial<Database> = {
  query: {
    users: {
      findFirst: vi.fn().mockResolvedValue({ id: 'user-123' }),
    },
  },
};

// Pass to function being tested
const service = new UserService(mockDb as Database);
```

---

**Last Updated**: 2025-11-23
**Package Version**: 0.1.0
**Drizzle ORM Version**: 0.44.7
**Database**: PostgreSQL (Neon Serverless)
**Node Versions**: Node.js 18+

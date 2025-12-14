# @codex/database

Foundation package providing type-safe PostgreSQL data access layer with dual connection modes, complete schema definitions, query utilities, and error handling.

**Purpose**: Type-safe Drizzle ORM integration for Neon serverless PostgreSQL with two connection strategies (HTTP for production, WebSocket for transactions), comprehensive schema definitions, reusable query utilities, and PostgreSQL error detection.

**Status**: Foundation package - depended on by all service and utility layers

**Latest Version**: 0.1.0

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Public API](#public-api)
- [Database Clients](#database-clients)
- [Connection Strategies](#connection-strategies)
- [Query Utilities](#query-utilities)
- [Error Handling](#error-handling)
- [Data Models](#data-models)
- [Usage Examples](#usage-examples)
- [Integration Points](#integration-points)
- [Configuration](#configuration)
- [Performance Notes](#performance-notes)
- [Testing](#testing)

---

## Overview

@codex/database is the foundational data access layer for Codex. It provides:

- **Dual Database Clients**: Two connection modes optimized for different use cases
  - `dbHttp`: Stateless HTTP client for production (Cloudflare Workers, edge deployments)
  - `dbWs`: Stateful WebSocket client with full transaction support (tests, local dev)
- **Drizzle ORM Integration**: Type-safe SQL query builder with full schema inference
- **Complete Schema**: All business domain tables (users, content, organizations, purchases, playback, etc.)
- **Query Utilities**: Reusable helpers for common patterns (soft-delete filtering, scoping, pagination)
- **Error Detection**: Type-safe PostgreSQL error detection (unique violations, foreign keys, etc.)
- **Connection Management**: Automatic pooling, lazy initialization, proper cleanup

All database interaction in Codex flows through this package. It integrates with Neon's serverless PostgreSQL, supporting local development with Docker, ephemeral test branches in CI/CD, and production deployments.

---

## Quick Start

```typescript
import { dbHttp, dbWs, schema } from '@codex/database';
import { eq } from 'drizzle-orm';

// HTTP client - simple queries in production workers
const users = await dbHttp.select().from(schema.users);

// WebSocket client - transactions in tests
await dbWs.transaction(async (tx) => {
  await tx.insert(schema.users).values({ name: 'Jane', email: 'jane@example.com' });
  await tx.insert(schema.organizations).values({ name: 'Acme', slug: 'acme' });
});

// Query utilities - common patterns
import { scopedNotDeleted, withPagination } from '@codex/database';

const pagination = withPagination({ page: 1, limit: 20 });
const content = await dbHttp.query.content.findMany({
  where: scopedNotDeleted(schema.content, userId),
  limit: pagination.limit,
  offset: pagination.offset,
});
```

---

## Public API

All exports are available at `@codex/database`:

### Database Clients

| Export | Type | Purpose | Use Case |
|--------|------|---------|----------|
| `dbHttp` | Proxy to HTTP Database | Stateless HTTP queries | Production workers, simple CRUD, one-off operations |
| `dbWs` | Proxy to WebSocket Database | Stateful queries with transactions | Tests, local dev, multi-step atomic operations |
| `createDbClient(env)` | Factory Function | Create HTTP client with explicit env | Better-auth config, custom initialization |
| `createPerRequestDbClient(env)` | Factory Function | Create per-request WebSocket client | Cloudflare Worker transactions (must cleanup) |
| `Database` | Type | HTTP client type for imports | Type annotations for HTTP clients |
| `DatabaseWs` | Type | WebSocket client type for imports | Type annotations for transaction clients |

### Query Utility Functions

| Export | Signature | Purpose |
|--------|-----------|---------|
| `whereNotDeleted(table)` | `(table) => SQL` | Filter soft-deleted records (deletedAt IS NULL) |
| `withCreatorScope(table, creatorId)` | `(table, id) => SQL` | Scope query to creator-owned resources |
| `withOrgScope(table, orgId)` | `(table, id) => SQL` | Scope query to organization-owned resources |
| `scopedNotDeleted(table, creatorId)` | `(table, id) => SQL` | Combined: non-deleted + creator scope |
| `orgScopedNotDeleted(table, orgId)` | `(table, id) => SQL` | Combined: non-deleted + org scope |
| `withPagination(options)` | `({page, limit}) => {limit, offset}` | Convert page-based to offset-based pagination |

### Error Detection Functions

| Export | Purpose |
|--------|---------|
| `isUniqueViolation(error)` | Detect unique constraint violations (PostgreSQL 23505) |
| `isForeignKeyViolation(error)` | Detect foreign key violations (PostgreSQL 23503) |
| `isNotNullViolation(error)` | Detect not-null constraint violations (PostgreSQL 23502) |
| `getConstraintName(error)` | Extract constraint name from error |
| `getErrorDetail(error)` | Extract detail message from error |

### Utility Functions

| Export | Purpose |
|--------|---------|
| `testDbConnection(env?)` | Verify database connectivity (SELECT 1 test) |
| `closeDbPool()` | Close WebSocket pool (MUST call in test cleanup) |

### Schema Exports

Access complete schema via `import { schema }` or individual table imports. All tables are Drizzle ORM table definitions with full TypeScript inference.

**Identity Tables**:
- `users` - User identity and profile information
- `accounts` - OAuth provider accounts (Better Auth)
- `sessions` - User session management
- `verificationTokens` - Email verification tokens

**Organization Tables**:
- `organizations` - Teams and organizations
- `organizationMemberships` - User roles in organizations

**Content Tables**:
- `mediaItems` - Uploaded video/audio files
- `content` - Published content (references media items)
- `contentAccess` - User access to content (purchases, subscriptions, etc.)

**E-Commerce Tables**:
- `purchases` - Purchase transaction records
- `platformFeeConfig` - Default platform fee configuration
- `organizationPlatformAgreements` - Custom org fees
- `creatorOrganizationAgreements` - Revenue split agreements

**Playback Tables**:
- `videoPlayback` - Video playback progress tracking

### Type Exports

Full Drizzle type inference available for all tables:

```typescript
// Read types (database record)
type User = typeof schema.users.$inferSelect;
type Content = typeof schema.content.$inferSelect;
type Organization = typeof schema.organizations.$inferSelect;

// Insert types (values to insert)
type NewUser = typeof schema.users.$inferInsert;
type NewContent = typeof schema.content.$inferInsert;
type NewOrganization = typeof schema.organizations.$inferInsert;

// All other tables follow same pattern
```

---

## Database Clients

### dbHttp: Production HTTP Client

Stateless HTTP-based client optimized for Cloudflare Workers and one-off queries.

**When to use**:
- Production Cloudflare Workers (workers/content-api, workers/identity-api, workers/auth, workers/ecom-api)
- One-off queries and simple CRUD operations
- Read-only operations
- Minimal latency for edge deployments

**Features**:
- Stateless connection (no persistent pool)
- Lazy initialization (first use only)
- Optimized for serverless/edge environments
- Uses Neon HTTP API

**Limitations**:
- `db.transaction()` is NOT supported (throws error)
- Cannot use transactions for multi-step atomic operations
- Use `dbWs` for transactions

**Connection Behavior**:
- First call to any dbHttp method initializes the client
- Initialization applies Neon configuration from environment
- Subsequent calls reuse the same client instance
- No cleanup needed (stateless HTTP)

**Example**:

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
const result = await dbHttp.execute(sql`SELECT COUNT(*) as count FROM users`);
```

### dbWs: WebSocket Client with Transactions

Stateful WebSocket-based client with full transaction support. Maintains a connection pool for atomic multi-step operations.

**When to use**:
- Test suites (full transaction support)
- Local development
- Operations requiring atomicity (multiple tables)
- Operations requiring BEGIN/COMMIT/ROLLBACK
- Cloudflare Workers that need per-request transactions (with cleanup)

**Features**:
- Full transaction support with BEGIN/COMMIT/ROLLBACK
- Connection pooling for connection reuse
- Interactive sessions
- Works in Node.js and Cloudflare Workers

**Pool Lifecycle**:
- Lazily initialized on first dbWs call
- MUST call `closeDbPool()` in test cleanup (prevents hanging processes)
- Maintains connection state across requests
- Automatic error handling on pool errors

**Example**:

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

### createDbClient(env): Factory for Explicit Environment

Creates HTTP database client with explicit environment variables. Useful for Better-auth configuration and custom initialization.

**Signature**:
```typescript
function createDbClient(env: DbEnvVars): Database;
```

**Parameters**:
- `env` - Database environment variables containing DB_METHOD and DATABASE_URL

**Returns**: Fresh HTTP database client instance with schema

**Example**:

```typescript
import { createDbClient } from '@codex/database';

// In Better-auth configuration
const db = createDbClient(c.env);

// Use like dbHttp
const users = await db.select().from(schema.users);
```

### createPerRequestDbClient(env): Per-Request Transactions in Workers

Creates a per-request WebSocket database client for Cloudflare Workers. CRITICAL: Must call cleanup before request ends.

**Signature**:
```typescript
function createPerRequestDbClient(env: DbEnvVars): {
  db: DatabaseWs;
  cleanup: () => Promise<void>;
};
```

**Parameters**:
- `env` - Database environment variables containing DB_METHOD and DATABASE_URL

**Returns**: Object with database client and cleanup function

**CRITICAL REQUIREMENT**: Call `cleanup()` before request ends. In Cloudflare Workers, WebSocket connections cannot outlive a single request.

**Example**:

```typescript
import { createPerRequestDbClient } from '@codex/database';

// In Cloudflare Worker route handler
app.post('/api/create-content', async (c) => {
  const { db, cleanup } = createPerRequestDbClient(c.env);
  try {
    const result = await db.transaction(async (tx) => {
      // Create media item
      const media = await tx.insert(schema.mediaItems).values({
        // ...
      }).returning();

      // Create content
      return await tx.insert(schema.content).values({
        mediaItemId: media[0].id,
        // ...
      }).returning();
    });
    return c.json(result);
  } finally {
    await cleanup(); // MUST cleanup before request ends
  }
});

// Or with ctx.waitUntil for async cleanup
app.post('/api/async', async (c, ctx) => {
  const { db, cleanup } = createPerRequestDbClient(c.env);
  const result = await db.transaction(async (tx) => {
    // Operations
  });
  ctx.waitUntil(cleanup()); // Cleanup after response sent
  return c.json(result);
});
```

---

## Connection Strategies

The database client supports three connection strategies configured via `DB_METHOD` environment variable:

### LOCAL_PROXY: Local Development

For local development with Docker Compose PostgreSQL.

**Configuration**:
```bash
DB_METHOD=LOCAL_PROXY
DATABASE_URL_LOCAL_PROXY=postgresql://postgres:password@db.localtest.me:5432/codex
```

**Characteristics**:
- Uses local PostgreSQL instance via Docker
- HTTP proxy for Neon compatibility
- Non-secure WebSocket (ws:// not wss://)
- Disabled in production

### NEON_BRANCH: CI/CD & Ephemeral Branches

For CI/CD pipelines and ephemeral branch databases.

**Configuration**:
```bash
DB_METHOD=NEON_BRANCH
DATABASE_URL=postgresql://user:pass@ep-xyz.us-east-2.aws.neon.tech/dbname
```

**Characteristics**:
- Neon ephemeral database branches
- Connection caching for read-your-writes consistency
- Full WebSocket support (wss://)
- Parallel test support (each test gets separate branch)
- Automatic branch cleanup

### PRODUCTION: Production Neon Database

For production deployments.

**Configuration**:
```bash
DB_METHOD=PRODUCTION
DATABASE_URL=postgresql://user:pass@ep-abc.us-east-2.aws.neon.tech/dbname
```

**Characteristics**:
- Production Neon database
- HTTP pooling optimized for edge
- Full WebSocket support (wss://)
- High availability and performance

---

## Query Utilities

### whereNotDeleted()

Filter soft-deleted records by checking `deletedAt IS NULL`.

**Signature**:
```typescript
function whereNotDeleted<T extends {deletedAt: PgColumn}>(table: T): SQL<unknown>;
```

**Use Cases**:
- Exclude soft-deleted records from queries
- Most common helper for ensuring data visibility

**Example**:

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

**Signature**:
```typescript
function withCreatorScope<T extends {creatorId: PgColumn}>(
  table: T,
  creatorId: string
): SQL<unknown>;
```

**Use Cases**:
- Ensure users only access their own content
- Implement creator-level access control
- Query creator-owned media, content, etc.

**Example**:

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

**Signature**:
```typescript
function withOrgScope<T extends {organizationId: PgColumn}>(
  table: T,
  organizationId: string
): SQL<unknown>;
```

**Use Cases**:
- Enforce organization-level isolation
- Query organization-owned content
- Implement multi-tenancy

**Example**:

```typescript
import { withOrgScope } from '@codex/database';
import { dbWs, schema } from '@codex/database';

// Get all content for an organization
const orgContent = await dbWs.query.content.findMany({
  where: withOrgScope(schema.content, orgId),
});
```

### scopedNotDeleted()

Combined helper for creator-owned resources: non-deleted + creator scope.

**Signature**:
```typescript
function scopedNotDeleted<T extends {deletedAt: PgColumn, creatorId: PgColumn}>(
  table: T,
  creatorId: string
): SQL<unknown>;
```

**Use Cases**:
- Most common pattern for creator-owned resources
- Equivalent to `and(whereNotDeleted(table), withCreatorScope(table, creatorId))`
- Single-operation convenience function

**Example**:

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

Combined helper for organization-owned resources: non-deleted + org scope.

**Signature**:
```typescript
function orgScopedNotDeleted<T extends {deletedAt: PgColumn, organizationId: PgColumn}>(
  table: T,
  organizationId: string
): SQL<unknown>;
```

**Use Cases**:
- Most common pattern for organization-owned resources
- Equivalent to `and(whereNotDeleted(table), withOrgScope(table, orgId))`
- Single-operation convenience function

**Example**:

```typescript
import { orgScopedNotDeleted } from '@codex/database';
import { dbWs, schema } from '@codex/database';
import { and, eq } from 'drizzle-orm';

// Get organization's non-deleted content
const items = await dbWs.query.content.findMany({
  where: orgScopedNotDeleted(schema.content, orgId),
});

// Get specific organization content by slug
const item = await dbWs.query.content.findFirst({
  where: and(
    orgScopedNotDeleted(schema.content, orgId),
    eq(schema.content.slug, slug)
  ),
});
```

### withPagination()

Convert page-based pagination (1-indexed pages) to offset-based pagination for SQL queries.

**Signature**:
```typescript
interface PaginationOptions {
  page: number;      // 1-indexed page number
  limit: number;     // Items per page
}

interface PaginationResult {
  limit: number;     // Items per page (same as input)
  offset: number;    // Items to skip
}

function withPagination(options: PaginationOptions): PaginationResult;
```

**Formula**: `offset = (page - 1) * limit`

**Use Cases**:
- Convert API pagination parameters to SQL
- Consistent pagination across all queries
- Support cursor-less pagination

**Example**:

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

---

## Error Handling

### PostgreSQL Error Categories

All database errors are PostgreSQL errors with standard error codes. The @codex/database package provides type-safe detection functions.

### Unique Constraint Violations (23505)

Occurs when inserting/updating a value that must be unique.

**Common occurrences**:
- Duplicate email in users table
- Duplicate slug in organization
- Duplicate session token
- Duplicate organization membership

**Example**:

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

### Foreign Key Violations (23503)

Occurs when referencing a non-existent parent record.

**Common occurrences**:
- Creator doesn't exist when creating content
- Organization doesn't exist
- Referenced media item doesn't exist
- Referenced user doesn't exist

**Example**:

```typescript
import { isForeignKeyViolation } from '@codex/database';

try {
  await dbWs.insert(schema.content).values({
    creatorId: 'non-existent-user',
  });
} catch (error) {
  if (isForeignKeyViolation(error)) {
    return { error: 'User not found', code: 'INVALID_CREATOR' };
  }
  throw error;
}
```

### Not-Null Violations (23502)

Occurs when inserting NULL into a NOT NULL column.

**Common occurrences**:
- Missing required field in insert
- NULL in non-nullable column

**Example**:

```typescript
import { isNotNullViolation } from '@codex/database';

try {
  await dbWs.insert(schema.users).values({
    // name is required - missing!
    email: 'test@example.com',
  });
} catch (error) {
  if (isNotNullViolation(error)) {
    return { error: 'Name is required', code: 'MISSING_FIELD' };
  }
  throw error;
}
```

### Check Constraint Violations (23514)

Occurs when data violates a CHECK constraint (invalid enum value, negative price, etc).

**Common occurrences**:
- Invalid status value (not one of allowed enum values)
- Negative price or amount
- Invalid access type
- Invalid membership role

**Example**:

```typescript
try {
  await dbWs.insert(schema.content).values({
    status: 'invalid-status', // Must be: draft|published|archived
  });
} catch (error) {
  if ('code' in error && error.code === '23514') {
    return { error: 'Invalid status value' };
  }
  throw error;
}
```

### Error Detection Pattern

Best practice for handling database operations:

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

---

## Data Models

### Identity Tables

#### users

User identity and profile information.

**Columns**:
- `id: text` - User ID (primary key)
- `name: text` - User's display name (required)
- `email: text` - Email address (unique, required)
- `emailVerified: boolean` - Email verification status (default: false)
- `image: text` - Profile image URL (optional)
- `role: text` - User role (default: 'customer')
- `createdAt: timestamp` - Creation timestamp (auto)
- `updatedAt: timestamp` - Last update timestamp (auto)

**Constraints**:
- Unique email per user
- Email and name required

**Relationships**: Referenced by content, mediaItems, sessions, organizationMemberships, purchases, videoPlayback

**Type Exports**:
```typescript
type User = typeof schema.users.$inferSelect;
type NewUser = typeof schema.users.$inferInsert;
```

#### accounts

OAuth provider accounts and credentials (Better Auth integration).

**Columns**:
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

User session management for authentication.

**Columns**:
- `id: text` - Primary key
- `expiresAt: timestamp` - Session expiration (required)
- `token: text` - Session token (unique, required)
- `createdAt: timestamp` - Creation timestamp (auto)
- `updatedAt: timestamp` - Last update timestamp (auto)
- `ipAddress: text` - Client IP (optional)
- `userAgent: text` - Client user agent (optional)
- `userId: text` - Session owner (FK -> users, cascade delete)

#### verificationTokens

Email verification tokens for sign-up and password reset.

**Columns**:
- `id: text` - Primary key
- `identifier: text` - Email or identifier (required)
- `value: text` - Token value (required)
- `expiresAt: timestamp` - Token expiration (required)
- `createdAt: timestamp` - Creation timestamp (auto)
- `updatedAt: timestamp` - Last update timestamp (auto)

---

### Organization Tables

#### organizations

Teams and organizations for collaborative content creation.

**Columns**:
- `id: uuid` - Primary key (default: random UUID)
- `name: varchar[255]` - Organization name (required)
- `slug: varchar[255]` - URL-safe slug (unique, required)
- `description: text` - Organization description (optional)
- `logoUrl: text` - Logo image URL (optional)
- `websiteUrl: text` - Organization website (optional)
- `createdAt: timestamp` - Creation time (auto)
- `updatedAt: timestamp` - Last update (auto)
- `deletedAt: timestamp` - Soft-delete marker (optional)

**Indexes**:
- Index on slug for efficient lookup

**Scoping**: Organization ID used for multi-tenant isolation

**Type Exports**:
```typescript
type Organization = typeof schema.organizations.$inferSelect;
type NewOrganization = typeof schema.organizations.$inferInsert;
```

#### organizationMemberships

User membership in organizations with roles and status.

**Columns**:
- `id: uuid` - Primary key
- `organizationId: uuid` - Organization (FK -> organizations, cascade delete)
- `userId: text` - User (FK -> users, cascade delete)
- `role: varchar[50]` - Role: owner, admin, creator, subscriber, member (default: member)
- `status: varchar[50]` - Status: active, inactive, invited (default: active)
- `invitedBy: text` - Who invited this user (FK -> users, set null on delete)
- `createdAt: timestamp` - Creation timestamp (auto)
- `updatedAt: timestamp` - Last update timestamp (auto)

**Constraints**:
- Unique (organizationId, userId) - one membership per user per org
- CHECK role: owner, admin, creator, subscriber, member
- CHECK status: active, inactive, invited

**Indexes**:
- Unique on (organizationId, userId)
- Index on organizationId
- Index on userId
- Composite on (organizationId, role) for role queries
- Composite on (organizationId, status) for status queries

**Type Exports**:
```typescript
type OrganizationMembership = typeof schema.organizationMemberships.$inferSelect;
type NewOrganizationMembership = typeof schema.organizationMemberships.$inferInsert;
```

---

### Content Tables

#### mediaItems

Video/audio upload metadata (separated from content for reusability).

**Columns**:
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
- `thumbnailKey: varchar[500]` - Thumbnail R2 key (optional)
- `uploadedAt: timestamp` - Upload completion time (optional)
- `createdAt: timestamp` - Creation timestamp (auto)
- `updatedAt: timestamp` - Last update timestamp (auto)
- `deletedAt: timestamp` - Soft-delete marker (optional)

**Constraints**:
- CHECK status: uploading, uploaded, transcoding, ready, failed
- CHECK mediaType: video, audio

**Indexes**:
- Index on creatorId
- Composite on (creatorId, status)
- Composite on (creatorId, mediaType)

**Lifecycle**:
1. `uploading` - Initial state when upload starts
2. `uploaded` - File successfully uploaded to R2
3. `transcoding` - Processing for streaming (HLS generation)
4. `ready` - Available for streaming
5. `failed` - Upload or transcoding failed

**Type Exports**:
```typescript
type MediaItem = typeof schema.mediaItems.$inferSelect;
type NewMediaItem = typeof schema.mediaItems.$inferInsert;
```

#### content

Published content that references media items. Can belong to organization or creator.

**Columns**:
- `id: uuid` - Primary key
- `creatorId: text` - Content creator (FK -> users, restrict delete)
- `organizationId: uuid` - Organization (FK -> organizations, set null) (optional)
- `mediaItemId: uuid` - Media reference (FK -> mediaItems, set null) (optional)
- `title: varchar[500]` - Content title (required)
- `slug: varchar[500]` - URL slug (unique per org/creator, required)
- `description: text` - Content description (optional)
- `contentType: varchar[50]` - video, audio, or written (required)
- `thumbnailUrl: text` - Custom thumbnail URL (optional)
- `contentBody: text` - Written content body (optional, Phase 2+)
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

**Constraints**:
- CHECK status: draft, published, archived
- CHECK visibility: public, private, members_only, purchased_only
- CHECK contentType: video, audio, written
- CHECK priceCents >= 0
- Unique slug per organization (for org content)
- Unique slug per creator (for personal content)

**Indexes**:
- Index on creatorId
- Index on organizationId
- Index on mediaItemId
- Composite on (slug, organizationId)
- Index on status
- Index on publishedAt
- Index on category
- Partial unique on slug+organizationId (where organizationId IS NOT NULL)
- Partial unique on slug+creatorId (where organizationId IS NULL)

**Lifecycle**:
1. `draft` - Initial state, not visible
2. `published` - Live, visible based on visibility setting
3. `archived` - Hidden, but not soft-deleted

**Type Exports**:
```typescript
type Content = typeof schema.content.$inferSelect;
type NewContent = typeof schema.content.$inferInsert;
```

---

### E-Commerce Tables

#### contentAccess

User access grants to content (purchases, subscriptions, complimentary access).

**Columns**:
- `id: uuid` - Primary key
- `userId: text` - Access holder (FK -> users, cascade delete)
- `contentId: uuid` - Content being accessed (FK -> content, cascade delete)
- `organizationId: uuid` - Content's organization (FK -> organizations, cascade delete)
- `accessType: varchar[50]` - purchased, subscription, complimentary, or preview (required)
- `expiresAt: timestamp` - Expiration time (NULL = permanent) (optional)
- `createdAt: timestamp` - Creation timestamp (auto)
- `updatedAt: timestamp` - Last update timestamp (auto)

**Constraints**:
- Unique (userId, contentId) - one access record per user per content
- CHECK accessType: purchased, subscription, complimentary, preview

**Indexes**:
- Index on userId
- Index on contentId
- Index on organizationId

**Access Types**:
- `purchased` - One-time purchase
- `subscription` - Ongoing subscription access
- `complimentary` - Free/promotional access
- `preview` - Limited preview access

**Type Exports**:
```typescript
type ContentAccess = typeof schema.contentAccess.$inferSelect;
type NewContentAccess = typeof schema.contentAccess.$inferInsert;
```

#### purchases

Purchase transaction records with immutable revenue split snapshots.

**Columns**:
- `id: uuid` - Primary key
- `customerId: text` - Buyer (FK -> users, cascade delete)
- `contentId: uuid` - Content purchased (FK -> content, restrict delete)
- `organizationId: uuid` - Creator's organization (FK -> organizations, restrict delete)
- `amountPaidCents: integer` - Amount in cents (required)
- `currency: varchar[3]` - Currency code (default: usd)
- `platformFeeCents: integer` - Platform fee snapshot (required, default: 0)
- `organizationFeeCents: integer` - Organization fee snapshot (required, default: 0)
- `creatorPayoutCents: integer` - Creator payout snapshot (required, default: 0)
- `platformAgreementId: uuid` - Platform fee agreement reference (optional)
- `creatorOrgAgreementId: uuid` - Creator-org revenue split agreement (optional)
- `stripePaymentIntentId: varchar[255]` - Stripe reference (unique, required)
- `status: varchar[50]` - pending, completed, refunded, or failed (required)
- `purchasedAt: timestamp` - Completion time (optional)
- `refundedAt: timestamp` - Refund time (optional)
- `refundReason: text` - Refund reason (optional)
- `refundAmountCents: integer` - Refund amount (optional)
- `stripeRefundId: varchar[255]` - Stripe refund reference (optional)
- `createdAt: timestamp` - Creation timestamp (auto)
- `updatedAt: timestamp` - Last update timestamp (auto)

**Constraints**:
- CHECK amountPaidCents >= 0
- CHECK platformFeeCents >= 0
- CHECK organizationFeeCents >= 0
- CHECK creatorPayoutCents >= 0
- CRITICAL: amountPaidCents = platformFeeCents + organizationFeeCents + creatorPayoutCents
- CHECK status: pending, completed, refunded, failed
- Unique on stripePaymentIntentId (idempotency)
- NO unique on (customerId, contentId) - users can retry or repurchase

**Indexes**:
- Index on customerId
- Index on contentId
- Index on organizationId
- Index on stripePaymentIntentId
- Index on createdAt
- Index on purchasedAt
- Index on platformAgreementId
- Index on creatorOrgAgreementId

**Revenue Split**: Immutable snapshots captured at purchase time. Changes to fee agreements don't affect past purchases. Supports versioned agreements.

**Status Flow**:
1. `pending` - Payment processing
2. `completed` - Purchase finalized
3. `refunded` - Refund issued
4. `failed` - Payment failed

**Type Exports**:
```typescript
type Purchase = typeof schema.purchases.$inferSelect;
type NewPurchase = typeof schema.purchases.$inferInsert;
```

#### platformFeeConfig

Default platform fee configuration. One active config at any time.

**Columns**:
- `id: uuid` - Primary key
- `platformFeePercentage: integer` - Fee in basis points (10000 = 100%, 1000 = 10%)
- `effectiveFrom: timestamp` - Start date (required, default: now)
- `effectiveUntil: timestamp` - End date (NULL = indefinite)
- `createdAt: timestamp` - Creation timestamp (auto)
- `updatedAt: timestamp` - Last update timestamp (auto)

**Phase 1 Default**: 10% platform fee (1000 basis points)

**Type Exports**:
```typescript
type PlatformFeeConfig = typeof schema.platformFeeConfig.$inferSelect;
type NewPlatformFeeConfig = typeof schema.platformFeeConfig.$inferInsert;
```

#### organizationPlatformAgreements

Custom platform fee agreements for specific organizations (volume discounts, etc).

**Columns**:
- `id: uuid` - Primary key
- `organizationId: uuid` - Organization (FK -> organizations, cascade delete)
- `platformFeePercentage: integer` - Custom fee in basis points
- `effectiveFrom: timestamp` - Start date
- `effectiveUntil: timestamp` - End date (NULL = indefinite)
- `createdAt: timestamp` - Creation timestamp (auto)
- `updatedAt: timestamp` - Last update timestamp (auto)

**Behavior**: If no record exists, organization uses platformFeeConfig default.

**Type Exports**:
```typescript
type OrganizationPlatformAgreement = typeof schema.organizationPlatformAgreements.$inferSelect;
type NewOrganizationPlatformAgreement = typeof schema.organizationPlatformAgreements.$inferInsert;
```

#### creatorOrganizationAgreements

Revenue split agreements between creators and organizations.

**Columns**:
- `id: uuid` - Primary key
- `creatorId: text` - Creator (FK -> users, cascade delete)
- `organizationId: uuid` - Organization (FK -> organizations, cascade delete)
- `organizationFeePercentage: integer` - Organization's cut (basis points)
- `effectiveFrom: timestamp` - Start date
- `effectiveUntil: timestamp` - End date (NULL = indefinite)
- `createdAt: timestamp` - Creation timestamp (auto)
- `updatedAt: timestamp` - Last update timestamp (auto)

**Phase 1 Default**: 0% to organization, 100% of remaining to creator

**Phase 2+**: Orgs can negotiate revenue share (e.g., 20% to org, 80% to creator)

**Behavior**: If no record exists, organization gets 0% (all remaining to creator).

**Type Exports**:
```typescript
type CreatorOrganizationAgreement = typeof schema.creatorOrganizationAgreements.$inferSelect;
type NewCreatorOrganizationAgreement = typeof schema.creatorOrganizationAgreements.$inferInsert;
```

---

### Playback Tables

#### videoPlayback

Video playback progress for resume functionality.

**Columns**:
- `id: uuid` - Primary key
- `userId: text` - Watcher (FK -> users, cascade delete)
- `contentId: uuid` - Video content (FK -> content, cascade delete)
- `positionSeconds: integer` - Current position in seconds (default: 0)
- `durationSeconds: integer` - Total duration in seconds (required)
- `completed: boolean` - Watched >= 95% (auto-set, default: false)
- `updatedAt: timestamp` - Last update timestamp (auto)
- `createdAt: timestamp` - Creation timestamp (auto)

**Constraints**:
- Unique (userId, contentId) - one playback record per user per video

**Indexes**:
- Index on userId
- Index on contentId

**Business Rules**:
- Frontend updates every 30 seconds during playback
- Backend auto-completes when position >= 95% of duration
- No cleanup - historical record useful for analytics

**Update Pattern**:
- Frontend sends partial updates (position + duration)
- Backend upserts the playback record
- When position >= 95% * durationSeconds, `completed` set to true

**Type Exports**:
```typescript
type VideoPlayback = typeof schema.videoPlayback.$inferSelect;
type NewVideoPlayback = typeof schema.videoPlayback.$inferInsert;
```

---

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

---

## Integration Points

### Packages Using @codex/database

| Package | Purpose | Connection | Usage |
|---------|---------|-----------|-------|
| @codex/identity | User/org management | dbWs/dbHttp | Read/write users, organizations, memberships |
| @codex/content | Content management | dbWs/dbHttp | CRUD operations on content, media items |
| @codex/access | Access control | dbWs/dbHttp | Query/grant content access, playback |
| @codex/security | Auth/security | dbWs/dbHttp | Manage sessions, verify tokens |
| @codex/purchase | E-commerce | dbWs/dbHttp | Purchase records, revenue splits |
| @codex/test-utils | Test utilities | dbWs | Database setup/teardown |
| @codex/worker-utils | Worker helpers | dbHttp/dbWs | Inject database clients |

### Workers Using @codex/database

| Worker | Connection Type | Purpose |
|--------|-----------------|---------|
| workers/auth | dbWs/dbHttp | Authentication, session management |
| workers/identity-api | dbHttp | User/organization API endpoints |
| workers/content-api | dbHttp | Content, media, access endpoints |
| workers/ecom-api | dbHttp | Payment processing, webhooks |

### Service Integration Pattern

Services extend BaseService and receive database clients via constructor:

```typescript
import { BaseService, type ServiceConfig } from '@codex/service-errors';
import { dbHttp, type Database } from '@codex/database';

class MyService extends BaseService {
  constructor(config: ServiceConfig) {
    super(config);
    // Database client available via this.db (from BaseService)
  }

  async doSomething() {
    const result = await this.db.query.users.findFirst({
      where: (u) => eq(u.id, userId),
    });
  }
}
```

---

## Performance Notes

### Query Optimization

1. **Use Indexes for Common Queries**
   - All tables have indexes on foreign keys and commonly filtered columns
   - Use indexed columns in WHERE clauses (creatorId, organizationId, status, etc)

2. **Soft-Delete Performance**
   - Use `whereNotDeleted()` helper in all queries
   - Indexes are optimized for soft-delete patterns
   - Deleted records remain in database for analytics

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

---

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
   - Automatic cleanup

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

## FAQ

**Q: Should I use dbHttp or dbWs?**
A: Use `dbHttp` in production workers (stateless, fast). Use `dbWs` in tests and when you need transactions.

**Q: Do I need to close dbHttp?**
A: No, dbHttp is stateless. Only call `closeDbPool()` for dbWs in test cleanup.

**Q: How do I handle unique constraint violations?**
A: Use `isUniqueViolation(error)` to detect and handle appropriately.

**Q: Can I use transactions in Cloudflare Workers?**
A: Yes, but use `createPerRequestDbClient()` and call `cleanup()` before request ends.

**Q: Why are some updates going to tables I didn't modify?**
A: Check if you're using soft deletes. `whereNotDeleted()` helper filters them automatically.

---

**Last Updated**: 2025-12-14
**Package Version**: 0.1.0
**Drizzle ORM Version**: 0.44.7
**Node Versions**: Node.js 18+
**Database**: PostgreSQL (Neon Serverless)
**Cloudflare Runtime**: Compatible with Cloudflare Workers

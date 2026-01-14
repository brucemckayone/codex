# P1-ACCESS-001: Content Access & Playback

**Priority**: P0 (Critical - content delivery)
**Status**: 🚧 Not Implemented
**Estimated Effort**: 3-4 days

---

## Table of Contents

- [Overview](#overview)
- [System Context](#system-context)
- [Database Schema](#database-schema)
- [Service Architecture](#service-architecture)
- [API Integration](#api-integration)
- [Available Patterns & Utilities](#available-patterns--utilities)
- [Dependencies](#dependencies)
- [Implementation Checklist](#implementation-checklist)
- [Testing Strategy](#testing-strategy)
- [Notes](#notes)

---

## Overview

Content Access is the gateway service between customers and content delivery. It enforces business rules determining who can stream what content, generates time-limited signed URLs for secure media streaming, and tracks playback progress for resume functionality.

This service sits between the content repository and the video player, making authorization decisions before granting access to media files stored in R2. Every streaming request flows through this service to verify the user has the right to view content - either because it's free or because they've purchased it.

The access control model supports three access types:
- **Free Content**: `priceCents = 0` or `NULL` → generate streaming URL immediately
- **Paid Content**: `priceCents > 0` → verify purchase record exists → generate URL
- **Members-Only Content**: `visibility = 'members_only'` → verify organization membership → generate URL

Playback tracking enables "continue watching" functionality by recording video position every 30 seconds. When a user returns to partially-watched content, the player resumes from their last position.

Key capabilities:
- **Access Verification**: Enforce free vs paid vs members-only content rules
- **Signed URL Generation**: Create time-limited (1-hour) R2 streaming URLs with automatic expiration
- **Playback Progress**: Track video position for resume watching
- **User Library**: List all content the user can access (purchased + free + org content)

This service is consumed by:
- **Video Player**: Requests streaming URLs for HLS playback
- **User Dashboard**: Displays "My Library" with continue watching indicators
- **Content Discovery**: Shows which content requires purchase vs immediate access

---

## System Context

### Upstream Dependencies

**Content Service** (P1-CONTENT-001) (✅ Complete):
- Queries `content` table to check publication status, pricing, visibility
- Content must have `status = 'published'` AND `deletedAt IS NULL`
- Reads `mediaItemId` to generate R2 keys for streaming

**Purchase Service** (P1-ECOM-001) (❌ Blocked):
- Queries `purchases` table to verify user has purchased content
- Purchase must have `status = 'completed'`
- Needed for paid content access verification

**Media Transcoding Service** (P1-TRANSCODE-001) (🚧 Future):
- Populates `media_items.hlsMasterPlaylistKey` with transcoded HLS manifest path
- Access service reads this key to generate R2 streaming URLs
- Media must have `status = 'ready'` before streaming

**Auth Service** (✅ Available):
- Provides authenticated user context (user ID, organization ID)
- Session validation for all API requests
- Organization membership verification for members-only content

### Downstream Consumers

**Video Player** (Frontend):
- Calls `GET /api/content/:id/stream` to get streaming URL
- Calls `POST /api/content/:id/progress` every 30 seconds during playback
- Calls `GET /api/content/:id/progress` on page load to resume watching
- Integration: Receives time-limited URL, uses HLS.js for playback

**User Dashboard** (Frontend):
- Calls `GET /api/user/library` to display accessible content
- Shows playback progress indicators (e.g., "watched 45% of video")
- Filters by completed vs in-progress content
- Integration: Displays purchased + free + org content with progress

**Content Discovery** (Frontend):
- Checks if content requires purchase or is immediately accessible
- Shows "Watch Now" vs "Purchase" buttons
- Integration: Reads `priceCents` from content metadata

### External Services

**Cloudflare R2**: Object storage for media files (HLS manifests and segments)
**Neon PostgreSQL**: Serverless Postgres for playback progress and access records
**Better Auth**: Session management and user authentication

### Integration Flow

```
User Request (stream video)
    ↓
Auth Middleware (validate session)
    ↓
Access Service (verify purchase or free)
    ↓
R2 Signing Service (generate time-limited URL)
    ↓
Return Signed URL (valid for 1 hour)
    ↓
Video Player (HLS playback)
    ↓
Progress Updates (every 30 seconds)
```

---

## Database Schema

### Tables

#### `video_playback`

**Purpose**: Track video playback progress for resume functionality. Enables "continue watching" feature by recording the last position watched for each user + content combination.

**Key Fields**:
- `id` (text, PK): Unique playback record identifier
- `userId` (text, FK → users.id): User watching the content
- `contentId` (text, FK → content.id): Content being watched
- `positionSeconds` (integer): Current playback position in seconds
- `durationSeconds` (integer): Total video duration (cached from media_items)
- `completed` (boolean): True when user has watched >= 95% of video
- `lastWatchedAt` (timestamp): When user last updated progress
- `createdAt`, `updatedAt`: Timestamps

**Constraints**:
- Primary Key: `id`
- Foreign Keys:
  - `userId` → `users.id`
  - `contentId` → `content.id`
- Unique: `(userId, contentId)` - one progress record per user per content
- Check: `positionSeconds >= 0`
- Check: `positionSeconds <= durationSeconds`
- Check: `durationSeconds > 0`

**Indexes**:
- `idx_video_playback_user_id` ON `userId`: User's watch history queries
- `idx_video_playback_completed` ON `userId, completed`: Filter completed vs in-progress
- Unique index on `(userId, contentId)` for upsert pattern

**Business Rules**:
- **Upsert Pattern**: Frontend sends progress updates every 30 seconds. Backend upserts record (INSERT ON CONFLICT UPDATE).
- **Auto-Complete**: When `positionSeconds >= 0.95 * durationSeconds`, set `completed = true`
- **No Cleanup**: Records are never deleted, useful for analytics

### Relationships

```
users (1) ─────< video_playback (N)
  └─ userId

content (1) ─────< video_playback (N)
  └─ contentId
```

### Migration Considerations

**Manual Steps Required**:
- CHECK constraints must be added manually (Drizzle doesn't auto-generate)
- Verify unique constraint on `(userId, contentId)` for upsert
- Add indexes for `userId` and `completed` queries

**Upsert Pattern**:
```sql
-- Example upsert query
INSERT INTO video_playback (user_id, content_id, position_seconds, duration_seconds, completed)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (user_id, content_id)
DO UPDATE SET
  position_seconds = EXCLUDED.position_seconds,
  completed = EXCLUDED.completed,
  last_watched_at = NOW(),
  updated_at = NOW();
```

**Soft Delete Pattern**:
- Playback records are NOT soft-deleted (no `deletedAt` column)
- Records are permanent for analytics

---

## Service Architecture

### Service Responsibilities

**ContentAccessService** (extends `BaseService` from `@codex/service-errors`):
- **Primary Responsibility**: Enforce access control and generate streaming URLs for authorized users
- **Key Operations**:
  - `verifyAccess(contentId, userId)`: Check if user can access content (free, purchased, or member)
  - `getStreamingUrl(contentId, userId)`: Verify access → generate time-limited R2 URL
  - `savePlaybackProgress(contentId, userId, progress)`: Upsert playback position
  - `getPlaybackProgress(contentId, userId)`: Retrieve last playback position
  - `getUserLibrary(userId, filters)`: List all accessible content (purchased + free + org)

### Key Business Rules

1. **Access Verification Logic**:
   - **Free Content**: `priceCents = 0 OR priceCents IS NULL` → grant access immediately
   - **Paid Content**: `priceCents > 0` → query `purchases` table for matching `userId + contentId` with `status = 'completed'`
   - **Members-Only**: `visibility = 'members_only'` → verify `user.organizationId = content.organizationId`
   - **Must Be Published**: All content must have `status = 'published'` AND `deletedAt IS NULL`
   - **Must Be Ready**: Referenced media must have `status = 'ready'`

2. **Streaming URL Generation**:
   - Read `hlsMasterPlaylistKey` from `media_items` table
   - Generate presigned R2 URL with 1-hour expiration
   - URL pattern: `https://r2-bucket.com/hls/{media_id}/master.m3u8?X-Amz-Signature=...`
   - Expiration ensures URLs can't be shared long-term

3. **Playback Progress Tracking**:
   - Frontend sends progress every 30 seconds during playback
   - Backend upserts `video_playback` record using `(userId, contentId)` unique constraint
   - Auto-complete when `positionSeconds >= 0.95 * durationSeconds`
   - Cache `durationSeconds` from `media_items` to avoid repeated joins

4. **User Library**:
   - Include all free content (`priceCents = 0 OR NULL`)
   - Include all purchased content (join with `purchases` where `status = 'completed'`)
   - Include all organization content if user has `organizationId`
   - Filter by completed vs in-progress using `video_playback.completed`
   - Paginate with 20 items per page

### Error Handling Approach

**Custom Error Classes** (extend base errors from `@codex/service-errors`):
- `AccessDeniedError`: User doesn't have access to content → HTTP 403
- `ContentNotPublishedError`: Content is draft or archived → HTTP 404
- `MediaNotReadyError`: Media transcoding not complete → HTTP 503 (Service Unavailable)
- `R2SigningError`: Failed to generate signed URL → HTTP 500

**Error Propagation**:
- Service throws specific error classes
- Worker layer catches via `mapErrorToResponse()` from `@codex/service-errors`
- Frontend receives clear error message (e.g., "You must purchase this content to watch")

**Error Recovery**:
- No automatic retries for access checks (fast fail)
- R2 signing errors should be rare (retry once with exponential backoff)

### Transaction Boundaries

**Operations requiring `db.transaction()`**:
- `savePlaybackProgress()`: Upsert playback + check auto-complete logic in single transaction
- No other operations need transactions (all are single queries)

**Single-operation methods** (no transaction needed):
- `verifyAccess()`: Read-only queries (content + purchase check)
- `getStreamingUrl()`: Read-only query → R2 signing (no DB write)
- `getPlaybackProgress()`: Read-only query
- `getUserLibrary()`: Read-only query with joins

---

## API Integration

### Endpoints

| Method | Path | Purpose | Security Policy |
|--------|------|---------|-----------------|
| GET | `/api/content/:id/stream` | Get streaming URL | `POLICY_PRESETS.authenticated()` |
| POST | `/api/content/:id/progress` | Save playback progress | `POLICY_PRESETS.authenticated()` |
| GET | `/api/content/:id/progress` | Get playback progress | `POLICY_PRESETS.authenticated()` |
| GET | `/api/user/library` | List accessible content | `POLICY_PRESETS.authenticated()` |

### Standard Pattern

All endpoints follow the `@codex/worker-utils` pattern:

```typescript
app.get('/api/content/:id/stream',
  withPolicy(POLICY_PRESETS.authenticated()), // Route-level security
  createAuthenticatedGetHandler({
    inputSchema: z.object({ id: z.string().uuid() }), // Param validation
    handler: async ({ input, context }) => {
      const service = new ContentAccessService(context);
      const url = await service.getStreamingUrl(input.id, context.user.id);
      return { streamingUrl: url, expiresIn: 3600 }; // 1 hour
    }
  })
);
```

### Security Policies

**Route-Level Security** (via `withPolicy()` from `@codex/worker-utils`):
- All endpoints require `POLICY_PRESETS.authenticated()` (valid session)
- No admin-only endpoints (all are user-facing)
- Rate limiting: Standard API rate limit (100 req/min per user)

**Access Control**:
- Verify access before generating streaming URL (403 if denied)
- Progress tracking only works for content user has access to
- Library queries are user-scoped (can only see own accessible content)

### Response Format

**Streaming URL Response**:
```typescript
{
  streamingUrl: string, // Presigned R2 URL (valid 1 hour)
  expiresIn: number,     // Seconds until expiration (3600)
  contentId: string,
  mediaItemId: string
}
```

**Playback Progress Response**:
```typescript
{
  positionSeconds: number,
  durationSeconds: number,
  completed: boolean,
  lastWatchedAt: string // ISO 8601
}
```

**User Library Response** (paginated):
```typescript
{
  data: Array<{
    content: Content,        // Full content metadata
    progress: {              // Playback progress (if exists)
      positionSeconds: number,
      durationSeconds: number,
      completed: boolean,
      lastWatchedAt: string
    } | null,
    accessType: 'free' | 'purchased' | 'member' // Why user has access
  }>,
  pagination: {
    page: number,
    pageSize: number,
    totalCount: number,
    totalPages: number
  }
}
```

---

## Available Patterns & Utilities

### Foundation Packages

#### `@codex/database`

**Query Helpers**:
- `scopedNotDeleted(table, userId)`: Filter by user + exclude soft-deleted records
- `withPagination(query, page, pageSize)`: Standardized pagination for user library
- Joins: Use Drizzle relational queries for `content JOIN media_items JOIN purchases JOIN video_playback`

**Upsert Pattern** (for playback progress):
```typescript
// Use Drizzle's onConflictDoUpdate
await db.insert(videoPlayback)
  .values({ userId, contentId, positionSeconds, durationSeconds, completed })
  .onConflictDoUpdate({
    target: [videoPlayback.userId, videoPlayback.contentId],
    set: {
      positionSeconds,
      completed,
      lastWatchedAt: new Date(),
      updatedAt: new Date()
    }
  });
```

**When to use**: All database queries. Use upsert pattern for playback progress.

---

#### `@codex/service-errors`

**BaseService** (extend this):
- Provides: `this.db`, `this.userId`, `this.environment`
- Constructor: `constructor(config: ServiceConfig)`

**Error Classes**:
- `ForbiddenError(message)`: Access denied → HTTP 403
- `NotFoundError(message)`: Content not found or not published → HTTP 404
- `InternalServiceError(message)`: R2 signing failure → HTTP 500

**When to use**: ContentAccessService extends BaseService. Throw `ForbiddenError` when access denied, `NotFoundError` when content doesn't exist or isn't published.

---

#### `@codex/validation`

**Access Schemas** (to be created in `@codex/validation/access-schemas`):
- `getStreamingUrlSchema`: Validate content ID parameter
- `savePlaybackProgressSchema`: Validate progress update (positionSeconds, durationSeconds)
- `getPlaybackProgressSchema`: Validate content ID
- `getUserLibrarySchema`: Validate filters (completed, contentType, page, pageSize)

**Security**:
- Validate all inputs to prevent injection attacks
- Ensure positionSeconds <= durationSeconds
- Validate page/pageSize for pagination

**When to use**: Define schemas for all API inputs. Validation happens in `createAuthenticatedHandler()`.

---

### Utility Packages

#### `@codex/cloudflare-clients`

**R2 Storage** (via `R2Service`):
- **`R2Service.generateSignedUrl(bucket, key, expiresIn)`**: Generate time-limited streaming URLs
  - Input: bucket name, R2 key (from `media_items.hlsMasterPlaylistKey`), expiration (3600 seconds)
  - Output: Presigned URL with HMAC signature
  - Automatic retry on failure (exponential backoff)

**When to use**: Call `generateSignedUrl()` after verifying access. Pass HLS master playlist key from media_items table.

---

#### `@codex/worker-utils`

**Worker Setup**:
- `createWorker(config)`: Fully configured Hono app
- Applied automatically: security headers, CORS, logging, error handling

**Route Handlers**:
- `createAuthenticatedHandler({ inputSchema, handler })`: Unified handler with validation
- `createAuthenticatedGetHandler({ schema, handler })`: For GET requests
- `withPolicy(POLICY_PRESETS.authenticated())`: Require valid session

**When to use**: Every endpoint uses `withPolicy()` + `createAuthenticatedHandler()`.

---

#### `@codex/observability`

**Logging**:
- `client.info('Access granted', { userId, contentId, accessType })`: Log successful access
- `client.warn('Access denied', { userId, contentId, reason })`: Log denied access
- `client.error('R2 signing failed', error)`: Log R2 errors

**When to use**: Log all access decisions (granted/denied) for security auditing. Log R2 errors for monitoring.

---

## Dependencies

### Required (Blocking)

| Dependency | Status | Description |
|------------|--------|-------------|
| Content Service (P1-CONTENT-001) | ✅ Complete | Need `content` and `media_items` tables to query publication status and HLS keys |
| Purchase Service (P1-ECOM-001) | ❌ **BLOCKED** | Need `purchases` table to verify paid content access. **Cannot implement access verification for paid content until this is complete.** |
| Auth Service | ✅ Available | Session validation, user context |
| R2 Service (@codex/cloudflare-clients) | ✅ Available | Presigned URL generation |

### Optional (Nice to Have)

| Dependency | Status | Description |
|------------|--------|-------------|
| Media Transcoding (P1-TRANSCODE-001) | 🚧 Future | Populates `hlsMasterPlaylistKey` in media_items. Access service can be built without this (use placeholder keys for testing). |

### Infrastructure Ready

- ✅ Database schema tooling (Drizzle ORM)
- ✅ Worker deployment pipeline (Cloudflare Workers)
- ✅ R2 storage with presigned URL support
- ✅ Session management (KV-backed)
- ✅ Error handling (@codex/service-errors)

### Critical Blocker

**P1-ECOM-001 (Stripe Checkout) must be completed first** to implement paid content access verification. Without the `purchases` table:
- Can implement free content streaming
- Can implement playback progress tracking
- **CANNOT implement paid content access** (major feature gap)

**Recommendation**: Implement free content + progress tracking first, then add paid content verification after P1-ECOM-001.

---

## Implementation Checklist

- [ ] **Database Setup**
  - [ ] Create `video_playback` table schema in `packages/database/src/schema/playback.ts`
  - [ ] Generate migration with CHECK constraints
  - [ ] Add unique constraint on `(userId, contentId)` for upsert
  - [ ] Add indexes for `userId` and `completed` queries
  - [ ] Run migration in development

- [ ] **Service Layer**
  - [ ] Create `packages/access/src/services/content-access-service.ts`
  - [ ] Implement `verifyAccess()` method (free content only initially)
  - [ ] Implement `getStreamingUrl()` method (uses R2Service)
  - [ ] Implement `savePlaybackProgress()` method (upsert pattern)
  - [ ] Implement `getPlaybackProgress()` method
  - [ ] Implement `getUserLibrary()` method
  - [ ] Add custom error classes (AccessDeniedError, etc.)
  - [ ] Add unit tests with mocked database

- [ ] **Validation**
  - [ ] Add Zod schemas to `@codex/validation/access-schemas.ts`
  - [ ] Schema for streaming URL request
  - [ ] Schema for playback progress update
  - [ ] Schema for library query filters
  - [ ] Add schema tests (100% coverage)

- [ ] **Worker/API**
  - [ ] Add access routes to content-api worker (or create new access-api worker)
  - [ ] Implement `GET /api/content/:id/stream` endpoint
  - [ ] Implement `POST /api/content/:id/progress` endpoint
  - [ ] Implement `GET /api/content/:id/progress` endpoint
  - [ ] Implement `GET /api/user/library` endpoint
  - [ ] Apply route-level security with `withPolicy()`
  - [ ] Add integration tests

- [ ] **Integration**
  - [ ] Test free content streaming end-to-end
  - [ ] Test playback progress upsert pattern
  - [ ] Test auto-complete logic (95% threshold)
  - [ ] Test user library with free content
  - [ ] ⏳ **Defer**: Paid content verification (blocked by P1-ECOM-001)

- [ ] **Deployment**
  - [ ] Update wrangler.jsonc with R2 bindings
  - [ ] Test in preview environment
  - [ ] Run migrations in staging
  - [ ] Deploy to production

---

## Testing Strategy

### Unit Tests

**Service Layer** (`packages/access/src/__tests__/`):
- Test access verification logic (free content)
- Test playback progress upsert pattern
- Test auto-complete logic (positionSeconds >= 95% of duration)
- Test user library query (joins, filters, pagination)
- Mock database and R2Service

**Validation Layer** (`packages/validation/src/__tests__/`):
- 100% coverage for access schemas
- Test progress update validation (position <= duration)
- Test library filter validation

### Integration Tests

**API Endpoints** (`workers/content-api/src/__tests__/`):
- Test streaming URL generation for free content
- Test access denied for unpublished content
- Test playback progress save and retrieve
- Test auto-complete when user watches 95%+
- Test user library with multiple content types

**Database Tests**:
- Test upsert pattern for playback progress (same user + content)
- Test unique constraint on `(userId, contentId)`
- Test CHECK constraints (position <= duration)

### E2E Scenarios

**Free Content Streaming**:
1. User requests stream URL for free content
2. Service verifies content is published + free
3. Service generates presigned R2 URL
4. User receives URL, HLS player loads video
5. User watches video, progress updates every 30 seconds
6. User closes video, progress saved
7. User returns, playback resumes from saved position

**Access Denied Scenario**:
1. User requests stream URL for paid content
2. Service checks for purchase record
3. No purchase found → throw `AccessDeniedError`
4. User receives 403 error with message "You must purchase this content"

**Auto-Complete Scenario**:
1. User watches video to 95% completion
2. Progress update triggers auto-complete
3. `video_playback.completed` set to `true`
4. User library shows content as "Completed"

### Local Development Testing

**Tools**:
- `pnpm test`: Run all tests
- `pnpm --filter @codex/access test:watch`: Watch mode
- `pnpm dev`: Local worker server
- Database: Local PostgreSQL via Docker

**Test Data**:
- Use `@codex/test-utils` to seed test users and content
- Create free content for access testing
- Mock R2 signed URLs in tests

---

## Notes

### Phased Implementation

**Phase 1: Free Content + Progress Tracking** (Can implement now):
- Free content streaming (no purchase check)
- Playback progress tracking
- User library (free content only)
- **Blocked on**: Nothing, can start immediately

**Phase 2: Paid Content Access** (Blocked by P1-ECOM-001):
- Add purchase verification to `verifyAccess()`
- Update user library to include purchased content
- **Blocked on**: P1-ECOM-001 (purchases table)

**Recommendation**: Implement Phase 1 first to unblock frontend development. Add Phase 2 after P1-ECOM-001 is complete.

### Architectural Decisions

**Time-Limited URLs**: Presigned R2 URLs expire after 1 hour to prevent URL sharing. If user pauses video > 1 hour, frontend requests new URL.

**Upsert Pattern**: Playback progress uses unique constraint on `(userId, contentId)` with `ON CONFLICT DO UPDATE` to avoid duplicate records.

**No Cleanup**: Playback records are never deleted. Useful for analytics (watch time, completion rate, etc.).

**Auto-Complete Threshold**: 95% threshold accounts for users who skip credits or don't watch final seconds.

**Progress Update Frequency**: 30 seconds balances database load with progress accuracy. Frontend can buffer updates client-side.

### Performance Considerations

**Expected Query Performance**:
- Access verification: < 30ms (indexed on content_id + user_id)
- Streaming URL generation: < 50ms (R2 signing + DB query)
- Playback progress upsert: < 20ms (unique index upsert)
- User library: < 100ms (joins + pagination)

**Database Load** (Phase 1 estimates):
- Streaming URL requests: ~1,000-10,000/day
- Progress updates: ~30,000-100,000/day (every 30 seconds during playback)
- Library queries: ~100-1,000/day

**Indexes are critical**:
- `(userId, contentId)` unique index: Upsert performance
- `userId` index: User library queries
- `completed` index: Filter completed vs in-progress

### Security Considerations

**URL Expiration**: 1-hour expiration prevents long-term URL sharing. Users cannot bookmark streaming URLs.

**Access Logging**: Log all access decisions (granted/denied) for security auditing and abuse detection.

**Rate Limiting**: Standard API rate limits (100 req/min) prevent abuse of streaming URL generation.

---

**Last Updated**: 2025-11-23
**Version**: 2.0 (Updated to architectural documentation standard)

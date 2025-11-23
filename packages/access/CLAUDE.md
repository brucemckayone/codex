# @codex/access

Content access control, streaming URL generation, and playback tracking for the Codex platform.

## Overview

@codex/access manages all content access decisions and streaming. It verifies user permissions (free content, purchases, organization membership), generates time-limited signed R2 URLs for media streaming, and tracks video/audio playback progress for resume functionality. The service enforces access control at the database layer while delegating R2 URL signing to Cloudflare R2. This package is used by the content-api worker to handle all streaming and library operations.

**Business responsibility**: Content access control and streaming infrastructure.

**Key use cases**:
- Generate presigned streaming URLs for authenticated users
- Verify user access (free vs purchased content, org membership)
- Track playback progress for video/audio resume functionality
- List user's content library with access and progress information

## Public API

| Export | Type | Purpose |
|--------|------|---------|
| `ContentAccessService` | Class | Main service for access control and streaming |
| `createContentAccessService()` | Function | Factory function for dependency injection |
| `ContentAccessServiceConfig` | Interface | Service configuration type |
| `ContentAccessEnv` | Interface | Environment variables for R2 signing |
| `AccessDeniedError` | Class | User lacks permission to access content |
| `R2SigningError` | Class | R2 presigned URL generation failed |
| `InvalidContentTypeError` | Class | Invalid media type for streaming |
| `OrganizationMismatchError` | Class | Content belongs to different organization |
| `UserLibraryItem` | Interface | Single item in user's library |
| `UserLibraryResponse` | Interface | Paginated library response |

**Validation schemas** (re-exported from @codex/validation):
- `getStreamingUrlSchema` - Validates content ID and expiry seconds
- `savePlaybackProgressSchema` - Validates position, duration, completed flag
- `getPlaybackProgressSchema` - Validates content ID lookup
- `listUserLibrarySchema` - Validates pagination, filter, sort options

## Core Service: ContentAccessService

Full qualified name: `@codex/access.ContentAccessService`

Service that manages all aspects of content access and streaming. Handles permission verification (free content, purchase validation, organization membership), generates presigned R2 URLs, and tracks playback progress.

### Constructor

```typescript
constructor(config: ContentAccessServiceConfig)
```

**Parameters**:
- `config.db: Database` - Drizzle database client for queries
- `config.r2: R2Signer` - R2 signing service (R2Service in production, R2SigningClient in tests)
- `config.obs: ObservabilityClient` - Observability/logging client

### Methods

#### getStreamingUrl()

Generate time-limited signed streaming URL for content with access verification.

```typescript
async getStreamingUrl(
  userId: string,
  input: GetStreamingUrlInput
): Promise<{
  streamingUrl: string;
  expiresAt: Date;
  contentType: 'video' | 'audio';
}>
```

**Parameters**:
- `userId: string` - Authenticated user ID from JWT token
- `input.contentId: string` - Content ID to stream
- `input.expirySeconds: number` - URL expiration in seconds (default 3600)

**Returns**:
- `streamingUrl: string` - R2 presigned URL (format: `https://{bucket}.r2.cloudflarestorage.com/{key}?X-Amz-Signature=...`)
- `expiresAt: Date` - When the signed URL expires
- `contentType: 'video' | 'audio'` - Media type of the content

**Access control flow**:
1. Content must exist, be published, and not deleted
2. If free (priceCents = 0) → grant access
3. If paid, check user purchase via contentAccess table → grant access
4. If no purchase, check user active membership in content's organization → grant access
5. Otherwise → throw AccessDeniedError

**Transaction safety**: All queries wrapped in transaction with read-committed isolation for consistent access verification.

**Throws**:
- `ContentNotFoundError` - Content doesn't exist, is draft, or deleted
- `AccessDeniedError` - User not purchased and not org member (403 status)
- `R2SigningError` - Failed to generate presigned URL (500 status)

**Observability**: Logs access grant/deny decisions and errors with userId, contentId, org context.

#### savePlaybackProgress()

Save or update video playback position (upsert pattern). Prevents backwards-seeking overwrites using GREATEST() SQL function.

```typescript
async savePlaybackProgress(
  userId: string,
  input: SavePlaybackProgressInput
): Promise<void>
```

**Parameters**:
- `userId: string` - Authenticated user ID
- `input.contentId: string` - Content ID being watched
- `input.positionSeconds: number` - Current playback position (seconds)
- `input.durationSeconds: number` - Total content duration (seconds)
- `input.completed?: boolean` - Optional completion flag

**Behavior**:
- Auto-completes if watched >= 95% of duration (positionSeconds >= durationSeconds * 0.95)
- Upsert via unique constraint (userId, contentId)
- On conflict, updates to max(current_position, new_position) - prevents backwards overwrites
- Completion flag is ORed (once completed, stays completed)
- Updates timestamp on every save

**Throws**: None (upsert operations don't throw for normal conditions)

**Observability**: Logs position, duration, and completion state.

#### getPlaybackProgress()

Retrieve playback position and completion status for specific content.

```typescript
async getPlaybackProgress(
  userId: string,
  input: GetPlaybackProgressInput
): Promise<{
  positionSeconds: number;
  durationSeconds: number;
  completed: boolean;
  updatedAt: Date;
} | null>
```

**Parameters**:
- `userId: string` - Authenticated user ID
- `input.contentId: string` - Content ID to query

**Returns**:
- Progress object if record exists, null if user has never watched this content
- `positionSeconds: number` - Last known position
- `durationSeconds: number` - Duration at time of last update
- `completed: boolean` - Whether content marked as finished
- `updatedAt: Date` - When progress was last updated

**Throws**: None

#### listUserLibrary()

Retrieve user's purchased content with playback progress, filters, sorting, and pagination.

```typescript
async listUserLibrary(
  userId: string,
  input: ListUserLibraryInput
): Promise<UserLibraryResponse>
```

**Parameters**:
- `userId: string` - Authenticated user ID
- `input.page: number` - Page number (1-indexed, default 1)
- `input.limit: number` - Items per page (default 20)
- `input.filter?: 'all' | 'in-progress' | 'completed'` - Content status filter (default 'all')
- `input.sortBy?: 'recent' | 'title' | 'duration'` - Sort order (default 'recent')

**Returns** (`UserLibraryResponse`):
```typescript
{
  items: [
    {
      content: {
        id: string;
        title: string;
        description: string;
        thumbnailUrl: string | null;
        contentType: 'video' | 'audio';
        durationSeconds: number;
      };
      purchase: {
        purchasedAt: string; // ISO 8601
        priceCents: number;
      };
      progress: {
        positionSeconds: number;
        durationSeconds: number;
        completed: boolean;
        percentComplete: number; // 0-100
        updatedAt: string; // ISO 8601
      } | null; // null if never watched
    }
  ];
  pagination: {
    page: number;
    limit: number;
    total: number; // After filters applied
    totalPages: number;
  };
}
```

**Query strategy**:
1. Fetch completed purchases with content and media details (paginated)
2. Batch-fetch playback progress for all content IDs
3. Build response items combining purchase and progress data
4. Apply filters (in-progress, completed, all)
5. Apply sorting (most recent by default, title alphabetically, duration descending)
6. Return paginated results

**Throws**: None

**Observability**: Logs page, filter, and sort parameters.

## Factory Function: createContentAccessService()

Create service instance with environment variable configuration. Used in API workers for dependency injection.

```typescript
export function createContentAccessService(
  env: ContentAccessEnv
): ContentAccessService
```

**Parameters** (`ContentAccessEnv`):
- `MEDIA_BUCKET?: R2Bucket` - R2 bucket binding (required)
- `R2_ACCOUNT_ID?: string` - Cloudflare account ID (required)
- `R2_ACCESS_KEY_ID?: string` - R2 API access key ID (required)
- `R2_SECRET_ACCESS_KEY?: string` - R2 API secret key (required)
- `R2_BUCKET_MEDIA?: string` - R2 bucket name (e.g., "codex-media-production") (required)
- `ENVIRONMENT?: string` - Environment name for observability (optional, defaults to "development")

**Returns**: Fully configured ContentAccessService instance

**Throws**: Error if any required environment variable missing

**Production deployment requires**: All R2 credentials configured in wrangler.toml secrets/bindings.

## Usage Examples

### Basic: Get streaming URL

```typescript
import { createContentAccessService } from '@codex/access';

// In Hono route handler
const service = createContentAccessService(ctx.env);
const userId = ctx.user.id; // From JWT

const result = await service.getStreamingUrl(userId, {
  contentId: 'content-123',
  expirySeconds: 3600, // 1 hour
});

// Respond with presigned URL
return {
  streamingUrl: result.streamingUrl,
  expiresAt: result.expiresAt.toISOString(),
  contentType: result.contentType,
};
```

### Basic: Save playback progress

```typescript
const service = createContentAccessService(ctx.env);

await service.savePlaybackProgress(userId, {
  contentId: 'content-123',
  positionSeconds: 450, // 7:30 into video
  durationSeconds: 1800, // 30 minutes
  completed: false, // Optional
});

// No return value, updates are fire-and-forget safe
```

### Basic: Resume from saved progress

```typescript
const service = createContentAccessService(ctx.env);

// Check if user has previous progress
const progress = await service.getPlaybackProgress(userId, {
  contentId: 'content-123',
});

if (progress) {
  // User has watched this before
  console.log(`Resume at ${progress.positionSeconds}s`);
  console.log(`${progress.percentComplete}% complete`);
} else {
  // First time watching
  console.log('Start from beginning');
}
```

### Advanced: User library with filters

```typescript
const service = createContentAccessService(ctx.env);

// Get page 2 of in-progress content, sorted by title
const libraryPage = await service.listUserLibrary(userId, {
  page: 2,
  limit: 20,
  filter: 'in-progress', // Only unwatched/partially watched
  sortBy: 'title', // A-Z
});

libraryPage.items.forEach(item => {
  console.log(`${item.content.title}`);
  if (item.progress) {
    console.log(`  ${item.progress.percentComplete}% watched`);
  } else {
    console.log(`  Not started`);
  }
});

console.log(`Page ${libraryPage.pagination.page} of ${libraryPage.pagination.totalPages}`);
```

### Advanced: Pagination with all options

```typescript
const service = createContentAccessService(ctx.env);

// Paginate through all completed purchases, sorted by duration
const completed = await service.listUserLibrary(userId, {
  page: 1,
  limit: 50,
  filter: 'completed',
  sortBy: 'duration', // Longest first
});

// Loop through all pages
let currentPage = 1;
let hasMore = true;

while (hasMore) {
  const page = await service.listUserLibrary(userId, {
    page: currentPage,
    limit: 50,
    filter: 'completed',
    sortBy: 'recent',
  });

  // Process items
  page.items.forEach(item => {
    console.log(`Completed: ${item.content.title}`);
  });

  hasMore = currentPage < page.pagination.totalPages;
  currentPage++;
}
```

### Error handling: Access denied

```typescript
import { AccessDeniedError } from '@codex/access';

const service = createContentAccessService(ctx.env);

try {
  const result = await service.getStreamingUrl(userId, {
    contentId: 'content-123',
    expirySeconds: 3600,
  });
  return { streamingUrl: result.streamingUrl };
} catch (error) {
  if (error instanceof AccessDeniedError) {
    // User doesn't have access - needs to purchase or join org
    return ctx.json({
      error: 'Access denied',
      code: 'ACCESS_DENIED',
      status: 403,
    }, 403);
  }
  throw error;
}
```

### Error handling: Content not found

```typescript
import { ContentNotFoundError } from '@codex/access';

try {
  const result = await service.getStreamingUrl(userId, {
    contentId: 'content-missing',
    expirySeconds: 3600,
  });
} catch (error) {
  if (error instanceof ContentNotFoundError) {
    // Content doesn't exist, is draft, or deleted
    return ctx.json({
      error: 'Content not found',
      code: 'NOT_FOUND',
      status: 404,
    }, 404);
  }
  throw error;
}
```

### Error handling: R2 signing failure

```typescript
import { R2SigningError } from '@codex/access';

try {
  const result = await service.getStreamingUrl(userId, {
    contentId: 'content-123',
    expirySeconds: 3600,
  });
} catch (error) {
  if (error instanceof R2SigningError) {
    // Infrastructure error - R2 signing failed
    console.error('R2 signing failure:', error.message);
    return ctx.json({
      error: 'Streaming unavailable',
      code: 'STREAMING_ERROR',
      status: 503,
    }, 503);
  }
  throw error;
}
```

## Access Control Model

### Free Content (priceCents = 0)

Any authenticated user can stream free content. No purchase or organization membership required. Access check is simple: if priceCents = 0, grant access.

### Paid Content (priceCents > 0)

Paid content requires one of:

1. **Purchase** - User has entry in contentAccess table with accessType='purchased'
2. **Organization Membership** - Content belongs to organization and user has active membership
3. **Denied** - Neither purchase nor org membership → AccessDeniedError

Access flow for paid content:
```
if (content.priceCents > 0) {
  // Check purchase
  const purchase = find contentAccess where userId=X, contentId=Y, accessType=purchased
  if (purchase) return GRANT

  // Check org membership
  if (!content.organizationId) return DENY // Personal paid content requires purchase
  const membership = find organizationMemberships where orgId=X, userId=Y, status=active
  if (membership) return GRANT

  return DENY
}
```

### Scope Enforcement

All database queries include row-level filtering:
- Content queries: No user_id filter (any user can access any published content for free/purchase verification)
- Playback progress: Filtered by userId (only user can see their own progress)
- Organization membership: Checked by content's organizationId (prevents access through unrelated org membership)
- Purchase verification: Filtered by userId (only user's own purchases count)

## Streaming URLs & R2 Integration

### Presigned URL Generation

Signed URLs are generated via R2 (S3-compatible AWS SDK):
- Generated with specified expiry (default 3600 seconds = 1 hour)
- Format: `https://{bucket-name}.r2.cloudflarestorage.com/{r2-key}?X-Amz-Signature=...&X-Amz-Date=...`
- Contains querystring authentication (AWS Signature V4)
- Can be used by unauthenticated clients once signed URL is obtained

### Media Storage Structure

Media stored in R2 with key structure:
- Original file: `originals/{content-id}.{ext}`
- HLS master playlist: `hls/{content-id}/master.m3u8`
- HLS segments: `hls/{content-id}/segment-{n}.ts`
- Thumbnail: `thumbnails/{content-id}.jpg`

Service streams from media_item.r2_key (usually the HLS master playlist for adaptive bitrate).

### Expiry Management

- URLs expire at specified time
- Web frontend should refresh URL before expiry
- HLS adapts bit rate based on network conditions
- Rate limiting prevents excessive URL refreshes (see content-api worker)

## Playback Progress Tracking

### Recording Progress

Progress is recorded via upsert pattern with optimistic concurrency control:
- Unique constraint: (userId, contentId)
- On insert conflict, update to MAX(current_position, new_position)
- Prevents backwards-seeking overwrites (forward-only progress tracking)
- Completion flag is ORed (once set to true, stays true)

### Auto-Completion

Content automatically marked as completed when watched >= 95% of duration:
```
if (positionSeconds >= durationSeconds * 0.95) {
  completed = true
}
```

### Resume Functionality

- getPlaybackProgress() returns null if content never watched
- Frontend checks response: null → start from 0%, non-null → resume from positionSeconds
- Progress updated on every seek/pause event from client
- Safe for high-frequency updates due to upsert pattern

### Watch Duration Accuracy

Progress tracks seconds watched, not real elapsed time. Duration stored at save-time to handle content re-edits.

## User Library Response

### Library Listing

Library shows all completed purchases (purchases.status='completed') with:
- Content metadata (title, description, duration, thumbnail)
- Purchase info (purchasedAt, priceCents)
- Playback progress if content has been watched (null if never started)
- Computed percentComplete (0-100 range)

### Filters

- `all` - Show all purchased content (default)
- `in-progress` - Show content with progress where completed=false
- `completed` - Show content where progress.completed=true

### Sorting

- `recent` - By purchase date, newest first (default)
- `title` - Alphabetically A-Z
- `duration` - Longest first

### Pagination

- Page-based pagination (1-indexed)
- Default 20 items per page
- Response includes total count and totalPages
- Fetches limit+1 to detect if more pages exist (cursor pattern)

## Integration Points

### Depends On

| Package | Why |
|---------|-----|
| `@codex/database` | Queries content, purchases, contentAccess, videoPlayback, organizationMemberships tables |
| `@codex/cloudflare-clients` | R2Service for presigned URL generation |
| `@codex/observability` | Logging and monitoring |
| `@codex/service-errors` | ServiceError base classes for error handling |
| `@codex/validation` | Zod schemas for input validation |

### Used By

| Component | Usage |
|-----------|-------|
| `content-api` worker | All streaming and library endpoints (POST /access/content/:id/stream, etc.) |
| Test suites | @codex/access integration tests |

### Database Tables

| Table | Operations | Purpose |
|-------|-----------|---------|
| `content` | SELECT | Find content, check published status |
| `media_items` | SELECT | Get R2 key, media type, duration |
| `purchases` | SELECT | Verify user purchases (access via contentAccess) |
| `content_access` | SELECT | Verify purchased content |
| `video_playback` | SELECT, INSERT, UPDATE | Track playback progress |
| `organization_memberships` | SELECT | Verify org member access to paid content |

## Error Handling

### AccessDeniedError

Thrown when user lacks permission to access paid content.

```typescript
export class AccessDeniedError extends ServiceError {
  // HTTP 403
  // Code: ACCESS_DENIED
}
```

**When thrown**:
- Paid content (priceCents > 0)
- User has no purchase (contentAccess with accessType='purchased')
- Content belongs to organization but user not active member
- OR content is personal paid content and no purchase exists

**Handling**:
```typescript
catch (error) {
  if (error instanceof AccessDeniedError) {
    // User needs to purchase or join organization
    return ctx.json({
      error: 'Access denied',
      status: 403
    }, 403);
  }
}
```

**Context data**:
- `userId: string` - User who attempted access
- `contentId: string` - Content being accessed
- `priceCents?: number` - Price of content if relevant
- `organizationId?: string` - Organization that owns content

### R2SigningError

Thrown when R2 presigned URL generation fails.

```typescript
export class R2SigningError extends InternalServiceError {
  // HTTP 500
  // Code: R2_SIGNING_ERROR
}
```

**When thrown**:
- R2 API call fails (network, auth, bucket issues)
- R2 key is missing from media_item
- R2 signing credentials invalid or expired

**Handling**:
```typescript
catch (error) {
  if (error instanceof R2SigningError) {
    // Infrastructure issue - not user's fault
    return ctx.json({
      error: 'Streaming temporarily unavailable',
      status: 503,
    }, 503);
  }
}
```

### ContentNotFoundError

Thrown when content doesn't exist, is not published, or is deleted.

```typescript
// Re-exported from @codex/content
export class ContentNotFoundError extends NotFoundError {
  // HTTP 404
  // Code: NOT_FOUND
}
```

**When thrown**:
- Content ID doesn't exist
- Content status != 'published'
- Content deletedAt is not null
- Content has no associated media_item (can't stream)

**Handling**:
```typescript
catch (error) {
  if (error instanceof ContentNotFoundError) {
    return ctx.json({
      error: 'Content not found',
      status: 404,
    }, 404);
  }
}
```

### InvalidContentTypeError

Thrown when media type is not video or audio.

```typescript
export class InvalidContentTypeError extends InternalServiceError {
  // HTTP 500
  // Code: INVALID_CONTENT_TYPE
}
```

**When thrown**: Media type not in ['video', 'audio'] (defense-in-depth check)

### OrganizationMismatchError

Thrown when content doesn't belong to expected organization.

```typescript
export class OrganizationMismatchError extends ServiceError {
  // HTTP 403
  // Code: ORGANIZATION_MISMATCH
}
```

**When thrown**: Content.organizationId doesn't match expected org

## Security Model

### Authentication

All methods require authenticated userId from JWT token. Service does not validate JWT - caller must extract userId from verified JWT token in request middleware.

### Authorization

Row-level security via database queries:
- Playback progress: Filtered by userId (can only see own progress)
- Content access: Verified by purchase or org membership (anyone can see published content metadata)
- Organization membership: Checked at database level (only org members can access org's paid content)

### Input Validation

All inputs validated against Zod schemas before reaching service:
- contentId: UUID format validation in @codex/validation
- expirySeconds: Integer > 0, capped at 7200 (2 hours) to prevent excessive signed URL lifetime
- positionSeconds, durationSeconds: Non-negative integers
- Page/limit: Positive integers with reasonable bounds (max 100 items/page)

### Rate Limiting

Content-api worker applies rate limiting:
- Streaming URLs: 60 requests/minute (allows HLS segment refreshes)
- Playback progress: 100 requests/minute (standard API rate)
- Library listing: 100 requests/minute (standard API rate)

### Signed URLs

Presigned URLs use AWS Signature V4 with HMAC-SHA256. Only valid:
- From specified R2 bucket
- For specified object key (r2-key)
- Until expiration timestamp
- Cannot be forged without R2 secret key

### Observability

All access decisions logged with security event details:
- granted via purchase: userId, contentId, security context
- granted via org membership: userId, contentId, organizationId, membershipRole
- denied access: userId, contentId, reason, severity=MEDIUM, eventType=access_control
- R2 signing failure: contentId, r2Key, error details

## Testing

### Integration Test Structure

Tests use neon-testing for ephemeral test database per test file. Each test creates its own data (idempotent tests).

### Test Patterns

```typescript
import { ContentAccessService } from '@codex/access';
import { setupTestDatabase, seedTestUsers } from '@codex/test-utils';
import { ObservabilityClient } from '@codex/observability';
import { createR2SigningClientFromEnv } from '@codex/cloudflare-clients';

// Setup
const db = setupTestDatabase();
const r2Client = createR2SigningClientFromEnv(); // Real signing for tests
const obs = new ObservabilityClient('content-access-test', 'test');

const service = new ContentAccessService({
  db,
  r2: r2Client,
  obs,
});

// Test: Free content accessible to anyone
const freeContent = await contentService.create({
  priceCents: 0, // Free!
  // ... other fields
}, userId);

const result = await service.getStreamingUrl(otherUserId, {
  contentId: freeContent.id,
  expirySeconds: 3600,
});

expect(result.streamingUrl).toContain('r2.cloudflarestorage.com');
expect(result.contentType).toBe('video');
```

### Testing Access Control

- **Free content**: Any user can stream
- **Paid content without purchase**: Throws AccessDeniedError
- **Paid content with purchase**: User can stream
- **Org paid content**: Member can stream, non-member denied
- **Personal paid content**: Only purchaser can stream

### Testing Playback Progress

- **Save progress**: Upsert works on first save
- **Update progress**: Forward progress updates, backwards skips ignored (GREATEST)
- **Auto-completion**: Completion at 95% threshold works
- **Resume**: getPlaybackProgress returns saved progress
- **No history**: Returns null for unwatched content

### Testing Library

- **Empty library**: Returns empty items array for new user
- **Pagination**: Correct offset/limit applied
- **Filtering**: in-progress/completed filters work correctly
- **Sorting**: recent/title/duration sorts apply correctly
- **Progress included**: Library items include progress if watched

### Unit Test Utilities

Service can be tested with mocked R2Signer:
```typescript
const mockR2: R2Signer = {
  generateSignedUrl: async (key, expirySeconds) => {
    return `https://example.com/mocked?key=${key}&expiry=${expirySeconds}`;
  }
};

const service = new ContentAccessService({
  db,
  r2: mockR2,
  obs,
});
```

### Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

## Performance Considerations

### Playback Progress Upsert

Uses database-side concurrency control (MAX function) to prevent backwards overwrites without application-level locking. Safe for high-frequency updates from multiple devices/tabs.

```typescript
// Upsert with optimistic concurrency:
.onConflictDoUpdate({
  set: {
    positionSeconds: sql`GREATEST(${videoPlayback.positionSeconds}, ${newPosition})`,
    completed: sql`${videoPlayback.completed} OR ${isCompleted}`,
  }
})
```

### Library Listing Optimization

1. Single purchase query with relations (limit + 1 for cursor detection)
2. Batch fetch progress for all content IDs (single query)
3. In-memory filtering/sorting (after fetched from DB)
4. Reduces N+1 query patterns to 2 queries max

### Transaction Isolation

Streaming URL access verification uses read-committed isolation with read-only transaction flag for consistent snapshot without locking.

### Streaming URL Caching

Signed URLs expire regularly (typically 1 hour). Browsers/clients should cache URLs up to expiration to reduce API calls.

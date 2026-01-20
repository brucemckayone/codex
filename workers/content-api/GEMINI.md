# Content-API Worker

## Overview

RESTful API for content lifecycle management, media handling, streaming, and access control. Provides creators with endpoints to manage videos/audio content, handle media transcoding pipeline coordination, publish/unpublish workflows, generate time-limited streaming URLs for authenticated users, and track playback progress.

**Primary Responsibility**: Content and media lifecycle, access control, streaming URL generation, playback tracking.

**Deployment Target**: `content-api.revelations.studio` (production), port 4001 (development).

**Key Features**:
- Content CRUD with draft → published lifecycle
- Media item management with transcoding status tracking
- Access control verification (free content vs purchased vs organization membership)
- Time-limited signed R2 streaming URLs with customizable expiration
- Playback progress tracking for resume functionality
- User library listing with purchase and progress metadata

---

## Architecture

### Route Structure

**Three route modules** mounted on separate paths:

| Module | Path | Responsibility |
|--------|------|---|
| `content.ts` | `/api/content` | Content CRUD, publish/unpublish lifecycle |
| `media.ts` | `/api/media` | Media item CRUD, upload-complete coordination |
| `content-access.ts` | `/api/access` | Streaming URLs, playback progress, user library |

### Middleware Chain

All routes inherit middleware from `createWorker()` factory in `index.ts`:

1. **Request Tracking**: Assigns UUID `x-request-id` for tracing, logs client IP and user agent
2. **Environment Validation**: Verifies required bindings and secrets on first request
3. **CORS**: Global CORS enabled (configurable origins via `enableCors: true`)
4. **Security Headers**: CSP, X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security
5. **Error Sanitization**: All error responses strip internal details, expose only user-safe messages
6. **Health Check Endpoint**: GET /health returns status of database, KV, R2 (public, no auth)

Route-level authentication and authorization enforced via `procedure()` policy configuration (declared per-endpoint).

### Service Instantiation

**Services created per-request** via procedure context injection:

- `ContentService` - Business logic for content operations (create, get, update, publish, delete)
- `MediaItemService` - Business logic for media operations (create, get, update, delete)
- `ContentAccessService` - Access verification, streaming URL generation, playback tracking

**Database Client**: `dbHttp` (HTTP wrapper around PostgreSQL via `@codex/database`)

**External Services**: R2Service for signed URL generation, observability client for logging

### Health Checks

Configured in `index.ts`, endpoint: GET /health

| Check | Type | Requirement |
|-------|------|---|
| Database | HTTP connection to Neon PostgreSQL | 5sec timeout |
| Rate Limit KV | Cloudflare KV namespace write/read | Confirms KV available |
| R2 Media Bucket | Cloudflare R2 bucket list operation | Confirms credentials valid |

Returns 200 OK if all healthy, 503 Service Unavailable if any fails.

---

## Public Endpoints

### Content Management - `/api/content`

#### POST /api/content
**Create new content item**

**Authentication**: Required (authenticated user with creator/admin role)

**Rate Limit**: API preset (100 requests/minute)

**Request Body** (`createContentSchema`):
```json
{
  "title": "string (1-255 chars)",
  "slug": "string (lowercase, alphanumeric + hypens, url-safe)",
  "description": "string | null (0-5000 chars)",
  "contentType": "video" | "audio" | "written",
  "mediaItemId": "uuid | null (required for video/audio)",
  "contentBody": "string | null (for written content)",
  "category": "string | null",
  "tags": "string[] (array of strings)",
  "thumbnailUrl": "string | null (valid URL)",
  "visibility": "public" | "purchased_only" | "members_only",
  "priceCents": "number | null (>= 0, required if purchased_only)",
  "organizationId": "uuid | null"
}
```

**Response** (201 Created):
```json
{
  "data": {
    "id": "uuid",
    "creatorId": "uuid (authenticated user)",
    "organizationId": "uuid | null",
    "mediaItemId": "uuid | null",
    "title": "string",
    "slug": "string",
    "description": "string | null",
    "contentType": "video" | "audio" | "written",
    "contentBody": "string | null",
    "category": "string | null",
    "tags": "string[]",
    "thumbnailUrl": "string | null",
    "visibility": "public" | "purchased_only" | "members_only",
    "priceCents": "number | null",
    "status": "draft",
    "viewCount": 0,
    "purchaseCount": 0,
    "publishedAt": null,
    "createdAt": "ISO 8601",
    "updatedAt": "ISO 8601",
    "deletedAt": null
  }
}
```

**Authorization**: Creator must own content (enforced via creatorId scoping)

**Validation**:
- Title: 1-255 characters
- Slug: unique per organization, lowercase alphanumeric + hyphens
- If contentType is video/audio: mediaItemId required
- If visibility is purchased_only: priceCents required (> 0)
- Tags: array of strings, max 10 tags

**Error Responses**:
- `400 Bad Request` - Validation failed (title too long, slug invalid format, missing required fields)
- `404 Not Found` - Referenced media item doesn't exist or not owned by creator
- `409 Conflict` - Slug already exists for organization
- `422 Unprocessable Entity` - Media item type mismatch (e.g., audio media with video content type)

---

#### GET /api/content/:id
**Get content by ID with full metadata**

**Authentication**: Required (any authenticated user)

**Rate Limit**: API preset (100 requests/minute)

**URL Parameters**:
- `id` (string, UUID) - Content ID

**Response** (200 OK):
```json
{
  "data": {
    "id": "uuid",
    "creatorId": "uuid",
    "organizationId": "uuid | null",
    "mediaItemId": "uuid | null",
    "title": "string",
    "slug": "string",
    "description": "string | null",
    "contentType": "video" | "audio" | "written",
    "contentBody": "string | null",
    "category": "string | null",
    "tags": "string[]",
    "thumbnailUrl": "string | null",
    "visibility": "public" | "purchased_only" | "members_only",
    "priceCents": "number | null",
    "status": "draft" | "published",
    "viewCount": "number",
    "purchaseCount": "number",
    "publishedAt": "ISO 8601 | null",
    "createdAt": "ISO 8601",
    "updatedAt": "ISO 8601",
    "deletedAt": "ISO 8601 | null",
    "mediaItem": {
      "id": "uuid",
      "creatorId": "uuid",
      "title": "string",
      "description": "string | null",
      "mediaType": "video" | "audio",
      "status": "uploading" | "uploaded" | "transcoding" | "ready" | "failed",
      "r2Key": "string (path in R2 bucket)",
      "fileSizeBytes": "number",
      "mimeType": "string (video/mp4, audio/mpeg, etc.)",
      "hlsPlaylistKey": "string | null (path to .m3u8 file)",
      "thumbnailKey": "string | null (path to thumbnail image)",
      "durationSeconds": "number | null",
      "width": "number | null (video only)",
      "height": "number | null (video only)",
      "createdAt": "ISO 8601",
      "updatedAt": "ISO 8601",
      "deletedAt": "ISO 8601 | null"
    } | null,
    "creator": {
      "id": "uuid",
      "email": "string",
      "name": "string | null"
    },
    "organization": {
      "id": "uuid",
      "slug": "string",
      "name": "string"
    } | null
  }
}
```

**Authorization**: User must own content (creator scoping enforced via ContentService.get)

**Error Responses**:
- `404 Not Found` - Content doesn't exist, is deleted, or not owned by authenticated user
- `401 Unauthorized` - User not authenticated

---

#### PATCH /api/content/:id
**Update content metadata**

**Authentication**: Required (creator/admin role, must own content)

**Rate Limit**: API preset (100 requests/minute)

**URL Parameters**:
- `id` (string, UUID) - Content ID

**Request Body** (`updateContentSchema`, all fields optional):
```json
{
  "title": "string (1-255 chars) | null",
  "slug": "string (url-safe) | null",
  "description": "string (0-5000 chars) | null",
  "contentBody": "string | null (for written content)",
  "category": "string | null",
  "tags": "string[]",
  "thumbnailUrl": "string | null (valid URL)",
  "visibility": "public" | "purchased_only" | "members_only",
  "priceCents": "number | null (>= 0)"
}
```

**Response** (200 OK): Same structure as GET endpoint

**Authorization**: User must own content

**Validation**:
- Slug: must be unique (if changed)
- Visibility change to purchased_only requires priceCents > 0
- Cannot change slug of published content

**Error Responses**:
- `400 Bad Request` - Invalid update data (slug format, price validation)
- `404 Not Found` - Content doesn't exist or not owned by creator
- `409 Conflict` - New slug conflicts with existing content
- `422 Unprocessable Entity` - Cannot update slug of published content

---

#### GET /api/content
**List user's content with pagination and filtering**

**Authentication**: Required

**Rate Limit**: API preset (100 requests/minute)

**Query Parameters** (`contentQuerySchema`):
```
?page=number (default: 1, min: 1)
&limit=number (default: 20, max: 100)
&search=string (filters title or slug substring)
&contentType=video|audio|written (single value)
&status=draft|published (single value)
&tags=string,string (comma-separated, matches any tag)
&visibility=public|purchased_only|members_only (single value)
&sortBy=createdAt|updatedAt|publishedAt|title (default: createdAt)
&sortOrder=asc|desc (default: desc)
```

**Response** (200 OK):
```json
{
  "items": [
    {
      "id": "uuid",
      "title": "string",
      "slug": "string",
      "description": "string | null",
      "contentType": "video" | "audio" | "written",
      "status": "draft" | "published",
      "viewCount": "number",
      "purchaseCount": "number",
      "publishedAt": "ISO 8601 | null",
      "createdAt": "ISO 8601",
      "updatedAt": "ISO 8601",
      "mediaItem": { ... } | null,
      "creator": { ... },
      "organization": { ... } | null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 145,
    "totalPages": 8
  }
}
```

**Scoping**: Only returns content created by authenticated user (creator scoping via ContentService.list)

**Error Responses**:
- `400 Bad Request` - Invalid page/limit values or sort parameter
- `401 Unauthorized` - User not authenticated

---

#### POST /api/content/:id/publish
**Publish content (transition from draft to published)**

**Authentication**: Required (creator/admin, must own content)

**Rate Limit**: API preset (100 requests/minute)

**URL Parameters**:
- `id` (string, UUID) - Content ID

**Request Body**: Empty

**Response** (200 OK):
```json
{
  "data": {
    "id": "uuid",
    "status": "published",
    "publishedAt": "ISO 8601 (current timestamp)",
    ...full content object
  }
}
```

**Publish Conditions**:
- Content must be in draft status
- If mediaItemId provided: media item must be in 'ready' status
- Title, slug, and contentType must be populated
- If visibility is purchased_only: priceCents must be > 0

**Side Effects**: Sets publishedAt timestamp, content becomes queryable by other users

**Error Responses**:
- `404 Not Found` - Content doesn't exist
- `422 Unprocessable Entity` - Content already published
- `422 Unprocessable Entity` - Media item not ready (status not 'ready')
- `422 Unprocessable Entity` - Missing required fields for publishing

---

#### POST /api/content/:id/unpublish
**Unpublish content (revert from published to draft)**

**Authentication**: Required (creator/admin, must own content)

**Rate Limit**: API preset (100 requests/minute)

**URL Parameters**:
- `id` (string, UUID) - Content ID

**Request Body**: Empty

**Response** (200 OK):
```json
{
  "data": {
    "id": "uuid",
    "status": "draft",
    "publishedAt": null,
    ...full content object
  }
}
```

**Side Effects**: Clears publishedAt timestamp, content hidden from public discovery

**Error Responses**:
- `404 Not Found` - Content doesn't exist
- `422 Unprocessable Entity` - Content not currently published

---

#### DELETE /api/content/:id
**Soft delete content (sets deleted_at timestamp)**

**Authentication**: Required (creator/admin, must own content)

**Rate Limit**: Strict preset (5 requests/15 minutes) to prevent accidental deletion

**URL Parameters**:
- `id` (string, UUID) - Content ID

**Request Body**: Empty

**Response** (204 No Content): Empty body (no content returned)

**Soft Delete Behavior**: Sets deleted_at timestamp, content remains in database for audit/recovery

**Side Effects**: Content no longer returned in list queries, not accessible via GET by ID

**Error Responses**:
- `404 Not Found` - Content doesn't exist or already deleted
- `429 Too Many Requests` - Rate limit exceeded (5 per 15 minutes)

---

### Media Management - `/api/media`

#### POST /api/media
**Create media item (called after file upload to R2)**

**Authentication**: Required (creator/admin role)

**Rate Limit**: API preset (100 requests/minute)

**Request Body** (`createMediaItemSchema`):
```json
{
  "title": "string (1-255 chars)",
  "description": "string | null (0-5000 chars)",
  "mediaType": "video" | "audio",
  "r2Key": "string (path in R2 bucket, e.g., 'uploads/user-123/file.mp4')",
  "fileSizeBytes": "number (> 0)",
  "mimeType": "string (video/mp4, audio/mpeg, etc.)"
}
```

**Response** (201 Created):
```json
{
  "data": {
    "id": "uuid",
    "creatorId": "uuid (authenticated user)",
    "title": "string",
    "description": "string | null",
    "mediaType": "video" | "audio",
    "status": "uploading",
    "r2Key": "string",
    "fileSizeBytes": "number",
    "mimeType": "string",
    "hlsPlaylistKey": null,
    "thumbnailKey": null,
    "durationSeconds": null,
    "width": null,
    "height": null,
    "createdAt": "ISO 8601",
    "updatedAt": "ISO 8601",
    "deletedAt": null
  }
}
```

**Lifecycle**: Status progresses as transcoding service processes:
- `uploading` → `uploaded` → `transcoding` → `ready` or `failed`

**Authorization**: User must be creator/admin

**Validation**:
- mediaType: 'video' or 'audio' only
- fileSizeBytes: positive number
- mimeType: valid MIME type string

**Error Responses**:
- `400 Bad Request` - Invalid mediaType, mimeType, or fileSizeBytes
- `422 Unprocessable Entity` - Invalid R2 key format

---

#### GET /api/media/:id
**Get media item by ID**

**Authentication**: Required

**Rate Limit**: API preset (100 requests/minute)

**URL Parameters**:
- `id` (string, UUID) - Media ID

**Response** (200 OK):
```json
{
  "data": {
    "id": "uuid",
    "creatorId": "uuid",
    "title": "string",
    "description": "string | null",
    "mediaType": "video" | "audio",
    "status": "uploading" | "uploaded" | "transcoding" | "ready" | "failed",
    "r2Key": "string",
    "fileSizeBytes": "number",
    "mimeType": "string",
    "hlsPlaylistKey": "string | null (populated after transcoding)",
    "thumbnailKey": "string | null (populated after transcoding)",
    "durationSeconds": "number | null (populated after transcoding)",
    "width": "number | null (video only, populated after transcoding)",
    "height": "number | null (video only, populated after transcoding)",
    "createdAt": "ISO 8601",
    "updatedAt": "ISO 8601",
    "deletedAt": "ISO 8601 | null",
    "creator": {
      "id": "uuid",
      "email": "string",
      "name": "string | null"
    }
  }
}
```

**Authorization**: User must own media (creator scoping enforced)

**Error Responses**:
- `404 Not Found` - Media doesn't exist or not owned by user
- `401 Unauthorized` - User not authenticated

---

#### PATCH /api/media/:id
**Update media metadata**

**Authentication**: Required (creator/admin, must own media)

**Rate Limit**: API preset (100 requests/minute)

**URL Parameters**:
- `id` (string, UUID) - Media ID

**Request Body** (`updateMediaItemSchema`, all optional):
```json
{
  "title": "string (1-255 chars) | null",
  "description": "string (0-5000 chars) | null",
  "status": "uploading" | "uploaded" | "transcoding" | "ready" | "failed",
  "hlsPlaylistKey": "string | null (path to .m3u8 file)",
  "thumbnailKey": "string | null (path to thumbnail image)",
  "durationSeconds": "number | null",
  "width": "number | null (video only)",
  "height": "number | null (video only)"
}
```

**Response** (200 OK): Same as GET endpoint

**Note**: Typically updated by transcoding service via internal worker-to-worker requests, not by users directly

**Authorization**: User must own media

**Error Responses**:
- `404 Not Found` - Media doesn't exist or not owned by user
- `400 Bad Request` - Invalid update data

---

#### GET /api/media
**List user's media items with pagination and filtering**

**Authentication**: Required

**Rate Limit**: API preset (100 requests/minute)

**Query Parameters** (`mediaQuerySchema`):
```
?page=number (default: 1, min: 1)
&limit=number (default: 20, max: 100)
&search=string (filters title substring)
&mediaType=video|audio (single value)
&status=uploading|uploaded|transcoding|ready|failed (single value)
&sortBy=createdAt|updatedAt|title (default: createdAt)
&sortOrder=asc|desc (default: desc)
```

**Response** (200 OK):
```json
{
  "items": [
    {
      "id": "uuid",
      "title": "string",
      "description": "string | null",
      "mediaType": "video" | "audio",
      "status": "uploading" | "uploaded" | "transcoding" | "ready" | "failed",
      "r2Key": "string",
      "fileSizeBytes": "number",
      "mimeType": "string",
      "durationSeconds": "number | null",
      "width": "number | null",
      "height": "number | null",
      "createdAt": "ISO 8601",
      "updatedAt": "ISO 8601",
      "deletedAt": "ISO 8601 | null",
      "creator": { ... }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3
  }
}
```

**Scoping**: Only returns media created by authenticated user

**Error Responses**:
- `400 Bad Request` - Invalid pagination or filter parameters
- `401 Unauthorized` - User not authenticated

---

#### POST /api/media/:id/upload-complete
**Mark upload as complete and trigger transcoding pipeline**

**Authentication**: Required (creator/admin, must own media)

**Rate Limit**: API preset (100 requests/minute)

**URL Parameters**:
- `id` (string, UUID) - Media ID

**Request Body**: Empty

**Response** (200 OK):
```json
{
  "success": true,
  "status": "transcoding" | "uploaded"
}
```

**Orchestration Flow**:
1. Verify creator owns media and status is 'uploading'
2. Verify media item exists
3. Update status to 'uploaded' in database
4. Call external transcoding service via MEDIA_API_URL
   - Endpoint: POST {MEDIA_API_URL}/internal/media/{id}/transcode
   - Headers: X-Worker-Secret: {WORKER_SHARED_SECRET}
   - Body: { creatorId: "uuid" }
5. If transcoding call fails: Return success=true, status='uploaded' (transcoding can be retried)
6. If transcoding call succeeds: Return success=true, status='transcoding'

**Side Effects**:
- Updates media status: 'uploading' → 'uploaded'
- Triggers asynchronous transcoding via external worker
- Transcoding worker updates status: 'transcoding' → 'ready' or 'failed'

**Error Responses**:
- `404 Not Found` - Media doesn't exist
- `422 Unprocessable Entity` - Media not in 'uploading' status (already uploaded or failed)
- `500 Internal Server Error` - MEDIA_API_URL not configured (environment issue)

---

#### DELETE /api/media/:id
**Soft delete media item**

**Authentication**: Required (creator/admin, must own media)

**Rate Limit**: Strict preset (5 requests/15 minutes)

**URL Parameters**:
- `id` (string, UUID) - Media ID

**Request Body**: Empty

**Response** (204 No Content): Empty body

**Soft Delete Behavior**: Sets deleted_at timestamp, does NOT delete file from R2

**Side Effects**: Media no longer returned in list queries, associated content cannot be published

**Error Responses**:
- `404 Not Found` - Media doesn't exist or already deleted
- `429 Too Many Requests` - Rate limit exceeded

---

### Content Access & Streaming - `/api/access`

#### GET /api/access/content/:id/stream
**Generate time-limited signed streaming URL**

**Authentication**: Required

**Rate Limit**: Streaming preset (60 requests/minute) to allow HLS segment refreshes while preventing abuse

**URL Parameters**:
- `id` (string, UUID) - Content ID

**Query Parameters** (`getStreamingUrlSchema`):
```
?expirySeconds=number (optional, default: 3600, range: 60-86400)
```

**Response** (200 OK):
```json
{
  "streamingUrl": "https://r2-bucket.s3.amazonaws.com/path/to/file.m3u8?X-Amz-Algorithm=AWS4-HMAC-SHA256&...",
  "expiresAt": "ISO 8601 (current time + expirySeconds)",
  "contentType": "video" | "audio"
}
```

**Access Control Flow**:
1. Verify content exists and is published
2. Verify content is not deleted
3. If visibility = 'public': Grant access
4. If visibility = 'purchased_only': Check content_access table for user's purchase
5. If visibility = 'members_only': Check if user is org member
6. If access denied: Return 403 Forbidden
7. If access granted: Generate signed R2 URL (HMAC-SHA256)
8. Return URL with expiry time

**URL Signing**: Uses AWS SigV4 via R2Service.generateSignedUrl()
- Signature includes object path, query parameters, timestamp
- Browser/client cannot forge valid URLs (requires R2 secret key)
- Time-limited: Requestor must download/stream within expirySeconds

**Error Responses**:
- `404 Not Found` - Content doesn't exist, is draft, or is deleted
- `403 Forbidden` - User hasn't purchased content and isn't org member
- `500 Internal Server Error` - Failed to generate signed URL (R2 error)

---

#### POST /api/access/content/:id/progress
**Save playback progress (track resume position)**

**Authentication**: Required

**Rate Limit**: API preset (100 requests/minute)

**URL Parameters**:
- `id` (string, UUID) - Content ID

**Request Body** (`savePlaybackProgressSchema`):
```json
{
  "positionSeconds": "number (>= 0, current playback position)",
  "durationSeconds": "number (> 0, total content duration)",
  "completed": "boolean (true if user finished watching)"
}
```

**Response** (204 No Content): Empty body (successful update, no content needed)

**Storage**: Stored in `video_playback` table, scoped to (userId, contentId) pair

**Upsert Behavior**: Updates existing progress record if exists, creates new if first progress save

**Use Cases**:
- Resume playback: Client calls GET progress, seeks to positionSeconds
- Track completion: Client sends completed=true when user finishes
- Progress tracking: Enables library features like "Continue watching" section

**Error Responses**:
- `404 Not Found` - Content doesn't exist
- `400 Bad Request` - Invalid position/duration (negative or duration=0)
- `422 Unprocessable Entity` - Position > duration

---

#### GET /api/access/content/:id/progress
**Get playback progress for content**

**Authentication**: Required

**Rate Limit**: API preset (100 requests/minute)

**URL Parameters**:
- `id` (string, UUID) - Content ID

**Response** (200 OK):
```json
{
  "progress": {
    "positionSeconds": "number (current playback position)",
    "durationSeconds": "number (total duration)",
    "completed": "boolean",
    "updatedAt": "ISO 8601 (timestamp of last progress update)"
  } | null
}
```

**Returns null** if user hasn't started watching this content

**Scoping**: Returns progress only for authenticated user (scoped via userId)

**Error Responses**:
- `404 Not Found` - Content doesn't exist
- `401 Unauthorized` - User not authenticated

---

#### GET /api/access/user/library
**List user's content library (purchased + organization + free content)**

**Authentication**: Required

**Rate Limit**: API preset (100 requests/minute)

**Query Parameters** (`listUserLibrarySchema`):
```
?page=number (default: 1, min: 1)
&limit=number (default: 20, max: 100)
&search=string (filters content title substring)
&contentType=video|audio|written (single value)
&sortBy=createdAt|purchasedAt|title (default: createdAt)
&sortOrder=asc|desc (default: desc)
```

**Response** (200 OK):
```json
{
  "items": [
    {
      "content": {
        "id": "uuid",
        "title": "string",
        "slug": "string",
        "description": "string | null",
        "thumbnailUrl": "string | null",
        "contentType": "video" | "audio" | "written",
        "durationSeconds": "number | null (video/audio only)",
        "visibility": "public" | "purchased_only" | "members_only"
      },
      "purchase": {
        "purchasedAt": "ISO 8601",
        "priceCents": "number"
      } | null,
      "progress": {
        "positionSeconds": "number",
        "durationSeconds": "number",
        "completed": "boolean",
        "percentComplete": "number (0-100)",
        "updatedAt": "ISO 8601"
      } | null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 15,
    "totalPages": 1
  }
}
```

**Library Contents**:
- Purchased content: Records in content_access table with access_type='purchased'
- Free public content: All public content (priceCents=0)
- Organization content: Content belonging to organizations user is member of
- Playback progress: Included if user has started watching (position > 0)

**Filtering**: Only returns published, non-deleted content

**Error Responses**:
- `400 Bad Request` - Invalid pagination or filter parameters
- `401 Unauthorized` - User not authenticated

---

## Content Lifecycle

### Draft → Published Flow

```
1. Creator calls POST /api/content
   ├─ ContentService creates content with status='draft'
   ├─ publishedAt = null
   └─ Content not visible to other users

2. Creator uploads media file to R2 directly (frontend-initiated)

3. Creator calls POST /api/media/:id/upload-complete
   ├─ Updates media status: uploading → uploaded
   └─ Triggers external transcoding service

4. Transcoding service processes media
   ├─ Converts to HLS (hlsPlaylistKey set)
   ├─ Extracts thumbnail (thumbnailKey set)
   ├─ Extracts metadata (duration, dimensions)
   └─ Updates media status: transcoding → ready

5. Creator calls PATCH /api/content/:id
   ├─ Updates title, description, pricing, visibility
   └─ Validates media is ready before allowing publish

6. Creator calls POST /api/content/:id/publish
   ├─ Verifies media status = 'ready'
   ├─ Sets status = 'published'
   ├─ Sets publishedAt = now()
   └─ Content visible to users (depending on visibility setting)

7. Viewers call GET /api/access/content/:id/stream
   ├─ Access control verified (free, purchased, org member)
   ├─ Signed R2 URL generated
   └─ Return streaming URL for HLS playback
```

### Media Status Progression

```
uploading
  ├─ File being uploaded to R2 by client
  └─ POST /api/media/:id/upload-complete triggers next state

uploaded
  ├─ File fully in R2
  └─ Transcoding service called, processes file

transcoding
  ├─ HLS conversion in progress
  ├─ Thumbnail extraction in progress
  └─ Status updated by transcoding service

ready
  ├─ All transcoding complete
  ├─ HLS playlist available at hlsPlaylistKey
  └─ Content can be published

failed
  └─ Transcoding error (corrupt file, unsupported codec, etc.)
```

---

## Security Model

### Authentication

**Default Policy**: All routes require valid authenticated session

**Session Verification** (via `@codex/security` middleware):
- Extracts `codex-session` cookie from request
- Calls Auth Worker GET /api/auth/session to validate
- Sets `ctx.user` with user data (id, email, role)
- Returns 401 Unauthorized if invalid or expired

**Session Caching**: Auth Worker caches sessions in KV (5min TTL) to reduce database load

### Authorization

**Role-Based Access Control**:

| Endpoint | Required Role | Additional Checks |
|----------|---|---|
| POST /api/content | creator, admin | User is creator (creatorId match) |
| GET /api/content/:id | (none) | User owns content |
| PATCH /api/content/:id | creator, admin | User owns content |
| DELETE /api/content/:id | creator, admin | User owns content |
| POST /api/content/:id/publish | creator, admin | User owns content, media ready |
| POST /api/content/:id/unpublish | creator, admin | User owns content |
| GET /api/content | (none) | Listed items scoped to user |
| POST /api/media | creator, admin | User is creator |
| GET /api/media/:id | (none) | User owns media |
| PATCH /api/media/:id | creator, admin | User owns media |
| DELETE /api/media/:id | creator, admin | User owns media |
| POST /api/media/:id/upload-complete | creator, admin | User owns media |
| GET /api/media | (none) | Listed items scoped to user |
| GET /api/access/content/:id/stream | (none) | Access verified via purchases/org membership |
| POST /api/access/content/:id/progress | (none) | Progress scoped to userId |
| GET /api/access/content/:id/progress | (none) | Progress scoped to userId |
| GET /api/access/user/library | (none) | Library scoped to userId |

**Creator Scoping**: All content and media queries filtered by creatorId in WHERE clause (cannot see other users' content)

**Purchase Verification**: ContentAccessService queries content_access table before generating streaming URL

**Organization Membership**: Checked when content visibility='members_only'

### Rate Limiting

**Presets** (from `@codex/security` RATE_LIMIT_PRESETS):

| Preset | Limit | Endpoints |
|--------|-------|-----------|
| api | 100/min | Content CRUD, media CRUD, progress, library |
| streaming | 60/min | Streaming URL generation (allows HLS segment refreshes) |
| strict | 5/15min | DELETE operations (content and media) |

**Implementation**: KV namespace `RATE_LIMIT_KV` for distributed rate limit tracking across worker instances

**Behavior**: Returns 429 Too Many Requests when limit exceeded

### Input Validation

**Zod Schemas** for request validation:

| Endpoint | Schema | Validates |
|----------|--------|-----------|
| POST /api/content | createContentSchema | title (1-255), slug (unique), mediaType match, pricing |
| PATCH /api/content | updateContentSchema | same as above for provided fields |
| GET /api/content | contentQuerySchema | page (1+), limit (1-100), sort fields, enum values |
| POST /api/media | createMediaItemSchema | mediaType (video/audio), fileSizeBytes (>0), mimeType |
| PATCH /api/media | updateMediaItemSchema | status enum, duration/dimensions (>0) |
| GET /api/media | mediaQuerySchema | page, limit, status enum, sort fields |
| GET /api/access/stream | getStreamingUrlSchema | expirySeconds (60-86400) |
| POST /api/access/progress | savePlaybackProgressSchema | positionSeconds, durationSeconds, position <= duration |
| GET /api/access/library | listUserLibrarySchema | page, limit, contentType enum |

**Error Response** (400 Bad Request):
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": [
      {
        "path": "title",
        "message": "String must contain at least 1 character(s)"
      }
    ]
  }
}
```

### Security Headers

Applied to all responses via worker middleware:

| Header | Value | Purpose |
|--------|-------|---------|
| Content-Security-Policy | Restricts resource loading | Prevents XSS attacks |
| X-Frame-Options | DENY | Prevents clickjacking |
| X-Content-Type-Options | nosniff | Prevents MIME type sniffing |
| Strict-Transport-Security | max-age=31536000 | Forces HTTPS (production only) |

### PII Handling

**Passwords**: Never logged or returned in responses. Hashed via bcrypt in Auth Worker.

**Email**: Stored in database, not included in error messages, returned only in user's own profile.

**User Data**: Returned in responses only to authenticated users for resources they own.

**Logs**: Request ID, IP, user agent tracked. Request/response bodies not logged (PII redaction).

---

## Error Handling

### Error Response Format

All errors follow consistent structure:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": { "optional": "context" }
  }
}
```

### Service Error Classes

| Error Class | Status | Code | When Thrown |
|-------------|--------|------|-------------|
| ContentNotFoundError | 404 | CONTENT_NOT_FOUND | Content doesn't exist or not owned by user |
| MediaNotFoundError | 404 | MEDIA_NOT_FOUND | Media doesn't exist or not owned by user |
| AccessDeniedError | 403 | ACCESS_DENIED | User hasn't purchased content and isn't org member |
| SlugConflictError | 409 | CONTENT_CONFLICT | Slug already exists for organization |
| MediaNotReadyError | 422 | MEDIA_NOT_READY | Media status not 'ready' for publishing |
| ContentTypeMismatchError | 422 | CONTENT_TYPE_MISMATCH | Content type doesn't match media type |
| ContentAlreadyPublishedError | 422 | ALREADY_PUBLISHED | Attempting to publish already-published content |
| BusinessLogicError | 422 | BUSINESS_LOGIC_ERROR | Generic business rule violation |
| R2SigningError | 500 | R2_SIGNING_ERROR | Failed to generate signed URL |
| InternalServiceError | 500 | INTERNAL_ERROR | Unexpected server error |

### Example Error Responses

**Validation Error** (400):
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": [
      {
        "path": "contentType",
        "message": "Invalid enum value. Expected 'video' | 'audio' | 'written'"
      }
    ]
  }
}
```

**Not Found** (404):
```json
{
  "error": {
    "code": "CONTENT_NOT_FOUND",
    "message": "Content not found",
    "details": {
      "contentId": "550e8400-e29b-41d4-a716-446655440000"
    }
  }
}
```

**Access Denied** (403):
```json
{
  "error": {
    "code": "ACCESS_DENIED",
    "message": "User does not have access to this content",
    "details": {
      "userId": "user-123",
      "contentId": "paid-video",
      "reason": "NOT_PURCHASED"
    }
  }
}
```

**Conflict** (409):
```json
{
  "error": {
    "code": "CONTENT_CONFLICT",
    "message": "Content with this slug already exists",
    "details": {
      "slug": "my-video",
      "organizationId": "org-123"
    }
  }
}
```

**Business Logic Error** (422):
```json
{
  "error": {
    "code": "MEDIA_NOT_READY",
    "message": "Media item not ready for publishing",
    "details": {
      "mediaItemId": "media-456",
      "currentStatus": "transcoding",
      "requiredStatus": "ready"
    }
  }
}
```

**Rate Limited** (429):
```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "details": {
      "retryAfterSeconds": 60
    }
  }
}
```

---

## Integration Points

### Services Used

**ContentService** (`@codex/content` package):
- All content CRUD operations
- Publish/unpublish transitions
- Soft delete with deletedAt tracking
- Query filtering by creatorId (automatic scoping)
- Enforces content state transitions (draft → published → deleted)

**MediaItemService** (`@codex/content` package):
- All media CRUD operations
- Status lifecycle management (uploading → ready)
- Soft delete (doesn't remove from R2)
- Scoped queries by creatorId

**ContentAccessService** (`@codex/access` package):
- Access control verification (free/purchased/org member)
- Streaming URL generation with AWS SigV4 signing
- Time-limited URL expiration handling
- Playback progress tracking (CRUD)

### Dependency Graph

```
content-api worker
  │
  ├─ ContentService (@codex/content)
  │  ├─ dbHttp (@codex/database)
  │  ├─ createContentSchema (@codex/validation)
  │  └─ ServiceErrors (@codex/service-errors)
  │
  ├─ MediaItemService (@codex/content)
  │  ├─ dbHttp (@codex/database)
  │  ├─ createMediaItemSchema (@codex/validation)
  │  └─ ServiceErrors (@codex/service-errors)
  │
  ├─ ContentAccessService (@codex/access)
  │  ├─ dbHttp (@codex/database)
  │  ├─ R2Service (@codex/cloudflare-clients)
  │  ├─ ObservabilityClient (@codex/observability)
  │  └─ ServiceErrors (@codex/service-errors)
  │
  ├─ Authentication (@codex/security)
  │  └─ Session validation via KV caching
  │
  ├─ Rate Limiting (@codex/security)
  │  └─ KV namespace (RATE_LIMIT_KV)
  │
  ├─ Worker Factory (@codex/worker-utils)
  │  ├─ procedure() handler
  │  ├─ createWorker() middleware chain
  │  └─ Health check utilities
  │
  └─ Types (@codex/shared-types)
     └─ HonoEnv, response types, user/context types
```

### Data Flow - Create Content Example

```
1. POST /api/content
   ↓
2. procedure() middleware chain
   ├─ Validate session (401 if invalid)
   ├─ Check role (403 if not creator/admin)
   └─ Validate body schema (400 if invalid)
   ↓
3. ContentService.create(validatedInput, userId)
   ├─ Check mediaItemId exists and owned by user (404 if not)
   ├─ Verify slug unique for organization (409 if conflict)
   ├─ Insert content record with status='draft'
   ├─ publishedAt = null
   └─ Return new content object
   ↓
4. procedure() returns response
   ├─ Status: 201 Created
   ├─ Body: Content object
   └─ Headers: Content-Type: application/json, security headers
```

### Data Flow - Get Streaming URL Example

```
1. GET /api/access/content/:id/stream?expirySeconds=3600
   ↓
2. procedure() middleware chain
   ├─ Validate session (401 if invalid)
   └─ Validate query params (400 if invalid)
   ↓
3. ContentAccessService.getStreamingUrl(userId, contentId, expirySeconds)
   ├─ Query content from database
   ├─ Verify published=true (404 if not published)
   ├─ Verify deleted_at is null (404 if deleted)
   ├─ Check visibility:
   │  ├─ If 'public': grant access
   │  ├─ If 'purchased_only': check content_access table (403 if not found)
   │  └─ If 'members_only': check org membership (403 if not member)
   ├─ If access denied: throw AccessDeniedError (403)
   ├─ Get mediaItem with hlsPlaylistKey
   ├─ Call R2Service.generateSignedUrl()
   │  ├─ Create AWS SigV4 request
   │  ├─ Sign with R2 secret key
   │  └─ Return presigned URL
   └─ Return { streamingUrl, expiresAt, contentType }
   ↓
4. procedure() returns response
   ├─ Status: 200 OK
   ├─ Body: { streamingUrl, expiresAt, contentType }
   └─ Headers: Cache-Control: no-cache (streaming URLs shouldn't be cached)
```

---

## Dependencies

### Core Packages

| Package | Version | Purpose | Key Exports |
|---------|---------|---------|-------------|
| @codex/content | workspace:* | Content and media services | ContentService, MediaItemService, schemas, errors |
| @codex/access | workspace:* | Content access control | ContentAccessService factory, streaming logic |
| @codex/database | workspace:* | PostgreSQL client | dbHttp, schema, query helpers |
| @codex/security | workspace:* | Auth and rate limiting | Session validation, rate limit presets |
| @codex/worker-utils | workspace:* | Worker factory and helpers | createWorker, procedure, health checks |
| @codex/shared-types | workspace:* | Shared types | HonoEnv, response types, user context |
| @codex/validation | workspace:* | Zod schemas | All request validation schemas |
| @codex/cloudflare-clients | workspace:* | Cloudflare service clients | R2Service for signed URLs |
| @codex/observability | workspace:* | Logging | ObservabilityClient |
| @codex/service-errors | workspace:* | Error handling | BaseService, error classes |
| hono | ^4.7.8 | Web framework | Router, middleware, context |

### Cloudflare Bindings

| Binding | Type | Purpose | Configuration |
|---------|------|---------|---|
| RATE_LIMIT_KV | KV Namespace | Rate limit counter storage | Shared across workers |
| MEDIA_BUCKET | R2 Bucket | Media file storage and streaming | CORS configured for HLS streaming |

### Environment Variables

**Development** (local .env):
```
ENVIRONMENT=development
DB_METHOD=LOCAL (or PRODUCTION for remote database)
WEB_APP_URL=http://localhost:5173
API_URL=http://localhost:4000
MEDIA_API_URL=http://localhost:42073 (transcoding service)
WORKER_SHARED_SECRET=<secret for internal worker requests>
```

**Staging** (wrangler.jsonc + secrets):
```
ENVIRONMENT=staging
DB_METHOD=PRODUCTION
WEB_APP_URL=https://codex-staging.revelations.studio
API_URL=https://api-staging.revelations.studio
MEDIA_API_URL=https://media-api-staging.revelations.studio
```

**Production** (wrangler.jsonc + secrets):
```
ENVIRONMENT=production
DB_METHOD=PRODUCTION
WEB_APP_URL=https://codex.revelations.studio
API_URL=https://api.revelations.studio
MEDIA_API_URL=https://media-api.revelations.studio
```

### Secrets (wrangler secret put)

```
DATABASE_URL=postgresql://user:pass@host:5432/codex
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-access-key>
R2_SECRET_ACCESS_KEY=<r2-secret-key>
```

---

## Development

### Local Setup

```bash
# Install dependencies
pnpm install

# Generate Cloudflare types
pnpm cf-typegen

# Type check
pnpm typecheck

# Format
pnpm format

# Lint
pnpm lint
```

### Running Locally

```bash
# Start dev server on port 4001 with debugger
pnpm dev

# Test health check
curl http://localhost:4001/health

# In another terminal, test with authentication
# (Requires Auth Worker running on port 42069)
curl -X POST http://localhost:42069/api/auth/email/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!","name":"Test"}' \
  -c cookies.txt

curl http://localhost:4001/api/content \
  -H "Cookie: codex-session=<token>" \
  -c cookies.txt
```

### Testing

```bash
# Run all tests
pnpm test

# Watch mode (re-run on file changes)
pnpm test:watch

# UI mode (visual test interface)
pnpm test:ui

# With coverage
pnpm test:coverage
```

**Test Setup**: Uses `vitest` with `@cloudflare/vitest-pool-workers` for Cloudflare Workers runtime access

**Test Files**:
- `src/index.test.ts` - Worker-level tests (health check, headers, auth, error handling)
- Service-level tests in `@codex/content` and `@codex/access` packages

### Code Quality

```bash
# Format code
pnpm format

# Lint
pnpm lint

# Type check
pnpm typecheck

# All checks
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

---

## Deployment

### Staging Deployment

```bash
# Deploy to staging environment
pnpm deploy:staging

# Verify health check
curl https://content-api-staging.revelations.studio/health

# Test endpoint with valid session
curl https://content-api-staging.revelations.studio/api/content \
  -H "Cookie: codex-session=<staging-session-token>"
```

### Production Deployment

```bash
# Build and deploy to production
pnpm deploy:production

# Verify health check
curl https://content-api.revelations.studio/health

# Monitor logs
wrangler tail --env production
```

### Pre-Deployment Checklist

- All tests passing: `pnpm test`
- No TypeScript errors: `pnpm typecheck`
- Linting clean: `pnpm lint`
- Code formatted: `pnpm format`
- Changes reviewed and approved

### Health Check Endpoint

**GET /health** (public, no authentication required):

```json
{
  "status": "ok" | "degraded",
  "service": "content-api",
  "version": "1.0.0",
  "timestamp": "ISO 8601",
  "checks": {
    "database": "ok" | "error",
    "kv": "ok" | "error",
    "r2": "ok" | "error"
  }
}
```

Returns `200 OK` if all checks pass, `503 Service Unavailable` if any check fails.

### Monitoring

**Request Tracking**: All requests assigned UUID via `x-request-id` header

**Observability**: Structured JSON logs via `@codex/observability`

**Error Monitoring**: Service errors logged with context (userId, contentId, etc.)

**Performance Metrics**:
- Request duration tracked
- Response times per endpoint
- Error rates and types

---

## Testing Approach

### Unit Tests (index.test.ts)

Tests run in actual Cloudflare Workers runtime via `cloudflare:test` module:

**Test Categories**:

1. **Health Check**
   - Returns 200 or 503 (database may not be available in test env)
   - Includes service name, version, timestamp

2. **Security Headers**
   - X-Content-Type-Options present
   - X-Frame-Options present
   - (CSP, HSTS checked in middleware tests)

3. **Authentication**
   - Unauthenticated requests return 401
   - Health check is public (no auth required)

4. **Error Handling**
   - 404 for unknown routes
   - 4xx for malformed JSON (not 500)
   - Error responses in standardized format

5. **Rate Limiting**
   - Middleware applies without crashing
   - (Actual limit enforcement tested via integration tests)

6. **Environment Bindings**
   - RATE_LIMIT_KV available
   - R2 and database bindings accessible

### Integration Tests (in service packages)

Service-level tests in `@codex/content` and `@codex/access` packages:
- Database transaction handling
- Query result accuracy
- Service error throwing
- (Run against test database via `@codex/test-utils`)

### Manual Testing

**Endpoint Testing with curl**:
```bash
# Create session
curl -X POST http://localhost:42069/api/auth/email/register \
  -H "Content-Type: application/json" \
  -d '{
    "email":"test@example.com",
    "password":"Test123!@#",
    "name":"Test User"
  }' \
  -c cookies.txt

# Create content
curl -X POST http://localhost:4001/api/content \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "title": "Test Video",
    "slug": "test-video",
    "contentType": "video",
    "mediaItemId": "550e8400-e29b-41d4-a716-446655440000",
    "visibility": "public"
  }'

# Get content
curl http://localhost:4001/api/content/550e8400-e29b-41d4-a716-446655440001 \
  -b cookies.txt

# List content
curl http://localhost:4001/api/content?page=1&limit=10 \
  -b cookies.txt

# Publish content
curl -X POST http://localhost:4001/api/content/550e8400-e29b-41d4-a716-446655440001/publish \
  -b cookies.txt

# Get streaming URL
curl http://localhost:4001/api/access/content/550e8400-e29b-41d4-a716-446655440001/stream \
  -b cookies.txt
```

---

## File Structure

```
workers/content-api/
├── src/
│   ├── index.ts                    # Main worker entry, createWorker setup
│   ├── index.test.ts               # Unit tests (health, auth, headers, errors)
│   │
│   └── routes/
│       ├── content.ts              # Content CRUD endpoints (POST, GET, PATCH, DELETE)
│       │                            # Publish/unpublish endpoints
│       ├── media.ts                # Media CRUD endpoints
│       │                            # Upload-complete coordination
│       └── content-access.ts       # Streaming URL, playback progress, user library
│
├── wrangler.jsonc                  # Cloudflare Workers config (KV, R2, env)
├── package.json                    # Dependencies, scripts, metadata
├── tsconfig.json                   # TypeScript configuration
├── vite.config.ts                  # Vite build configuration
├── vitest.config.ts                # Vitest test configuration
└── CLAUDE.md                       # This documentation
```

### Key Files

| File | Purpose | Contains |
|------|---------|----------|
| `src/index.ts` | Worker entry point | createWorker setup, route mounting, middleware chain |
| `src/routes/content.ts` | Content endpoints | 7 routes for CRUD, publish, unpublish, list |
| `src/routes/media.ts` | Media endpoints | 6 routes for CRUD, list, upload-complete |
| `src/routes/content-access.ts` | Access endpoints | 4 routes for streaming, progress, library |
| `src/index.test.ts` | Unit tests | Health check, auth, headers, errors |
| `wrangler.jsonc` | Worker config | KV bindings, R2 bucket, environment vars |
| `package.json` | Dependencies | @codex packages, hono, vitest, wrangler |

---

## Architecture Decisions

### Per-Request Service Instantiation

Services created for each request (not singletons) to ensure isolation and proper dependency injection. Database connection reused via `dbHttp` client (connection pooling handled by Neon).

### Creator Scoping at Query Level

All content/media queries filter by `creatorId` in database WHERE clause (not application-level filtering). Prevents accidental data leaks at source. Queryable via `scopedNotDeleted()` helper.

### Soft Deletes Only

Deletion sets `deleted_at` timestamp, never removes records. Allows recovery, audit trails, referential integrity, and soft-deleted content not returned by default queries.

### Route-Level Security Policies

Security declared in each route via `procedure()` policy (declarative, not hidden in middleware). Easier to understand security requirements by reading route definitions.

### Access Verification in Service Layer

ContentAccessService verifies access (purchases, org membership) in service, not in route handler. Business logic stays in service layer, separating concerns.

### Signed R2 URLs

Streaming URLs are time-limited and signed with AWS SigV4. Workers can't expose R2 secrets; signing happens in secure context. Prevents URL forgery and enforces expiration.

### Transcoding Coordination via HTTP

Media transcoding triggered via HTTP request to external MEDIA_API_URL (not event-driven queue). Allows retrying failed transcode requests and checking status via GET /api/media/:id.

---

## Related Components

**Dependencies** (imports from these packages):
- `@codex/content` - ContentService, MediaItemService, schemas, error classes
- `@codex/access` - ContentAccessService factory for streaming and purchases
- `@codex/database` - dbHttp PostgreSQL client, database schema, query helpers
- `@codex/security` - Session validation, rate limiting
- `@codex/worker-utils` - createWorker, procedure, health checks
- `@codex/shared-types` - HonoEnv, response types
- `@codex/validation` - Zod schemas for all requests

**Dependents** (consumers of this worker):
- Frontend web app - calls all endpoints
- Mobile app - calls endpoints (same API surface)
- External transcoding worker - coordinates transcoding via upload-complete

**External Services**:
- Neon PostgreSQL - Content, media, access data persistence
- Cloudflare R2 - Media file storage, HLS playlist serving
- Cloudflare KV - Rate limit tracking, session caching (via Auth Worker)
- Auth Worker - Session validation on every authenticated request
- Transcoding Worker (MEDIA_API_URL) - Processes media files, updates status

---

## Example Usage

### Create Content and Publish

```bash
# 1. Register/login (get session)
curl -X POST http://localhost:42069/api/auth/email/register \
  -H "Content-Type: application/json" \
  -d '{
    "email":"creator@example.com",
    "password":"Secure123!@#",
    "name":"Creator"
  }' \
  -c cookies.txt

# 2. Upload media to R2 (frontend-initiated, get R2 presigned URL from somewhere)
# Assume file uploaded, mediaId created: 550e8400-e29b-41d4-a716-446655440000

# 3. Create media item record
curl -X POST http://localhost:4001/api/media \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "title": "My Demo Video",
    "description": "A short demonstration",
    "mediaType": "video",
    "r2Key": "uploads/creator-123/demo.mp4",
    "fileSizeBytes": 52428800,
    "mimeType": "video/mp4"
  }'
# Response: { "data": { "id": "media-uuid", "status": "uploading", ... } }

# 4. Mark upload complete, trigger transcoding
curl -X POST http://localhost:4001/api/media/media-uuid/upload-complete \
  -b cookies.txt
# Response: { "success": true, "status": "transcoding" }

# 5. Wait for transcoding (poll GET /api/media/media-uuid until status='ready')
# Assuming transcoding completes...

# 6. Create content item
curl -X POST http://localhost:4001/api/content \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "title": "My Demo Video",
    "slug": "my-demo-video",
    "description": "A short demonstration video",
    "contentType": "video",
    "mediaItemId": "media-uuid",
    "category": "tutorials",
    "tags": ["demo", "tutorial"],
    "visibility": "public"
  }'
# Response: { "data": { "id": "content-uuid", "status": "draft", ... } }

# 7. Publish content
curl -X POST http://localhost:4001/api/content/content-uuid/publish \
  -b cookies.txt
# Response: { "data": { "id": "content-uuid", "status": "published", "publishedAt": "...", ... } }

# 8. Get streaming URL (as viewer)
curl http://localhost:4001/api/access/content/content-uuid/stream?expirySeconds=3600 \
  -b cookies.txt
# Response: {
#   "streamingUrl": "https://r2-bucket.s3.amazonaws.com/...",
#   "expiresAt": "...",
#   "contentType": "video"
# }

# 9. Track playback progress
curl -X POST http://localhost:4001/api/access/content/content-uuid/progress \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "positionSeconds": 120,
    "durationSeconds": 600,
    "completed": false
  }'
# Response: (204 No Content)

# 10. Get library (list purchased + free content)
curl http://localhost:4001/api/access/user/library \
  -b cookies.txt
# Response: { "items": [ { "content": {...}, "purchase": null, "progress": {...} } ], ... }
```

---

## Summary

The Content-API Worker provides a complete REST API for content lifecycle management, media handling, and access control. It enforces creator ownership through database-level scoping, handles secure streaming via signed R2 URLs, coordinates with external transcoding services, and tracks user progress for resume functionality.

**Key Architectural Principles**:
1. **Separation of Concerns**: Content, media, and access as separate route modules
2. **Security-First**: Creator scoping at query level, role-based authorization, rate limiting
3. **Service Layer Pattern**: Business logic in ContentService, MediaItemService, ContentAccessService
4. **Soft Deletes**: All deletions set deleted_at, enabling recovery and audit
5. **Async Coordination**: Transcoding triggered via HTTP, status tracked via polling
6. **LLM-Optimized Docs**: Complete endpoint specifications, error codes, examples

This documentation serves as the single source of truth for the Content-API Worker. All public APIs, security models, error handling, and integration points are documented with full specifications and working examples.

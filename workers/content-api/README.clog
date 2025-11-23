# Content API Worker

## Overview

RESTful API for managing content items, media uploads, and content access/streaming. Provides endpoints for creators to manage videos/audio content, handle media lifecycle (upload → transcoding → ready), publish/unpublish workflows, and generate time-limited streaming URLs for authenticated users.

**Primary Responsibility**: Content and media lifecycle management with access control and streaming URL generation.

**Deployment**: Cloudflare Worker on `content-api.revelations.studio` (production), port 4001 (development).

**Key Features**:
- Content CRUD operations (create, read, update, publish, unpublish, delete)
- Media item management with upload and transcoding status tracking
- Access control verification (free content, purchases, organization membership)
- Time-limited signed R2 streaming URLs
- Playback progress tracking for resume functionality
- User library listing with content and purchase metadata

---

## Architecture

### Route Structure

**Three route modules** mounted on separate paths:

| Route Module | Path | Responsibility |
|---|---|---|
| `content.ts` | `/api/content` | Content CRUD, publish/unpublish lifecycle |
| `media.ts` | `/api/media` | Media item CRUD with upload tracking |
| `content-access.ts` | `/api/access` | Streaming URLs, playback progress, user library |

### Middleware Chain

All routes inherit middleware from `createWorker()` in `index.ts`:

1. **Request Tracking**: UUID request ID, client IP, user agent logging
2. **CORS**: Global CORS enabled with configurable origins
3. **Security Headers**: CSP, XFO, X-Content-Type-Options
4. **Error Sanitization**: Internal details not exposed in responses

Route-level authentication via `withPolicy()` middleware (declared per endpoint).

### Dependency Injection

**Services instantiated per-request**:
- `ContentService` - business logic for content operations
- `MediaItemService` - business logic for media operations
- `ContentAccessService` - access verification and streaming URL generation

**Database**: `dbHttp` client (HTTP wrapper around PostgreSQL via `@codex/database`)

**R2 Service**: Injected via `ctx.env` for signed URL generation

### Health Checks

Configured in `index.ts`:
- **Database**: HTTP connection to PostgreSQL
- **Rate Limit KV**: Cloudflare KV namespace for rate limiting
- **R2 Media Bucket**: Cloudflare R2 bucket for media storage

---

## Public Endpoints

### Content Management - `/api/content`

#### POST /api/content
**Create new content item**

**Security**: Creator/Admin role, API rate limit (100 req/min)

**Request Body**:
```json
{
  "title": "string",
  "slug": "string (url-safe)",
  "description": "string | null",
  "contentType": "video" | "audio" | "written",
  "mediaItemId": "uuid | null (required if not written)",
  "contentBody": "string | null (for written content)",
  "category": "string | null",
  "tags": "string[]",
  "thumbnailUrl": "string | null",
  "visibility": "public" | "purchased_only" | "members_only",
  "priceCents": "number | null (must be >= 0)",
  "organizationId": "uuid | null"
}
```

**Response** (201 Created):
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
    "status": "draft",
    "viewCount": 0,
    "purchaseCount": 0,
    "publishedAt": "ISO 8601 | null",
    "createdAt": "ISO 8601",
    "updatedAt": "ISO 8601",
    "deletedAt": "ISO 8601 | null"
  }
}
```

**Error Responses**:
- `400 Bad Request` - Validation error (invalid slug format, missing required fields)
- `409 Conflict` - Slug already exists for organization
- `422 Unprocessable Entity` - Media item type mismatch or not ready for publishing
- `404 Not Found` - Referenced media item doesn't exist or not owned by creator

---

#### GET /api/content/:id
**Get content by ID**

**Security**: Authenticated users, API rate limit (100 req/min)

**URL Parameters**:
- `id` (string, required) - Content ID (UUID)

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
      "status": "uploading" | "transcoding" | "ready" | "failed",
      "r2Key": "string",
      "fileSizeBytes": "number",
      "mimeType": "string",
      "hlsPlaylistKey": "string | null",
      "thumbnailKey": "string | null",
      "durationSeconds": "number | null",
      "width": "number | null",
      "height": "number | null",
      "createdAt": "ISO 8601",
      "updatedAt": "ISO 8601",
      "deletedAt": "ISO 8601 | null"
    },
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

**Error Responses**:
- `404 Not Found` - Content doesn't exist, is deleted, or not owned by authenticated user
- `401 Unauthorized` - User not authenticated

---

#### PATCH /api/content/:id
**Update content metadata**

**Security**: Creator/Admin (owner), API rate limit (100 req/min)

**URL Parameters**:
- `id` (string, required) - Content ID

**Request Body** (all fields optional):
```json
{
  "title": "string",
  "slug": "string",
  "description": "string | null",
  "contentBody": "string | null",
  "category": "string | null",
  "tags": "string[]",
  "thumbnailUrl": "string | null",
  "visibility": "public" | "purchased_only" | "members_only",
  "priceCents": "number | null"
}
```

**Response** (200 OK): Same as GET endpoint

**Error Responses**:
- `400 Bad Request` - Invalid update data
- `404 Not Found` - Content doesn't exist or not owned by creator
- `409 Conflict` - New slug conflicts with existing content
- `422 Unprocessable Entity` - Cannot change slug of published content

---

#### GET /api/content
**List content with pagination and filters**

**Security**: Authenticated users, API rate limit (100 req/min)

**Query Parameters**:
```
?page=number (default: 1)
&limit=number (default: 20, max: 100)
&search=string (filter by title or slug)
&contentType=video|audio|written (filter by type)
&status=draft|published (filter by status)
&tags=string,string (filter by any tag)
&visibility=public|purchased_only|members_only
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
      "updatedAt": "ISO 8601"
      "mediaItem": { ... },
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

**Error Responses**:
- `400 Bad Request` - Invalid page/limit values
- `401 Unauthorized` - User not authenticated

---

#### POST /api/content/:id/publish
**Publish content (make available to users)**

**Security**: Creator/Admin (owner), API rate limit (100 req/min)

**URL Parameters**:
- `id` (string, required) - Content ID

**Request Body**: Empty

**Response** (200 OK):
```json
{
  "data": {
    "id": "uuid",
    "status": "published",
    "publishedAt": "ISO 8601",
    ...
  }
}
```

**Conditions**:
- Content must be in draft status
- Media item must be in 'ready' status (if attached)
- All required fields must be populated

**Error Responses**:
- `404 Not Found` - Content doesn't exist
- `422 Unprocessable Entity` - Content already published
- `422 Unprocessable Entity` - Media item not ready for publishing
- `422 Unprocessable Entity` - Missing required fields (title, slug, contentType, mediaItemId)

---

#### POST /api/content/:id/unpublish
**Unpublish content (revert to draft)**

**Security**: Creator/Admin (owner), API rate limit (100 req/min)

**URL Parameters**:
- `id` (string, required) - Content ID

**Request Body**: Empty

**Response** (200 OK):
```json
{
  "data": {
    "id": "uuid",
    "status": "draft",
    "publishedAt": null,
    ...
  }
}
```

**Error Responses**:
- `404 Not Found` - Content doesn't exist
- `422 Unprocessable Entity` - Content not currently published

---

#### DELETE /api/content/:id
**Soft delete content (sets deleted_at timestamp)**

**Security**: Creator/Admin (owner), Strict rate limit (5 req/15min)

**URL Parameters**:
- `id` (string, required) - Content ID

**Request Body**: Empty

**Response** (204 No Content): Empty body

**Error Responses**:
- `404 Not Found` - Content doesn't exist
- `429 Too Many Requests` - Rate limit exceeded

---

### Media Management - `/api/media`

#### POST /api/media
**Create media item (called after upload to R2 completes)**

**Security**: Creator/Admin, API rate limit (100 req/min)

**Request Body**:
```json
{
  "title": "string",
  "description": "string | null",
  "mediaType": "video" | "audio",
  "r2Key": "string (path in R2 bucket)",
  "fileSizeBytes": "number",
  "mimeType": "string (video/mp4, audio/mpeg, etc.)"
}
```

**Response** (201 Created):
```json
{
  "data": {
    "id": "uuid",
    "creatorId": "uuid",
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

**Lifecycle**: Status progresses `uploading` → `transcoding` → `ready` or `failed` as transcoding service processes

**Error Responses**:
- `400 Bad Request` - Invalid mediaType or mimeType
- `422 Unprocessable Entity` - Invalid R2 key format

---

#### GET /api/media/:id
**Get media item by ID**

**Security**: Authenticated users, API rate limit (100 req/min)

**URL Parameters**:
- `id` (string, required) - Media ID

**Response** (200 OK):
```json
{
  "data": {
    "id": "uuid",
    "creatorId": "uuid",
    "title": "string",
    "description": "string | null",
    "mediaType": "video" | "audio",
    "status": "uploading" | "transcoding" | "ready" | "failed",
    "r2Key": "string",
    "fileSizeBytes": "number",
    "mimeType": "string",
    "hlsPlaylistKey": "string | null",
    "thumbnailKey": "string | null",
    "durationSeconds": "number | null",
    "width": "number | null",
    "height": "number | null",
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

**Error Responses**:
- `404 Not Found` - Media doesn't exist or not owned by user
- `401 Unauthorized` - User not authenticated

---

#### PATCH /api/media/:id
**Update media metadata**

**Security**: Creator/Admin (owner), API rate limit (100 req/min)

**URL Parameters**:
- `id` (string, required) - Media ID

**Request Body** (all optional):
```json
{
  "title": "string",
  "description": "string | null",
  "status": "uploading" | "transcoding" | "ready" | "failed",
  "hlsPlaylistKey": "string | null",
  "thumbnailKey": "string | null",
  "durationSeconds": "number | null",
  "width": "number | null",
  "height": "number | null"
}
```

**Response** (200 OK): Same as GET endpoint

**Note**: Typically updated by transcoding service via worker-to-worker requests, not by users directly

**Error Responses**:
- `404 Not Found` - Media doesn't exist
- `400 Bad Request` - Invalid update data

---

#### GET /api/media
**List media items with pagination and filters**

**Security**: Authenticated users, API rate limit (100 req/min)

**Query Parameters**:
```
?page=number (default: 1)
&limit=number (default: 20, max: 100)
&search=string (filter by title)
&mediaType=video|audio (filter by type)
&status=uploading|transcoding|ready|failed (filter by status)
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
      "status": "uploading" | "transcoding" | "ready" | "failed",
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

**Error Responses**:
- `400 Bad Request` - Invalid pagination params
- `401 Unauthorized` - User not authenticated

---

#### DELETE /api/media/:id
**Soft delete media item**

**Security**: Creator/Admin (owner), Strict rate limit (5 req/15min)

**URL Parameters**:
- `id` (string, required) - Media ID

**Request Body**: Empty

**Response** (204 No Content): Empty body

**Note**: Does not delete from R2; only sets deleted_at timestamp in database

**Error Responses**:
- `404 Not Found` - Media doesn't exist
- `429 Too Many Requests` - Rate limit exceeded

---

### Content Access & Streaming - `/api/access`

#### GET /api/access/content/:id/stream
**Generate signed streaming URL**

**Security**: Authenticated users, Streaming rate limit (60 req/min)

**URL Parameters**:
- `id` (string, required) - Content ID

**Query Parameters**:
```
?expirySeconds=number (default: 3600, max: 86400)
```

**Response** (200 OK):
```json
{
  "streamingUrl": "https://r2-bucket.s3.amazonaws.com/path/to/file.m3u8?...",
  "expiresAt": "2025-01-23T15:30:00Z",
  "contentType": "video"
}
```

**Access Control Flow**:
1. Content must be published and not deleted
2. If free (priceCents = 0) → grant access
3. If paid, check purchase record for user → grant access
4. If paid, check organization membership → grant access
5. Otherwise → deny with 403 Access Denied

**Error Responses**:
- `404 Not Found` - Content doesn't exist, is draft, or is deleted
- `403 Forbidden` - User hasn't purchased content and isn't org member
- `500 Internal Server Error` - Failed to generate signed URL

---

#### POST /api/access/content/:id/progress
**Save playback progress**

**Security**: Authenticated users, API rate limit (100 req/min)

**URL Parameters**:
- `id` (string, required) - Content ID

**Request Body**:
```json
{
  "positionSeconds": "number (current playback position)",
  "durationSeconds": "number (total content duration)",
  "completed": "boolean (true if user finished watching)"
}
```

**Response** (204 No Content): Empty body

**Storage**: Stored in `video_playback` table, scoped to userId

**Error Responses**:
- `404 Not Found` - Content doesn't exist
- `400 Bad Request` - Invalid position/duration values
- `422 Unprocessable Entity` - Position exceeds duration

---

#### GET /api/access/content/:id/progress
**Get playback progress**

**Security**: Authenticated users, API rate limit (100 req/min)

**URL Parameters**:
- `id` (string, required) - Content ID

**Response** (200 OK):
```json
{
  "progress": {
    "positionSeconds": 1200,
    "durationSeconds": 3600,
    "completed": false,
    "updatedAt": "2025-01-23T15:30:00Z"
  }
}
```

**Returns** `null` for progress if user hasn't started watching

**Error Responses**:
- `404 Not Found` - Content doesn't exist
- `401 Unauthorized` - User not authenticated

---

#### GET /api/access/user/library
**List user's content library (purchased + free content)**

**Security**: Authenticated users, API rate limit (100 req/min)

**Query Parameters**:
```
?page=number (default: 1)
&limit=number (default: 20, max: 100)
&search=string (filter by title)
&contentType=video|audio|written (filter by type)
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
        "durationSeconds": "number | null"
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

**Includes**:
- Purchased content (via `content_access` table with access_type='purchased')
- Free public content (priceCents = 0)
- Organization member content (if member of org)
- Playback progress if started

**Error Responses**:
- `400 Bad Request` - Invalid pagination
- `401 Unauthorized` - User not authenticated

---

## Security Model

### Authentication

**Default Policy**: All routes require authenticated session

**Session Verification**: Via `@codex/security` middleware
- Validates session token from request
- Populates `ctx.user` with user data (id, email, role)
- Returns 401 Unauthorized if invalid

**Route-Level Override**: `withPolicy()` middleware declares per-route auth requirement

### Authorization

**Role-Based Access Control**:

| Endpoint | Required Roles | Other Checks |
|---|---|---|
| POST /api/content | creator, admin | User must be creator |
| GET /api/content/:id | (none, authenticated) | Must own content |
| PATCH /api/content/:id | creator, admin | Must own content |
| DELETE /api/content/:id | creator, admin | Must own content |
| POST /api/content/:id/publish | creator, admin | Must own content |
| POST /api/content/:id/unpublish | creator, admin | Must own content |
| GET /api/content | (none, authenticated) | Listed items scoped to user |
| POST /api/media | creator, admin | User must be creator |
| GET /api/media/:id | (none, authenticated) | Must own media |
| PATCH /api/media/:id | creator, admin | Must own media |
| DELETE /api/media/:id | creator, admin | Must own media |
| GET /api/media | (none, authenticated) | Listed items scoped to user |
| GET /api/access/content/:id/stream | (none, authenticated) | Access verified via purchases + org membership |
| POST /api/access/content/:id/progress | (none, authenticated) | Progress scoped to userId |
| GET /api/access/content/:id/progress | (none, authenticated) | Progress scoped to userId |
| GET /api/access/user/library | (none, authenticated) | Library scoped to userId |

**Creator Scoping**: All ContentService and MediaItemService queries filtered by creatorId (cannot see other users' content)

**Purchase Verification**: ContentAccessService checks `content_access` table before generating streaming URL

**Organization Membership**: ContentAccessService allows access if user is org member AND content belongs to org

### Rate Limiting

**Presets** (from `@codex/security`):

| Preset | Limit | Use Case |
|---|---|---|
| api | 100 req/min | Standard CRUD operations |
| auth | 10 req/min | Login/signup (unused in content-api) |
| streaming | 60 req/min | Streaming URL requests (allows HLS segment refreshes) |
| strict | 5 req/15min | Deletion operations |

**Configuration**: Declared in `withPolicy()` for each route

**Implementation**: KV namespace `RATE_LIMIT_KV` for distributed rate limit tracking

### Input Validation

**Zod Schemas** for all requests:

- `createContentSchema` - Body validation for POST /api/content
- `updateContentSchema` - Body validation for PATCH /api/content/:id
- `contentQuerySchema` - Query params validation for GET /api/content
- `createMediaItemSchema` - Body validation for POST /api/media
- `updateMediaItemSchema` - Body validation for PATCH /api/media/:id
- `mediaQuerySchema` - Query params validation for GET /api/media
- `getStreamingUrlSchema` - Params/query validation for GET /api/access/content/:id/stream
- `savePlaybackProgressSchema` - Body validation for POST /api/access/content/:id/progress
- `getPlaybackProgressSchema` - Params validation for GET /api/access/content/:id/progress
- `listUserLibrarySchema` - Query params validation for GET /api/access/user/library
- `createIdParamsSchema()` - Generic ID validation for routes

**Error Response**: 400 Bad Request with validation details

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

**Applied to all responses** (via worker middleware):
- `Content-Security-Policy`: Restricts resource loading
- `X-Frame-Options: DENY`: Prevents clickjacking
- `X-Content-Type-Options: nosniff`: Prevents MIME type sniffing
- `Strict-Transport-Security`: HTTPS enforcement

### PII Handling

**Error Sanitization**: Error messages don't expose internal details or user information

**Logging**: Request IDs, IPs, user agents tracked but PII not logged

---

## Error Responses

All errors follow consistent format:

### Validation Errors (400)
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

### Service Errors (4xx/5xx)

| Error Class | Status | Code | When Thrown |
|---|---|---|---|
| ContentNotFoundError | 404 | CONTENT_NOT_FOUND | Content doesn't exist or not owned by user |
| MediaNotFoundError | 404 | MEDIA_NOT_FOUND | Media item doesn't exist or not owned by user |
| AccessDeniedError | 403 | ACCESS_DENIED | User hasn't purchased content and isn't org member |
| SlugConflictError | 409 | CONTENT_CONFLICT | Slug already exists for organization |
| MediaNotReadyError | 422 | MEDIA_NOT_READY | Media item not in 'ready' status for publishing |
| ContentTypeMismatchError | 422 | CONTENT_TYPE_MISMATCH | Content type doesn't match media type |
| ContentAlreadyPublishedError | 422 | ALREADY_PUBLISHED | Attempting to publish already-published content |
| BusinessLogicError | 422 | BUSINESS_LOGIC_ERROR | Generic business rule violation |
| R2SigningError | 500 | R2_SIGNING_ERROR | Failed to generate signed URL |
| InvalidContentTypeError | 500 | INVALID_CONTENT_TYPE | Media type not valid for streaming |
| InternalServiceError | 500 | INTERNAL_ERROR | Unexpected server error |

**Error Response Format**:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": { "context": "optional" }
  }
}
```

---

## Integration Points

### Services Used

**ContentService** (`@codex/content`):
- Handles all content CRUD, publish/unpublish, lifecycle
- Created per-request in content routes
- Dependencies: Database client, environment config
- Scopes all queries to creatorId

**MediaItemService** (`@codex/content`):
- Handles all media item CRUD
- Created per-request in media routes
- Dependencies: Database client, environment config
- Scopes all queries to creatorId

**ContentAccessService** (`@codex/access`):
- Created via factory function `createContentAccessService(ctx.env)`
- Handles access verification, streaming URL generation, playback progress
- Dependencies: Database client, R2 signer, observability client
- No creator scoping (verifies content published and user has access)

### Dependency Graph

```
content-api worker
  ├── ContentService
  │   ├── @codex/database (dbHttp)
  │   ├── @codex/validation (schemas)
  │   └── @codex/service-errors (error classes)
  │
  ├── MediaItemService
  │   ├── @codex/database (dbHttp)
  │   ├── @codex/validation (schemas)
  │   └── @codex/service-errors (error classes)
  │
  ├── ContentAccessService (factory: createContentAccessService)
  │   ├── @codex/database (dbHttp)
  │   ├── @codex/cloudflare-clients (R2Service)
  │   ├── @codex/observability (ObservabilityClient)
  │   └── @codex/validation (schemas)
  │
  ├── @codex/security (authentication middleware)
  ├── @codex/worker-utils (createWorker, withPolicy, createAuthenticatedHandler)
  ├── @codex/shared-types (HonoEnv, response types)
  └── Hono framework (routing)
```

### Data Flow - Create Content

1. **Client Request**: POST /api/content with title, slug, mediaItemId, etc.
2. **Authentication**: `withPolicy()` verifies session (ctx.user set)
3. **Authorization**: `POLICY_PRESETS.creator()` checks user has creator role
4. **Validation**: `createContentSchema.parse()` validates request body
5. **Service Call**: `ContentService.create(validatedInput, ctx.user.id)`
6. **Database Transaction**: Service inserts content record, validates media item
7. **Response**: 201 Created with new content data

### Data Flow - Get Streaming URL

1. **Client Request**: GET /api/access/content/:id/stream with valid session
2. **Authentication**: `withPolicy()` verifies session
3. **Authorization**: Standard authenticated user policy
4. **Service Call**: `ContentAccessService.getStreamingUrl(userId, input)`
5. **Verification**: Service checks content published, verifies user access (free/purchased/org member)
6. **R2 Signing**: Service generates time-limited signed URL via R2Service
7. **Response**: 200 OK with streamingUrl, expiresAt, contentType

---

## Dependencies

### Core Dependencies

| Package | Purpose |
|---|---|
| `@codex/content` | ContentService, MediaItemService, validation schemas, types |
| `@codex/access` | ContentAccessService factory, access control logic |
| `@codex/database` | PostgreSQL client (dbHttp), database schema, helpers |
| `@codex/security` | Authentication middleware, rate limiting, session validation |
| `@codex/worker-utils` | createWorker factory, withPolicy, createAuthenticatedHandler, health checks |
| `@codex/shared-types` | HonoEnv, response types, user/context types |
| `@codex/validation` | Zod schemas for all requests |
| `@codex/cloudflare-clients` | R2Service for signed URL generation |
| `@codex/observability` | Logging and observability |
| `hono` | Web framework for routing and middleware |

### Cloudflare Bindings

| Binding | Type | Purpose |
|---|---|---|
| RATE_LIMIT_KV | KV Namespace | Distributed rate limit tracking |
| MEDIA_BUCKET | R2 Bucket | Storage for media files and HLS playlists |

### Environment Variables

**Development** (`wrangler dev --env development`):
```
ENVIRONMENT=development
DB_METHOD=PRODUCTION (uses production database)
WEB_APP_URL=http://localhost:5173
API_URL=http://localhost:4000
```

**Staging** (`wrangler deploy --env staging`):
```
ENVIRONMENT=staging
DB_METHOD=PRODUCTION
WEB_APP_URL=https://codex-staging.revelations.studio
API_URL=https://api-staging.revelations.studio
```

**Production** (`wrangler deploy --env production`):
```
ENVIRONMENT=production
DB_METHOD=PRODUCTION
WEB_APP_URL=https://codex.revelations.studio
API_URL=https://api.revelations.studio
```

### Secrets

Set via `wrangler secret put`:
```
DATABASE_URL=postgresql://user:pass@host:5432/codex
R2_ACCOUNT_ID=xxx
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
```

---

## Development

### Local Setup

```bash
# Install dependencies
pnpm install

# Set up environment variables in .env.local
# (DATABASE_URL will be shared with other workers)

# Generate Cloudflare types
pnpm cf-typegen

# Type check
pnpm typecheck
```

### Running Locally

```bash
# Start dev server on port 4001 with debugger
pnpm dev

# Access at http://localhost:4001/health (should return 200)
```

### Testing

```bash
# Run tests
pnpm test

# Watch mode
pnpm test --watch

# UI mode
pnpm test:ui
```

**Test Setup**: Uses `@cloudflare/vitest-pool-workers` and `@codex/test-utils` for mocking services and Cloudflare bindings

### Code Quality

```bash
# Format code
pnpm format

# Lint
pnpm lint

# Type check
pnpm typecheck
```

---

## Deployment

### Staging Deployment

```bash
# Deploy to staging environment
pnpm deploy:staging

# Verify health check
curl https://content-api-staging.revelations.studio/health
```

### Production Deployment

```bash
# Build and deploy to production
pnpm deploy:production

# Verify health check
curl https://content-api.revelations.studio/health
```

### Health Check Endpoint

**GET /health** (public, no auth required):
```json
{
  "status": "ok",
  "timestamp": "2025-01-23T15:00:00Z",
  "checks": {
    "database": "ok",
    "kv": "ok",
    "r2": "ok"
  }
}
```

Returns `503 Service Unavailable` if any check fails.

### Monitoring

**Request Tracking**: All requests assigned UUID, tracked with IP and user agent

**Observability**: Logs via `@codex/observability` with structured JSON

**Error Reporting**: Service errors logged with context (userId, contentId, etc.)

---

## Response Format Examples

### Success: Single Item (201)
```bash
curl -X POST http://localhost:4001/api/content \
  -H "Content-Type: application/json" \
  -H "Cookie: session=..." \
  -d '{
    "title": "My First Video",
    "slug": "my-first-video",
    "contentType": "video",
    "mediaItemId": "uuid",
    "visibility": "purchased_only",
    "priceCents": 1999
  }'
```

Response (201 Created):
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "creatorId": "user-123",
    "organizationId": null,
    "mediaItemId": "media-456",
    "title": "My First Video",
    "slug": "my-first-video",
    "description": null,
    "contentType": "video",
    "contentBody": null,
    "category": null,
    "tags": [],
    "thumbnailUrl": null,
    "visibility": "purchased_only",
    "priceCents": 1999,
    "status": "draft",
    "viewCount": 0,
    "purchaseCount": 0,
    "publishedAt": null,
    "createdAt": "2025-01-23T15:00:00Z",
    "updatedAt": "2025-01-23T15:00:00Z",
    "deletedAt": null
  }
}
```

### Success: List (200)
```bash
curl http://localhost:4001/api/content?page=1&limit=10 \
  -H "Cookie: session=..."
```

Response (200 OK):
```json
{
  "items": [
    {
      "id": "content-1",
      "title": "My First Video",
      "slug": "my-first-video",
      "contentType": "video",
      "status": "draft",
      "viewCount": 0,
      "publishedAt": null,
      "createdAt": "2025-01-23T15:00:00Z",
      ...
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1
  }
}
```

### Error: Validation (400)
```bash
curl -X POST http://localhost:4001/api/content \
  -H "Content-Type: application/json" \
  -H "Cookie: session=..." \
  -d '{
    "slug": "my-video",
    "contentType": "invalid"
  }'
```

Response (400 Bad Request):
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": [
      {
        "path": "title",
        "message": "Required"
      },
      {
        "path": "contentType",
        "message": "Invalid enum value. Expected 'video' | 'audio' | 'written'"
      }
    ]
  }
}
```

### Error: Access Denied (403)
```bash
curl http://localhost:4001/api/access/content/paid-video/stream \
  -H "Cookie: session=... (free user)"
```

Response (403 Forbidden):
```json
{
  "error": {
    "code": "ACCESS_DENIED",
    "message": "User does not have access to this content",
    "details": {
      "userId": "user-123",
      "contentId": "paid-video",
      "code": "ACCESS_DENIED"
    }
  }
}
```

### Error: Not Found (404)
```bash
curl http://localhost:4001/api/content/nonexistent \
  -H "Cookie: session=..."
```

Response (404 Not Found):
```json
{
  "error": {
    "code": "CONTENT_NOT_FOUND",
    "message": "Content not found",
    "details": {
      "contentId": "nonexistent"
    }
  }
}
```

### Error: Conflict (409)
```bash
curl -X POST http://localhost:4001/api/content \
  -H "Content-Type: application/json" \
  -H "Cookie: session=..." \
  -d '{
    "title": "My Video",
    "slug": "my-video",
    "contentType": "video",
    "mediaItemId": "media-1"
  }'
# Note: slug "my-video" already exists
```

Response (409 Conflict):
```json
{
  "error": {
    "code": "CONTENT_CONFLICT",
    "message": "Content with this slug already exists",
    "details": {
      "slug": "my-video"
    }
  }
}
```

### Error: Business Logic (422)
```bash
curl -X POST http://localhost:4001/api/content/draft-video/publish \
  -H "Cookie: session=..." \
  -d '{}'
# Note: media item status is 'uploading', not 'ready'
```

Response (422 Unprocessable Entity):
```json
{
  "error": {
    "code": "MEDIA_NOT_READY",
    "message": "Media item not ready for publishing",
    "details": {
      "mediaItemId": "media-1"
    }
  }
}
```

---

## Architecture Decisions

### Per-Request Service Instantiation

Services created for each request (not singletons) to ensure isolation and proper dependency injection. Database connection reused via `dbHttp` client.

### Creator Scoping at Query Level

All content/media queries filter by `creatorId` in database query itself (via `withCreatorScope`, `scopedNotDeleted`). Prevents accidental data leaks at source.

### Soft Deletes Only

Deletion sets `deleted_at` timestamp, never removes records. Allows recovery, audit trails, and referential integrity.

### Route-Level Security Policies

Security declared in each route via `withPolicy()` (declarative, not hidden in middleware). Easier to understand security requirements by reading route definitions.

### Access Verification in Service Layer

ContentAccessService verifies access (purchases, org membership) in service, not in route handler. Business logic stays in service layer.

### Signed R2 URLs

Streaming URLs are time-limited and signed with AWS credentials. Workers can't expose R2 secrets; signing happens in secure context.

---

## Related Components

- **@codex/content** - Service implementations and validation schemas
- **@codex/access** - Content access service for streaming and purchases
- **@codex/database** - Database client and query helpers
- **@codex/security** - Authentication and rate limiting
- **@codex/worker-utils** - Worker factory, route helpers, health checks
- **transcoding-worker** - Processes media uploads, updates status to 'ready'
- **ecommerce-api** - Handles purchases, creates entries in `content_access` table

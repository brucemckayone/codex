# @codex/shared-types

Shared TypeScript type definitions for the Codex platform. Provides type-safe contracts for workers, services, and API responses used across all components. This foundation package ensures consistency, type safety, and seamless integration throughout the platform.

## Overview

`@codex/shared-types` is a types-only package that serves as the single source of truth for:
- Worker environment types (Hono bindings, variables, context)
- API response envelopes and DTOs
- Authentication and session data structures
- Pagination and list response formats
- Standard error response shapes

All Codex workers and services depend on this package for type safety and contract consistency. It has no runtime code—only TypeScript type definitions that compile away, adding zero overhead while ensuring compile-time type correctness.

### Key Responsibilities

1. **Worker Environment Types** - Define the Hono environment (bindings, variables) shared by all workers
2. **API Response Types** - Standardize response envelopes for all endpoints (single-item, paginated lists, errors)
3. **Authentication Context** - Provide typed contexts for authenticated routes with user, session, and request metadata
4. **Integration Types** - Export types from service packages for use in worker responses

### Why This Package Exists

Without shared types, workers would lack:
- Compile-time guarantees that responses match API contracts
- Type safety when accessing middleware-set context variables
- Consistent pagination and response envelope structures
- Clear contracts for authentication and authorization contexts

With shared types, all components share:
- A single definition of `HonoEnv` used by all workers
- Identical pagination metadata across all list endpoints
- Type-safe access to user, session, and organization context
- Compile-time verification that API responses match expected shapes

## Public API

All types are exported from the main entry point (`@codex/shared-types`) and the worker entry point (`@codex/shared-types/worker`).

### Worker Environment Types

| Type | Purpose | Usage |
|------|---------|-------|
| `HonoEnv` | Complete Hono environment with bindings and variables | Type parameter for Hono app: `new Hono<HonoEnv>()` |
| `Bindings` | Cloudflare Workers bindings (env vars, KV, R2, database) | Access via `c.env` in route handlers |
| `Variables` | Context variables set by middleware during request processing | Access via `c.get('session')`, `c.get('user')`, etc. |
| `SessionData` | Minimal session information from auth system | Set by requireAuth middleware |
| `UserData` | User information needed for API operations | Set by requireAuth middleware |
| `AuthenticatedContext` | Typed context guaranteeing authenticated user is present | Used in route handler type signatures |
| `EnrichedAuthContext` | Extended context with request metadata for auditing | Used in route handlers needing full request tracking |

### API Response Types

| Type | HTTP Response | Usage |
|------|---------------|-------|
| `SingleItemResponse<T>` | 200 OK, 201 Created | GET single item, POST create, PATCH update |
| `PaginatedListResponse<T>` | 200 OK | GET list with pagination |
| `PaginationMetadata` | Embedded in paginated responses | Pagination info: page, limit, total, totalPages |
| `SuccessResponse<T>` | Generic success wrapper | Fallback for custom response shapes |
| `ErrorResponse` | 4xx, 5xx errors | Standard error envelope with code, message, details |

### Content Response Types

| Type | HTTP Endpoint | Response Shape |
|------|---------------|-----------------|
| `ContentResponse` | GET /api/content/:id | `{ data: ContentWithRelations }` |
| `ContentListResponse` | GET /api/content | `{ items: ContentWithRelations[], pagination: PaginationMetadata }` |
| `CreateContentResponse` | POST /api/content | `{ data: Content }` |
| `UpdateContentResponse` | PATCH /api/content/:id | `{ data: Content }` |
| `PublishContentResponse` | POST /api/content/:id/publish | `{ data: Content }` |
| `UnpublishContentResponse` | POST /api/content/:id/unpublish | `{ data: Content }` |
| `DeleteContentResponse` | DELETE /api/content/:id | `null` (204 No Content) |

### Media Response Types

| Type | HTTP Endpoint | Response Shape |
|------|---------------|-----------------|
| `MediaResponse` | GET /api/media/:id | `{ data: MediaItemWithRelations }` |
| `MediaListResponse` | GET /api/media | `{ items: MediaItemWithRelations[], pagination: PaginationMetadata }` |
| `CreateMediaResponse` | POST /api/media | `{ data: MediaItem }` |
| `UpdateMediaResponse` | PATCH /api/media/:id | `{ data: MediaItem }` |
| `DeleteMediaResponse` | DELETE /api/media/:id | `null` (204 No Content) |

### Content Access Response Types

| Type | HTTP Endpoint | Purpose |
|------|---------------|---------|
| `StreamingUrlResponse` | GET /api/access/content/:id/stream | Signed streaming URL with expiration |
| `PlaybackProgressResponse` | GET /api/access/content/:id/progress | Current playback position or null |
| `UpdatePlaybackProgressResponse` | POST /api/access/content/:id/progress | `null` (204 No Content) |
| `UserLibraryResponse` | GET /api/access/user/library | User's purchased content with progress |

### Organization Response Types

| Type | HTTP Endpoint | Response Shape |
|------|---------------|-----------------|
| `OrganizationResponse` | GET /api/organizations/:id | `{ data: Organization }` |
| `OrganizationListResponse` | GET /api/organizations | `{ items: Organization[], pagination: PaginationMetadata }` |
| `OrganizationBySlugResponse` | GET /api/organizations/slug/:slug | `{ data: Organization }` |
| `CreateOrganizationResponse` | POST /api/organizations | `{ data: Organization }` |
| `UpdateOrganizationResponse` | PATCH /api/organizations/:id | `{ data: Organization }` |
| `DeleteOrganizationResponse` | DELETE /api/organizations/:id | `{ success: true, message: string }` |
| `CheckSlugResponse` | GET /api/organizations/check-slug/:slug | `{ available: boolean }` |

## Worker Environment Types - Detailed Specification

### HonoEnv

The complete Hono environment type combining bindings and variables. Use this as the type parameter for all Hono apps.

```typescript
type HonoEnv = {
  Bindings: Bindings;
  Variables: Variables;
};
```

**Usage in route handlers:**

```typescript
import { Hono } from 'hono';
import type { HonoEnv } from '@codex/shared-types';

const app = new Hono<HonoEnv>();

app.get('/example', (c) => {
  // c.env is typed as Bindings
  const dbUrl = c.env.DATABASE_URL;

  // c.get() returns typed Variables
  const user = c.get('user');
  const session = c.get('session');

  return c.json({ message: 'ok' });
});
```

### Bindings

Environment variables and Cloudflare resources available to all workers. Includes:
- Database connection (PostgreSQL via Neon)
- CORS configuration (web app and API URLs)
- Cloudflare KV for rate limiting
- R2 bucket and credentials for media storage
- Environment name (development, staging, production)

```typescript
export type Bindings = {
  ENVIRONMENT?: string;           // 'development' | 'staging' | 'production'
  DATABASE_URL?: string;          // PostgreSQL connection string
  DB_METHOD?: string;             // 'PRODUCTION' (pooling) | 'LOCAL' (direct)
  WEB_APP_URL?: string;           // https://app.example.com
  API_URL?: string;               // https://api.example.com
  RATE_LIMIT_KV?: KVNamespace;    // KV namespace for rate limiting
  MEDIA_BUCKET?: R2Bucket;        // R2 bucket for media files
  R2_ACCOUNT_ID?: string;         // Cloudflare account ID
  R2_ACCESS_KEY_ID?: string;      // R2 API access key
  R2_SECRET_ACCESS_KEY?: string;  // R2 API secret key
  R2_BUCKET_MEDIA?: string;       // R2 bucket name
};
```

**Accessing bindings in route handlers:**

```typescript
// Through Hono context
app.post('/upload', (c) => {
  const bucket = c.env.MEDIA_BUCKET;
  const accountId = c.env.R2_ACCOUNT_ID;

  return c.json({ bucket });
});
```

### Variables

Context variables set by middleware during request processing. Access via `c.get()` in route handlers. Middleware populates these based on:
- Authentication (session, user from auth middleware)
- Request tracking (requestId, clientIP, userAgent)
- Organization scoping (organizationId, organizationRole)
- Internal request authentication (workerAuth)

```typescript
export type Variables = {
  session?: SessionData;              // Set by requireAuth middleware
  user?: UserData;                    // Set by requireAuth middleware
  obs?: unknown;                      // Observability client
  requestId?: string;                 // Request tracking ID
  clientIP?: string;                  // Extracted from CF-Connecting-IP
  userAgent?: string;                 // For analytics and security
  workerAuth?: boolean;               // Worker-to-worker HMAC auth
  organizationId?: string;            // Multi-tenant organization scope
  organizationRole?: string;          // User role within organization
  organizationMembership?: {          // Full membership details
    role: string;
    status: string;
    joinedAt: Date;
  };
};
```

**Accessing variables in route handlers:**

```typescript
app.get('/my-data', (c) => {
  // Type-safe access to middleware-set variables
  const user = c.get('user');              // UserData | undefined
  const requestId = c.get('requestId');    // string | undefined
  const orgId = c.get('organizationId');   // string | undefined

  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return c.json({ user });
});
```

### SessionData

Minimal session information from the authentication system. Set by `requireAuth` middleware.

```typescript
export type SessionData = {
  id: string;                  // Session ID
  userId: string;              // User ID from auth system
  expiresAt: Date | string;    // Session expiration time
  token?: string;              // Optional session token
  [key: string]: unknown;      // Allows extensions by auth system
};
```

### UserData

User information needed for API operations. Set by `requireAuth` middleware.

```typescript
export type UserData = {
  id: string;                  // User ID
  email: string;               // User email address
  name: string | null;         // User display name (nullable)
  role: string;                // User role (e.g., 'user', 'admin', 'creator')
  emailVerified: boolean;       // Email verification status
  createdAt: Date | string;    // Account creation timestamp
  [key: string]: unknown;      // Allows extensions by auth system
};
```

**Example middleware that sets user and session:**

```typescript
app.use(async (c, next) => {
  const token = c.req.header('Authorization');
  if (!token) {
    return await next();
  }

  // Validate token and extract user
  const user: UserData = {
    id: 'user_123',
    email: 'user@example.com',
    name: 'John Doe',
    role: 'creator',
    emailVerified: true,
    createdAt: new Date(),
  };

  const session: SessionData = {
    id: 'session_123',
    userId: user.id,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    token,
  };

  c.set('user', user);
  c.set('session', session);

  await next();
});
```

### AuthenticatedContext

Typed context that guarantees the authenticated user is present (used after auth middleware). Provides convenient access to user, session, and bindings.

```typescript
export type AuthenticatedContext<TEnv = HonoEnv> = {
  user: Required<NonNullable<Variables['user']>>;  // User is guaranteed to exist
  session: Variables['session'];                    // Session may be present
  env: TEnv extends { Bindings: infer B } ? B : Bindings;
};
```

**Usage in route handlers that require authentication:**

```typescript
import type { AuthenticatedContext } from '@codex/shared-types';

export async function getUserProfile(ctx: AuthenticatedContext) {
  // user is guaranteed to exist here (TypeScript enforces this)
  console.log(ctx.user.id);
  console.log(ctx.user.email);

  return {
    user: ctx.user,
    sessionId: ctx.session?.id,
  };
}
```

### EnrichedAuthContext

Extended context with request metadata for security auditing, logging, and tracking. Includes all `AuthenticatedContext` fields plus:
- Request ID for correlation
- Client IP for security logging
- User agent for bot detection
- Organization scope (if applicable)
- Permissions array (derived from user role)

```typescript
export type EnrichedAuthContext<TEnv = HonoEnv> = AuthenticatedContext<TEnv> & {
  requestId: string;              // Unique request identifier
  clientIP: string;               // Client IP from CF-Connecting-IP
  userAgent: string;              // For security auditing
  organizationId?: string;        // If request is org-scoped
  permissions: string[];          // Permissions based on role + membership
};
```

**Usage in route handlers needing full context:**

```typescript
import type { EnrichedAuthContext } from '@codex/shared-types';

app.post('/api/sensitive-operation', (c) => {
  const ctx: EnrichedAuthContext = {
    user: c.get('user')!,
    session: c.get('session'),
    env: c.env,
    requestId: c.get('requestId')!,
    clientIP: c.get('clientIP')!,
    userAgent: c.get('userAgent')!,
    organizationId: c.get('organizationId'),
    permissions: ['user:write', 'org:admin'],
  };

  // Log for audit trail
  console.log(`User ${ctx.user.id} performing operation`, {
    requestId: ctx.requestId,
    clientIP: ctx.clientIP,
    organizationId: ctx.organizationId,
  });

  return c.json({ success: true });
});
```

## API Response Types - Detailed Specification

### Response Envelopes

All API responses follow standardized envelope formats for predictable client handling.

#### SingleItemResponse<T>

Wrapper for single-item responses (GET by ID, POST create, PATCH update).

```typescript
export interface SingleItemResponse<T> {
  data: T;
}
```

**Example - fetching a single content item:**

```typescript
// Request: GET /api/content/content_123
// Response:
{
  "data": {
    "id": "content_123",
    "title": "Video Title",
    "description": "...",
    "creatorId": "user_456",
    "published": true,
    "createdAt": "2025-01-23T10:00:00Z",
    "updatedAt": "2025-01-23T15:30:00Z",
    "contentType": {
      "id": "type_video",
      "name": "Video"
    }
  }
}
```

**Type-safe handling in frontend:**

```typescript
import type { ContentResponse } from '@codex/shared-types';

async function getContent(id: string): Promise<ContentResponse> {
  const res = await fetch(`/api/content/${id}`);
  return res.json();
}

const response = await getContent('content_123');
console.log(response.data.title);  // TypeScript knows this is a string
```

#### PaginatedListResponse<T>

Wrapper for list responses with pagination metadata.

```typescript
export interface PaginatedListResponse<T> {
  items: T[];
  pagination: PaginationMetadata;
}

export interface PaginationMetadata {
  page: number;       // Current page (1-indexed)
  limit: number;      // Items per page
  total: number;      // Total items across all pages
  totalPages: number; // Total number of pages
}
```

**Example - fetching a paginated list:**

```typescript
// Request: GET /api/content?page=2&limit=20
// Response:
{
  "items": [
    { "id": "content_1", "title": "...", ... },
    { "id": "content_2", "title": "...", ... }
  ],
  "pagination": {
    "page": 2,
    "limit": 20,
    "total": 145,
    "totalPages": 8
  }
}
```

**Type-safe handling in frontend:**

```typescript
import type { ContentListResponse } from '@codex/shared-types';

async function listContent(page: number, limit: number): Promise<ContentListResponse> {
  const res = await fetch(`/api/content?page=${page}&limit=${limit}`);
  return res.json();
}

const response = await listContent(2, 20);
response.items.forEach(item => {
  console.log(item.title);
});
console.log(`Page ${response.pagination.page} of ${response.pagination.totalPages}`);
```

### Error Response

Standard error envelope for all error responses (4xx, 5xx).

```typescript
export type ErrorResponse = {
  error: {
    code: string;        // Error code: 'INVALID_INPUT', 'NOT_FOUND', 'UNAUTHORIZED', etc.
    message: string;     // Human-readable error message
    details?: unknown;   // Optional additional details (validation errors, etc.)
  };
};
```

**Example error responses:**

```typescript
// 400 Bad Request - validation error
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "Validation failed",
    "details": {
      "title": ["Title is required"],
      "description": ["Description must be less than 500 characters"]
    }
  }
}

// 404 Not Found
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Content not found with ID: content_123"
  }
}

// 401 Unauthorized
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required"
  }
}

// 403 Forbidden
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to access this resource"
  }
}
```

**Type-safe error handling in frontend:**

```typescript
import type { ErrorResponse } from '@codex/shared-types';

async function fetchContent(id: string) {
  try {
    const res = await fetch(`/api/content/${id}`);
    if (!res.ok) {
      const error: ErrorResponse = await res.json();
      console.error(`Error ${error.error.code}: ${error.error.message}`);
    }
    return await res.json();
  } catch (err) {
    console.error('Network error', err);
  }
}
```

### Success Response

Generic success wrapper (used less commonly—most endpoints use SingleItemResponse or PaginatedListResponse).

```typescript
export type SuccessResponse<T> = {
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    hasMore?: boolean;
    [key: string]: unknown;
  };
};
```

## Content Access Response Types - Detailed Specification

### StreamingUrlResponse

Response from GET /api/access/content/:id/stream. Provides a signed streaming URL for content playback.

```typescript
export interface StreamingUrlResponse {
  streamingUrl: string;  // Signed URL from R2 with expiration
  expiresAt: string;     // ISO 8601 timestamp when URL expires
  contentType: string;   // MIME type: 'video/mp4', 'audio/mpeg', etc.
}
```

**Example:**

```typescript
// Request: GET /api/access/content/content_123/stream
// Response:
{
  "streamingUrl": "https://r2.example.com/media/content_123.mp4?X-Amz-Signature=...",
  "expiresAt": "2025-01-23T17:30:00Z",
  "contentType": "video/mp4"
}
```

**Usage in video player:**

```typescript
import type { StreamingUrlResponse } from '@codex/shared-types';

async function getStreamingUrl(contentId: string): Promise<StreamingUrlResponse> {
  const res = await fetch(`/api/access/content/${contentId}/stream`);
  return res.json();
}

const { streamingUrl, contentType } = await getStreamingUrl('content_123');

// Configure video element with signed URL
const video = document.querySelector('video');
video.src = streamingUrl;
video.type = contentType;
```

### PlaybackProgressResponse

Response from GET /api/access/content/:id/progress. Returns current playback position or null if not started.

```typescript
export interface PlaybackProgressResponse {
  progress: {
    positionSeconds: number;    // Current position in content
    durationSeconds: number;    // Total duration of content
    completed: boolean;         // Whether content was fully watched
    updatedAt: string;          // ISO 8601 timestamp of last update
  } | null;                     // null if not started
}
```

**Example:**

```typescript
// Request: GET /api/access/content/content_123/progress
// Response - if started:
{
  "progress": {
    "positionSeconds": 1200,
    "durationSeconds": 3600,
    "completed": false,
    "updatedAt": "2025-01-23T14:30:00Z"
  }
}

// Response - if not started:
{
  "progress": null
}
```

**Usage in progress tracking:**

```typescript
import type { PlaybackProgressResponse } from '@codex/shared-types';

async function getProgress(contentId: string): Promise<PlaybackProgressResponse> {
  const res = await fetch(`/api/access/content/${contentId}/progress`);
  return res.json();
}

const response = await getProgress('content_123');
if (response.progress) {
  const percent = (response.progress.positionSeconds / response.progress.durationSeconds) * 100;
  console.log(`Progress: ${percent}%`);
} else {
  console.log('Not started yet');
}
```

### UpdatePlaybackProgressResponse

Response from POST /api/access/content/:id/progress. Returns null (204 No Content response).

```typescript
export type UpdatePlaybackProgressResponse = null;
```

**Usage in progress update:**

```typescript
async function updateProgress(contentId: string, positionSeconds: number): Promise<void> {
  const res = await fetch(`/api/access/content/${contentId}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positionSeconds }),
  });

  if (res.status === 204) {
    console.log('Progress updated');
  }
}
```

### UserLibraryResponse

Response from GET /api/access/user/library. Returns user's purchased content with purchase info and playback progress.

```typescript
export interface UserLibraryResponse {
  items: Array<{
    content: {
      id: string;
      title: string;
      description: string;
      thumbnailUrl: string | null;
      contentType: string;
      durationSeconds: number;
    };
    purchase: {
      purchasedAt: string;  // ISO 8601 timestamp
      priceCents: number;   // Price in cents
    };
    progress: {
      positionSeconds: number;
      durationSeconds: number;
      completed: boolean;
      percentComplete: number;  // 0-100
      updatedAt: string;
    } | null;
  }>;
  pagination: PaginationMetadata;
}
```

**Example:**

```typescript
// Request: GET /api/access/user/library?page=1&limit=10
// Response:
{
  "items": [
    {
      "content": {
        "id": "content_123",
        "title": "Advanced TypeScript",
        "description": "...",
        "thumbnailUrl": "https://...",
        "contentType": "video",
        "durationSeconds": 3600
      },
      "purchase": {
        "purchasedAt": "2025-01-15T10:00:00Z",
        "priceCents": 2999
      },
      "progress": {
        "positionSeconds": 1200,
        "durationSeconds": 3600,
        "completed": false,
        "percentComplete": 33.33,
        "updatedAt": "2025-01-23T14:30:00Z"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 5,
    "totalPages": 1
  }
}
```

**Type-safe usage in frontend:**

```typescript
import type { UserLibraryResponse } from '@codex/shared-types';

async function getUserLibrary(): Promise<UserLibraryResponse> {
  const res = await fetch('/api/access/user/library?page=1&limit=20');
  return res.json();
}

const library = await getUserLibrary();
library.items.forEach(item => {
  const percentComplete = item.progress?.percentComplete ?? 0;
  console.log(`${item.content.title}: ${percentComplete}% complete`);
});
```

## Usage Examples

### Basic Worker Setup

Create a Hono worker with types from shared-types:

```typescript
import { Hono } from 'hono';
import type { HonoEnv } from '@codex/shared-types';

const app = new Hono<HonoEnv>();

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    environment: c.env.ENVIRONMENT,
  });
});

export default app;
```

### Typed Route Handler with Authentication

Use AuthenticatedContext for routes requiring authentication:

```typescript
import { Hono } from 'hono';
import type {
  AuthenticatedContext,
  HonoEnv,
  UserData,
} from '@codex/shared-types';

const app = new Hono<HonoEnv>();

// Helper to create typed handler
async function requireAuth(c): AuthenticatedContext {
  const user = c.get('user');
  const session = c.get('session');

  if (!user) {
    throw new Error('Authentication required');
  }

  return {
    user,
    session,
    env: c.env,
  };
}

// Route using authenticated context
app.get('/api/profile', async (c) => {
  const ctx = await requireAuth(c);

  return c.json({
    data: {
      id: ctx.user.id,
      email: ctx.user.email,
      role: ctx.user.role,
    },
  });
});

export default app;
```

### Handling API Response Types

Type-safe response handling in route handlers:

```typescript
import type {
  ContentResponse,
  ContentListResponse,
  CreateContentResponse,
} from '@codex/shared-types';
import { ContentService } from '@codex/content';

// Single item response
app.get('/api/content/:id', async (c): Promise<ContentResponse> => {
  const id = c.req.param('id');
  const service = new ContentService({ db: dbHttp });
  const content = await service.getById(id);

  return c.json({ data: content });
});

// Paginated list response
app.get('/api/content', async (c): Promise<ContentListResponse> => {
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '20');

  const service = new ContentService({ db: dbHttp });
  const { items, total } = await service.list({ page, limit });

  return c.json({
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// Create response
app.post('/api/content', async (c): Promise<CreateContentResponse> => {
  const body = await c.req.json();
  const service = new ContentService({ db: dbHttp });
  const content = await service.create(body, c.get('user').id);

  return c.json({ data: content }, 201);
});
```

### Accessing Variables in Middleware

Middleware can read and write to context variables:

```typescript
import type { HonoEnv, Variables } from '@codex/shared-types';
import { Hono } from 'hono';

const app = new Hono<HonoEnv>();

// Request tracking middleware
app.use(async (c, next) => {
  const requestId = crypto.randomUUID();
  const clientIP = c.req.header('CF-Connecting-IP') || 'unknown';

  c.set('requestId', requestId);
  c.set('clientIP', clientIP);

  console.log(`[${requestId}] ${c.req.method} ${c.req.path} from ${clientIP}`);

  await next();
});

// Authenticated routes can access these variables
app.get('/api/data', (c) => {
  const requestId = c.get('requestId');
  const user = c.get('user');

  return c.json({
    requestId,
    userId: user?.id,
  });
});

export default app;
```

### Organization-Scoped Routes

Using organization context variables:

```typescript
app.post('/api/organizations/:orgId/members', async (c) => {
  const orgId = c.req.param('orgId');
  const userOrgId = c.get('organizationId');
  const userRole = c.get('organizationRole');

  // Verify user belongs to this organization
  if (userOrgId !== orgId) {
    return c.json(
      { error: { code: 'FORBIDDEN', message: 'Not a member of this organization' } },
      403
    );
  }

  // Verify user has admin role
  if (userRole !== 'admin') {
    return c.json(
      { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
      403
    );
  }

  // Perform operation
  return c.json({ success: true });
});
```

### Error Handling

Type-safe error handling:

```typescript
import type { ErrorResponse } from '@codex/shared-types';

app.onError((err, c) => {
  const errorResponse: ErrorResponse = {
    error: {
      code: 'INTERNAL_ERROR',
      message: err.message || 'An error occurred',
      details: {
        path: c.req.path,
        method: c.req.method,
      },
    },
  };

  return c.json(errorResponse, 500);
});
```

## Integration Points

### Packages That Use These Types

| Package | Purpose | How It Uses Types |
|---------|---------|------------------|
| `@codex/worker-utils` | Worker middleware and utilities | Imports `HonoEnv`, `Bindings`, `Variables` for middleware type signatures |
| `@codex/content` | Content service layer | Exports `Content`, `ContentWithRelations` used in response types |
| `@codex/identity` | Identity service layer | Exports `Organization` used in response types |
| `@codex/access` | Content access service | Imports response types for service-level type safety |
| `@codex/security` | Security utilities | Imports `Variables` for auth context |

### Workers That Use These Types

| Worker | Entry Point | Usage |
|--------|------------|-------|
| `content-api` | `src/index.ts` | Uses `HonoEnv`, all content response types, `AuthenticatedContext` |
| `identity-api` | `src/index.ts` | Uses `HonoEnv`, organization response types, `AuthenticatedContext` |
| `auth` | `src/index.ts` | Uses `SessionData`, `UserData`, `Bindings` for session management |
| `stripe-webhook-handler` | `src/index.ts` | Uses `Bindings` for environment access |

### How Shared Types Enable Type Safety

```typescript
// Without shared types - manual response typing in each route
app.get('/api/content/:id', (c) => {
  // No type checking - response could be any shape
  return c.json({
    data: {
      id: '...',
      title: '...',
      // Typos not caught
      titlee: '...',
    },
  });
});

// With shared types - compile-time verification
import type { ContentResponse } from '@codex/shared-types';

app.get('/api/content/:id', async (c): Promise<ContentResponse> => {
  // TypeScript ensures response matches ContentResponse shape
  // Any deviation causes compile error
  const content = await service.getById(id);
  return c.json({ data: content });
});
```

This integration ensures:
- Frontend can import types and match backend contracts
- Services export types that workers import for responses
- Type errors caught at compile time, not runtime
- Contracts enforced across all components

## Type Safety - How Types Ensure Correctness

### Compile-Time Guarantees

Types from shared-types provide these guarantees:

1. **Response Shape Validation** - Endpoint responses must match their declared type

```typescript
// This compiles
async function createContent(): Promise<CreateContentResponse> {
  return { data: { id: '123', title: 'Video' } };
}

// This fails to compile - missing required field 'id'
async function createContent(): Promise<CreateContentResponse> {
  return { data: { title: 'Video' } };  // Type error
}
```

2. **Context Variable Access** - Variables can only be accessed with correct names

```typescript
const user = c.get('user');           // OK - correct variable
const userData = c.get('userData');   // Type error - variable doesn't exist
```

3. **Bindings Access** - Environment variables are properly typed

```typescript
const dbUrl = c.env.DATABASE_URL;    // string | undefined
const bucket = c.env.MEDIA_BUCKET;   // R2Bucket | undefined

// Type system ensures proper null checks
const databaseUrl: string = c.env.DATABASE_URL;  // Error - may be undefined
const databaseUrl: string | undefined = c.env.DATABASE_URL;  // OK
```

4. **Authentication Context** - AuthenticatedContext guarantees user is present

```typescript
// Without guarantee - need manual checks
function myRoute(c) {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  console.log(user.id);  // Type: string
}

// With guarantee - user is guaranteed
function myRoute(ctx: AuthenticatedContext) {
  console.log(ctx.user.id);  // No check needed - compiler guarantees user exists
}
```

5. **Pagination Consistency** - All list responses have identical pagination structure

```typescript
// Type system ensures all paginated responses use PaginationMetadata
const contentList: ContentListResponse = ...;
const mediaList: MediaListResponse = ...;

// Both have .pagination.page, .pagination.total, etc.
// Same structure across all endpoints
contentList.pagination.page;  // Works
mediaList.pagination.page;    // Works
```

### Runtime Safety Through Proper Typing

```typescript
// Frontend code has type safety
import type {
  ContentListResponse,
  UserLibraryResponse,
} from '@codex/shared-types';

async function example() {
  const content: ContentListResponse = await fetch('/api/content').then(r => r.json());

  // These work - types match
  content.items.forEach(item => console.log(item.title));
  const page = content.pagination.page;

  // These fail at compile time
  const pageCount = content.pagination.pageCount;  // Error - property doesn't exist
  const owner = content.items[0].owner;            // Error - Content doesn't have owner
}
```

## Testing - Using Types in Tests

### Testing Type Definitions

Verify types are correct using type tests:

```typescript
// test/types.test.ts
import type {
  ContentResponse,
  HonoEnv,
  AuthenticatedContext,
  UserData,
} from '@codex/shared-types';

// Type assertion tests verify shape correctness
function testContentResponseType() {
  const response: ContentResponse = {
    data: {
      id: 'content_123',
      title: 'Test Content',
      description: 'Test',
      creatorId: 'user_123',
      published: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  // Compile succeeds - type is correct
  expect(response.data.title).toBe('Test Content');
}

// This would fail to compile (type checking)
function testMissingField() {
  const response: ContentResponse = {
    data: {
      id: 'content_123',
      // Missing required fields - compile error
    },
  };
}
```

### Testing Route Handlers with Typed Context

Use types to test route handlers:

```typescript
import type { HonoEnv, Variables } from '@codex/shared-types';
import { Context } from 'hono';

describe('Route Handlers', () => {
  // Create typed context for testing
  function createMockContext(): Context<HonoEnv> {
    const mockEnv: HonoEnv['Bindings'] = {
      ENVIRONMENT: 'test',
      DATABASE_URL: 'postgresql://localhost/test',
    };

    const mockVariables: HonoEnv['Variables'] = {
      user: {
        id: 'user_123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
        emailVerified: true,
        createdAt: new Date(),
      },
      requestId: 'req_123',
      clientIP: '127.0.0.1',
    };

    const context = new Context({} as any, {
      env: mockEnv,
      executionCtx: {} as any,
    });

    Object.entries(mockVariables).forEach(([key, value]) => {
      context.set(key as any, value);
    });

    return context;
  }

  test('authenticated route handler', async () => {
    const c = createMockContext();

    const user = c.get('user');
    expect(user?.id).toBe('user_123');
    expect(user?.email).toBe('test@example.com');
  });
});
```

### Testing Response Types

Verify API responses match declared types:

```typescript
import type {
  ContentListResponse,
  PaginatedListResponse,
} from '@codex/shared-types';

describe('API Responses', () => {
  test('list endpoint returns typed response', async () => {
    const response: ContentListResponse = {
      items: [
        {
          id: 'content_1',
          title: 'Test',
          description: '',
          creatorId: 'user_1',
          published: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      pagination: {
        page: 1,
        limit: 20,
        total: 100,
        totalPages: 5,
      },
    };

    expect(response.items).toHaveLength(1);
    expect(response.pagination.totalPages).toBe(5);
  });

  test('pagination metadata is consistent', async () => {
    const response: ContentListResponse = await fetchContent();

    // Type system ensures these properties exist
    const { page, limit, total, totalPages } = response.pagination;

    expect(page).toBeGreaterThan(0);
    expect(limit).toBeGreaterThan(0);
    expect(total).toBeGreaterThanOrEqual(0);
    expect(totalPages).toBe(Math.ceil(total / limit));
  });
});
```

### Mocking Types in Tests

Use types to create type-safe mocks:

```typescript
import type {
  UserData,
  SessionData,
  AuthenticatedContext,
} from '@codex/shared-types';

function createMockUser(overrides?: Partial<UserData>): UserData {
  return {
    id: 'user_123',
    email: 'test@example.com',
    name: 'Test User',
    role: 'user',
    emailVerified: true,
    createdAt: new Date(),
    ...overrides,
  };
}

function createMockSession(overrides?: Partial<SessionData>): SessionData {
  return {
    id: 'session_123',
    userId: 'user_123',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

function createMockAuthContext(
  overrides?: Partial<AuthenticatedContext>
): AuthenticatedContext {
  return {
    user: createMockUser(),
    session: createMockSession(),
    env: {
      ENVIRONMENT: 'test',
      DATABASE_URL: 'postgresql://localhost/test',
    },
    ...overrides,
  };
}

describe('Service Tests', () => {
  test('service with authenticated context', () => {
    const ctx = createMockAuthContext({
      user: createMockUser({ role: 'admin' }),
    });

    expect(ctx.user.role).toBe('admin');
    expect(ctx.session?.userId).toBe('user_123');
  });
});
```

### Testing Type Guards

Verify type narrowing works correctly:

```typescript
import type {
  PlaybackProgressResponse,
  UserLibraryResponse,
} from '@codex/shared-types';

describe('Type Guards', () => {
  test('playback progress handles null safely', () => {
    const response1: PlaybackProgressResponse = { progress: null };
    const response2: PlaybackProgressResponse = {
      progress: {
        positionSeconds: 100,
        durationSeconds: 3600,
        completed: false,
        updatedAt: '2025-01-23T10:00:00Z',
      },
    };

    // Type system enforces null checking
    if (response1.progress) {
      const percent = (response1.progress.positionSeconds / response1.progress.durationSeconds) * 100;
    }

    if (response2.progress) {
      // This block executes - response2.progress is not null
      const percent = (response2.progress.positionSeconds / response2.progress.durationSeconds) * 100;
      expect(percent).toBeGreaterThan(0);
    }
  });

  test('user library response typing', () => {
    const library: UserLibraryResponse = {
      items: [
        {
          content: {
            id: 'content_1',
            title: 'Course',
            description: 'Learn TypeScript',
            thumbnailUrl: null,
            contentType: 'video',
            durationSeconds: 3600,
          },
          purchase: {
            purchasedAt: '2025-01-15T10:00:00Z',
            priceCents: 2999,
          },
          progress: {
            positionSeconds: 1200,
            durationSeconds: 3600,
            completed: false,
            percentComplete: 33.33,
            updatedAt: '2025-01-23T14:30:00Z',
          },
        },
      ],
      pagination: {
        page: 1,
        limit: 10,
        total: 5,
        totalPages: 1,
      },
    };

    library.items.forEach(item => {
      expect(item.content.id).toBeDefined();
      expect(item.purchase.priceCents).toBeGreaterThan(0);

      // Progress may be null, so check before accessing
      if (item.progress) {
        expect(item.progress.percentComplete).toBeLessThanOrEqual(100);
      }
    });
  });
});
```

### Integration Tests Using Shared Types

```typescript
import type { ContentResponse } from '@codex/shared-types';

describe('Integration Tests', () => {
  test('endpoint returns properly typed response', async () => {
    const response = await fetch('http://localhost:8000/api/content/content_123');
    const json: ContentResponse = await response.json();

    // Type safety in test assertions
    expect(json.data.id).toBeDefined();
    expect(json.data.title).toBeTypeOf('string');
    expect(json.data.published).toBeTypeOf('boolean');
  });
});
```

## Building and Development

### Build Configuration

The package builds TypeScript types using Vite with `vite-plugin-dts`:

```bash
# Development (watch mode)
npm run dev

# Production build
npm run build

# Type checking
npm run typecheck

# Linting and formatting
npm run lint
npm run format
```

Build output:
- `dist/index.d.ts` - Main type definitions (default export)
- `dist/worker-types.d.ts` - Worker-specific types (subpath export)

### Usage in Other Packages

Import from the main entry point:

```typescript
import type {
  HonoEnv,
  ContentResponse,
  AuthenticatedContext,
} from '@codex/shared-types';
```

Or import worker types via subpath:

```typescript
import type { HonoEnv, Bindings } from '@codex/shared-types/worker';
```

### Package Structure

```
packages/shared-types/
├── src/
│   ├── index.ts              # Main exports (re-exports from other files)
│   ├── worker-types.ts       # Hono environment, bindings, variables, auth contexts
│   └── api-responses.ts      # API response types and pagination
├── dist/                     # Compiled type definitions
├── package.json              # Package metadata and build scripts
├── tsconfig.json             # TypeScript configuration
├── vite.config.shared-types.ts # Build configuration
└── README.md                 # This file
```

## Summary

`@codex/shared-types` provides the foundational type definitions that enable type-safe communication across all Codex platform components. Every worker, service, and integration point depends on these types to ensure:

- **Consistency** - All responses follow the same envelope structure
- **Type Safety** - Compile-time verification of correct usage
- **Clarity** - Clear contracts between components
- **Maintainability** - Single source of truth for type definitions
- **Developer Experience** - IDE autocomplete and inline documentation

By importing and using types from this package, developers ensure their code is type-safe, maintainable, and consistent with the rest of the platform.

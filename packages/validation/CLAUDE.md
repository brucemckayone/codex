# @codex/validation

Comprehensive Zod schema library for request validation and type inference across the Codex platform. Provides centralized, reusable validation schemas for all API endpoints, services, and data operations.

## Overview

The `@codex/validation` package is a foundational library that implements the input validation strategy for Codex. It serves as the single source of truth for data validation rules, ensuring consistent validation behavior across workers, services, and packages.

**Primary responsibility**: Define and enforce validation rules for all user-generated input, database constraints, and API contracts.

**Why it exists**: Validation logic is complex and must be consistent everywhere input is accepted. By centralizing schemas, we ensure:
- Single source of truth for validation rules
- Type-safe inference from Zod schemas (TypeScript `z.infer`)
- Reusability across workers and services
- Easy maintenance when validation rules change
- Security enforcement (XSS prevention, path traversal prevention, constraint validation)

**Key features**:
- Zod-based schema definitions for all content, identity, and access operations
- Custom validators for URLs, slugs, file paths, and pricing
- Type inference for compile-time type safety
- Security-focused validation (regex patterns, custom refinements)
- Comprehensive error messages for API responses
- Database constraint alignment (enums match CHECK constraints)

## Architecture

The package is organized into domain-specific modules:

- **primitives.ts**: Reusable primitive validators (UUIDs, URLs, slugs, numbers, strings)
- **content/content-schemas.ts**: Content, media, and organization schemas
- **identity/user-schema.ts**: User authentication schemas
- **schemas/access.ts**: Content access and streaming schemas
- **shared/**: Pagination and common query schemas

Each module exports both Zod schemas (for validation) and TypeScript types (inferred from schemas using `z.infer<typeof schema>`).

## Public API

### Primitive Validators

Core building blocks for composing larger schemas. Designed for reuse across domain-specific schemas.

| Export | Type | Purpose | Usage |
|--------|------|---------|-------|
| `uuidSchema` | ZodSchema | Validates UUID v4 format | Primary/foreign key validation |
| `createSlugSchema(maxLength)` | Function | Validates URL-safe slugs | Organization/content slugs |
| `urlSchema` | ZodSchema | Validates HTTP/HTTPS URLs | Website URLs, image URLs |
| `priceCentsSchema` | ZodSchema | Validates pricing (integer cents) | Content pricing |
| `positiveIntSchema` | ZodSchema | Validates positive integers | Page numbers, limits |
| `nonNegativeIntSchema` | ZodSchema | Validates non-negative integers | Duration, position, count |
| `createSanitizedStringSchema(min, max, fieldName)` | Function | Validates trimmed strings with bounds | Titles, names, descriptions |
| `createOptionalTextSchema(maxLength, fieldName)` | Function | Validates optional text with max length | Descriptions, optional fields |
| `emailSchema` | ZodSchema | Validates email format | Email addresses |
| `createIdParamsSchema()` | Function | Validates route param `{ id: string }` | GET/PATCH/DELETE /:id routes |
| `createSlugParamsSchema(maxLength)` | Function | Validates route param `{ slug: string }` | GET /:slug routes |

### Content Schemas

Validation for organizations, media items, and content creation/updates.

#### Organization Schemas

```typescript
// Create organization input validation
createOrganizationSchema: ZodSchema<CreateOrganizationInput>
type CreateOrganizationInput = {
  name: string;              // 1-255 characters
  slug: string;              // lowercase a-z0-9-, no leading/trailing hyphens
  description?: string;      // optional, max 5000 chars
  logoUrl?: string | null;   // optional HTTP/HTTPS URL
  websiteUrl?: string | null;// optional HTTP/HTTPS URL
}

// Update organization (all fields optional)
updateOrganizationSchema: ZodSchema<UpdateOrganizationInput>
type UpdateOrganizationInput = Partial<CreateOrganizationInput>

// Organization status enum
organizationStatusEnum: ZodEnum<['active', 'suspended', 'deleted']>

// Query/list organizations
organizationQuerySchema: ZodSchema<OrganizationQueryInput>
type OrganizationQueryInput = {
  page: number;                      // default: 1
  limit: number;                     // default: 20, max: 100
  search?: string;                   // max 255 chars
  sortBy: 'createdAt' | 'name';     // default: 'createdAt'
  sortOrder: 'asc' | 'desc';        // default: 'desc'
}
```

#### Media Item Schemas

```typescript
// Create media item
createMediaItemSchema: ZodSchema<CreateMediaItemInput>
type CreateMediaItemInput = {
  title: string;                     // 1-255 characters
  description?: string;              // optional, max 5000 chars
  mediaType: 'video' | 'audio';     // enum
  mimeType: string;                  // whitelist of supported formats
  fileSizeBytes: number;             // 1 byte to 5GB
  r2Key: string;                     // S3-style path, max 500 chars
}

// Update media item (for transcoding service)
updateMediaItemSchema: ZodSchema<UpdateMediaItemInput>
type UpdateMediaItemInput = {
  status?: 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed';
  durationSeconds?: number;          // 0-86400 (24 hours max)
  width?: number;                    // 1-7680 (8K max)
  height?: number;                   // 1-4320 (8K max)
  hlsMasterPlaylistKey?: string;     // HLS manifest path
  thumbnailKey?: string;             // thumbnail image path
  uploadedAt?: Date;                 // upload timestamp
}

// Query/list media
mediaQuerySchema: ZodSchema<MediaQueryInput>
type MediaQueryInput = {
  page: number;                      // default: 1
  limit: number;                     // default: 20, max: 100
  status?: mediaStatusEnum;          // optional filter
  mediaType?: 'video' | 'audio';    // optional filter
  sortBy: 'createdAt' | 'uploadedAt' | 'title'; // default: 'createdAt'
  sortOrder: 'asc' | 'desc';        // default: 'desc'
}

// Media type and status enums
mediaTypeEnum: ZodEnum<['video', 'audio']>
mediaStatusEnum: ZodEnum<['uploading', 'uploaded', 'transcoding', 'ready', 'failed']>
```

#### Content Schemas

```typescript
// Create content
createContentSchema: ZodSchema<CreateContentInput>
type CreateContentInput = {
  title: string;                           // 1-500 characters
  slug: string;                            // URL-safe, max 500 chars
  description?: string;                    // optional, max 10000 chars
  contentType: 'video' | 'audio' | 'written'; // enum
  mediaItemId?: string | null;             // UUID, required for video/audio
  contentBody?: string;                    // optional, max 100000 chars
  organizationId?: string | null;          // UUID, org context
  category?: string;                       // optional, max 100 chars
  tags?: string[];                         // array, max 20, each max 50 chars
  thumbnailUrl?: string | null;            // optional HTTP/HTTPS URL
  visibility: 'public' | 'private' | 'members_only' | 'purchased_only';
  priceCents?: number | null;              // cents (0 to $100,000)
}

// Update content (partial, cannot change mediaItemId)
updateContentSchema: ZodSchema<UpdateContentInput>
type UpdateContentInput = Partial<Omit<CreateContentInput, 'mediaItemId'>>

// Content type, status, and visibility enums
contentTypeEnum: ZodEnum<['video', 'audio', 'written']>
contentStatusEnum: ZodEnum<['draft', 'published', 'archived']>
visibilityEnum: ZodEnum<['public', 'private', 'members_only', 'purchased_only']>

// Query/list content
contentQuerySchema: ZodSchema<ContentQueryInput>
type ContentQueryInput = {
  page: number;                           // default: 1
  limit: number;                          // default: 20, max: 100
  status?: contentStatusEnum;              // optional filter
  contentType?: contentTypeEnum;           // optional filter
  visibility?: visibilityEnum;             // optional filter
  category?: string;                       // optional, max 100 chars
  organizationId?: string;                 // UUID, optional filter
  search?: string;                         // text search, max 255 chars
  sortBy: 'createdAt' | 'updatedAt' | 'publishedAt' | 'title' | 'viewCount' | 'purchaseCount';
  sortOrder: 'asc' | 'desc';              // default: 'desc'
}

// Publish content status change
publishContentSchema: ZodSchema<PublishContentInput>
type PublishContentInput = {
  contentId: string;                       // UUID of content to publish
}
```

#### Upload Request Schema

```typescript
// Initiate direct upload to R2
uploadRequestSchema: ZodSchema<UploadRequestInput>
type UploadRequestInput = {
  filename: string;                        // 1-255 chars, [a-zA-Z0-9._-]
  contentType: string;                     // MIME type from whitelist
  fileSizeBytes: number;                   // 1 byte to 5GB
  title: string;                           // 1-255 characters
  description?: string;                    // optional, max 1000 chars
  mediaType: 'video' | 'audio';           // enum
}
```

### Identity Schemas

```typescript
// User profile
userSchema: ZodSchema<User>
type User = {
  email: string;              // valid email format
  name: string;               // 1+ characters
  age?: number;               // optional, must be >= 0
  role: 'user' | 'admin';    // default: 'user'
}

// Login credentials
loginSchema: ZodSchema<LoginCredentials>
type LoginCredentials = {
  email: string;              // valid email format
  password: string;           // min 8 characters
}
```

### Access Schemas

Validation for user library, playback tracking, and streaming URLs.

```typescript
// Get streaming URL
getStreamingUrlSchema: ZodSchema<GetStreamingUrlInput>
type GetStreamingUrlInput = {
  contentId: string;          // UUID of content
  expirySeconds?: number;     // optional, default 3600, range 300-7200 (5m-2h)
}

// Save playback progress
savePlaybackProgressSchema: ZodSchema<SavePlaybackProgressInput>
type SavePlaybackProgressInput = {
  contentId: string;          // UUID of content
  positionSeconds: number;    // non-negative integer
  durationSeconds: number;    // positive integer
  completed?: boolean;        // default: false
}

// Get playback progress
getPlaybackProgressSchema: ZodSchema<GetPlaybackProgressInput>
type GetPlaybackProgressInput = {
  contentId: string;          // UUID of content
}

// List user library
listUserLibrarySchema: ZodSchema<ListUserLibraryInput>
type ListUserLibraryInput = {
  page: number;               // default: 1, max: 1000
  limit: number;              // default: 20, max: 100
  filter: 'all' | 'in-progress' | 'completed'; // default: 'all'
  sortBy: 'recent' | 'title' | 'duration'; // default: 'recent'
}
```

## Schema Categories by Domain

### Primitives
Building blocks for all validation:
- **Identifiers**: UUID validation
- **URLs**: HTTP/HTTPS validation with protocol enforcement
- **Numbers**: Price (cents), positive/non-negative integers
- **Strings**: Sanitized text with length constraints, slugs, email
- **Params**: ID and slug route parameter validation

### Content Management
Organizations, media, and content operations:
- **Organizations**: Create/update/query with slug uniqueness, name/description bounds
- **Media Items**: File uploads with MIME type whitelist, R2 path validation
- **Content**: Multi-type content (video/audio/written) with visibility and pricing
- **Upload**: Direct R2 upload initiation with file size and format validation

### Identity & Access
User management and content access control:
- **Users**: Email, name, role, age
- **Login**: Email and password for authentication
- **Library**: User playback history and saved content
- **Streaming**: Temporary signed URL generation with expiry bounds
- **Progress**: Playback position tracking

## Validation Patterns

### 1. Basic Schema Usage

Parse and validate user input:

```typescript
import { createContentSchema, type CreateContentInput } from '@codex/validation';

// Throws ZodError if validation fails
const validated = createContentSchema.parse(userInput);

// Or use safe parsing (returns { success: true/false })
const result = createContentSchema.safeParse(userInput);
if (result.success) {
  const validated: CreateContentInput = result.data;
}
```

### 2. Type Inference for Type Safety

Use `z.infer` to get TypeScript types automatically:

```typescript
import { createContentSchema } from '@codex/validation';

// Type is inferred automatically from schema
type ContentInput = z.infer<typeof createContentSchema>;

// Or use pre-exported types
import type { CreateContentInput } from '@codex/validation';
```

### 3. Extending Schemas

Compose schemas for reuse:

```typescript
import { createSanitizedStringSchema } from '@codex/validation';

const myCustomSchema = z.object({
  title: createSanitizedStringSchema(5, 100, 'Title'),
  status: z.enum(['active', 'inactive']),
});
```

### 4. Custom Refinements

Add business logic validation:

```typescript
const createContentSchema = baseContentSchema
  .refine(
    (data) => {
      // Video/audio MUST have mediaItemId
      if (['video', 'audio'].includes(data.contentType)) {
        return !!data.mediaItemId;
      }
      return true;
    },
    {
      message: 'Media item is required for video and audio content',
      path: ['mediaItemId'],
    }
  );
```

### 5. Route Parameter Validation

Validate dynamic route segments:

```typescript
import { createIdParamsSchema, createSlugParamsSchema } from '@codex/validation';

// Route: GET /content/:id
const schema = { params: createIdParamsSchema() };
// Validates: { id: string (UUID) }

// Route: GET /org/:slug
const schema = { params: createSlugParamsSchema(255) };
// Validates: { slug: string (lowercase a-z0-9-) }
```

### 6. Query Parameter Validation with Type Coercion

Handle query string parameters (always strings in URL):

```typescript
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// URL: ?page=2&limit=50
// Coerces strings to numbers automatically
const validated = querySchema.parse(req.query);
```

### 7. Enum Validation

Whitelist allowed values:

```typescript
import { visibilityEnum } from '@codex/validation';

// Throws error if not one of: public, private, members_only, purchased_only
const visibility = visibilityEnum.parse(userInput);
```

### 8. Optional and Nullable Fields

Handle missing/null values:

```typescript
const schema = z.object({
  description: z.string().optional(),           // undefined is valid
  logoUrl: z.string().nullable(),               // null is valid
  websiteUrl: z.string().optional().nullable(), // both undefined and null valid
});
```

## Custom Validators

### Slug Validation

Prevents XSS and path traversal by restricting to `a-z0-9-` with no leading/trailing hyphens:

```typescript
const slugSchema = createSlugSchema(500);
// Accepts: 'my-content', 'tutorial-2024', 'a'
// Rejects: 'MY-CONTENT' (uppercase), '-start' (leading), 'double--hyphen'
// Transform: Converts to lowercase
```

**Security properties**:
- Lowercase-only prevents case sensitivity attacks
- Hyphen-only separator prevents XSS encoding evasion
- No path traversal characters (`../`, `..\\`)
- Safe for URLs and file paths

### URL Validation

Restricts to HTTP/HTTPS, preventing javascript: and data: URIs:

```typescript
const urlSchema = z.string().url().refine((url) => {
  const parsed = new URL(url);
  return ['http:', 'https:'].includes(parsed.protocol);
});
// Accepts: 'https://example.com', 'http://example.com:8080'
// Rejects: 'javascript:alert(1)', 'data:text/html,<script>', 'ftp://example.com'
```

**Security properties**:
- Protocol whitelist blocks javascript: and data: URIs
- Native URL constructor prevents malformed URLs
- Used for all external URLs (logos, websites, thumbnails)

### R2 Path Validation

Prevents directory traversal and injection in cloud storage paths:

```typescript
const r2Key = z.string()
  .regex(/^[a-zA-Z0-9/_-]+(\.[a-zA-Z0-9]+)?$/)
  .refine((key) => !key.includes('..'));
// Accepts: 'originals/abc123/video.mp4', 'hls/master.m3u8'
// Rejects: '../../../etc/passwd', 'file@name.mp4', 'file name.mp4'
```

**Security properties**:
- Character whitelist prevents injection
- Path traversal detection blocks `..` sequences
- Used for S3/R2 object keys to prevent unauthorized access

### Filename Validation

Prevents directory traversal in uploaded filenames:

```typescript
const filename = z.string()
  .regex(/^[a-zA-Z0-9._-]+$/);
// Accepts: 'video.mp4', 'video-final_v2.mp4'
// Rejects: 'my video.mp4' (spaces), '../etc/passwd' (path traversal)
```

## Error Messages

All schemas provide clear, user-friendly error messages designed for API responses. Errors follow the pattern:

**Format**: "[Field name] must [condition]" or "[Field name] [error]"

**Examples**:
- `"Organization name must be at least 1 characters"`
- `"Slug must contain only lowercase letters, numbers, and hyphens"`
- `"URL must use HTTP or HTTPS protocol"`
- `"Price cannot exceed $100,000"`
- `"File size cannot exceed 5GB"`
- `"Media item is required for video and audio content"`
- `"Status must be active, suspended, or deleted"`

**Error response structure**:

When validation fails, Zod errors are converted to JSON by the worker layer:

```typescript
// Validation fails
const result = createContentSchema.safeParse(invalidInput);
if (!result.success) {
  // result.error is ZodError
  // Contains: error.issues[].{path[], message, code}
}

// HTTP response (400 Bad Request)
{
  "error": "Validation failed",
  "issues": [
    {
      "path": ["mediaItemId"],
      "message": "Media item is required for video and audio content"
    }
  ]
}
```

## Type Inference and TypeScript Integration

### Automatic Type Extraction

Zod schemas automatically generate TypeScript types using `z.infer`:

```typescript
import { createContentSchema } from '@codex/validation';

// Automatic type derivation
type CreateContentInput = z.infer<typeof createContentSchema>;

// Service layer receives strongly-typed data
class ContentService {
  async create(input: CreateContentInput, creatorId: string) {
    // TypeScript knows all fields and their types
    console.log(input.title); // string
    console.log(input.priceCents); // number | null
  }
}
```

### Pre-Exported Types

Common types are pre-exported for convenience:

```typescript
import {
  type CreateContentInput,
  type UpdateContentInput,
  type ContentQueryInput,
  createContentSchema,
} from '@codex/validation';

// Use pre-exported types
function handleCreate(input: CreateContentInput) {
  // ...
}

// Or derive your own
type MyType = z.infer<typeof createContentSchema>;
```

### Type Safety in Workers

Workers validate and extract types in one step:

```typescript
import { createContentSchema, type CreateContentInput } from '@codex/validation';

app.post('/content', createAuthenticatedHandler({
  schema: { body: createContentSchema },
  handler: async (c, ctx) => {
    // ctx.validated.body is strongly-typed as CreateContentInput
    const content = await contentService.create(
      ctx.validated.body,
      ctx.user.id
    );
    return { data: content };
  },
}));
```

### Database Constraint Alignment

Schema enums match database CHECK constraints exactly:

```typescript
// packages/validation/src/content/content-schemas.ts
export const contentStatusEnum = z.enum(['draft', 'published', 'archived']);
export const visibilityEnum = z.enum(['public', 'private', 'members_only', 'purchased_only']);
export const mediaStatusEnum = z.enum(['uploading', 'uploaded', 'transcoding', 'ready', 'failed']);

// Aligns with database schema:
// CHECK (content_status IN ('draft', 'published', 'archived'))
// CHECK (visibility IN ('public', 'private', 'members_only', 'purchased_only'))
// CHECK (media_status IN ('uploading', 'uploaded', 'transcoding', 'ready', 'failed'))
```

This ensures validation at the API boundary matches database constraints.

## Usage Examples

### Example 1: Creating Content in a Worker

```typescript
import { createContentSchema, type CreateContentInput } from '@codex/validation';
import { ContentService } from '@codex/content';

app.post('/content', createAuthenticatedHandler({
  schema: { body: createContentSchema },
  handler: async (c, ctx) => {
    // Validated input is strongly typed
    const input: CreateContentInput = ctx.validated.body;

    const service = new ContentService({ db: dbHttp });
    const content = await service.create(input, ctx.user.id);

    return {
      data: content,
    };
  },
}));
```

### Example 2: Listing Content with Filters

```typescript
import { contentQuerySchema } from '@codex/validation';

app.get('/content', createAuthenticatedHandler({
  schema: { query: contentQuerySchema },
  handler: async (c, ctx) => {
    // Query parameters are validated and coerced
    const filters = ctx.validated.query;

    const service = new ContentService({ db: dbHttp });
    const { items, total } = await service.list(filters, ctx.user.id);

    return { data: items, total };
  },
}));
```

### Example 3: Validating Route Parameters

```typescript
import { createIdParamsSchema } from '@codex/validation';

app.get('/:id', createAuthenticatedHandler({
  schema: { params: createIdParamsSchema() },
  handler: async (c, ctx) => {
    // Route param is validated as UUID
    const { id } = ctx.validated.params;

    const service = new ContentService({ db: dbHttp });
    const content = await service.get(id, ctx.user.id);

    return { data: content };
  },
}));
```

### Example 4: Custom Type-Safe Data Processing

```typescript
import { createOrganizationSchema, type CreateOrganizationInput } from '@codex/validation';

function processOrganization(input: CreateOrganizationInput) {
  // All fields are properly typed
  const slug = input.slug.toLowerCase(); // slug is string
  const hasLogo = !!input.logoUrl; // logoUrl is string | undefined | null

  return {
    slug,
    name: input.name,
    hasLogo,
  };
}
```

### Example 5: Error Handling

```typescript
import { createContentSchema } from '@codex/validation';

function validateAndHandle(input: unknown) {
  const result = createContentSchema.safeParse(input);

  if (!result.success) {
    // result.error is ZodError
    const issues = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));

    return {
      status: 400,
      body: {
        error: 'Validation failed',
        issues,
      },
    };
  }

  // result.data is fully validated and typed
  const validated = result.data;
  // Process validated data
}
```

## Integration Points

### Packages Using @codex/validation

| Package | Schemas Used | Purpose |
|---------|--------------|---------|
| @codex/content | createContentSchema, createMediaItemSchema, createOrganizationSchema | Content service validation |
| @codex/access | getStreamingUrlSchema, savePlaybackProgressSchema, listUserLibrarySchema | Access control and streaming |
| @codex/identity | userSchema, loginSchema | User authentication |

### Workers Using @codex/validation

| Worker | Endpoints | Key Schemas |
|--------|-----------|-------------|
| content-api | POST/GET/PATCH /content, POST /content/:id/publish | createContentSchema, contentQuerySchema, createIdParamsSchema |
| media-api | POST/GET /media, PATCH /media/:id | createMediaItemSchema, updateMediaItemSchema, createIdParamsSchema |
| identity-api | POST/PATCH /organizations, GET /organizations | createOrganizationSchema, organizationQuerySchema, createIdParamsSchema |
| content-access-api | GET /stream, POST /progress, GET /library | getStreamingUrlSchema, savePlaybackProgressSchema, listUserLibrarySchema |

### Service Layer Integration

Services import validated types for type safety:

```typescript
// @codex/content
import { type CreateContentInput, type UpdateContentInput } from '@codex/validation';

export class ContentService {
  async create(input: CreateContentInput, creatorId: string) {
    // input is guaranteed to match database schema
  }

  async update(contentId: string, input: UpdateContentInput, creatorId: string) {
    // input is partial but validated
  }
}
```

## Performance Notes

### Validation Cost

- **Zod parsing**: Minimal overhead (microseconds per validation)
- **Regex compilation**: Cached by Zod, no recompilation per request
- **Custom refinements**: Only run after basic validation passes
- **Type inference**: Zero runtime cost (compile-time only)

### Recommendations

1. **Parse at boundaries**: Validate request input immediately at route handler
2. **Reuse schemas**: Import from this package rather than duplicating
3. **Safe parsing**: Use `.safeParse()` for error handling without try/catch
4. **Type inference**: Let TypeScript infer types from schemas rather than manual definitions

## Security Features

### XSS Prevention

All URL fields reject `javascript:` and `data:` URIs:

```typescript
// ✓ Valid
urlSchema.parse('https://example.com');
urlSchema.parse('http://example.com');

// ❌ Throws
urlSchema.parse('javascript:alert(1)');
urlSchema.parse('data:text/html,<script>alert(1)</script>');
```

### Path Traversal Prevention

R2 keys and filenames reject path traversal sequences:

```typescript
// ✓ Valid
createMediaItemSchema.parse({
  ...,
  r2Key: 'originals/abc123/video.mp4',
});

// ❌ Throws
createMediaItemSchema.parse({
  ...,
  r2Key: '../../../etc/passwd',
});
```

### String Sanitization

All user-generated strings are trimmed and length-limited:

```typescript
// Input: "  My Title  "
// Output: "My Title" (trimmed)
const title = createSanitizedStringSchema(1, 255, 'Title').parse('  My Title  ');
```

### Enum Whitelisting

All enum fields only accept database-defined values:

```typescript
// ✓ Valid
mediaTypeEnum.parse('video');
mediaTypeEnum.parse('audio');

// ❌ Throws
mediaTypeEnum.parse('document'); // Not in whitelist
```

## Database Alignment

All schemas align exactly with database constraints:

| Schema | Database Constraint | Alignment |
|--------|---------------------|-----------|
| `organizationSlugSchema` | `VARCHAR(255)` | Max 255 chars |
| `mediaTypeEnum` | `CHECK (media_type IN ('video', 'audio'))` | Exact match |
| `mediaStatusEnum` | `CHECK (status IN (...))` | Exact match |
| `priceCentsSchema` | `CHECK (price_cents >= 0)`, `INTEGER` | Non-negative int |
| `contentTypeEnum` | `CHECK (content_type IN (...))` | Exact match |
| `slugSchema` | `VARCHAR(500)` | Max 500 chars |

See `packages/database/src/schema/content.ts` for full database schema.

## Error Handling

Zod throws `ZodError` on validation failures:

```typescript
import { ZodError } from 'zod';

try {
  const user = userSchema.parse(invalidInput);
} catch (error) {
  if (error instanceof ZodError) {
    console.error(error.errors);
    // [
    //   {
    //     code: 'invalid_type',
    //     expected: 'string',
    //     received: 'number',
    //     path: ['email'],
    //     message: 'Expected string, received number'
    //   }
    // ]
  }
}
```

Use `safeParse()` for non-throwing validation:

```typescript
const result = userSchema.safeParse(input);
if (!result.success) {
  console.error(result.error.errors);
} else {
  console.log(result.data); // Validated data
}
```

## Testing

The package includes comprehensive test suites covering:
- Valid inputs (happy paths)
- Invalid inputs (error cases)
- Edge cases (boundary conditions)
- Security validations (XSS, injection, path traversal)
- Database constraint alignment

Run tests:

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage report
pnpm test:coverage
```

## Integration Examples

### With Cloudflare Workers + Hono

```typescript
import { Hono } from 'hono';
import { createAuthenticatedHandler } from '@codex/worker-utils';
import { createContentSchema, createIdParamsSchema } from '@codex/validation';

const app = new Hono();

app.post(
  '/api/content',
  createAuthenticatedHandler({
    schema: {
      body: createContentSchema,
    },
    handler: async (c, ctx) => {
      // ctx.validated.body is fully validated and typed
      const content = await contentService.create(
        ctx.validated.body,
        ctx.user.id
      );
      return content;
    },
    successStatus: 201,
  })
);

app.get(
  '/api/content/:id',
  createAuthenticatedHandler({
    schema: {
      params: createIdParamsSchema(),
    },
    handler: async (c, ctx) => {
      // ctx.validated.params.id is validated UUID
      return contentService.get(ctx.validated.params.id, ctx.user.id);
    },
  })
);
```

### With Service Layer

```typescript
import {
  createOrganizationSchema,
  type CreateOrganizationInput
} from '@codex/validation';
import { organizations } from '@codex/database/schema';
import { db } from '@codex/database';

class OrganizationService {
  async create(input: CreateOrganizationInput) {
    // Validate input (throws ZodError if invalid)
    const validated = createOrganizationSchema.parse(input);

    try {
      const [org] = await db
        .insert(organizations)
        .values(validated)
        .returning();

      return org;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('Organization slug already exists');
      }
      throw error;
    }
  }
}
```

### Query String Validation

Zod's `z.coerce` handles query string type coercion:

```typescript
import { contentQuerySchema } from '@codex/validation';

// Query string: ?page=2&limit=50&status=published
const query = {
  page: '2',      // String from URL
  limit: '50',    // String from URL
  status: 'published',
};

const validated = contentQuerySchema.parse(query);
// Result: { page: 2, limit: 50, status: 'published', ... } (numbers coerced)
```

## Best Practices

### 1. Always Validate at Boundaries

```typescript
// ✓ Good: Validate at API entry point
app.post('/api/users', async (c) => {
  const validated = userSchema.parse(await c.req.json());
  return userService.create(validated);
});

// ❌ Bad: Pass raw input to service layer
app.post('/api/users', async (c) => {
  return userService.create(await c.req.json()); // No validation!
});
```

### 2. Use Type Inference

```typescript
// ✓ Good: Infer types from schemas
export type User = z.infer<typeof userSchema>;

// ❌ Bad: Duplicate type definitions
export type User = { email: string; name: string; ... };
```

### 3. Compose Schemas from Primitives

```typescript
// ✓ Good: Reuse primitive schemas
import { uuidSchema, createSanitizedStringSchema } from '@codex/validation/primitives';

const mySchema = z.object({
  id: uuidSchema,
  title: createSanitizedStringSchema(1, 255, 'Title'),
});

// ❌ Bad: Duplicate validation logic
const mySchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(255),
});
```

### 4. Handle Errors Gracefully

```typescript
// ✓ Good: Catch and format errors
try {
  const validated = userSchema.parse(input);
} catch (error) {
  if (error instanceof ZodError) {
    return c.json({ errors: error.errors }, 400);
  }
  throw error;
}

// Or use safeParse
const result = userSchema.safeParse(input);
if (!result.success) {
  return c.json({ errors: result.error.errors }, 400);
}
```

## Related Packages

- **@codex/database** - Database schema and migrations
- **@codex/content** - Content service layer (uses validation schemas)
- **@codex/identity** - Identity service layer (uses validation schemas)
- **@codex/worker-utils** - Worker utilities with built-in validation support

## Testing

### Test Setup Pattern

The package includes comprehensive tests using Vitest:

```typescript
import { describe, expect, it } from 'vitest';
import { createContentSchema } from '@codex/validation';

describe('createContentSchema', () => {
  it('should validate valid content', () => {
    const result = createContentSchema.safeParse({
      title: 'My Video',
      slug: 'my-video',
      contentType: 'video',
      mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
    });

    expect(result.success).toBe(true);
  });

  it('should reject invalid content', () => {
    const result = createContentSchema.safeParse({
      title: 'My Video',
      // Missing required fields
    });

    expect(result.success).toBe(false);
  });
});
```

### Testing Validation Errors

```typescript
import { createContentSchema } from '@codex/validation';

it('should provide specific error for missing mediaItemId', () => {
  const result = createContentSchema.safeParse({
    title: 'Video',
    slug: 'video',
    contentType: 'video', // mediaItemId required for video
    // Missing mediaItemId
  });

  expect(result.success).toBe(false);
  if (!result.success) {
    const error = result.error.issues.find((i) => i.path.includes('mediaItemId'));
    expect(error?.message).toContain('Media item is required');
  }
});
```

### Testing Security Validations

```typescript
it('should reject XSS attempts in URLs', () => {
  const result = createOrganizationSchema.safeParse({
    name: 'Test',
    slug: 'test',
    logoUrl: 'javascript:alert(1)',
  });

  expect(result.success).toBe(false);
});

it('should reject path traversal in R2 keys', () => {
  const result = createMediaItemSchema.safeParse({
    title: 'Test',
    mediaType: 'video',
    mimeType: 'video/mp4',
    fileSizeBytes: 1000,
    r2Key: '../../../etc/passwd',
  });

  expect(result.success).toBe(false);
});
```

## Build & Deployment

### Development

```bash
cd packages/validation

# Build package
npm run build

# Watch mode
npm run dev

# Run tests
npm run test

# Test coverage
npm run test:coverage

# Type check
npm run typecheck
```

### Package Publishing

The package exports:
- **Main entry**: `./dist/index.js` (compiled JavaScript)
- **Types**: `./dist/index.d.ts` (TypeScript declarations)

All exports are re-exported from `/src/index.ts`:

```typescript
export * from './content/content-schemas';
export * from './identity/user-schema';
export * from './primitives';
export * from './schemas/access';
```

## Zod Version

- **Zod version**: 3.24.1
- **Validation style**: Schema-based validation
- **Error handling**: Native ZodError with detailed issue information

## Quick Reference

### Most Common Schemas

```typescript
// Organization
createOrganizationSchema, updateOrganizationSchema

// Content
createContentSchema, updateContentSchema, contentQuerySchema

// Media
createMediaItemSchema, updateMediaItemSchema

// Access
getStreamingUrlSchema, listUserLibrarySchema

// Route params
createIdParamsSchema, createSlugParamsSchema

// Primitives
uuidSchema, emailSchema, urlSchema, priceCentsSchema
```

### Most Common Type Inference

```typescript
type CreateContentInput = z.infer<typeof createContentSchema>;
type UpdateContentInput = z.infer<typeof updateContentSchema>;
type ContentQueryInput = z.infer<typeof contentQuerySchema>;
```

### Most Common Parsing Patterns

```typescript
// Parse and throw on error
const data = schema.parse(input);

// Safe parse (no throw)
const result = schema.safeParse(input);
if (result.success) {
  // Use result.data
}

// Type inference in one step
const validated: z.infer<typeof schema> = schema.parse(input);
```

## Contributing

When adding new schemas:

1. Add primitive components to `primitives.ts` if reusable
2. Add domain-specific schemas to appropriate files (e.g., `content-schemas.ts`)
3. Export from `index.ts`
4. Add comprehensive tests covering:
   - Valid inputs (happy paths)
   - Invalid inputs (error cases)
   - Security validations (XSS, path traversal, etc.)
   - Database constraint alignment
5. Document usage in this README

## License

MIT

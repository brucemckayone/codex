# @codex/validation

Type-safe validation schemas for the Codex platform, built on [Zod](https://zod.dev).

## Overview

`@codex/validation` provides centralized validation schemas and TypeScript types for all user input across the Codex application. It ensures data integrity, security, and consistency at API boundaries, service layers, and database interactions.

### Key Features

- **Type-Safe Validation**: Zod-based schemas with automatic TypeScript type inference
- **Security-First Design**: Built-in XSS prevention, path traversal protection, and input sanitization
- **Database Alignment**: Schemas match database constraints exactly (CHECK constraints, length limits, enums)
- **Reusable Primitives**: Common validation patterns (UUIDs, slugs, URLs, emails) for composition
- **Clear Error Messages**: User-friendly, non-leaking error messages for validation failures
- **Query Validation**: Pagination, filtering, and sorting schemas for API queries

## Installation

```bash
pnpm add @codex/validation
```

## Core Dependencies

- **zod** (^3.24.1) - Schema validation and type inference

## Package Structure

```
src/
├── index.ts              # Main entry point (exports all schemas)
├── primitives.ts         # Reusable primitive validation schemas
├── content-schemas.ts    # Content management schemas (orgs, media, content)
├── user-schema.ts        # User and authentication schemas
└── *.test.ts            # Comprehensive test suites
```

## Quick Start

### Basic Usage

```typescript
import { userSchema, type User } from '@codex/validation';

// Validate user input
const rawInput = {
  email: 'user@example.com',
  name: 'John Doe',
  role: 'user',
};

// Parse and validate
const user: User = userSchema.parse(rawInput);
// Throws ZodError if validation fails

// Safe parsing (no throw)
const result = userSchema.safeParse(rawInput);
if (result.success) {
  console.log(result.data); // Type: User
} else {
  console.error(result.error.errors);
}
```

### Service Layer Integration

```typescript
import {
  createOrganizationSchema,
  type CreateOrganizationInput
} from '@codex/validation';

class OrganizationService {
  async create(input: CreateOrganizationInput) {
    // Validate input
    const validated = createOrganizationSchema.parse(input);

    // Insert into database
    const [org] = await db.insert(organizations)
      .values(validated)
      .returning();

    return org;
  }
}
```

### API Route Validation

```typescript
import { createContentSchema } from '@codex/validation';
import { createAuthenticatedHandler } from '@codex/worker-utils';

app.post(
  '/api/content',
  createAuthenticatedHandler({
    schema: {
      body: createContentSchema,
    },
    handler: async (c, ctx) => {
      // ctx.validated.body is fully validated and typed
      return contentService.create(ctx.validated.body, ctx.user.id);
    },
    successStatus: 201,
  })
);
```

## API Reference

### Primitive Schemas (`primitives.ts`)

Common building blocks for validation schemas.

#### Identifiers

```typescript
import { uuidSchema, createSlugSchema } from '@codex/validation/primitives';

// UUID validation (v4)
const id = uuidSchema.parse('123e4567-e89b-12d3-a456-426614174000');

// Slug validation (lowercase, alphanumeric + hyphens)
const slugSchema = createSlugSchema(255); // max length
const slug = slugSchema.parse('my-awesome-post'); // "my-awesome-post"
const normalized = slugSchema.parse('My-AWESOME-Post'); // "my-awesome-post" (transformed)
```

#### URLs

```typescript
import { urlSchema } from '@codex/validation/primitives';

// Only allows HTTP/HTTPS (prevents javascript:, data: URIs)
const url = urlSchema.parse('https://example.com');
// Throws: urlSchema.parse('javascript:alert(1)') ❌
```

#### Strings

```typescript
import {
  createSanitizedStringSchema,
  createOptionalTextSchema,
  emailSchema
} from '@codex/validation/primitives';

// Required string with length constraints
const titleSchema = createSanitizedStringSchema(1, 255, 'Title');
const title = titleSchema.parse('  My Title  '); // "My Title" (trimmed)

// Optional text (can be null/undefined)
const descriptionSchema = createOptionalTextSchema(5000, 'Description');
const desc = descriptionSchema.parse(null); // null ✓

// Email validation
const email = emailSchema.parse('user@example.com');
```

#### Numbers

```typescript
import {
  priceCentsSchema,
  positiveIntSchema,
  nonNegativeIntSchema
} from '@codex/validation/primitives';

// Price in cents (0-10,000,000 or null)
const price = priceCentsSchema.parse(1999); // $19.99
const free = priceCentsSchema.parse(null); // Free content

// Positive integer
const count = positiveIntSchema.parse(42);

// Non-negative integer (allows 0)
const views = nonNegativeIntSchema.parse(0);
```

#### Route Params Helpers

```typescript
import { createIdParamsSchema, createSlugParamsSchema } from '@codex/validation/primitives';

// For routes like /api/content/:id
const idParams = createIdParamsSchema();
// Validates: { id: string (UUID) }

// For routes like /api/content/:slug
const slugParams = createSlugParamsSchema(255);
// Validates: { slug: string (normalized) }
```

### Content Management Schemas (`content-schemas.ts`)

Comprehensive schemas for organizations, media items, and content.

#### Organizations

```typescript
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  organizationStatusEnum,
  type CreateOrganizationInput,
  type UpdateOrganizationInput
} from '@codex/validation';

// Create organization
const orgInput: CreateOrganizationInput = {
  name: 'Acme Corp',
  slug: 'acme-corp',
  description: 'A leading provider of innovative solutions',
  logoUrl: 'https://example.com/logo.png',
  websiteUrl: 'https://acme.com',
};
const validated = createOrganizationSchema.parse(orgInput);

// Update organization (partial)
const update: UpdateOrganizationInput = {
  name: 'Acme Corporation',
};
const validatedUpdate = updateOrganizationSchema.parse(update);

// Status enum
const status = organizationStatusEnum.parse('active'); // 'active' | 'suspended' | 'deleted'
```

#### Media Items

```typescript
import {
  createMediaItemSchema,
  updateMediaItemSchema,
  mediaTypeEnum,
  mediaStatusEnum,
  type CreateMediaItemInput,
  type UpdateMediaItemInput
} from '@codex/validation';

// Create media item
const mediaInput: CreateMediaItemInput = {
  title: 'My Awesome Video',
  description: 'A great video about coding',
  mediaType: 'video',
  mimeType: 'video/mp4',
  fileSizeBytes: 10485760, // 10MB
  r2Key: 'originals/abc123/video.mp4',
};
const validated = createMediaItemSchema.parse(mediaInput);

// Update media item (set status, metadata)
const update: UpdateMediaItemInput = {
  status: 'ready',
  durationSeconds: 3600,
  width: 1920,
  height: 1080,
  hlsMasterPlaylistKey: 'hls/abc123/master.m3u8',
  thumbnailKey: 'thumbnails/abc123/thumb.jpg',
};
const validatedUpdate = updateMediaItemSchema.parse(update);

// Type enums
const type = mediaTypeEnum.parse('video'); // 'video' | 'audio'
const status = mediaStatusEnum.parse('ready'); // 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed'
```

**Security Features**:
- Whitelisted MIME types only (prevents malicious file uploads)
- R2 key path traversal prevention (rejects `../` sequences)
- File size limits (max 5GB)
- Valid character sets (alphanumeric, hyphens, underscores, slashes, dots)

#### Content

```typescript
import {
  createContentSchema,
  updateContentSchema,
  publishContentSchema,
  contentTypeEnum,
  visibilityEnum,
  contentStatusEnum,
  type CreateContentInput,
  type UpdateContentInput
} from '@codex/validation';

// Create video content
const contentInput: CreateContentInput = {
  title: 'Introduction to TypeScript',
  slug: 'intro-to-typescript',
  description: 'Learn TypeScript from scratch',
  contentType: 'video',
  mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
  organizationId: '123e4567-e89b-12d3-a456-426614174001', // or null for personal
  category: 'Programming',
  tags: ['typescript', 'javascript', 'tutorial'],
  thumbnailUrl: 'https://example.com/thumb.jpg',
  visibility: 'public',
  priceCents: 999, // $9.99
};
const validated = createContentSchema.parse(contentInput);

// Create written content
const writtenContent: CreateContentInput = {
  title: 'My Blog Post',
  slug: 'my-blog-post',
  contentType: 'written',
  contentBody: 'This is a long blog post about coding...',
  visibility: 'public',
  priceCents: null, // Free
};

// Update content (partial, cannot change mediaItemId)
const update: UpdateContentInput = {
  title: 'Updated Title',
  priceCents: 1499, // $14.99
};
const validatedUpdate = updateContentSchema.parse(update);

// Enums
const type = contentTypeEnum.parse('video'); // 'video' | 'audio' | 'written'
const visibility = visibilityEnum.parse('public'); // 'public' | 'private' | 'members_only' | 'purchased_only'
const status = contentStatusEnum.parse('published'); // 'draft' | 'published' | 'archived'
```

**Business Rules** (enforced via refinements):
- Video/audio content MUST have `mediaItemId`
- Written content MUST have `contentBody`
- Free content (null or 0 price) cannot have `purchased_only` visibility
- Tags: max 20 tags, each max 50 characters

#### Query Schemas

```typescript
import {
  paginationSchema,
  contentQuerySchema,
  mediaQuerySchema,
  organizationQuerySchema,
  sortOrderEnum,
  type PaginationInput,
  type ContentQueryInput
} from '@codex/validation';

// Basic pagination (works with query strings)
const query = paginationSchema.parse({ page: '2', limit: '50' });
// Result: { page: 2, limit: 50 } (coerced to numbers)

// Content filtering
const contentQuery: ContentQueryInput = {
  page: 1,
  limit: 20,
  status: 'published',
  contentType: 'video',
  visibility: 'public',
  category: 'Programming',
  organizationId: '123e4567-e89b-12d3-a456-426614174000',
  search: 'typescript tutorial',
  sortBy: 'publishedAt',
  sortOrder: 'desc',
};
const validated = contentQuerySchema.parse(contentQuery);

// Media filtering
const mediaQuery = mediaQuerySchema.parse({
  status: 'ready',
  mediaType: 'video',
  sortBy: 'uploadedAt',
});

// Organization filtering
const orgQuery = organizationQuerySchema.parse({
  search: 'acme',
  sortBy: 'name',
  sortOrder: 'asc',
});
```

#### Upload Requests

```typescript
import { uploadRequestSchema, type UploadRequestInput } from '@codex/validation';

// Validate file upload initiation
const uploadRequest: UploadRequestInput = {
  filename: 'video.mp4',
  contentType: 'video/mp4',
  fileSizeBytes: 10485760, // 10MB
  title: 'My Video',
  description: 'A great video',
  mediaType: 'video',
};
const validated = uploadRequestSchema.parse(uploadRequest);

// Security: Prevents path traversal in filenames
// Throws: uploadRequestSchema.parse({ filename: '../../../etc/passwd', ... }) ❌
```

### User Schemas (`user-schema.ts`)

```typescript
import { userSchema, loginSchema, type User, type LoginCredentials } from '@codex/validation';

// User validation
const user: User = userSchema.parse({
  email: 'user@example.com',
  name: 'John Doe',
  age: 30, // optional
  role: 'admin', // 'user' | 'admin'
});

// Login validation
const credentials: LoginCredentials = loginSchema.parse({
  email: 'user@example.com',
  password: 'securepassword123', // min 8 chars
});
```

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

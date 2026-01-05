# @codex/validation

Centralized Zod schema library for input validation and type inference across Codex. Single source of truth for all validation rules, providing type-safe contracts between workers, services, and the database.

## Overview

The `@codex/validation` package defines all input validation schemas used by workers, services, and the database layer. It ensures consistent validation behavior and provides automatic type inference via `z.infer`.

**Primary responsibility**: Validate all user input, route parameters, and query strings while providing type-safe TypeScript interfaces.

**Why it exists**:
- Single source of truth for validation (if validation rules change, update once)
- Type inference via `z.infer<typeof schema>` eliminates duplicate type definitions
- Security enforcement at API boundaries (XSS, path traversal, injection prevention)
- Database constraint alignment (validation enums match CHECK constraints exactly)
- Reusable schemas across all workers and services

**Key features**:
- Zod-based primitives and domain schemas with full type inference
- Security-first validation: URL protocol whitelisting, slug safety, R2 path traversal prevention, domain whitelisting for redirects
- Database-aligned enums: mediaStatusEnum, contentStatusEnum, visibilityEnum, etc. match database CHECK constraints exactly
- Custom refinements for cross-field validation: video/audio requires mediaItemId, free content cannot be purchased_only, etc.
- Pagination schema with coercion for query string parameters
- Clear, actionable error messages designed for API responses

## Architecture

The package is organized into layered modules by domain and reusability:

```
primitives.ts
  └─ Reusable validators (UUIDs, URLs, slugs, numbers, strings, email, params)

shared/
  └─ pagination-schema.ts (PaginationInput with coercion)

content/
  ├─ Organization schemas (create, update, query)
  ├─ Media item schemas (create, update, query)
  ├─ Content schemas (create, update, query, publish)
  └─ Upload request schema

identity/
  └─ User schemas (user profile, login credentials)

schemas/
  ├─ access.ts (streaming URLs, playback progress, user library)
  └─ purchase.ts (checkout session, purchase queries, webhook metadata)

index.ts
  └─ Re-exports all schemas and types
```

**Design principle**: Primitives are composed into domain schemas. Domain schemas are composed using `.extend()` or `.refine()` for cross-field validation. All exports include both schemas (for `parse()` calls) and types (for TypeScript annotations).

## Public API

### Primitive Validators

Reusable building blocks for composing domain schemas. Zero business logic—pure validation only.

#### Identifiers

```typescript
// UUID v4 validation (for all primary/foreign keys)
export const uuidSchema: ZodSchema;
// Example: '550e8400-e29b-41d4-a716-446655440000'

// Better Auth user ID (alphanumeric, 1-64 chars)
export const userIdSchema: ZodSchema;
// Example: 'GV762T8n0fCnqy3qxRvoMjJZ7hTTd44b' (Better Auth default format)

// URL-safe slug validation (lowercase a-z0-9-, no leading/trailing hyphens)
export const createSlugSchema(maxLength?: number = 500): ZodSchema;
// Example: 'my-content-slug' (not 'My-Content-Slug' or '-my-slug')
```

#### URLs & Protocols

```typescript
// HTTP/HTTPS only (prevents javascript: and data: URIs for XSS prevention)
export const urlSchema: ZodSchema;
// Accepts: 'https://example.com', 'http://example.com:8080'
// Rejects: 'javascript:alert(1)', 'data:text/html,<img>', 'ftp://example.com'
```

#### Numbers

```typescript
// Price in cents: non-negative integer, max $100,000 (10M cents), nullable
export const priceCentsSchema: ZodSchema;
// Example: 9999 (represents $99.99), null (free content)

// Positive integer (> 0)
export const positiveIntSchema: ZodSchema;
// Example: 1, 100, 1000 (not 0)

// Non-negative integer (>= 0)
export const nonNegativeIntSchema: ZodSchema;
// Example: 0, 100, 1000
```

#### Strings

```typescript
// Sanitized string: trimmed, min/max length, custom field name for errors
export const createSanitizedStringSchema(min: number, max: number, fieldName: string): ZodSchema;
// Example: createSanitizedStringSchema(1, 255, 'Title')
// Trims whitespace, rejects empty strings

// Optional text: trimmed, max length, can be null/undefined
export const createOptionalTextSchema(maxLength: number, fieldName: string): ZodSchema;
// Example: createOptionalTextSchema(5000, 'Description')
// Allows null or undefined

// Email validation
export const emailSchema: ZodSchema;
// Example: 'user@example.com'
```

#### Route Parameters

```typescript
// Route params for GET/:id endpoints
export const createIdParamsSchema(): ZodSchema;
// Validates: { id: string (UUID) }

// Route params for GET/:slug endpoints
export const createSlugParamsSchema(maxLength?: number = 255): ZodSchema;
// Validates: { slug: string (lowercase a-z0-9-) }
```

### Content Domain Schemas

Validation for organizations, media items, and content with database constraint alignment and security refinements.

#### Organization Schemas

```typescript
export const createOrganizationSchema: ZodSchema;
export type CreateOrganizationInput = {
  name: string;              // 1-255 chars, trimmed (sanitized)
  slug: string;              // lowercase a-z0-9-, max 255 chars (unique per database)
  description?: string;      // max 5000 chars, optional, nullable
  logoUrl?: string | null;   // HTTP/HTTPS URL only, optional, nullable
  websiteUrl?: string | null;// HTTP/HTTPS URL only, optional, nullable
};

export const updateOrganizationSchema: ZodSchema; // All fields optional
export type UpdateOrganizationInput = Partial<CreateOrganizationInput>;

export const organizationStatusEnum: ZodEnum<['active', 'suspended', 'deleted']>;

export const organizationQuerySchema: ZodSchema;
export type OrganizationQueryInput = {
  page: number;              // default: 1, coerced from query string
  limit: number;             // default: 20, max 100, coerced from query string
  search?: string;           // max 255 chars, optional filter
  sortBy: 'createdAt' | 'name'; // default: 'createdAt'
  sortOrder: 'asc' | 'desc'; // default: 'desc'
};
```

#### Media Item Schemas

```typescript
export const mediaTypeEnum: ZodEnum<['video', 'audio']>;
// Aligns with database CHECK constraint

export const mediaStatusEnum: ZodEnum<['uploading', 'uploaded', 'transcoding', 'ready', 'failed']>;
// Aligns with database CHECK constraint

export const createMediaItemSchema: ZodSchema;
export type CreateMediaItemInput = {
  title: string;             // 1-255 chars
  description?: string;      // max 5000 chars, optional, nullable
  mediaType: 'video' | 'audio';
  mimeType: string;          // whitelist: video/mp4, video/quicktime, video/x-msvideo, video/webm,
                             // audio/mpeg, audio/mp4, audio/wav, audio/webm, audio/ogg
  fileSizeBytes: number;     // 1 byte to 5GB
  r2Key: string;             // S3-style path (alphanumeric/_-, no traversal, max 500 chars)
};

export const updateMediaItemSchema: ZodSchema;
export type UpdateMediaItemInput = {
  status?: 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed';
  durationSeconds?: number;  // 0-86400 (24 hours max)
  width?: number;            // 1-7680 (8K max width)
  height?: number;           // 1-4320 (8K max height)
  hlsMasterPlaylistKey?: string | null; // max 500 chars
  thumbnailKey?: string | null;         // max 500 chars
  uploadedAt?: Date;
};

export const mediaQuerySchema: ZodSchema;
export type MediaQueryInput = {
  page: number;              // default: 1, coerced from query string
  limit: number;             // default: 20, max 100, coerced from query string
  status?: MediaStatusEnum;  // optional filter
  mediaType?: 'video' | 'audio'; // optional filter
  sortBy: 'createdAt' | 'uploadedAt' | 'title'; // default: 'createdAt'
  sortOrder: 'asc' | 'desc'; // default: 'desc'
};
```

#### Content Schemas

```typescript
export const contentTypeEnum: ZodEnum<['video', 'audio', 'written']>;
export const contentStatusEnum: ZodEnum<['draft', 'published', 'archived']>;
export const visibilityEnum: ZodEnum<['public', 'private', 'members_only', 'purchased_only']>;
export const sortOrderEnum: ZodEnum<['asc', 'desc']>;

export const createContentSchema: ZodSchema;
export type CreateContentInput = {
  title: string;             // 1-500 chars, sanitized
  slug: string;              // lowercase a-z0-9-, max 500 chars
  description?: string;      // max 10000 chars, optional, nullable
  contentType: 'video' | 'audio' | 'written';
  mediaItemId?: string | null; // UUID, REQUIRED if video/audio
  contentBody?: string;      // max 100000 chars, REQUIRED if written
  organizationId?: string | null; // UUID, optional (personal content if null)
  category?: string | null;  // max 100 chars, optional, nullable
  tags?: string[];           // max 20 tags, each max 50 chars (defaults to [])
  thumbnailUrl?: string | null; // HTTP/HTTPS URL, optional, nullable
  visibility: 'public' | 'private' | 'members_only' | 'purchased_only'; // default: 'purchased_only'
  priceCents?: number | null; // 0 to 10M cents ($100K), nullable
};

// Refinements:
// 1. Video/audio MUST have mediaItemId
// 2. Written MUST have contentBody
// 3. Free content (price 0 or null) CANNOT be purchased_only visibility

export const updateContentSchema: ZodSchema; // All fields optional except mediaItemId removed
export type UpdateContentInput = Partial<Omit<CreateContentInput, 'mediaItemId'>>;

export const publishContentSchema: ZodSchema;
export type PublishContentInput = {
  contentId: string; // UUID of content to publish
};

export const contentQuerySchema: ZodSchema;
export type ContentQueryInput = {
  page: number;              // default: 1, coerced from query string
  limit: number;             // default: 20, max 100, coerced from query string
  status?: ContentStatusEnum; // optional filter
  contentType?: ContentTypeEnum; // optional filter
  visibility?: VisibilityEnum; // optional filter
  category?: string;         // max 100 chars, optional filter
  organizationId?: string;   // UUID, optional filter
  search?: string;           // max 255 chars, optional text search
  sortBy: 'createdAt' | 'updatedAt' | 'publishedAt' | 'title' | 'viewCount' | 'purchaseCount'; // default: 'createdAt'
  sortOrder: 'asc' | 'desc'; // default: 'desc'
};
```

#### Upload Request Schema

```typescript
export const uploadRequestSchema: ZodSchema;
export type UploadRequestInput = {
  filename: string;          // 1-255 chars, alphanumeric + ._- only (no spaces, no path separators)
  contentType: string;       // MIME type from whitelist (video/*, audio/*)
  fileSizeBytes: number;     // 1 byte to 5GB
  title: string;             // 1-255 chars, sanitized
  description?: string;      // max 1000 chars, optional, nullable
  mediaType: 'video' | 'audio';
};
```

### Identity Schemas

```typescript
export const userSchema: ZodSchema;
export type User = {
  email: string;      // valid email format
  name: string;       // 1+ characters
  age?: number;       // optional, must be >= 0
  role: 'user' | 'admin'; // default: 'user'
};

export const loginSchema: ZodSchema;
export type LoginCredentials = {
  email: string;      // valid email format
  password: string;   // min 8 characters
};
```

### Access Schemas

Validation for content streaming, playback tracking, and user library access.

```typescript
export const getStreamingUrlSchema: ZodSchema;
export type GetStreamingUrlInput = {
  contentId: string;          // UUID of content
  expirySeconds?: number;     // 300-7200 seconds (5 min to 2 hours), default: 3600 (1 hour)
};

export const savePlaybackProgressSchema: ZodSchema;
export type SavePlaybackProgressInput = {
  contentId: string;          // UUID of content
  positionSeconds: number;    // non-negative integer (>=0)
  durationSeconds: number;    // positive integer (>0)
  completed?: boolean;        // default: false
};

export const getPlaybackProgressSchema: ZodSchema;
export type GetPlaybackProgressInput = {
  contentId: string;          // UUID of content
};

export const listUserLibrarySchema: ZodSchema;
export type ListUserLibraryInput = {
  page: number;               // default: 1, max: 1000
  limit: number;              // default: 20, max: 100
  filter: 'all' | 'in-progress' | 'completed'; // default: 'all'
  sortBy: 'recent' | 'title' | 'duration'; // default: 'recent'
};
```

### Purchase Schemas

Validation for Stripe Checkout integration and purchase queries. All URLs are HTTP/HTTPS only.

```typescript
export const checkoutRedirectUrlSchema: ZodSchema;
// Whitelisted domains: revelations.studio, codex.revelations.studio, app.revelations.studio,
// codex-staging.revelations.studio, app-staging.revelations.studio, localhost, 127.0.0.1
// Prevents open redirect attacks via domain whitelist

export const purchaseStatusEnum: ZodEnum<['pending', 'completed', 'refunded', 'failed']>;
// Aligns with database CHECK constraint

export const createCheckoutSchema: ZodSchema;
export type CreateCheckoutInput = {
  contentId: string;          // UUID of content to purchase
  successUrl: string;         // HTTP/HTTPS URL on whitelisted domain
  cancelUrl: string;          // HTTP/HTTPS URL on whitelisted domain
};

export const purchaseQuerySchema: ZodSchema;
export type PurchaseQueryInput = {
  page: number;               // default: 1, max: 1000, coerced from query string
  limit: number;              // default: 20, max: 100, coerced from query string
  status?: PurchaseStatus;    // optional filter
  contentId?: string;         // UUID, optional filter
};

export const getPurchaseSchema: ZodSchema;
export type GetPurchaseInput = {
  id: string;                 // UUID of purchase record
};

export const checkoutSessionMetadataSchema: ZodSchema;
export type CheckoutSessionMetadata = {
  customerId: string;         // Better Auth user ID (alphanumeric)
  contentId: string;          // UUID of content being purchased
  organizationId?: string | null; // UUID of creator's organization, nullable
};
```

## Core Validation Patterns

### 1. Basic Usage: Parse & Type Inference

```typescript
import { createContentSchema, type CreateContentInput } from '@codex/validation';

// Parse (throws ZodError on failure)
const validated = createContentSchema.parse(userInput);

// Safe parse (no throw)
const result = createContentSchema.safeParse(userInput);
if (result.success) {
  const validated: CreateContentInput = result.data;
}

// Type inference via z.infer (single source of truth)
type MyInput = z.infer<typeof createContentSchema>;
```

### 2. Route Parameter Validation

```typescript
import { procedure } from '@codex/worker-utils';
import { createIdParamsSchema, createSlugParamsSchema } from '@codex/validation';

// GET /content/:id
app.get('/:id', procedure({
  policy: { auth: 'required' },
  input: { params: createIdParamsSchema() },
  handler: async (ctx) => {
    const { id } = ctx.input.params; // UUID
  },
}));

// GET /org/:slug
app.get('/:slug', procedure({
  policy: { auth: 'required' },
  input: { params: createSlugParamsSchema(255) },
  handler: async (ctx) => {
    const { slug } = ctx.input.params; // lowercase a-z0-9-
  },
}));
```

### 3. Query Parameters with Type Coercion

Query string parameters are always strings in URLs. Use `z.coerce` to convert:

```typescript
import { procedure } from '@codex/worker-utils';
import { contentQuerySchema } from '@codex/validation';

// URL: ?page=2&limit=50&status=published
app.get('/content', procedure({
  policy: { auth: 'required' },
  input: { query: contentQuerySchema },
  handler: async (ctx) => {
    // ctx.input.query has page/limit coerced to numbers
    const { page, limit, status } = ctx.input.query;
  },
}));
```

### 4. Schema Composition

Extend schemas to add filters and sorting:

```typescript
import { paginationSchema } from '@codex/validation';

// Extend pagination with domain-specific filters
const myQuerySchema = paginationSchema.extend({
  status: z.enum(['active', 'inactive']).optional(),
  createdAfter: z.coerce.date().optional(),
});
```

### 5. Cross-Field Validation (Refinements)

Validate relationships between fields:

```typescript
export const createContentSchema = baseContentSchema
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

## Security Features

All validation schemas enforce security at the API boundary:

### XSS Prevention

URL fields reject `javascript:` and `data:` URIs:

```typescript
// Valid
urlSchema.parse('https://example.com');
urlSchema.parse('http://subdomain.example.com:8080');

// Throws
urlSchema.parse('javascript:alert(1)');
urlSchema.parse('data:text/html,<img src=x onerror=alert(1)>');
```

### Path Traversal Prevention

R2 keys and filenames reject traversal sequences:

```typescript
// Valid
createMediaItemSchema.parse({
  // ...
  r2Key: 'originals/abc123/video.mp4',
});

// Throws
createMediaItemSchema.parse({
  // ...
  r2Key: '../../../etc/passwd',
});

uploadRequestSchema.parse({
  filename: 'video.mp4', // Valid
});
uploadRequestSchema.parse({
  filename: '../etc/passwd', // Throws
});
```

### Open Redirect Prevention

Checkout redirect URLs are domain-whitelisted:

```typescript
// Whitelisted domains
- revelations.studio
- codex.revelations.studio
- app.revelations.studio
- codex-staging.revelations.studio
- app-staging.revelations.studio
- localhost (dev only)
- 127.0.0.1 (dev only)

// Valid
checkoutRedirectUrlSchema.parse('https://app.revelations.studio/success');

// Throws
checkoutRedirectUrlSchema.parse('https://evil.com/phish');
```

### String Sanitization

All user-generated strings are trimmed and length-bounded:

```typescript
// Input: "  My Title  "
// Output: "My Title" (trimmed)
// Max length enforced: 255 chars
createSanitizedStringSchema(1, 255, 'Title').parse('  My Title  ');
```

### Enum Whitelisting

Only database-defined values accepted:

```typescript
mediaTypeEnum.parse('video');    // Valid
mediaTypeEnum.parse('audio');    // Valid
mediaTypeEnum.parse('document');  // Throws (not whitelisted)
```

## Database Alignment

All validation schemas align exactly with database constraints. Enum values in schemas match CHECK constraints in the database schema:

| Schema | Database Column | Constraint | Alignment |
|--------|-----------------|-----------|-----------|
| `mediaTypeEnum` | media_items.media_type | `('video', 'audio')` | Exact match |
| `mediaStatusEnum` | media_items.status | `('uploading', 'uploaded', 'transcoding', 'ready', 'failed')` | Exact match |
| `contentTypeEnum` | content.content_type | `('video', 'audio', 'written')` | Exact match |
| `contentStatusEnum` | content.status | `('draft', 'published', 'archived')` | Exact match |
| `visibilityEnum` | content.visibility | `('public', 'private', 'members_only', 'purchased_only')` | Exact match |
| `purchaseStatusEnum` | purchases.status | `('pending', 'completed', 'refunded', 'failed')` | Exact match |
| `priceCentsSchema` | content.price_cents, purchases.amount_paid_cents | Non-negative integer, max 10M | Non-negative int, 0-10M |
| `createSlugSchema(500)` | content.slug | VARCHAR(500) | Max 500 chars |
| `organizationSlugSchema` | organizations.slug | VARCHAR(255), UNIQUE | Max 255 chars, unique |

This ensures that:
1. API validation matches database constraints (no surprises on insert/update)
2. Changes to database constraints must be reflected in validation schemas
3. Enum values are whitelisted at the API boundary (principle of least privilege)

## Usage Examples

### Example 1: Create Endpoint with Full Validation

```typescript
import { procedure } from '@codex/worker-utils';
import { createContentSchema, createIdParamsSchema } from '@codex/validation';
import { ContentService } from '@codex/content';

// POST /api/content
app.post('/api/content', procedure({
  policy: { auth: 'required' },
  input: { body: createContentSchema },
  handler: async (ctx) => {
    const service = new ContentService({ db: dbHttp });
    const content = await service.create(ctx.input.body, ctx.user.id);
    return { data: content };
  },
}));

// GET /api/content/:id
app.get('/api/content/:id', procedure({
  policy: { auth: 'required' },
  input: { params: createIdParamsSchema() },
  handler: async (ctx) => {
    const service = new ContentService({ db: dbHttp });
    const content = await service.get(ctx.input.params.id, ctx.user.id);
    return { data: content };
  },
}));
```

### Example 2: List Endpoint with Pagination & Filters

```typescript
import { procedure } from '@codex/worker-utils';
import { contentQuerySchema } from '@codex/validation';

// GET /api/content?page=1&limit=20&status=published
app.get('/api/content', procedure({
  policy: { auth: 'required' },
  input: { query: contentQuerySchema },
  handler: async (ctx) => {
    const service = new ContentService({ db: dbHttp });
    const { items, total } = await service.list(
      ctx.input.query,
      ctx.user.id
    );
    return { data: items, total };
  },
}));
```

### Example 3: Service Layer with Type Safety

```typescript
import { type CreateContentInput } from '@codex/validation';

export class ContentService {
  async create(input: CreateContentInput, creatorId: string) {
    // input is fully typed and validated
    const { title, slug, visibility, priceCents } = input;

    // Guaranteed to satisfy database constraints
    const [content] = await this.db
      .insert(schema.content)
      .values({ ...input, creatorId })
      .returning();

    return content;
  }
}
```

### Example 4: Error Handling

```typescript
import { createContentSchema } from '@codex/validation';

const result = createContentSchema.safeParse(userInput);

if (!result.success) {
  // result.error contains all validation issues
  const errors = result.error.errors.map((e) => ({
    path: e.path.join('.'),
    message: e.message,
  }));
  return c.json({ error: 'Validation failed', errors }, 400);
}

// result.data is guaranteed valid
const validated = result.data;
```

## Integration with Codex Architecture

### Dependent Packages

| Package | Usage | Schemas |
|---------|-------|---------|
| @codex/content | Content & media lifecycle | createContentSchema, createMediaItemSchema, createOrganizationSchema |
| @codex/identity | Organization management | createOrganizationSchema, updateOrganizationSchema |
| @codex/access | Content access & streaming | getStreamingUrlSchema, savePlaybackProgressSchema, listUserLibrarySchema |
| @codex/purchase | Stripe checkout & purchases | createCheckoutSchema, purchaseQuerySchema, checkoutSessionMetadataSchema |

### Dependent Workers

All workers use validation schemas in route handlers via `procedure()`:

```typescript
import { procedure } from '@codex/worker-utils';
import { createContentSchema } from '@codex/validation';

app.post('/api/content', procedure({
  policy: { auth: 'required' },
  input: { body: createContentSchema },
  handler: async (ctx) => {
    // ctx.input is fully validated and typed
  },
}));
```

## Performance & Best Practices

**Validation cost**: Minimal (microseconds per request). Zod caches regex compilation and runs custom refinements only after basic validation passes.

**Best practices**:
1. Validate at API boundaries (route handlers), not in services
2. Reuse schemas from this package rather than duplicating
3. Use `.safeParse()` for error handling without try/catch
4. Let TypeScript infer types from schemas (don't manually define types)
5. Extend base schemas for domain-specific filters/sorting

## Testing

Comprehensive test suites cover valid inputs, error cases, edge cases, security validations (XSS, path traversal, injection), and database constraint alignment. Run tests:

```bash
pnpm test
pnpm test:watch
pnpm test:coverage
```

## Quick Reference

**Common schemas**:
```
createContentSchema, updateContentSchema, contentQuerySchema
createOrganizationSchema, updateOrganizationSchema
createMediaItemSchema, updateMediaItemSchema
getStreamingUrlSchema, savePlaybackProgressSchema
createCheckoutSchema, purchaseQuerySchema
createIdParamsSchema, createSlugParamsSchema
```

**Common primitives**:
```
uuidSchema, userIdSchema
createSlugSchema(maxLength), urlSchema
priceCentsSchema, positiveIntSchema, nonNegativeIntSchema
emailSchema
```

**Common patterns**:
```
schema.parse(input)                          // Throws ZodError
schema.safeParse(input)                      // Returns {success, data|error}
z.infer<typeof schema>                       // Type inference
type MyType = z.infer<typeof mySchema>;      // Type extraction
```

**Enum exports**:
```
contentTypeEnum, contentStatusEnum, visibilityEnum
mediaTypeEnum, mediaStatusEnum
purchaseStatusEnum
sortOrderEnum
organizationStatusEnum
```

## Build & Deployment

```bash
# Development
npm run build      # Build package
npm run dev        # Watch mode
npm run typecheck  # Type check

# Testing
npm run test              # Run all tests
npm run test:coverage     # Coverage report
```

Exports:
- Main: `./dist/index.js`
- Types: `./dist/index.d.ts`
- Zod version: 3.24.1

## License

MIT

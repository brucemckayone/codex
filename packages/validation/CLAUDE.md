# @codex/validation

Zod schemas for input validation. Single source of truth for all API inputs.

## Usage Patterns

### Basic Pattern: Validate User Input

```ts
import { createContentSchema, uuidSchema } from '@codex/validation';

// In procedure()
app.post('/api/content',
  procedure({
    policy: { auth: 'required' },
    input: { body: createContentSchema },
    handler: async (ctx) => {
      // ctx.input.body is typed and validated
      return await ctx.services.content.create(ctx.input.body, ctx.user.id);
    },
  })
);

// Direct validation (rare)
const id = uuidSchema.parse(req.param('id')); // throws if invalid
```

### Defensive Validation in Services

```ts
import { z, uuidSchema } from '@codex/validation';

class ContentService {
  async getById(id: string, userId: string) {
    // Defensive validation (belt & suspenders)
    const validId = uuidSchema.parse(id);
    const validUserId = uuidSchema.parse(userId);

    return await db.query.content.findFirst({
      where: (content, { eq }) => eq(content.id, validId),
    });
  }
}
```

## Common Schemas

### Content & Media
- `createContentSchema` - Create content (title, slug, mediaItemId, visibility, price)
- `updateContentSchema` - Update content (partial fields)
- `contentQuerySchema` - List/filter content (pagination, creatorId, status)
- `createMediaItemSchema` - Register media upload
- `mediaQuerySchema` - List media items

### Organizations
- `createOrganizationSchema` - Create org (name, slug, description, logoUrl, websiteUrl)
- `updateOrganizationSchema` - Update org (all fields optional)
- `inviteMemberSchema` - Invite org member (email, role)
- `updateMemberRoleSchema` - Update member role
- `listMembersQuerySchema` - List org members (pagination, role filter)

### Access & Playback
- `getStreamingUrlSchema` - Request streaming URL (contentId)
- `savePlaybackProgressSchema` - Save playback position (contentId, position)

### Purchases
- `createCheckoutSchema` - Stripe checkout session (contentId, successUrl, cancelUrl)
- `purchaseQuerySchema` - List purchases (userId, contentId, status)

### Common Utilities
- `paginationSchema` - `{ page: number, limit: number }` (max 100/page)
- `uuidSchema` - UUID v4 validation
- `userIdSchema` - BetterAuth user ID (alphanumeric, 1-64 chars)
- `slugSchema` - Lowercase alphanumeric + hyphens
- `urlSchema` - HTTP/HTTPS only (XSS prevention)
- `emailSchema` - Email validation

## Primitives (Building Blocks)

### Identifiers
- `uuidSchema` - UUID v4 (e.g., content IDs, media IDs)
- `userIdSchema` - BetterAuth user ID (alphanumeric string)
- `createSlugSchema(maxLength)` - Slug factory (default 500 chars)
- `createIdParamsSchema()` - `{ id: uuidSchema }` for route params
- `createSlugParamsSchema()` - `{ slug: slugSchema }` for route params

### URLs & Strings
- `urlSchema` - HTTP/HTTPS URLs only (blocks `javascript:`, `data:`)
- `emailSchema` - Email validation
- `createSanitizedStringSchema(min, max, fieldName)` - Trim + length limits
- `createOptionalTextSchema(max, fieldName)` - Nullable text with max length

### Numbers
- `priceCentsSchema` - Integer cents (0-10,000,000), nullable (null = free)
- `positiveIntSchema` - Positive integers (e.g., page numbers)
- `nonNegativeIntSchema` - Non-negative integers (e.g., counts)

### Dates & Colors
- `isoDateSchema` - ISO 8601 date strings coerced to Date objects
- `hexColorSchema` - `#RRGGBB` format (uppercase normalized)
- `timezoneSchema` - IANA timezone (e.g., `America/New_York`)

## Special Cases

### SVG Sanitization

**Use Case**: Sanitize user-uploaded SVG files to prevent XSS.

```ts
import { sanitizeSvgContent } from '@codex/validation';

const safeSvg = await sanitizeSvgContent(userUploadedSvg);
// Removes <script>, onclick handlers, dangerous URIs
```

**What's Blocked**:
- `<script>`, `<iframe>`, `<object>`, `<embed>`, `<foreignObject>`
- Event handlers (`onerror`, `onload`, `onclick`, etc.)
- `javascript:`, `data:` URIs

**What's Allowed**:
- Safe SVG elements (`<svg>`, `<path>`, `<circle>`, `<rect>`, `<g>`, `<defs>`)
- Gradients, filters, common attributes

**Note**: Returns empty string if sanitization fails (indicates malicious file).

### MIME Type Extraction

**Use Case**: Extract clean MIME type from Content-Type header.

```ts
import { extractMimeType } from '@codex/validation';

const mimeType = extractMimeType('image/jpeg; charset=utf-8');
// Returns: 'image/jpeg'
```

### Organization Slug Validation

**Use Case**: Ensure org slug doesn't conflict with platform subdomains.

```ts
import { createOrganizationSchema } from '@codex/validation';

// Organization slug is validated within createOrganizationSchema
createOrganizationSchema.parse({
  name: 'My Org',
  slug: 'platform', // throws (reserved subdomain)
});

createOrganizationSchema.parse({
  name: 'My Org',
  slug: 'my-org',   // valid
});
```

**Reserved Subdomains**: `platform`, `api`, `www`, `admin`, `docs`, `blog`, `status`, `cdn` (see `@codex/constants/RESERVED_SUBDOMAINS_SET`)

**Implementation**: The slug validation is built into `createOrganizationSchema` using `organizationSlugSchema` (internal to content-schemas.ts)

## Standards

### Validation Best Practices
1. **Use Zod schemas** for all user input (body, query, params)
2. **Match database constraints** (string lengths, enum values)
3. **Sanitize strings** (trim whitespace, normalize case)
4. **Prevent XSS** (block `javascript:`, `data:` URIs in URLs)
5. **Clear error messages** (user-friendly, non-leaking)

### Error Handling
- Invalid input throws `ZodError` with field-level details
- Procedure automatically catches and returns 400 Bad Request
- Service errors (business logic) throw typed errors (404, 403, etc.)

### Integration with `procedure()`
```ts
// Input validation happens before handler execution
app.post('/api/content/:id/publish',
  procedure({
    policy: { auth: 'required' },
    input: { params: createIdParamsSchema() },
    handler: async (ctx) => {
      // ctx.input.params.id is guaranteed to be valid UUID
      return await ctx.services.content.publish(
        ctx.input.params.id,
        ctx.user.id
      );
    },
  })
);
```

### Type Inference
```ts
import { z } from '@codex/validation';

const schema = createContentSchema;
type ContentInput = z.infer<typeof schema>;
// Type-safe input across workers and services
```

## Reference
- **Source**: `/packages/validation/src/`
- **Primitives**: `/packages/validation/src/primitives.ts`
- **Schemas**: `/packages/validation/src/schemas/` and `/packages/validation/src/content/`
- **Tests**: `/packages/validation/src/__tests__/`

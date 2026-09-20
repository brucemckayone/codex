---
name: validation-patterns
description: >
  Deep reference for Zod schema composition, shared primitives, input sanitization,
  magic byte validation, and the schema-first workflow for Codex endpoints.
type: reference
---

# Validation Patterns

Validation is the first line of defense. Every HTTP input — body, query, params —
must be validated by a Zod schema before it reaches a handler. This is not a
suggestion; it's enforced by `procedure()` which calls `validateInput()` at
step 6 of the pipeline.

The `@codex/validation` package is the single source of truth for schemas. Never
define schemas inline in route handlers.

Reference implementations:
- `packages/validation/CLAUDE.md` — authoritative rules
- `packages/validation/src/primitives.ts` — building blocks
- `packages/validation/src/schemas/` — domain schemas
- `packages/validation/src/content/content-schemas.ts` — content/media schemas

---

## Why Schemas Live in One Package

If schemas live next to their route handlers, three things break:

1. **Reuse** — the admin worker and the content worker both need `createContentSchema`
2. **Testing** — services can't be unit-tested against schemas without importing workers
3. **Types** — schemas provide the TypeScript types consumed by services and the web app

Centralising in `@codex/validation` means:
- `api.content.create(input)` on the frontend uses the inferred type
- `ContentService.create(input)` uses the same inferred type
- `procedure({ input: { body: createContentSchema } })` validates at the edge

One shape, three consumers, no drift.

---

## The Three Input Slots

```typescript
procedure({
  input: {
    params: z.object({ id: uuidSchema }),        // URL params — :id in path
    query: paginationQuerySchema,                 // ?page=2&limit=20
    body: createContentSchema,                    // JSON body (POST/PATCH)
  },
  handler: async (ctx) => {
    // All three are now fully typed:
    ctx.input.params.id       // string (UUID)
    ctx.input.query.page      // number
    ctx.input.body.title      // string
  }
})
```

Each slot is optional and validated independently. A `ValidationError` reports
which slot failed.

---

## Shared Primitives

Never re-write these. If you find yourself writing `z.string().uuid()`, import
`uuidSchema` instead:

| Primitive | Shape | Use |
|-----------|-------|-----|
| `uuidSchema` | v4 UUID | Resource IDs |
| `userIdSchema` | alphanumeric 1–64 | BetterAuth user IDs (not UUIDs) |
| `createSlugSchema(max?)` | lowercase + hyphens | Org/content slugs |
| `createIdParamsSchema()` | `{ id: uuidSchema }` | Route `:id` params |
| `createSlugParamsSchema(max?)` | `{ slug: slugSchema }` | Route `:slug` params |
| `urlSchema` | http/https only | User-provided URLs (blocks `javascript:`, `data:`) |
| `optionalUrlSchema()` | url or undefined | Optional URL fields (empty string coerced to undefined) |
| `emailSchema` | RFC-ish email | Login, registration, invitations |
| `createSanitizedStringSchema(min, max, field)` | trimmed, length-bounded | Most text fields |
| `createOptionalTextSchema(max, field)` | nullable text | Optional descriptions |
| `priceCentsSchema` | 0–10,000,000 pence, nullable | Prices (null = free) |
| `positiveIntSchema` | ≥1 integer | Counts, quantities |
| `nonNegativeIntSchema` | ≥0 integer | Offsets, zero-permitted counts |
| `isoDateSchema` | ISO 8601 → `Date` | Date inputs (coerced) |
| `hexColorSchema` | `#RRGGBB` uppercase | Brand colors |
| `timezoneSchema` | IANA tz string | Scheduling |
| `radiusValueSchema` | 0–2 rem | Border radius tokens |
| `densityValueSchema` | 0.75–1.25 | Spacing density |
| `fontNameSchema` | ≤50 chars | Font families |

---

## Composition Patterns

### Creating vs updating

Create schemas are strict — required fields are required. Update schemas are
usually `.partial()`:

```typescript
export const createContentSchema = z.object({
  title: createSanitizedStringSchema(1, 200, 'title'),
  slug: createSlugSchema(100),
  contentType: contentTypeEnum,
  visibility: visibilityEnum,
  priceCents: priceCentsSchema,
  description: createOptionalTextSchema(5000, 'description'),
});

export const updateContentSchema = createContentSchema.partial().extend({
  // Fields that can only be set on update (e.g. status transitions)
  status: contentStatusEnum.optional(),
});
```

### Query schemas

Always extend `paginationSchema`:

```typescript
import { paginationSchema } from '@codex/validation';

export const contentQuerySchema = paginationSchema.extend({
  status: contentStatusEnum.optional(),
  contentType: contentTypeEnum.optional(),
  search: z.string().max(200).optional(),
});
```

Max string length on `search` is deliberate — it's an open text input. Unbounded
strings are a DoS vector when stored or piped into queries.

### Enums

Define enums in the schema file, export them, reuse:

```typescript
export const contentStatusEnum = z.enum(['draft', 'published', 'archived']);
export type ContentStatus = z.infer<typeof contentStatusEnum>;
```

The inferred type travels with the schema — services, routes, and the frontend
all use the same union.

### Discriminated unions

For payloads that vary by type:

```typescript
export const notificationEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('purchase_completed'),
    purchaseId: uuidSchema,
    amountCents: priceCentsSchema,
  }),
  z.object({
    type: z.literal('subscription_created'),
    subscriptionId: uuidSchema,
    tierName: z.string(),
  }),
]);
```

Discriminated unions give exhaustive type narrowing in handlers:

```typescript
switch (event.type) {
  case 'purchase_completed': event.purchaseId; break;   // ← typed
  case 'subscription_created': event.tierName; break;   // ← typed
}
```

---

## Sanitization: Beyond Validation

Validation *confirms shape*. Sanitization *removes dangerous content*. Some inputs
need both.

### SVG content (XSS vector)

SVGs can embed `<script>`, event handlers, and `javascript:` URIs. They must be
sanitized before storage or rendering:

```typescript
import { sanitizeSvgContent } from '@codex/validation';

// Inside a service (logo upload):
const safeSvg = await sanitizeSvgContent(rawSvgString);
// Throws if sanitization strips everything (malicious file)
// Blocks: <script>, <iframe>, <object>, <embed>, <foreignObject>, <image>
// Blocks: onerror, onload, onclick, onmouseover handlers
// Blocks: javascript:, data: URIs
```

Used by:
- Org logo upload (SVG variant)
- Anywhere else we accept SVG input

### User-provided URLs

Always use `urlSchema`, never `z.string().url()`:

```typescript
// WRONG — accepts javascript:alert(1)
website: z.string().url()

// CORRECT — only http/https
website: urlSchema
```

`urlSchema` blocks dangerous protocols. Zod's `.url()` doesn't.

### MIME type and magic bytes (file uploads)

File uploads need two layers:

1. **MIME type allowlist** — from the `Content-Type` header (cheap, trust-but-verify)
2. **Magic byte validation** — actually read the first few bytes of the file

```typescript
import { validateImageSignature } from '@codex/validation';

// In the service after multipartProcedure delivered the file:
if (!validateImageSignature(new Uint8Array(file.buffer), file.type)) {
  throw new ValidationError('File content does not match declared type');
}
```

Without magic byte checking, an attacker can rename `evil.html` to `evil.png`
and the browser will still render it as HTML when served with guessed MIME.

See `07-file-upload-patterns.md` for the full upload security model.

---

## Error Shape

When validation fails, `procedure()` calls `mapErrorToResponse` which produces:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Input validation failed",
    "details": {
      "body.title": "Too short: minimum 1 character",
      "query.limit": "Number must be less than or equal to 100"
    }
  }
}
```

Status: 422.

The frontend uses `details` to attach errors to form fields by path.

---

## Schema Placement

| Domain | File |
|--------|------|
| Content, media, uploads | `packages/validation/src/content/content-schemas.ts` |
| Access, playback | `packages/validation/src/schemas/access.ts` |
| Organization members | `packages/validation/src/schemas/organization.ts` |
| Purchases (Stripe) | `packages/validation/src/schemas/purchase.ts` |
| Subscriptions | `packages/validation/src/schemas/subscription.ts` |
| Settings (branding, contact, features) | `packages/validation/src/schemas/settings.ts` |
| Transcoding (RunPod webhook) | `packages/validation/src/schemas/transcoding.ts` |
| File upload meta | `packages/validation/src/schemas/file-upload.ts` |
| Notifications | `packages/validation/src/schemas/notifications.ts` |
| Auth | `packages/validation/src/auth.ts` |
| Identity (user profile) | `packages/validation/src/identity/user-schema.ts` |
| Admin | `packages/validation/src/admin/admin-schemas.ts` |
| Pagination | `packages/validation/src/shared/pagination-schema.ts` |
| Primitives | `packages/validation/src/primitives.ts` |

All exported through `packages/validation/src/index.ts` — import from the package
root, not the internal paths.

---

## Adding a New Schema

1. Choose the right domain file (or create a new one in `schemas/`)
2. Use existing primitives — never re-invent UUID, email, URL, price schemas
3. Export the schema AND the inferred type
4. Add to `packages/validation/src/index.ts` barrel
5. Consume from route handler: `input: { body: yourSchema }`
6. Consume from service: `async create(input: z.infer<typeof yourSchema>)`
7. Write tests — happy path, each failure mode, edge cases (empty, max length, unicode)

---

## Anti-Patterns

| Anti-pattern | Why it breaks | Fix |
|--------------|---------------|-----|
| Inline schema in route handler | Non-reusable, unshared type | Add to `@codex/validation`, export |
| `z.string().url()` for user URLs | Accepts `javascript:`, `data:` | `urlSchema` |
| `z.string()` for free text | Unbounded — DoS via huge payloads | `createSanitizedStringSchema(min, max)` or `.max()` |
| Writing regex for emails / UUIDs / slugs | Wheel re-invented, tests drift | Use primitives |
| Accepting SVG without `sanitizeSvgContent` | XSS on render | Sanitize in the service layer |
| `z.number()` for prices | No range check, could be negative | `priceCentsSchema` |
| `z.string().datetime()` | Zod gives a string, not a `Date` | `isoDateSchema` coerces to `Date` |
| Schema in the wrong slot (body where params expected) | 422 on every request | Match schema to slot |
| `.strict()` always | Breaks forward compatibility (new optional fields fail) | Default (strip unknown) is fine |
| Ad-hoc `.refine(...)` instead of cross-field validation | Hard to reuse | Extract to named schema |
| Using `z.union` where `z.discriminatedUnion` fits | Poorer errors, slower parsing | Discriminated union with a `type` field |
| `str.substring(0, N)` to truncate user-provided text before varchar | Can split a UTF-8 code unit mid-way → mojibake + JSON serialization errors | `safeTruncate(str, N)` that respects code-unit boundaries |

---

## Debugging Validation Failures

1. **422 on a field you swear is correct?** — check the actual request body in worker logs; trailing whitespace, missing fields, wrong type are common.
2. **Schema imports `undefined`?** — primitive not in `index.ts` barrel.
3. **Type mismatch between service input and route** — one imports from `@codex/validation`, the other redefines locally. Consolidate.
4. **`z.infer<typeof schema>` too loose?** — probably used `z.any()` somewhere in the schema. Tighten it.
5. **`.partial()` gives every field `T | undefined` but you want `T | null`** — use `.nullable()` on the original field, not `.partial()`.

---

## When to Re-Verify This Reference

Re-read this doc against current code if you see changes in:

- `packages/validation/src/primitives.ts` (shared primitives)
- `packages/validation/src/index.ts` (barrel exports)
- `packages/validation/CLAUDE.md` (rules)
- Any new schema file in `packages/validation/src/schemas/`

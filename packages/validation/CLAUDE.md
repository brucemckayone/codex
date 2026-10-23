# @codex/validation

Zod schemas for all API inputs. Single source of truth — define schemas here, never in route handlers.

## Usage with `procedure()`

```ts
import { createContentSchema, createIdParamsSchema } from '@codex/validation';

app.post('/content',
  procedure({
    policy: { auth: 'required' },
    input: { body: createContentSchema },
    handler: async (ctx) => {
      // ctx.input.body is fully typed and validated
      return await ctx.services.content.create(ctx.input.body, ctx.user.id);
    },
  })
);

app.get('/content/:id',
  procedure({
    policy: { auth: 'required' },
    input: { params: createIdParamsSchema() },
    handler: async (ctx) => {
      // ctx.input.params.id is guaranteed UUID
    },
  })
);
```

## Schema Domains

### Content & Media (`content/content-schemas.ts`)
- `createContentSchema` — create content (title, slug, type, visibility, price, etc.)
- `updateContentSchema` — partial update
- `publishContentSchema` — publish with optional publishedAt date
- `contentQuerySchema` — paginated list (status, type, creatorId, visibility filters)
- `publicContentQuerySchema` — public-facing list (published only)
- `publicContentArgsSchema` — the web `getPublicContent` remote query's args, built from the same field rules as `publicContentQuerySchema`
- `publicContentSlugSchema` (`PUBLIC_CONTENT_SLUG_MAX`), `topicSlugSchema` (`TOPIC_SLUG_MAX`), `orgIdQuerySchema` (lowercased, for KV keys), `PUBLIC_LIST_MAX_LIMIT` (50: the API caps to it, the remote refuses past it) — field rules shared by the API, the remote query and the web pages that 404 before calling
- `discoverContentQuerySchema` — platform-wide published list (type, search, sort)
- `uploadRequestSchema` — presigned upload request (filename, mimeType, fileSize)
- `createMediaItemSchema` — register media upload
- `updateMediaItemSchema` — update media metadata
- `mediaQuerySchema` — paginated media list
- `checkContentSlugSchema` — slug availability check
- `organizationQuerySchema` — org-scoped content query
- Enums: `contentTypeEnum`, `visibilityEnum`, `contentStatusEnum`, `contentAccessTypeEnum`, `mediaTypeEnum`, `mediaStatusEnum`

### Organization Members (`schemas/organization.ts`)
- `inviteMemberSchema` — invite by email + role
- `updateMemberRoleSchema` — change member role
- `listMembersQuerySchema` — paginated members list with role filter
- `publicMembersQuerySchema` — public members query

### Access & Playback (`schemas/access.ts`)
- `getStreamingUrlSchema` — request signed streaming URL (`contentId`)
- `savePlaybackProgressSchema` — save position (`contentId`, `positionSeconds`, `durationSeconds`, `completed`)
- `getPlaybackProgressSchema` — get progress for content
- `listUserLibrarySchema` — paginated library with filters

### Purchases (`schemas/purchase.ts`)
- `createCheckoutSchema` — Stripe checkout (`contentId`, `successUrl`, `cancelUrl`)
- `purchaseQuerySchema` — list purchases (userId, contentId, status)
- `getPurchaseSchema` — get single purchase
- `createPortalSessionSchema` — Stripe billing portal
- `verifyCheckoutSessionSchema` — verify session after redirect
- `checkoutSessionMetadataSchema` — internal Stripe metadata shape
- `purchaseStatusEnum` — purchase statuses

### Settings (`schemas/settings.ts`)
- `updateBrandingSchema` — org branding (colors, fonts, radius, density, logo, intro video, hero layout)
- `updateContactSchema` — contact settings (name, email, timezone, social URLs)
- `updateFeaturesSchema` — feature flags (signups, purchases, subscriptions)
- `brandingSettingsSchema`, `contactSettingsSchema`, `featureSettingsSchema` — full settings shapes
- `allSettingsSchema` — combined settings
- `DEFAULT_BRANDING`, `DEFAULT_CONTACT`, `DEFAULT_FEATURES` — default values
- `pricingFaqItemSchema`, `pricingFaqSchema` — FAQ array
- `logoMimeTypeSchema`, `ALLOWED_LOGO_MIME_TYPES`, `MAX_LOGO_FILE_SIZE_BYTES`

### Subscriptions (`schemas/subscription.ts`)
- Subscription-related schemas (plans, membership)

### Transcoding (`schemas/transcoding.ts`)
- `runpodWebhookSchema`, `runpodWebhookUnionSchema` — RunPod webhook payloads
- `runpodWebhookOutputSchema` — transcoding output (HLS variants, thumbnails)
- `retryTranscodingSchema`, `getTranscodingStatusSchema`
- Enums: `runpodJobStatusEnum`, `transcodingStepEnum`, `hlsVariantSchema`, `thumbnailSizeSchema`, `mezzanineStatusEnum`
- Types: `RunPodWebhookPayload`, `RunPodWebhookOutput`, `TranscodingStep`

### File Upload (`schemas/file-upload.ts`)
- File upload validation schemas

### Notifications (`schemas/notifications.ts`)
- Email/notification schemas

### Auth (`auth.ts`)
- Auth-related schemas (registration, login, etc.)

### Identity (`identity/user-schema.ts`)
- User profile schemas

### Admin (`admin/admin-schemas.ts`)
- Admin-only operation schemas

### Pagination (`shared/pagination-schema.ts`)
- `paginationSchema` — `{ page, limit }`: page 1 to `PAGINATION_MAX_PAGE` (1000), limit 1–100
- `PaginationInput` — inferred type
- `clampPageParam(raw)` — a `?page=` URL param clamped to a page every list accepts, for a server load that forwards it

### Search (`shared/search-schema.ts`)
- `createSearchQuerySchema(max = SEARCH_MAX_QUERY_LENGTH)` — the ONLY free-text `search` schema: drops NUL, trims, caps
- `boundSearchParam(raw)` — the same normalisation for a server load that forwards a URL param, cutting rather than refusing
- `gateSearchQuery` / `isSearchQueryBelowFloor` — the client-side 3-character floor
- `stripNul` / `hasNoNul` — see the NUL rule below

## Primitives (`primitives.ts`)

| Export | Purpose |
|---|---|
| `uuidSchema` | UUID v4 validation |
| `userIdSchema` | BetterAuth user ID (alphanumeric, 1–64 chars) |
| `createSlugSchema(maxLength?)` | Slug factory (lowercase alphanumeric + hyphens) |
| `createIdParamsSchema()` | `{ id: uuidSchema }` for route params |
| `createSlugParamsSchema(maxLength?)` | `{ slug: slugSchema }` for route params |
| `urlSchema` | HTTP/HTTPS only — blocks `javascript:`, `data:` |
| `optionalUrlSchema(message?)` | Optional URL — coerces empty string to undefined |
| `createPlatformImageUrlSchema(base)` | **Image URLs only** — narrows `urlSchema` to the asset CDN `base` (`R2_PUBLIC_URL_BASE`). Fails closed when `base` is missing |
| `PLATFORM_IMAGE_URL_MESSAGE` | Canonical rejection message for the above (services reuse it in `ValidationError`) |
| `emailSchema` | Email validation |
| `createSanitizedStringSchema(min, max, field)` | Trimmed string with length limits |
| `createOptionalTextSchema(max, field)` | Nullable optional text |
| `priceCentsSchema` | Integer pence, 0–10,000,000, nullable (null = free) |
| `positiveIntSchema` | Positive integers |
| `nonNegativeIntSchema` | Non-negative integers |
| `isoDateSchema` | ISO 8601 → coerced `Date` |
| `hexColorSchema` | `#RRGGBB` normalized to uppercase |
| `timezoneSchema` | IANA timezone string |
| `radiusValueSchema` | Border radius: 0–2 rem |
| `densityValueSchema` | Spacing multiplier: 0.75–1.25 |
| `fontNameSchema` | Font family name (alphanumeric + spaces, max 50) |
| `sanitizeSvgContent(content)` | Async DOMPurify SVG sanitization |
| `extractMimeType(contentType)` | Strips parameters from Content-Type header |

`z` is also re-exported: `import { z } from '@codex/validation'`

## SVG Sanitization

```ts
import { sanitizeSvgContent } from '@codex/validation';

const safeSvg = await sanitizeSvgContent(userUploadedSvg);
// Throws if sanitization results in empty content (malicious file)
// Blocks: <script>, <iframe>, <object>, <embed>, <foreignObject>, <image>
// Blocks: onerror, onload, onclick handlers; javascript:/data: URIs
```

**MUST use for all SVG uploads** — unsanitized SVGs are XSS vectors.

## Currency Note

`priceCentsSchema` stores values in **pence (GBP)**, not cents. Max 10,000,000p = £100,000.

## Strict Rules

- **MUST** validate all user input (body, query, params) via `procedure({ input })` — no unvalidated input reaches handlers
- **MUST** use existing primitives (`uuidSchema`, `urlSchema`, `emailSchema`) — NEVER write ad-hoc regex
- **MUST** use `sanitizeSvgContent()` for ALL SVG uploads
- **MUST** use `urlSchema` for ALL user-provided URLs — blocks dangerous protocols
- **MUST** narrow user-provided IMAGE URLs with `createPlatformImageUrlSchema(base)` at the write path (Codex-8so68) —
  `urlSchema` alone lets a caller hotlink a third-party host, leaking every viewer's IP/referrer and bypassing
  R2 + `@codex/image-processing`. The base is a worker binding, so this CANNOT live in the schema; enforcement is in
  `ContentService.create/update` (`thumbnailUrl`) and `OrganizationService.create/update` (`logoUrl`)
- **NEVER** tighten `urlSchema` itself, or any non-image URL field — `websiteUrl`, social links, contact URLs and
  rich-text hyperlinks are legitimately external
- **NEVER** define ad-hoc schemas in route handlers — add them to this package
- **MUST** handle NUL (U+0000) in every string from a URL (Codex-osuqt). Postgres refuses NUL in text (22021), so one
  that reaches a query is a 500 any visitor can raise. FREE TEXT drops it (`createSearchQuerySchema`, `stripNul`). An
  EXACT-MATCH IDENTIFIER (a slug, a topic) refuses it with `.refine(hasNoNul, …)`: rewritten, `a\0b` names a different
  row and `\0` becomes `''`, which drops the filter. A plain `z.string().max(n)` does neither
- **NEVER** hand-copy an API schema for a web remote query or a page's pre-call guard — build it from the shared field
  rules here (`publicContentArgsSchema`). A remote query is a public endpoint: an argument it accepts and the API
  refuses comes back as a 500 logged at error level, where one it refuses is a clean 400

## Reference Files

- `packages/validation/src/primitives.ts` — building-block schemas
- `packages/validation/src/content/content-schemas.ts` — content/media schemas
- `packages/validation/src/schemas/` — domain schemas
- `packages/validation/src/shared/pagination-schema.ts` — pagination

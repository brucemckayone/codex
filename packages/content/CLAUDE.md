# @codex/content

Content and media lifecycle management. Core service package for content CRUD, media registration, thumbnail uploads, and status transitions.

## Key Exports

```typescript
import { ContentService, MediaItemService } from '@codex/content';
import { SlugConflictError, MediaNotReadyError, ContentNotFoundError } from '@codex/content';
// The catalogue projection, shared with @codex/access getWithdrawnContent so
// the public list and the withdrawn read cannot drift apart:
import {
  CATALOGUE_CONTENT_COLUMNS, // content columns left out: purchaseCount
  PUBLIC_CREATOR_COLUMNS, // id, name (never the email)
  PUBLIC_MEDIA_ITEM_COLUMNS, // durationSeconds, thumbnailKey, hlsPreviewKey
  PUBLIC_ORGANIZATION_COLUMNS, // id, name, slug, logoUrl
} from '@codex/content';
import type { CatalogueContentRow, PublicContentRow } from '@codex/content';
// Plan access (Codex-2hxff.91): the content side of content_tier_access.
import {
  withTierWire, // adds includedInTierIds + the phase-1 includedInTierId shim to rows
  notClosedToNewViewers, // SQL: hide a closed, unpriced item from catalogues
  syncLegacyIncludedInTierId, // the legacy column's dual-write
  invalidatePlanSubscriberLibraries, // catalogue + tier subscribers' libraries
} from '@codex/content';
```

**Plan access.** `content.is_tier_gated` is the gate; `content_tier_access` holds which tiers open the item (a set). Gated with no tick = CLOSED, never free. `services/content-tier-access.ts` is the editor's writer of the ticks and the ONLY place (with `content-service.ts`, the schema, `TierService` and test-utils) allowed to name `legacyIncludedInTierId` — `src/__tests__/legacy-tier-rename-guard.test.ts` fails otherwise. Every content read (get, list, listPublic, publish, create, update) carries `includedInTierIds` plus the deprecated `includedInTierId` shim.

All validation schemas are re-exported from `@codex/validation` for convenience.

## `ContentService`

| Method | Signature | Notes |
|---|---|---|
| `create` | `(input: CreateContentInput, creatorId: string)` | Transaction. Media validated but not required to be ready for draft. Checks slug uniqueness. Plan access (Codex-2hxff.91): `isTierGated` + `includedInTierIds` (the exact set) write the switch and the ticks; the legacy `includedInTierId: X` means the switch plus every live tier of the org at or above X's `sortOrder`. Every tier must be a live tier of the org (`FOR SHARE`), else `ValidationError { invalidTierIds }`. |
| `get` | `(id: string, creatorId: string)` | Returns `ContentWithRelations` (includes mediaItem). Scoped by creatorId. The org leaves out the payee's user id (`ReadableOrganization`, Codex-kk6zx): the route checks content ownership, not org management. |
| `update` | `(id: string, input: UpdateContentInput, creatorId: string)` | Transaction. Checks slug conflict if slug changes. On PUBLISHED content, a price set or changed, a tier tick ADDED, the tier switch newly on (or the row turned purchasable) needs a payout-ready creator — else `CreatorPayoutsRequiredError`. Compared by value, so a form resending unchanged flags never trips it; removing a price/tier never does. Ticks: an absent `includedInTierIds` leaves them; `[]` empties them (the item stays gated and CLOSED, never free); switch off deletes them (I1). I2/I4 are checked on the EFFECTIVE row. A legacy `includedInTierId` equal to the stored legacy value is "unchanged" (no re-expansion). An org change while gated is refused ("Remove this item from plans…"). |
| `uploadThumbnail` | `(id: string, creatorId: string, file: File, r2: R2Bucket, r2PublicUrlBase: string)` | Processes image via `@codex/image-processing`, returns `ImageProcessingResult`. |
| `isSlugAvailable` | `(slug: string, creatorId: string, organizationId?: string \| null, excludeContentId?: string \| null)` | Slug uniqueness — org scope when `organizationId` is given, else creator-personal scope. |
| `publish` | `(id: string, creatorId: string)` | Transaction. Video/audio content requires its media at `status === 'ready'`. Subscriber content (`isTierGated`, not purchasable) needs at least one LIVE tier ticked — else `TierRequiredToPublishError` (code `TIER_REQUIRED_TO_PUBLISH`, owner U2; the admin publish has the same rule). Content that earns money (`requiresPayoutsToPublish`: any price, or the tier switch on — purchasable or not) additionally requires a payout-ready Connect account — else `CreatorPayoutsRequiredError`. |
| `unpublish` | `(id: string, creatorId: string)` | Reverts published → draft. |
| `delete` | `(id: string, creatorId: string)` | Soft delete via `deletedAt`. |
| `list` | `(creatorId: string, filters: ContentFilters, pagination?, options?)` | Paginated. Supports status/search/type filters. Two scopes, two return types. `studio` (default): the creator's own rows, whole, with their email; the org without the payee id. `browse` (the 4-argument form, `{ scope: 'browse' }`): any signed-in viewer's catalogue, so `CatalogueContentRow`, projected as `listPublic` is and with no body (Codex-1bdx0). |
| `listPublic` | `(params)` | Public-facing list: published, non-deleted content whose org is live (or personal). A catalogue read carries no body; only a by-slug read of a PUBLIC piece keeps it (`isPublicContent` from `@codex/constants`: free and no gate, so a free-flagged course-only practice has none; Codex-039vo). No creator email. Returns `PublicContentRow`: the media item, org and creator are `PUBLIC_*_COLUMNS` and the row leaves out `CATALOGUE_CONTENT_COLUMNS` (`purchaseCount`), the same projection as `@codex/access` `getWithdrawnContent`. content-api caches these rows and builds the wire item after the read, so any change to this select needs a `PUBLIC_CONTENT_SHAPE_VERSION` bump (v5 added the tier wire). `category` needs `orgId` (ValidationError). A catalogue read hides a CLOSED item without a price: gated with no tick on a live ACTIVE tier (`notClosedToNewViewers`, owner U11, U13; a switched-off tier's members still watch it). The by-slug read still returns it. |
| `setCache` | `(cache: VersionedCache)` | Inject `VersionedCache` for cache invalidation on mutations. |

### Constructor

```typescript
const service = new ContentService({ db, environment, r2PublicUrlBase });
```

`r2PublicUrlBase` (the `R2_PUBLIC_URL_BASE` binding) is the ONLY host accepted
for `thumbnailUrl` on `create`/`update` — an external image URL is rejected with
`ValidationError` (Codex-8so68). Omit it and the gate fails closed: no thumbnail
can be set at all.

## `MediaItemService`

| Method | Signature | Notes |
|---|---|---|
| `create` | `(input: CreateMediaItemInput, creatorId: string)` | Registers upload, status: `uploading`. |
| `upload` | `(mediaId: string, body: ArrayBuffer, contentType: string, creatorId: string)` | Uploads to R2 via the service's injected `r2` client, transitions status: `uploaded`. |
| `get` | `(id: string, creatorId: string)` | Scoped by creatorId. |
| `update` | `(id: string, input: UpdateMediaItemInput, creatorId: string)` | Transaction. |
| `delete` | `(id: string, creatorId: string)` | Soft delete. |
| `list` | `(creatorId: string, filters?: MediaItemFilters, pagination?)` | Paginated list. |
| `updateStatus` | `(id: string, status, creatorId: string)` | Validates allowed transitions. |
| `markAsReady` | `(id: string, meta, creatorId: string)` | Sets HLS/thumbnail keys. Status → `ready`. |

## Content Status Lifecycle

```
Draft → Published → Draft (unpublish) → Deleted (soft)
```

- **Draft → Published**: ALL attached media MUST be `status: 'ready'` (enforced)
- **Published → Draft**: Allowed.

## Media Status Lifecycle

```
uploading → uploaded → transcoding → ready
                                  → failed (retryable)
```

## Custom Errors

| Error | HTTP | When |
|---|---|---|
| `SlugConflictError` | 409 | Slug already exists for this creator/org |
| `MediaNotReadyError` | 422 | Publishing with non-ready media |
| `MediaNotFoundError` | 404 | Media doesn't exist or not owned |
| `ContentNotFoundError` | 404 | Content doesn't exist or not owned |
| `ContentTypeMismatchError` | 422 | Content type doesn't match media type |
| `TierRequiredToPublishError` | 422 | Publishing subscriber content with no tier ticked (code `TIER_REQUIRED_TO_PUBLISH`) |

## Rules

- **MUST** scope all queries with `scopedNotDeleted(content, creatorId)` or `withCreatorScope()` — never unscoped
- **MUST** use `db.transaction()` for `create` and `publish` — multi-step operations
- **MUST** check `media.status === 'ready'` before publishing — invariant
- **NEVER** hard-delete content — soft delete via `deletedAt`
- `contentBody` can be Tiptap JSON (stored in `content_body_json`) or plain text (stored in `content_body`) — the service auto-detects
- **MUST** treat `isTierGated` as a gate whether or not a tier is ticked — a gated row is never `isFree`, and clearing the last tick never makes it free
- **MUST** write raw tick subqueries with a TEXT alias (`content_tier_access cta … cta.content_id`) when they can run inside a relational `findMany/findFirst` — drizzle rewrites every drizzle column in that `where` to the root alias

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/validation`, `@codex/cloudflare-clients`, `@codex/image-processing`, `@codex/cache`
- **Used by**: content-api worker (port 4001)

## Reference Files

- `packages/content/src/services/content-service.ts`
- `packages/content/src/services/media-service.ts`

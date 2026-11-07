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
  notClosedToNewViewers, // SQL: hide a closed, unpriced item (re-export of @codex/database's)
  syncLegacyIncludedInTierId, // the legacy column's dual-write
  invalidatePlanSubscriberLibraries, // catalogue, public counts + tier subscribers' libraries
} from '@codex/content';
```

**Plan access.** `content.is_tier_gated` is the gate; `content_tier_access` holds which tiers open the item (a set). Gated with no tick = CLOSED, never free. `services/content-tier-access.ts` is the editor's writer of the ticks and the ONLY place (with `content-service.ts`, the schema, `TierService` and test-utils) allowed to name `legacyIncludedInTierId` — `src/__tests__/legacy-tier-rename-guard.test.ts` fails otherwise. Every content read (get, list, listPublic, publish, create, update) carries `includedInTierIds` plus the deprecated `includedInTierId` shim.

All validation schemas are re-exported from `@codex/validation` for convenience.

## `ContentService`

| Method | Signature | Notes |
|---|---|---|
| `create` | `(input: CreateContentInput, creatorId: string)` | Transaction. Media validated but not required to be ready for draft. Checks slug uniqueness. Plan access (Codex-2hxff.91): `isTierGated` + `includedInTierIds` (the exact set) write the switch and the ticks; the legacy `includedInTierId: X` means the switch plus every live tier of the org at or above X's `sortOrder`. Every tier must be a live tier of the org (`FOR SHARE`), else `ValidationError { invalidTierIds }`. |
| `get` | `(id: string, creatorId: string)` | Returns `ContentWithRelations` (includes mediaItem). Scoped by creatorId. The org leaves out the payee's user id (`ReadableOrganization`, Codex-kk6zx): the route checks content ownership, not org management. |
| `update` | `(id: string, input: UpdateContentInput, creatorId: string)` | Transaction. Checks slug conflict if slug changes. A CHANGED `mediaItemId` is checked as create checks one (Codex-vmi6m): the caller's own, not deleted (`MediaNotFoundError`), the content's type, ready when the content is published; a locking read (`FOR KEY SHARE`, or `FOR SHARE` for a scheduled draft's swap, which decides on the status). An unchanged id is not re-checked, so a draft holding a deleted item still saves. On PUBLISHED content, a price set or changed, a tier tick ADDED, the tier switch newly on (or the row turned purchasable) needs a payout-ready creator — else `CreatorPayoutsRequiredError`. Compared by value, so a form resending unchanged flags never trips it; removing a price/tier never does. Ticks: an absent `includedInTierIds` leaves them; `[]` empties them (the item stays gated and CLOSED, never free); switch off deletes them (I1). I2/I4 are checked on the EFFECTIVE row. A legacy `includedInTierId` equal to the stored legacy value is "unchanged" (no re-expansion). An org change while gated is refused ("Remove this item from plans…"). |
| `uploadThumbnail` | `(id: string, creatorId: string, file: File, r2: R2Bucket, r2PublicUrlBase: string)` | Processes image via `@codex/image-processing`, returns `ImageProcessingResult`. |
| `isSlugAvailable` | `(slug: string, creatorId: string, organizationId?: string \| null, excludeContentId?: string \| null)` | Slug uniqueness — org scope when `organizationId` is given, else creator-personal scope. |
| `publish` | `(id: string, creatorId: string, { whenReady, fromSchedule }?)` | Transaction. Locks its row `FOR NO KEY UPDATE`, then its media `FOR KEY SHARE`, or `FOR SHARE` with `whenReady` so a status UPDATE in flight is waited for (the order `update` takes; no tier lock). Never call it while a transaction that wrote the media row is still open (E2.8's trigger): with `whenReady` it waits on that lock for good; without, it reads the status from before the write and refuses `MEDIA_NOT_READY`. Video/audio content requires its media at `status === 'ready'`, the content creator's own (`MediaNotFoundError`, Codex-vmi6m) and not deleted (`MediaDeletedError`, 422, `details.code: 'MEDIA_DELETED'`). The admin publish (`@codex/admin`) holds the same gate. Subscriber content (`isTierGated`, not purchasable) needs at least one LIVE tier ticked — else `TierRequiredToPublishError` (code `TIER_REQUIRED_TO_PUBLISH`, owner U2; the admin publish has the same rule). Content that earns money (`requiresPayoutsToPublish`: any price, or the tier switch on — purchasable or not) additionally requires a payout-ready Connect account — else `CreatorPayoutsRequiredError`. **Publish when ready** (Codex-a6ofh.2.7): with `whenReady`, media on its way (`isMediaOnItsWay`, @codex/constants: an upload not yet stalled, `uploaded`, `transcoding`) doesn't refuse, every other rule still does, and the draft comes back scheduled (`publishRequestedAt`, the first ask's time kept); failed media or a stalled upload still refuses `MEDIA_NOT_READY`. Every publish that goes live (this and the admin twin) clears `publishRequestedAt` + `publishBlockedReason`. `fromSchedule: { mediaItemId }` (the media-ready trigger, E2.8) returns the row unchanged unless it is still scheduled on that media; an already-live row comes back `published`, as from any publish. |
| `cancelPublishRequest` | `(id: string, creatorId: string)` | Clears a publish-when-ready schedule and its blocked reason; a draft with neither a schedule nor a blocked reason comes back unchanged; a piece that went live first refuses `ContentAlreadyLiveError` (409, `CONTENT_ALREADY_LIVE`). `update` clears it too when a save removes the media, makes the piece an article, or swaps onto failed media or a stopped upload; a swap onto media on its way or already ready keeps it (owner, E2.7 review), and a scheduled draft reads the new media `FOR SHARE`. |
| `unpublish` | `(id: string, creatorId: string)` | Reverts published → draft. |
| `delete` | `(id: string, creatorId: string)` | Soft delete via `deletedAt`. |
| `list` | `(creatorId: string, filters: ContentFilters, pagination?, options?)` | Paginated. Supports status/search/type filters. Two scopes, two return types. `studio` (default): the creator's own rows, whole, with their email; the org without the payee id. `browse` (the 4-argument form, `{ scope: 'browse' }`): any signed-in viewer's catalogue, so `CatalogueContentRow`, projected as `listPublic` is and with no body (Codex-1bdx0). |
| `listPublic` | `(params)` | Public-facing list: published, non-deleted content whose org is live (or personal). A catalogue read carries no body; only a by-slug read of a PUBLIC piece keeps it (`isPublicContent` from `@codex/constants`: free and no gate, so a free-flagged course-only practice has none; Codex-039vo). No creator email. Returns `PublicContentRow`: the media item, org and creator are `PUBLIC_*_COLUMNS` and the row leaves out `CATALOGUE_CONTENT_COLUMNS` (`purchaseCount`, `publishRequestedAt`, `publishBlockedReason`), the same projection as `@codex/access` `getWithdrawnContent`. content-api caches these rows and builds the wire item after the read, so a change to a shape that has SHIPPED needs a `PUBLIC_CONTENT_SHAPE_VERSION` bump (v5 added the tier wire); a column hidden from its first day needs none. `category` needs `orgId` (ValidationError). A catalogue read hides a CLOSED item without a price: gated with no tick on a live ACTIVE tier (`notClosedToNewViewers`, owner U11, U13; a switched-off tier's members still watch it). The by-slug read still returns it. |
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
| `getUsage` | `(id: string, creatorId: string)` | `MediaUsage` (`@codex/shared-types`): every use, live first, names only what the caller can see (`hidden` counts the rest), plus the `fingerprint` the delete sends back. Never cached. |
| `delete` | `(id: string, creatorId: string, usageFingerprint?: string)` | Soft delete, guarded (Codex-6sbn1): 409 `MediaInUseError` while anything LIVE uses it, else 409 `MediaUsageChangedError` when the fingerprint is stale, or missing while drafts use it. One transaction, the media row `FOR UPDATE` first. Sets `filesPurgeAfter` = deletedAt + 30 days and never touches R2. Drafts keep their link. Returns `{ drafts }`. |
| `restore` | `(id: string)` | Support only (admin-api `POST /api/admin/media/:id/restore`). One conditional update; `ConflictError` (`reason: 'FILES_GONE' \| 'NOT_DELETED'`) once the purge has STARTED on the files (`files_purge_started_at`), for a delete from before files were kept, or for an item not deleted. A half-removed item can never come back. |
| `purgeDueFiles` | `({ deadline })` | media-api's daily step (03:00 UTC on the hourly cron). Due items (`files_purge_after <= now`, files not all gone, 25 a run, oldest first): skips anything live uses (error log) and moves it 7 days down the queue; claims (`files_purge_started_at`, re-checking it is still deleted and due); deletes the four MEDIA_BUCKET prefixes in batches; stamps `files_purged_at`. On a failure it is due again in a day, and gives the claim back ONLY if no R2 delete was sent; a half-removed item keeps it and a later run finishes it. Never throws. |
| `list` | `(creatorId: string, filters?: MediaItemFilters, pagination?)` | Paginated list. Each item carries `usage: { total, live }` from ONE extra statement per page. |
| `summary` | `(creatorId: string)` | `MediaLibrarySummary` (`@codex/shared-types`) over the creator's live items, in one scan: `total`, `totalBytes`, `failed`, and `stopped` (uploads still `uploading` past `MEDIA_UPLOAD_STALLED_AFTER_MS`). The library header and its needs-attention line (Codex-a6ofh.1.6). |
| `updateStatus` | `(id: string, status, creatorId: string)` | Validates allowed transitions. |
| `markAsReady` | `(id: string, meta, creatorId: string)` | Sets HLS/thumbnail keys. Status → `ready`. |

## Content Status Lifecycle

```
Draft → Published → Draft (unpublish) → Deleted (soft)
```

- **Draft → Published**: ALL attached media MUST be `status: 'ready'` (enforced)
- **Published → Draft**: Allowed.

## Where a media item is used (Codex-6sbn1)

`services/media-usage.ts` is the ONE lookup over every column that can hold a media id: `content.media_item_id`, the four course sell columns, `courses.guide->>'portraitMediaId'` (jsonb, no FK) and `branding_settings.intro_video_media_item_id`. The library chip, `getUsage`, the delete guard and the purge all read it.

- **Live** (blocks a delete and the purge): content published or EVER released (`published_at` set: buyers keep it, owner round 2), a published course in a live org, an org's intro video (always). Everything else is a draft use.
- **`MEDIA_REFERENCE_COLUMNS`** classifies every FK to `media_items.id` as `blocking` or `{ ignored: reason }` (signature film, testimonial avatar). `media-usage.test.ts` walks the schema and fails on an unclassified one: a new media column MUST be added there, and to the lookup if it blocks.
- **Attach and go-live paths re-check under a lock**: `validateMediaItem` (content), `assertMediaItemsInOrg` (course sell media, `@codex/access`), `linkIntroVideo` (`@codex/platform-settings`), content publish (here and the admin twin) and the course page publish (`cascadeCourseFromPage`, `CourseMediaDeletedError`) read the media row `FOR KEY SHARE` inside their transaction, so one that waited on a delete's `FOR UPDATE` finds the row deleted. A new attach or go-live path needs the same. A read that DECIDES on the media's status (publish when ready, and a scheduled draft's swap in `update`) takes `FOR SHARE` instead, which a status UPDATE also waits on: under KEY SHARE a transcode finishing or failing mid-read crosses it unseen.

## Media Status Lifecycle

```
uploading → uploaded → transcoding → ready
                                  → failed (retryable)
```

## Custom Errors

| Error | HTTP | When |
|---|---|---|
| `SlugConflictError` | 409 | Slug already exists for this creator/org |
| `MediaNotReadyError` | 422 | Publishing with non-ready media, or a live piece's media swapped onto it; `details.stalled: true` when it is an upload that stopped (re-upload, don't wait) |
| `MediaNotFoundError` | 404 | Media doesn't exist or not owned |
| `MediaInUseError` | 409 | Deleting media something live uses (code `MEDIA_IN_USE`, details `{ live, drafts }` only) |
| `MediaUsageChangedError` | 409 | Deleting media whose uses changed since the dialog read them (code `MEDIA_USAGE_CHANGED`, details `{ live, drafts }` only) |
| `MediaDeletedError` | 422 | Publishing content whose media was deleted (`details.code: 'MEDIA_DELETED'`) |
| `ContentNotFoundError` | 404 | Content doesn't exist or not owned |
| `ContentTypeMismatchError` | 422 | Content type doesn't match media type |
| `TierRequiredToPublishError` | 422 | Publishing subscriber content with no tier ticked (code `TIER_REQUIRED_TO_PUBLISH`) |
| `ContentAlreadyLiveError` | 409 | Cancelling a publish-when-ready schedule on a piece that went live first (code `CONTENT_ALREADY_LIVE`) |

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

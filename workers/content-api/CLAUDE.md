# Content-API Worker (port 4001)

Content CRUD, media lifecycle, access control, and streaming. The largest worker — handles the core content platform functionality.

## Endpoints

### Content (`/api/content`)

| Method | Path | Policy | Roles | Notes |
|---|---|---|---|---|
| POST | `/api/content` | `auth: 'required'` | creator, admin | Create draft content; 201 |
| GET | `/api/content/check-slug/:slug` | `auth: 'required'` | any | `{ available: bool }` |
| GET | `/api/content/:id` | `auth: 'required'` | any | Get own content by ID |
| PATCH | `/api/content/:id` | `auth: 'required'` | creator, admin | Update content |
| GET | `/api/content` | `auth: 'required'` | any | List own content (paginated) |
| POST | `/api/content/:id/publish` | `auth: 'required'` | creator, admin | Publish; bumps org cache |
| POST | `/api/content/:id/unpublish` | `auth: 'required'` | creator, admin | Unpublish; bumps org cache |
| DELETE | `/api/content/:id` | `auth: 'required'` | creator, admin | Soft delete; `strict` rate limit; 204 |
| POST | `/api/content/:id/thumbnail` | `auth: 'required'` | creator, admin | Upload thumbnail (multipart) |
| DELETE | `/api/content/:id/thumbnail` | `auth: 'required'` | creator, admin | Remove thumbnail; 204 |

### Public Content (`/api/content/public`)

No authentication required. Each route DECLARES its preset on the policy
(`cache: 'public'`) and `procedure()` emits it — `public, max-age=60, s-maxage=60`.
The 60s bound is the KV invalidation window; see `CACHE_PRESETS` in
`@codex/constants`. Never set `Cache-Control` by hand here — the static-analysis
gate rejects it.

Every RELATION on a list item is BUILT field by field by `toPublicItems`
(`r2-public-urls.ts`), never spread from the service's row: the media item is
`durationSeconds`, `thumbnailUrl` and `hlsPreviewUrl`, the org `id`, `name`,
`slug` and `logoUrl`, the creator `id` and `name` (Codex-ve5eh, Codex-567de).
No raw R2 key, RunPod job id, transcoding error or payee id reaches a client.
The content row's OWN columns pass through as `listPublic` selects them, so a
content column is kept off the wire in the service: `CATALOGUE_CONTENT_COLUMNS`
leaves out `purchaseCount` (owner, 2026-10-26), and a new internal content
column needs an exclusion there too. `listPublic` selects only those columns
(`PUBLIC_*_COLUMNS` and `CATALOGUE_CONTENT_COLUMNS` in `@codex/content`).
The org list's KV slot holds those ROWS and the item is built after the read,
so ANY change to `listPublic`'s select needs a `PUBLIC_CONTENT_SHAPE_VERSION`
bump (`public-cache.ts`), and a change to the builder alone does not. apps/web
/explore caches the browse route's response (`content:auth:vN`), so a change
to the browse select (the same shared column lists) OR a field removed from
the builder needs a bump there.
A key with no CDN base is sent as a null URL and logged once per request as
`r2_public_base.missing`, by `toPublicItems` and the single `toPublicItem`
alike; both take `ctx.obs` as a required argument.
Three other KV-cached reads store URLs BUILT from `R2_PUBLIC_URL_BASE`: the
topic categories (`/public/categories`) and the journey card lists
(`/api/journeys/courses`, `/api/journeys/published`). Their slot types end in
`cdnBaseSlot(base)` (`cdn-base-slot.ts`, Codex-yjyju), so a fixed or changed
base reads a fresh slot at once instead of serving the old URLs for the 2h
TTL; a new cached read that bakes in the base needs the same suffix. They log
`r2_public_base.missing` on every request with no base.
`GET /api/content/browse` (signed-in) sends the same item (Codex-1bdx0).

| Method | Path | Policy | Notes |
|---|---|---|---|
| GET | `/api/content/public` | `auth: 'none'` | List published content for an org or a creator (orgId, creatorId or slug required; `category` needs orgId). Only a by-slug read of a PUBLIC piece (`isPublicContent`: free and no gate) carries its body; an entitled reader gets a gated body from `/stream?include=body` (Codex-039vo) |
| GET | `/api/content/public/discover` | `auth: 'none'` | Platform-wide content browse |

### Media (`/api/media`)

| Method | Path | Policy | Roles | Notes |
|---|---|---|---|---|
| POST | `/api/media` | `auth: 'required'` | creator, admin | Create media item; 201 |
| GET | `/api/media/:id` | `auth: 'required'` | any | Get media by ID |
| PATCH | `/api/media/:id` | `auth: 'required'` | creator, admin | Update media |
| GET | `/api/media` | `auth: 'required'` | any | List own media (paginated) |
| POST | `/api/media/:id/upload` | `auth: 'required'` | creator, admin | Binary upload fallback (local dev) |
| POST | `/api/media/:id/upload-complete` | `auth: 'required'` | creator, admin | Mark upload done; triggers transcoding |
| DELETE | `/api/media/:id` | `auth: 'required'` | creator, admin | Soft delete; `strict` rate limit; 204 |

### Access & Streaming (`/api/access`)

| Method | Path | Policy | Rate Limit | Notes |
|---|---|---|---|---|
| GET | `/api/access/content/:id/stream` | `auth: 'required'` | `streaming` (60/min) | Returns signed streaming URL + waveformUrl + contentType; `private, no-store`. `?include=body` also returns `body: { contentBody, contentBodyJson }` once access is granted (a row never released is granted to no one, Codex-nacky): the detail pages' body for a gated piece (Codex-039vo). No `body` means not returned; a piece with no body is both fields null. Never pass it from a remote query or the player refresh |
| GET | `/api/access/content/withdrawn` | `auth: 'required'` | `api` | `?slug` + exactly one of `orgId` or `creatorId` (`withdrawnContentQuerySchema`, strict). An item withdrawn from sale that this reader still has: `{ content, held }`, `content` the public list's item (`toPublicItem` in `r2-public-urls.ts`, from the same `PUBLIC_*_COLUMNS` select), never the row, and no body. Every other case is the same 404; `private, no-store`. The detail pages ask for it when the public lookup misses for a signed-in reader (Codex-ov2ii) |
| POST | `/api/access/content/:id/progress` | `auth: 'required'` | `api` | Save playback progress; 204 |
| GET | `/api/access/content/:id/progress` | `auth: 'required'` | `api` | Get playback progress |
| GET | `/api/access/user/library` | `auth: 'required'` | `api` | User's purchased content (paginated) |

## Key Flows

### Media Upload → Transcode → Publish
```
1. POST /api/media           → status: uploading, get presigned R2 URL
2. Client PUT to R2 presigned URL directly (or POST /api/media/:id/upload in dev)
3. POST /api/media/:id/upload-complete
   → status: uploading → uploaded
   → workerFetch (HMAC) to media-api /internal/media/:id/transcode (via waitUntil)
4. RunPod transcodes → media-api webhook → status: ready
5. POST /api/content/:id/publish  (requires all media ready)
```

### Streaming URL Generation
```
GET /api/access/content/:id/stream[?include=body]
  → KV revocation check, then decideContentAccess in a read-only transaction
    (price / tier / followers / team / course-only arms + the publication rule)
  → mint an HLS token + master-playlist proxy URL; presign the waveform
  → return { streamingUrl, waveformUrl, expiresAt, contentType, readyVariants? }
    (+ body: { contentBody, contentBodyJson } with include=body, from the row
    the access decision read, after it granted; a row never released is
    granted to no one);
    Cache-Control private, no-store
```

### Cache Invalidation on Publish/Unpublish/Delete
`bumpOrgContentVersion()` fires via `waitUntil` — invalidates:
- `COLLECTION_ORG_CONTENT(organizationId)` — org content collection version
- The org's public caches (resolves the slug from the DB, then `invalidateOrgPublicCaches`: the slug-keyed config and stats, and the creators list's own id)

## Services Used

| Service | Package | Purpose |
|---|---|---|
| `ContentService` | `@codex/content` | Content CRUD, publish/unpublish, slug check |
| `MediaItemService` (`media`) | `@codex/content` | Media registration, status transitions, upload |
| `ContentAccessService` (`access`) | `@codex/access` | Access verification, streaming URLs, playback progress, library |
| `ImageProcessingService` | `@codex/image-processing` | Thumbnail upload/delete (R2 + DB) |

## Bindings / Env

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Neon PostgreSQL |
| `R2_ACCOUNT_ID` | Yes | Cloudflare R2 account |
| `R2_ACCESS_KEY_ID` | Yes | R2 signing credentials |
| `R2_SECRET_ACCESS_KEY` | Yes | R2 signing credentials |
| `R2_BUCKET_MEDIA` | Yes | R2 bucket name for media |
| `RATE_LIMIT_STRICT` / `RATE_LIMIT_API` / `RATE_LIMIT_STREAMING` | Yes | Native per-preset rate-limit bindings — `RATE_LIMIT_KV` was removed (Codex-kgrdp.17); the limiter fails OPEN when the binding is missing |
| `AUTH_SESSION_KV` | Yes | Session validation |
| `MEDIA_BUCKET` | Yes (R2 binding) | R2 namespace for health check |
| `MEDIA_API_URL` | Yes | URL to trigger transcoding |
| `WORKER_SHARED_SECRET` | Yes | HMAC for worker-to-worker (media-api) |
| `CACHE_KV` | No | Cache invalidation |
| `R2_PUBLIC_URL_BASE` | No | CDN base URL for resolving R2 keys to URLs |
| `ENVIRONMENT` | No | `development` / `production` |

## Strict Rules

- **MUST** scope all content/media queries by `creatorId` — NEVER return other creators' content
- **MUST** check media ready status before allowing publish (enforced in `ContentService`)
- **MUST** verify access before generating streaming URLs (enforced in `ContentAccessService`)
- **MUST** use `successStatus: 201` for POST creates, `204` for deletes
- **NEVER** return raw R2 keys — always resolve to signed/CDN URLs
- **NEVER** put business logic in route handlers — delegate to service methods

## Reference Files

- `workers/content-api/src/index.ts` — worker setup, route mounting
- `workers/content-api/src/routes/content.ts` — content CRUD + thumbnail
- `workers/content-api/src/routes/media.ts` — media CRUD + upload + upload-complete
- `workers/content-api/src/routes/content-access.ts` — streaming, progress, library, can-view/can-enter gates, HLS playlist proxy
- `workers/content-api/src/routes/public.ts` — public browse + discover + public categories
- `workers/content-api/src/routes/categories.ts` — category CRUD, reorder, cover upload
- `workers/content-api/src/routes/journeys.ts` — journeys/courses member + studio surface (~25 routes)
- `workers/content-api/src/routes/journey-insights.ts` — studio journey insights

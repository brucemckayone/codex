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

No authentication required. Responses include `Cache-Control: public, max-age=300`.

| Method | Path | Policy | Notes |
|---|---|---|---|
| GET | `/api/content/public` | `auth: 'none'` | List published content for org (orgId or slug required) |
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
| GET | `/api/access/content/:id/stream` | `auth: 'required'` | `streaming` (60/min) | Returns signed streaming URL + waveformUrl + contentType |
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
GET /api/access/content/:id/stream
  → verify access: free → granted, paid → check purchase/membership
  → generate signed R2 URL (SigV4, time-limited)
  → return { streamingUrl, waveformUrl, expiresAt, contentType }
```

### Cache Invalidation on Publish/Unpublish/Delete
`bumpOrgContentVersion()` fires via `waitUntil` — invalidates:
- `COLLECTION_ORG_CONTENT(organizationId)` — org content collection version
- Org slug-keyed cache (resolves slug from DB, then invalidates)

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
| `RATE_LIMIT_KV` | Yes | Rate limiting |
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
- `workers/content-api/src/routes/content-access.ts` — streaming, progress, library
- `workers/content-api/src/routes/public.ts` — public browse + discover endpoints

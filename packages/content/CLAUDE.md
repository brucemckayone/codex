# @codex/content

Content and media lifecycle management. The core service package for content CRUD, media registration, and status transitions.

## API

### `ContentService`
| Method | Purpose | Notes |
|---|---|---|
| `create(input, creatorId)` | Create draft content | Validates slug uniqueness, media exists. Uses transaction |
| `get(id, creatorId)` | Get content with relations | Scoped by creatorId |
| `update(id, input, creatorId)` | Update metadata | Checks slug conflict if slug changes |
| `publish(id, creatorId)` | Draft → Published | Requires all media `status === 'ready'`. Transaction |
| `unpublish(id, creatorId)` | Published → Draft | Reverses publish |
| `delete(id, creatorId)` | Soft delete | Sets `deletedAt` |
| `list(creatorId, filters)` | Paginated list | Scoped, supports status/search filters |

### `MediaItemService`
| Method | Purpose | Notes |
|---|---|---|
| `create(input, creatorId)` | Register upload | Status: `uploading` |
| `updateStatus(id, status, creatorId)` | Transition status | Validates allowed transitions |
| `markAsReady(id, meta, creatorId)` | Finalize transcoding | Sets HLS/thumbnail keys. Status: `ready` |
| `delete(id, creatorId)` | Soft delete | Cleans up R2 if needed |

## Lifecycles

### Content Status
```
Draft → Published → Draft (unpublish) → Deleted (soft)
```
- **Draft → Published**: ALL attached media MUST be `status: 'ready'` (enforced with `invariant()`)
- **Published → Draft**: Allowed (unpublish). Streaming URLs stop working.
- **Any → Deleted**: Soft delete via `deletedAt`

### Media Status
```
uploading → uploaded → transcoding → ready
                                  → failed
```
- **uploading**: Media registered, file upload in progress
- **uploaded**: File received in R2, awaiting transcoding
- **transcoding**: RunPod job in progress (triggered by content-api → media-api)
- **ready**: HLS playlist + variants available, thumbnail generated
- **failed**: Transcoding failed (retryable via media-api)

### Transcoding Trigger
When media reaches `uploaded` status, the content-api calls media-api (worker-to-worker, HMAC auth) to start transcoding. Media-api calls RunPod, which calls back via webhook when complete.

## Custom Error Classes
| Error | Code | When |
|---|---|---|
| `SlugConflictError` | 409 | Slug already exists for this creator |
| `MediaNotReadyError` | 422 | Trying to publish with non-ready media |
| `ContentNotFoundError` | 404 | Content doesn't exist or not owned |

## Strict Rules

- **MUST** scope ALL queries with `scopedNotDeleted(content, creatorId)` — content is always creator-scoped
- **MUST** use `db.transaction()` for create and publish operations — these are multi-step
- **MUST** check `invariant(media.status === 'ready')` before publishing content
- **MUST** validate slug uniqueness within creator scope before create/update
- **NEVER** allow publishing content with non-ready media — this is a business rule invariant
- **NEVER** hard-delete content — always soft delete via `deletedAt`

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/validation`, `@codex/cloudflare-clients`
- **Used by**: content-api worker, media-api worker

## Reference Files

- `packages/content/src/services/content-service.ts` — ContentService
- `packages/content/src/services/media-service.ts` — MediaItemService

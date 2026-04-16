# @codex/content

Content and media lifecycle management. Core service package for content CRUD, media registration, thumbnail uploads, and status transitions.

## Key Exports

```typescript
import { ContentService, MediaItemService } from '@codex/content';
import { SlugConflictError, MediaNotReadyError, ContentNotFoundError } from '@codex/content';
```

All validation schemas are re-exported from `@codex/validation` for convenience.

## `ContentService`

| Method | Signature | Notes |
|---|---|---|
| `create` | `(input: CreateContentInput, creatorId: string)` | Transaction. Media validated but not required to be ready for draft. Checks slug uniqueness. |
| `get` | `(id: string, creatorId: string)` | Returns `ContentWithRelations` (includes mediaItem). Scoped by creatorId. |
| `update` | `(id: string, input: UpdateContentInput, creatorId: string)` | Transaction. Checks slug conflict if slug changes. |
| `uploadThumbnail` | `(id: string, creatorId: string, file: File)` | Processes image via `@codex/image-processing`, updates thumbnailUrl. |
| `isSlugAvailable` | `(slug: string, creatorId: string, excludeId?: string)` | Checks slug uniqueness within creator scope. |
| `publish` | `(id: string, creatorId: string)` | Transaction. ALL attached media MUST be `status === 'ready'`. |
| `unpublish` | `(id: string, creatorId: string)` | Reverts published → draft. Purges CDN cache. |
| `delete` | `(id: string, creatorId: string)` | Soft delete via `deletedAt`. |
| `list` | `(creatorId: string, filters: ContentFilters, pagination?)` | Paginated. Supports status/search/type filters. |
| `listPublic` | `(params)` | Public-facing list — only published, non-deleted content. |
| `setCache` | `(cache: VersionedCache)` | Inject `VersionedCache` for cache invalidation on mutations. |
| `setCachePurge` | `(client: CachePurgeClient, webAppUrl: string)` | Inject CDN purge client for publish/unpublish. |

### Constructor

```typescript
const service = new ContentService({ db, environment });
```

## `MediaItemService`

| Method | Signature | Notes |
|---|---|---|
| `create` | `(input: CreateMediaItemInput, creatorId: string)` | Registers upload, status: `uploading`. |
| `upload` | `(id: string, creatorId: string, file: File, r2Service: R2Service)` | Uploads to R2, transitions status: `uploaded`. |
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
- **Published → Draft**: Allowed. CDN cache purged automatically.

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

## Rules

- **MUST** scope all queries with `scopedNotDeleted(content, creatorId)` or `withCreatorScope()` — never unscoped
- **MUST** use `db.transaction()` for `create` and `publish` — multi-step operations
- **MUST** check `media.status === 'ready'` before publishing — invariant
- **NEVER** hard-delete content — soft delete via `deletedAt`
- `contentBody` can be Tiptap JSON (stored in `content_body_json`) or plain text (stored in `content_body`) — the service auto-detects

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/validation`, `@codex/cloudflare-clients`, `@codex/image-processing`, `@codex/cache`
- **Used by**: content-api worker (port 4001)

## Reference Files

- `packages/content/src/services/content-service.ts`
- `packages/content/src/services/media-service.ts`

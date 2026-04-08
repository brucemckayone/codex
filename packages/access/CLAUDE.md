# @codex/access

Content access control, streaming URL generation, and playback progress tracking. Used by content-api worker.

## API

### `ContentAccessService`
| Method | Purpose | Notes |
|---|---|---|
| `getStreamingUrl(userId, contentId)` | Verify access + return signed R2 URL | Checks free/purchased/membership |
| `savePlaybackProgress(userId, contentId, pos, dur)` | Upsert playback position | Auto-completes at 95% duration |
| `getPlaybackProgress(userId, contentId)` | Get position/status | Returns null if no progress |
| `listUserLibrary(userId, options)` | List purchased content + progress | Paginated, includes progress data |

### Factory
- `createContentAccessService(env)` — injects DB, R2, PurchaseService

## Access Decision Tree

```
Content requested
  ├── visibility === 'free' (price === null or 0) → GRANTED
  ├── visibility === 'paid'
  │     ├── User has purchase record → GRANTED
  │     ├── User is org member → GRANTED
  │     └── Otherwise → AccessDeniedError (403)
  └── visibility === 'private' → DENIED (unless owner, via other flows)
```

## Signed URLs

- **Protocol**: AWS SigV4 via `R2Service.generateSignedUrl()`
- **Expiry**: Configurable per request (default: 1 hour)
- **Content**: Points to HLS playlist in R2 (`{contentId}/playlist.m3u8`)
- **Security**: URL is scoped to the specific R2 key — cannot be used to access other objects

## Errors
| Error | Code | When |
|---|---|---|
| `AccessDeniedError` | 403 | User doesn't have access to paid content |
| `ContentNotFoundError` | 404 | Content doesn't exist or is not published |

## Strict Rules

- **MUST** check access permissions before generating signed URLs — NEVER generate URLs without access verification
- **MUST** scope all library queries to the authenticated user — NEVER return another user's library
- **MUST** verify content is published before granting access
- **NEVER** expose raw R2 keys or bucket names to clients — only return signed URLs

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/cloudflare-clients` (R2), `@codex/purchase`
- **Used by**: content-api worker (streaming and library endpoints)

## Reference Files

- `packages/access/src/services/ContentAccessService.ts` — ContentAccessService

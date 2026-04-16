# @codex/access

Content access control, signed URL generation, and playback progress tracking. Co-deployed with content-api worker because it requires direct R2 access.

## Key Exports

```typescript
import { ContentAccessService, createContentAccessService } from '@codex/access';
import { AccessDeniedError, ContentNotFoundError, R2SigningError } from '@codex/access';
```

## `ContentAccessService`

### Constructor

```typescript
const service = new ContentAccessService({
  db,
  environment,
  r2,              // R2Signer: R2Service (prod) or DevR2Signer (dev)
  purchaseService, // PurchaseService instance
});
```

In dev, `DevR2Signer` returns unsigned dev-cdn URLs. In production, uses `R2Service` with AWS SigV4.

### Factory

```typescript
const service = createContentAccessService(env);
// Injects DB, R2, and PurchaseService from env bindings
```

### Methods

| Method | Signature | Notes |
|---|---|---|
| `getStreamingUrl` | `(userId: string, input: GetStreamingUrlInput)` | Verifies access, generates signed R2 URL + optional waveform URL. Returns `{ streamingUrl, waveformUrl, expiresAt, contentType }`. |
| `savePlaybackProgress` | `(userId: string, input: SavePlaybackProgressInput)` | Upserts position/duration. Auto-marks `completed = true` at 95% (`VIDEO_PROGRESS` constant). |
| `getPlaybackProgress` | `(userId: string, input: GetPlaybackProgressInput)` | Returns `{ positionSeconds, durationSeconds, completed, percentComplete, updatedAt }` or null. |
| `listUserLibrary` | `(userId: string, input: ListUserLibraryInput)` | Paginated library: purchased content + membership content + subscription content. Includes progress data. |

## Access Decision Logic

`getStreamingUrl()` checks in order (transaction for consistency):

1. Content must be published and non-deleted
2. `priceCents === 0` or `null` → free access granted
3. User has a completed purchase → access granted
4. User is an org member (any role) → access granted
5. User has a following relationship → access granted (org followers)
6. User has an active subscription to the org meeting the content's `minimumTierId` → access granted
7. Otherwise → `AccessDeniedError` (403)

## Library Query

`listUserLibrary()` runs three independent queries in parallel:
- `queryPurchased` — content with completed purchases
- `queryMembership` — content accessible via org membership
- `querySubscription` — content accessible via subscription tier

Results are merged, deduplicated, and enriched with progress data.

## Custom Errors

| Error | HTTP | When |
|---|---|---|
| `AccessDeniedError` | 403 | User has no valid access path to paid content |
| `ContentNotFoundError` | 404 | Content doesn't exist, is draft, or deleted |
| `MediaNotReadyForStreamingError` | 422 | Content has no associated media item |
| `R2SigningError` | 500 | Failed to generate signed URL |
| `InvalidContentTypeError` | 422 | Unexpected media type |
| `OrganizationMismatchError` | 422 | Org context mismatch |

## Rules

- **MUST** check access before generating signed URLs — never generate URLs without access verification
- **MUST** scope all library and progress queries to the authenticated `userId`
- **MUST** verify content is published before granting access
- **NEVER** expose raw R2 keys or bucket names to clients — only return signed URLs
- Access check uses a transaction for snapshot consistency

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/cloudflare-clients` (R2), `@codex/purchase`, `@codex/constants`
- **Used by**: content-api worker (port 4001) — co-deployed because signed URL generation needs direct R2 binding

## Reference Files

- `packages/access/src/services/ContentAccessService.ts`
- `packages/access/src/constants.ts` — `LOG_EVENTS`, `LOG_SEVERITY`

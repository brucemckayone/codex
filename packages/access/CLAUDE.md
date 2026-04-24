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

`getStreamingUrl()` branches by `accessType` (transaction for consistency):

| accessType | Granted when |
|---|---|
| `team` | User has a management role in the org (owner / admin / creator). |
| `followers` | User follows the org **or** has a management role. An active subscription alone does **not** grant access — subscribers must explicitly follow. |
| `subscribers` | User has an active subscription meeting the content's `minimumTierId` **or** has a completed purchase **or** has a management role. |
| paid (`priceCents > 0`) | User has a completed purchase **or** an active subscription meeting `minimumTierId` (if set) **or** a management role. |
| `free` / `null` (no price) | Granted — subject only to content being published and non-deleted. |

Content must always be published and non-deleted. Otherwise → `AccessDeniedError` (403).

**Why follower ≠ subscriber:** the two relationships are intentionally independent. Following is a free, low-friction signal of interest; subscribing is a paid commitment. Creators can gate content to followers for community-building reasons without implicitly bundling it into every paid tier. A subscriber who wants follower-only posts simply clicks Follow (free).

**Archived (soft-deleted) tiers still resolve during access checks.** When `content.minimum_tier_id` points at a tier that has been soft-deleted after the content was gated — or when an active subscription's `tier_id` references an archived tier — the access decision must still compare sortOrder. The inline tier lookup inside `getStreamingUrl` therefore deliberately omits the `deletedAt` filter (mirror of `TierService.getTierForAccessCheck`). See `packages/subscription/CLAUDE.md` → **Archived-tier semantic** for the full write-vs-read-path contract.

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

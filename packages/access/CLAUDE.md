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
const { service, cleanup } = createContentAccessService(env);
// Builds DB, R2, PurchaseService (+ optional revocation, contentApiBaseUrl, hlsTokenSecret) from env bindings; await cleanup() to close the DB client
```

### Methods

| Method | Signature | Notes |
|---|---|---|
| `getStreamingUrl` | `(userId: string, input: GetStreamingUrlInput)` | Verifies access (KV revocation short-circuit first when wired). For video/audio returns an HLS master-playlist PROXY URL on the content-api origin carrying a signed HLS token; `streamingUrl` is `null` for written content. The waveform is a presigned R2 URL. Returns `{ streamingUrl, waveformUrl, expiresAt, contentType, readyVariants? }`. |
| `savePlaybackProgress` | `(userId: string, input: SavePlaybackProgressInput)` | Upserts position/duration. Auto-marks `completed = true` at 95% (`VIDEO_PROGRESS` constant). |
| `getPlaybackProgress` | `(userId: string, input: GetPlaybackProgressInput)` | Returns `{ positionSeconds, durationSeconds, completed, updatedAt }` or null. |
| `listUserLibrary` | `(userId: string, input: ListUserLibraryInput)` | Paginated library: purchased + membership + subscription + free-relationship + followers-relationship content (five parallel arms). Includes progress data and journey provenance. |

## Access Decision Logic

`getStreamingUrl()` (via `assertStreamingAccess` → `decideContentAccess` in `services/content-access/access-decision.ts`) branches by the content's access-policy flags — `courseOnly`, `isTeamOnly`, `isFollowerGated`, `includedInTierId`, `priceCents > 0` — inside a read-only transaction:

| accessType | Granted when |
|---|---|
| `team` | User has a management role in the org (owner / admin / creator). |
| `followers` | User has an **active subscription** to the org **or** follows the org **or** has a management role. |
| `subscribers` (`includedInTierId` set) | Active subscription whose tier `sortOrder` meets the content's `includedInTierId` **or** a completed purchase **or** a stored entitlement **or** an owned course **or** a management role. |
| paid (`priceCents > 0`, no tier) | User has a completed purchase **or** a stored entitlement **or** an owned course **or** a management role. A subscription alone does NOT unlock paid content. |
| `free` / `null` (no price) | Granted — subject only to content being published and non-deleted. |

Content must always be published and non-deleted. Otherwise → `ContentNotFoundError` (404); granted-but-unauthorized paths map to `AccessDeniedError` (403).

### Access hierarchy (Codex-xybr3)

The platform's access hierarchy is **`subscribers ⊇ followers ⊇ public`**. An active subscription to the content's org grants followers-only access without requiring a follower row. Tier-gated (subscribers-only) content is **orthogonal** to this hierarchy — a subscription does NOT automatically unlock tier-gated content unless the subscriber's tier meets the content's `includedInTierId` (by tier `sortOrder`).

Inside the followers branch, checks run in this order:

1. **Subscription** — `status IN (active, cancelling)` AND `currentPeriodEnd > now()`. Any tier qualifies (followers-only content has no tier gate at all). Paused / past_due / expired subscriptions are filtered out. On grant, `obs.info` emits `reason='followers_content_granted_via_subscription'` so analytics can distinguish the subscription-driven path from an explicit follow.
2. **Follower row** — fallback so ex-subscribers (status=cancelled) who are still following continue to see the content.
3. **Management membership** — owner/admin/creator implicitly bypass the gate.

**Archived (soft-deleted) tiers still resolve during access checks.** When `content.included_in_tier_id` points at a tier that has been soft-deleted after the content was gated — or when an active subscription's `tier_id` references an archived tier — the access decision must still compare sortOrder. The inline tier lookup inside `getStreamingUrl` therefore deliberately omits the `deletedAt` filter (mirror of `TierService.getTierForAccessCheck`). See `packages/subscription/CLAUDE.md` → **Archived-tier semantic** for the full write-vs-read-path contract.

## Library Query

`listUserLibrary()` runs five independent query arms in parallel:
- `queryPurchased` — content with completed purchases
- `queryMembership` — content accessible via org membership
- `querySubscription` — content accessible via subscription tier
- `queryFreeRelationship` — `isFree` content of followed/subscribed orgs
- `queryFollowersRelationship` — `isFollowerGated` content of followed/subscribed orgs

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

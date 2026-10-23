# @codex/identity

User identity and profile management. Handles profile get/update, creator upgrades, avatar uploads, and notification preferences. KV-cached via `VersionedCache`.

## Key Exports

```typescript
import { IdentityService } from '@codex/identity';
import type { AvatarUploadResponse } from '@codex/identity';
import { UserNotFoundError, UsernameTakenError } from '@codex/identity';
```

## `IdentityService`

### Constructor

```typescript
const service = new IdentityService({
  db,
  environment,
  r2Service,        // R2Service instance
  r2PublicUrlBase,  // Base URL for R2 public assets
  cache?,           // Optional VersionedCache — enables cache-aside pattern
  orphanedFileService?, // Records R2 files a failed cleanup left, for the media-api sweep
  cdnPurger?,       // Optional CdnCachePurger — purges a deleted account's avatars from the CDN edge
  waitUntil?,       // Optional — keeps the purge alive after the response; absent, it is awaited
});
```

Requires `R2Service` and `r2PublicUrlBase` for avatar uploads. `cache` is optional but strongly recommended in production.

### Methods

| Method | Signature | Notes |
|---|---|---|
| `getProfile` | `(userId: string): Promise<UserProfile>` | Cache-aside: `CacheType.USER_PROFILE`, 10min TTL. `image` is the upload if there is one, else the sign-in provider's picture; `hasCustomAvatar` says which, since only an upload can be removed (Codex-kk9nv.10). Throws `UserNotFoundError` if not found. |
| `getPublicProfileByUsername` | `(username: string): Promise<PublicCreatorProfile \| null>` | **ANONYMOUS-READABLE.** Two-hop cache-aside: `USERNAME_TO_ID` (1h, under `CacheType.USERNAME_LOOKUP(username)`) -> `USER_PUBLIC_PROFILE` (10min). Returns only `{ id, name, image, bio, socialLinks }` from an explicit column allowlist — never `email`. Returns `null` for an unknown username rather than throwing. |
| `updateProfile` | `(userId: string, input)` | Updates name/email/username/bio/socialLinks. Email change sets `emailVerified: false`. Validates username uniqueness. Invalidates the user's surfaces (see Cache Behaviour). |
| `upgradeToCreator` | `(userId: string, input: { username, bio?, socialLinks? })` | Atomically sets `role: 'creator'` + username. Only works if current role is `'customer'`. Validates username availability. Invalidates the user's surfaces. |
| `uploadAvatar` | `(userId: string, file: File)` | Processes via `ImageProcessingService` (WebP, 3 sizes). Uploads to R2. Invalidates the user's surfaces. Returns `ImageProcessingResult`. |
| `deleteAvatar` | `(userId: string)` | Deletes the avatar's R2 files and clears `avatarUrl` via `ImageProcessingService`, then invalidates the user's surfaces. It invalidates them also when there was no upload to remove: Remove is offered only for an upload, so that usually means a surface left stale by an earlier removal, and this retry heals it. `DELETE /api/user/avatar` calls this, never the image service directly. |
| `deleteAccount` | `(userId: string): Promise<readonly string[]>` | Self-service soft delete. Refused while the user owns an org (`AccountOwnsOrganizationError`) or has content (`AccountHasContentError`). One transaction: locks every membership row the user holds and asks the owner question again (a transfer to them that committed since the first check is refused, one that comes second finds no eligible recipient), reads the orgs whose creators list shows the user, scrubs PII, ends their agreements and proposals, ends their live NON-owner memberships (`inactive`), and withdraws open ownership offers to them (`recipient_ineligible`). A failed read there aborts the deletion. After the commit: invalidates those orgs' public caches, deletes the avatar files, starts the purge of `{cdn host}/avatars/{userId}` from the edge (skipped and logged without `cdnPurger`, at error in production) and hands it to `waitUntil`, then returns every session token so the route can drop the cached sessions. The token return never waits on the purge. Nothing after the commit can fail the deletion. |
| `getMyMembership` | `(orgId: string, userId: string)` | Returns `{ role, status, joinedAt }` or nulls if not a member. Never throws. |
| `getNotificationPreferences` | `(userId: string)` | Cache-aside: `CacheType.USER_PREFERENCES`, 10min TTL. Upserts defaults on first access. |
| `updateNotificationPreferences` | `(userId: string, input)` | Upserts `emailMarketing`, `emailTransactional`, `emailDigest`. Invalidates cache. |

### `updateProfile` Input Shape

```typescript
{
  displayName?: string;   // Maps to `name` column
  email?: string;         // Changes → sets emailVerified: false
  username?: string | null;
  bio?: string | null;
  socialLinks?: { website?, twitter?, youtube?, instagram? } | null;
}
```

## Cache Behaviour

- `getProfile()` uses `CacheType.USER_PROFILE` (10min TTL)
- `getNotificationPreferences()` uses `CacheType.USER_PREFERENCES` (10min TTL)
- Every mutation calls `this.cache.invalidate(userId)` after success
- A write to the user's public card (`uploadAvatar`, `deleteAvatar`,
  `updateProfile`, `upgradeToCreator`) goes through the private
  `invalidateUserSurfaces`. It invalidates the user id, plus the creators-list
  id, `CacheType.COLLECTION_ORG_CREATORS(slug)`, of every org whose public
  creators list shows the user (`ORG_CREATORS`, 4h). That list carries name,
  username, avatar, bio and social links. It has its own id so these writes
  leave the org's config and stats, keyed by the bare slug, alone
  (Codex-kk9nv.9). Which orgs is `listedCreatorConditions` from
  `@codex/database`, the same conditions the list is read with
  (Codex-kk9nv.7). It is best-effort: a failed org lookup is logged as a
  warning, and the lists expire with their TTL. A committed write is never
  reported as failed.
- `deleteAccount` is the exception. It reads the listing orgs inside its
  transaction, because after the scrub no query can find them, and it also
  ends the memberships, so it invalidates both the slug and the creators id
  (`invalidateOrgPublicCaches` from `@codex/cache`).
- If `cache` is not injected, methods fall back to direct DB queries

### Why the public profile is keyed by USER ID, not username

`getPublicProfileByUsername()` resolves `username -> userId` in one cache slot
and then reads the profile from a second slot keyed by **user id**. That is
deliberate: the three `invalidate(userId)` calls above then clear the public
profile for free, so an edited bio or a freshly uploaded avatar can never leave
a stale public copy. Keying the profile by username instead would have made
every one of those existing invalidations silently miss.

Only a username *rename* needs its own handling, and `updateProfile` bumps the
OLD and the NEW value (a freed username must stop resolving to its previous
owner). `upgradeToCreator` bumps the username it assigns.

The profile slot is a SEPARATE `CacheType` from `USER_PROFILE` rather than a
projection of it, because the `USER_PROFILE` entry carries the user's `email`.
Reusing it would put a PII-bearing object one careless `return` away from an
unauthenticated endpoint; nothing sensitive is ever written into
`USER_PUBLIC_PROFILE`, so the endpoint is safe by construction.

## Custom Errors

| Error | When |
|---|---|
| `UserNotFoundError` | User doesn't exist or soft-deleted |
| `UsernameTakenError` | Username already taken by another active user |
| `BusinessLogicError` | `upgradeToCreator()` called on non-customer user |

## Rules

- **MUST** scope all queries to the authenticated `userId` — NEVER expose other users' data
- **MUST** invalidate cache after profile/preference mutations
- Username validation excludes the current user (`ne(users.id, excludeUserId)`) to allow no-change saves
- `getMyMembership()` does NOT check `status = 'active'` — returns any membership row regardless of status

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/cache`, `@codex/image-processing`, `@codex/cloudflare-clients`
- **Used by**: identity-api worker (port 42074)

## Reference Files

- `packages/identity/src/services/identity-service.ts`

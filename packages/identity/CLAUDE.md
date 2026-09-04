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
});
```

Requires `R2Service` and `r2PublicUrlBase` for avatar uploads. `cache` is optional but strongly recommended in production.

### Methods

| Method | Signature | Notes |
|---|---|---|
| `getProfile` | `(userId: string): Promise<UserProfile>` | Cache-aside: `CacheType.USER_PROFILE`, 10min TTL. Throws `UserNotFoundError` if not found. |
| `getPublicProfileByUsername` | `(username: string): Promise<PublicCreatorProfile \| null>` | **ANONYMOUS-READABLE.** Two-hop cache-aside: `USERNAME_TO_ID` (1h) -> `USER_PUBLIC_PROFILE` (10min). Returns only `{ id, name, image, bio, socialLinks }` from an explicit column allowlist — never `email`. Returns `null` for an unknown username rather than throwing. |
| `updateProfile` | `(userId: string, input)` | Updates name/email/username/bio/socialLinks. Email change sets `emailVerified: false`. Validates username uniqueness. Invalidates cache. |
| `upgradeToCreator` | `(userId: string, input: { username, bio?, socialLinks? })` | Atomically sets `role: 'creator'` + username. Only works if current role is `'customer'`. Validates username availability. Invalidates cache. |
| `uploadAvatar` | `(userId: string, file: File)` | Processes via `ImageProcessingService` (WebP, 3 sizes). Uploads to R2. Invalidates cache. Returns `ImageProcessingResult`. |
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
- All mutation methods call `this.cache.invalidate(userId)` after success
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

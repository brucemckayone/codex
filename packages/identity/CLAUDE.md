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

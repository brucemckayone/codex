# Fix 2: Organization Membership KV Cache

> **Parent:** [Auth Performance Investigation](../auth-performance-investigation.md)
> **Priority:** HIGH — saves ~200ms per `requireOrgMembership` request across ~46 routes in 5 workers
> **Impact:** -100-200ms per request for all studio, settings, and management routes
> **Effort:** Medium (3-4 hours)

---

## Problem

`checkOrganizationMembership()` in `packages/worker-utils/src/procedure/org-helpers.ts:105-147` fires an uncached Neon query on every request that uses `requireOrgMembership: true` or `requireOrgManagement: true`. The function already has a TODO comment acknowledging this:

```typescript
// TODO: Add KV caching here for performance
// Cache key: `org:${organizationId}:member:${userId}`
// TTL: 5 minutes
```

### Affected Routes (~46 total across 5 workers)

**organization-api (~23 routes):**
- GET `/members` — list org members
- POST `/members/invite` — invite member
- PATCH `/members/:userId` — update role
- DELETE `/members/:userId` — remove member
- GET/PUT settings (branding, contact, features) — 6 routes
- POST/PATCH/DELETE tiers — 3+ routes
- GET/PUT/PATCH organizations — multiple routes
- Follower endpoints

**admin-api (~13 routes):**
- All admin analytics, content management, and customer management endpoints
- Every route uses `requireOrgMembership` or `requireOrgManagement`

**ecom-api (~6 routes):**
- POST/DELETE subscriptions
- POST/PATCH/GET connect (Stripe Connect onboarding)
- Checkout endpoints

**notifications-api (~4 routes):**
- GET/POST/PUT/DELETE templates

**identity-api (direct caller):**
- `workers/identity-api/src/routes/membership.ts` calls `checkOrganizationMembership()` directly (bypasses `procedure()` org policy)

---

## Design

### Pattern: Cache-Aside with Version-Based Invalidation

Following the established `@codex/cache` VersionedCache pattern (same as org config, user profile):

```typescript
const cache = new VersionedCache({ kv: env.CACHE_KV });
const membership = await cache.get(
  `org:${organizationId}:member:${userId}`,
  CacheType.ORG_MEMBERSHIP,
  () => fetchMembershipFromDB(organizationId, userId),
  { ttl: 300 } // 5 minutes
);
```

### Why Cache-Aside (Not Write-Through)

- Membership reads are **very frequent** (every `requireOrgMembership` request)
- Membership writes are **rare** (only admin invite/role change/remove)
- Cold miss on first read is acceptable (200ms one-time cost)
- Write-through would require every mutation endpoint to re-warm, which is overkill for 3 write paths

### Cache Key Structure

```
cache:version:org:{orgId}:member:{userId}           ← version key
cache:org:membership:org:{orgId}:member:{userId}:v{version}  ← data key
```

Data stored:
```typescript
{
  role: string;     // 'owner' | 'admin' | 'creator' | 'member'
  status: string;   // 'active'
  joinedAt: string; // ISO date
}
```

### TTL: 5 minutes

- Membership changes are security-sensitive (role = permissions)
- 5 minutes is acceptable because:
  - Role changes take effect on next request after TTL
  - Removal takes effect after TTL (user can still access for up to 5 min)
  - This matches the original TODO suggestion
  - Version-based invalidation provides immediate invalidation for the write path

---

## Implementation

### Step 1: Add CacheType

```typescript
// packages/cache/src/cache-keys.ts — ADD to CacheType object
/** Organization membership cache (role, status per user per org) */
ORG_MEMBERSHIP: 'org:membership',
```

### Step 2: Update `checkOrganizationMembership()`

```typescript
// packages/worker-utils/src/procedure/org-helpers.ts

import { CacheType, VersionedCache } from '@codex/cache';

export async function checkOrganizationMembership(
  organizationId: string,
  userId: string,
  env: Bindings,
  obs?: ObservabilityClient
): Promise<OrganizationMembership | null> {
  const kv = env.CACHE_KV as KVNamespace | undefined;

  // Cache-aside: try KV first, fall back to DB
  if (kv) {
    try {
      const cache = new VersionedCache({ kv, obs });
      const cacheId = `org:${organizationId}:member:${userId}`;

      const result = await cache.get<OrganizationMembership | null>(
        cacheId,
        CacheType.ORG_MEMBERSHIP,
        async () => {
          return await fetchMembershipFromDB(organizationId, userId, env, obs);
        },
        { ttl: 300 } // 5 minutes
      );

      return result;
    } catch {
      // Graceful degradation — fall through to direct DB query
    }
  }

  // No KV available — direct DB query (dev without KV binding)
  return await fetchMembershipFromDB(organizationId, userId, env, obs);
}

/** Extract DB query to reusable function */
async function fetchMembershipFromDB(
  organizationId: string,
  userId: string,
  env: Bindings,
  obs?: ObservabilityClient
): Promise<OrganizationMembership | null> {
  try {
    const db = createDbClient(env);
    const membership = await db.query.organizationMemberships.findFirst({
      where: and(
        eq(schema.organizationMemberships.organizationId, organizationId),
        eq(schema.organizationMemberships.userId, userId),
        eq(schema.organizationMemberships.status, 'active')
      ),
      columns: { role: true, status: true, createdAt: true },
    });

    if (!membership) return null;

    return {
      role: membership.role,
      status: membership.status,
      joinedAt: membership.createdAt,
    };
  } catch (error) {
    obs?.error('Error checking organization membership', {
      organizationId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
```

### Step 3: Add Invalidation to Mutation Endpoints

All in `workers/organization-api/src/routes/members.ts`:

```typescript
import { CacheType, VersionedCache } from '@codex/cache';

// Helper — reusable across all 3 mutation endpoints
function invalidateMembershipCache(
  env: Bindings,
  executionCtx: ExecutionContext,
  orgId: string,
  userId: string
) {
  const kv = env.CACHE_KV as KVNamespace | undefined;
  if (!kv) return;

  const cache = new VersionedCache({ kv });
  const cacheId = `org:${orgId}:member:${userId}`;

  executionCtx.waitUntil(
    cache.invalidate(cacheId).catch(() => {})
  );
}
```

Add to each mutation handler:

| Handler | Location | Add After |
|---|---|---|
| `inviteMember` | POST `/invite` handler | After DB insert succeeds |
| `updateMemberRole` | PATCH `/:userId` handler | After DB update succeeds |
| `removeMember` | DELETE `/:userId` handler | After DB soft-delete succeeds |

**Additional mutation paths to consider:**
- `OrganizationService.create()` auto-creates an owner membership at org creation — invalidation likely not needed (first access will warm cache)
- `identity-api` membership endpoint — if it mutates membership, add invalidation there too

Example (invite):
```typescript
// After successful invite creation
invalidateMembershipCache(ctx.env, ctx.executionCtx, orgId, invitedUserId);
```

---

## Validation

1. Login as org admin, visit studio settings page
2. First load: check logs for `[VersionedCache] MISS` → DB query
3. Refresh: check logs for `[VersionedCache] HIT` → no DB query
4. Change a member's role → next request should miss (version bumped)

```bash
# Before: ~200ms for membership check
# After: ~10ms (KV hit) on warmed cache
```

---

## Files to Modify

| File | Change |
|---|---|
| `packages/cache/src/cache-keys.ts` | Add `ORG_MEMBERSHIP: 'org:membership'` |
| `packages/worker-utils/src/procedure/org-helpers.ts` | Implement cache-aside in `checkOrganizationMembership()` |
| `workers/organization-api/src/routes/members.ts` | Add `invalidateMembershipCache()` to invite, update role, remove |
| `workers/identity-api/src/routes/membership.ts` | Benefits from cache automatically (calls `checkOrganizationMembership()` directly) |

---

## Risks

- **Low:** Stale membership for up to 5 min after admin changes — acceptable for most orgs
- **Low:** VersionedCache graceful degradation means no KV = falls back to DB (same as today)
- **Note:** If `CACHE_KV` binding is missing in some workers, the function gracefully falls back to DB query

# Fix 5: Batch Org Context Endpoint

> **Parent:** [Auth Performance Investigation](../auth-performance-investigation.md)
> **Priority:** MEDIUM — reduces HTTP call count, saves network overhead
> **Impact:** 4 calls → 1, saving ~30-80ms per org page load
> **Effort:** Medium (2-3 hours)

---

## Problem

The org layout server load makes 4+ separate HTTP calls to backend workers:

| Call | Worker | Auth | Purpose |
|---|---|---|---|
| `getPublicInfo(slug)` | org-api | No | Org branding, name, description |
| `getCurrent(orgId)` | ecom-api | Yes | User's subscription status |
| `tiers.list(orgId)` | org-api | No | Subscription tier definitions |
| `isFollowing(orgId)` | org-api | Yes | Follow button state |

Each call has ~3-8ms fixed overhead (header construction, AbortController, JSON parse) plus network RTT. Four calls = 12-32ms overhead + 4× network RTT.

---

## Design: Aggregated Org Context Endpoint

Create a single endpoint in `organization-api` that returns everything the org layout needs:

```
GET /api/organizations/:slug/context
  → Optional auth (returns extra data if authenticated)
  → Returns: org info + tiers + stats + follower status + subscription context
```

### Response Shape

```typescript
interface OrgContextResponse {
  org: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    logoUrl: string | null;
    brandColors: BrandColors;
    brandFonts?: BrandFonts;
    brandRadius?: number;
    brandDensity?: number;
    brandFineTune?: BrandFineTune;
    introVideoUrl?: string | null;
    heroLayout?: string;
    enableSubscriptions?: boolean;
  };
  tiers: SubscriptionTier[];
  stats: {
    creatorCount: number;
    contentCount: number;
    totalDuration: number;
  } | null;
  // Auth-only fields (null when unauthenticated)
  isFollowing: boolean;
  subscription: {
    userTierSortOrder: number | null;
  } | null;
}
```

### Why This Works

- **One session validation** instead of 2-3 (if auth is `'optional'`)
- **One network round-trip** instead of 4
- **Parallel DB/KV queries** within the single handler
- **All data is already available** in org-api (org info, tiers, stats, following) except subscription which requires a cross-worker call

### Challenge: Subscription is in ecom-api

The current subscription lives in `ecom-api`, not `org-api`. Options:

1. **Worker-to-worker call** from org-api → ecom-api (adds HMAC overhead, but saves 1 client call)
2. **Move subscription check to org-api** (breaks service boundary)
3. **Skip subscription in batch, fetch separately** (keeps subscription as separate call)

**Recommendation:** Option 1 — org-api calls ecom-api via `workerFetch` for the subscription status. This adds ~10ms (HMAC + internal fetch) but eliminates the client→ecom-api round trip (~50-200ms).

---

## Implementation

### Step 1: Add Endpoint to org-api

```typescript
// workers/organization-api/src/routes/context.ts
//
// NOTE: getPublicInfo and listPublic are NOT existing service methods.
// The public org info is currently fetched via a route-local function
// (fetchPublicOrgInfo) in organizations.ts. Before implementing this endpoint:
//   1. Extract fetchPublicOrgInfo to a service method on OrganizationService, OR
//   2. Import the route-local function from organizations.ts
// Similarly, TierService has listTiers(orgId) not listPublic(slug).

import { procedure } from '@codex/worker-utils';
import { z } from 'zod';
import { workerFetch } from '@codex/security';
import { getServiceUrl } from '@codex/constants';

app.get('/api/organizations/:slug/context',
  procedure({
    policy: { auth: 'optional' },  // Works for both auth'd and unauth'd
    input: {
      params: z.object({ slug: z.string().min(1) }),
    },
    handler: async (ctx) => {
      const { slug } = ctx.input.params;
      const userId = ctx.user?.id;

      // Step 1: Resolve org (needed for orgId-dependent queries)
      // Uses existing service method — may need to extract public info variant
      const org = await ctx.services.organization.getBySlug(slug);
      if (!org) throw new NotFoundError('Organization not found');

      // Step 2: Parallel fetches using orgId — all KV-cached, fast
      const [tiers, stats, isFollowing, subscription] = await Promise.all([
        ctx.services.tier.listTiers(org.id).catch(() => []),
        ctx.services.organization.getStats(org.id).catch(() => null),
        userId
          ? ctx.services.organization.isFollowing(org.id, userId).catch(() => false)
          : Promise.resolve(false),
        userId
          ? fetchSubscriptionFromEcom(ctx.env, org.id, userId)
          : Promise.resolve(null),
      ]);

      return {
        org: {
          id: org.id,
          slug: org.slug,
          name: org.name,
          description: org.description,
          logoUrl: org.logoUrl,
          brandColors: org.brandColors,
          // ... other branding fields
        },
        tiers: tiers ?? [],
        stats: stats ?? null,
        isFollowing,
        subscription: subscription
          ? { userTierSortOrder: subscription.tier?.sortOrder ?? null }
          : null,
      };
    },
  })
);

/** Worker-to-worker call to ecom-api for subscription status */
async function fetchSubscriptionFromEcom(
  env: Bindings,
  orgId: string | undefined,
  userId: string
): Promise<{ tier?: { sortOrder: number } } | null> {
  if (!orgId) return null;
  try {
    const url = getServiceUrl('ecom', env);
    const response = await workerFetch(
      `${url}/subscriptions/current?organizationId=${orgId}&userId=${userId}`,
      { method: 'GET' },
      env.WORKER_SHARED_SECRET
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data?.data ?? null;
  } catch {
    return null;
  }
}
```

### Step 2: Update SvelteKit Layout

```typescript
// _org/[slug]/+layout.server.ts — simplified

const api = createServerApi(platform, cookies);

// Single call replaces 4 separate calls
const context = await api.org.getContext(slug);

if (!context) error(404, `Organization "${slug}" not found`);

return {
  org: context.org,
  enableSubscriptions: context.org.enableSubscriptions ?? true,
  user: locals.user,
  versions: readOrgVersions(platform, context.org.id, locals.user?.id),
  subscriptionContext: {
    userTierSortOrder: context.subscription?.userTierSortOrder ?? null,
    tiers: context.tiers,
  },
  isFollowing: context.isFollowing,
};
```

### Step 3: Add to API Client

```typescript
// apps/web/src/lib/server/api.ts — in org namespace
getContext: (slug: string) => request<OrgContextResponse>('org', `/api/organizations/${slug}/context`),
```

---

## Dependency: Combines Well With Other Fixes

| If combined with... | Effect |
|---|---|
| Fix 1 (Session KV alignment) | The single auth check in this endpoint hits KV instead of DB |
| Fix 2 (Membership cache) | If endpoint needs membership, it's cached |
| Fix 3 (Client-side streaming) | Some fields may not be needed in batch if moved client-side |
| Fix 4 (Trusted caller) | The single call can use HMAC, eliminating session validation entirely |

**Best combined with Fix 3:** If `isFollowing` and `subscription` move to client-side, this endpoint simplifies to just org info + tiers + stats — all public, no auth needed. That's the simplest and fastest option.

---

## Before/After

### Before: 4+ HTTP Calls

```
SvelteKit → org-api: getPublicInfo        (30ms)
SvelteKit → org-api: tiers.list           (30ms)
SvelteKit → ecom-api: getCurrent          (200ms, auth)
SvelteKit → org-api: isFollowing          (200ms, auth)
                                          Total: ~460ms + 4× overhead
```

### After: 1 HTTP Call

```
SvelteKit → org-api: getContext           (50ms, optional auth)
  → internal: org info (KV hit, 10ms)
  → internal: tiers (KV hit, 10ms)
  → internal: stats (KV hit, 10ms)
  → internal: isFollowing (DB, 20ms)
  → internal: w2w ecom subscription (30ms)
                                          Total: ~50ms + 1× overhead
```

**Estimated saving:** ~400ms per org page load.

---

## Files to Modify

| File | Change |
|---|---|
| `workers/organization-api/src/routes/context.ts` | NEW — aggregated context endpoint |
| `workers/organization-api/src/index.ts` | Register new route file |
| `apps/web/src/lib/server/api.ts` | Add `api.org.getContext()` method |
| `apps/web/src/routes/_org/[slug]/+layout.server.ts` | Replace 4 calls with single `getContext()` |

---

## Risks

- **Low:** Worker-to-worker call to ecom-api adds ~10ms, but saves ~200ms overall
- **Medium:** Single point of failure — if org-api is down, entire context fails (but this is true today since getPublicInfo is critical)
- **Low:** More data per response means slightly larger JSON payload (~2-3KB vs 4× ~1KB)

---

## Note: Consider Deferring

If Fix 3 (move streaming to client-side) is implemented first, the batch endpoint becomes less critical because:
- `isFollowing` moves to client
- `subscriptionContext` moves to client
- Only `orgInfo` + `tiers` remain — both are already fast (KV cached)

**Recommendation:** Implement Fix 3 first, then evaluate if this endpoint is still needed. It may only save 10-20ms if the expensive auth'd calls are already client-side.

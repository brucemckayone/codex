# Section 2: KV Write-Through for Tiers

> Parent: [caching-strategy.md](../caching-strategy.md)

## Problem

`GET /api/organizations/:id/tiers` always hits Neon. Zero caching. Every request — whether from the org layout, pricing page, or content detail — triggers a fresh database query.

**Characteristics of tier data:**
- Public (no auth required, `policy: { auth: 'optional' }`)
- Org-scoped (identical for all visitors to the same org)
- Rarely mutated (admin-only: create, update, delete, reorder — maybe once a month)
- Frequently read (every authenticated org page load via layout, plus pricing page, plus content detail)

**Current endpoint:** `workers/organization-api/src/routes/tiers.ts`, line 58 — GET `/` handler calls `ctx.services.tier.listTiers(orgId)` with no caching.

## Why Write-Through, Not Cache-Aside

The existing caching in the codebase uses **cache-aside** (read checks cache → miss → fetch from DB → store). This works well for data with many writers or unpredictable access patterns.

For tiers, cache-aside has a weakness: **the first reader after a mutation pays the Neon cost**. Since mutations are rare (admin-only) but reads are constant (every visitor), the mutation handler should pay the small cost of re-warming the cache so that no reader ever hits Neon.

**Write-through** means: after a successful DB mutation, the handler immediately populates the cache with fresh data. Every subsequent reader — including the very next visitor — gets a KV hit.

| Pattern | First reader after mutation | Typical reader | Mutation cost |
|---------|---------------------------|----------------|---------------|
| Cache-aside | Cache miss → Neon (~150ms) | KV hit (~10ms) | Version bump only |
| Write-through | KV hit (~10ms) | KV hit (~10ms) | Version bump + re-fetch + KV write |

The extra mutation cost (~200ms of background work in `waitUntil`) is negligible for an admin action that happens rarely.

## Existing Pattern

`updateBrandCache()` in `workers/organization-api/src/routes/settings.ts` (lines 60-170) is already write-through for org branding:

```
PUT /settings/branding succeeds
  → waitUntil: fetch fresh branding from DB → kv.put(key, data, { ttl })
```

## Design

### Write-through using existing VersionedCache API

VersionedCache has no `set()` method. Write-through is achieved with a two-step pattern:

```typescript
// Step 1: Bump version (makes old data stale)
await cache.invalidate(orgId);

// Step 2: Populate new version (new version → miss → fetcher → stores)
await cache.get(orgId, CacheType.ORG_TIERS,
  () => ctx.services.tier.listTiers(orgId),
  { ttl: 86400 }
);
```

**Why not add a `set()` method?** This pattern runs in 4 mutation handlers in one file. A `set()` method on VersionedCache would be an abstraction with a single consumer today. If more write-through use cases emerge, we add it then.

### TTL: 24h safety net

The TTL is **not** the invalidation mechanism — write-through + version bumping handles that. The 24h TTL is a safety net: if a mutation somehow fails to invalidate (KV write error, missed code path), the stale data eventually expires. This follows Design Principle #1 from the strategy doc.

### Helper function

Extract `warmTierCache()` to avoid repeating the two-step pattern in 4 handlers:

```typescript
/**
 * Write-through: invalidate + re-warm the tier cache.
 * Fire-and-forget via waitUntil — never blocks the mutation response.
 */
function warmTierCache(
  ctx: { env: { CACHE_KV?: unknown }; executionCtx: { waitUntil(p: Promise<unknown>): void }; services: { tier: { listTiers(orgId: string): Promise<unknown> } } },
  orgId: string
): void {
  if (!ctx.env.CACHE_KV) return;
  const cache = new VersionedCache({
    kv: ctx.env.CACHE_KV as import('@cloudflare/workers-types').KVNamespace,
  });
  ctx.executionCtx.waitUntil(
    (async () => {
      await cache.invalidate(orgId);
      await cache.get(orgId, CacheType.ORG_TIERS,
        () => ctx.services.tier.listTiers(orgId),
        { ttl: 86400 }
      );
    })().catch(() => {}) // Never throw from background task
  );
}
```

This is justified deduplication (same pattern, same file, 4 call sites), not speculative abstraction.

## Implementation

### `packages/cache/src/cache-keys.ts`

Add to CacheType object:

```typescript
/** Organization subscription tiers (sorted list, public) */
ORG_TIERS: 'org:tiers',
```

### `workers/organization-api/src/routes/tiers.ts`

**GET `/` handler** — add cache-aside read:

```typescript
app.get('/', procedure({
  policy: { auth: 'optional' },
  input: { params: orgIdParamSchema },
  handler: async (ctx) => {
    const orgId = ctx.input.params.id;
    if (ctx.env.CACHE_KV) {
      const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
      return cache.get(orgId, CacheType.ORG_TIERS,
        () => ctx.services.tier.listTiers(orgId),
        { ttl: 86400 }
      );
    }
    return ctx.services.tier.listTiers(orgId);
  },
}));
```

**POST `/` (create)** — add write-through:
```typescript
handler: async (ctx) => {
  const orgId = ctx.organizationId as string;
  const tier = await ctx.services.tier.createTier(orgId, ctx.input.body);
  warmTierCache(ctx, orgId);
  return tier;
},
```

**PATCH `/:tierId` (update)** — add write-through:
```typescript
handler: async (ctx) => {
  const orgId = ctx.organizationId as string;
  const { tierId } = ctx.input.params;
  const tier = await ctx.services.tier.updateTier(tierId, orgId, ctx.input.body);
  warmTierCache(ctx, orgId);
  return tier;
},
```

**DELETE `/:tierId` (delete)** — add write-through:
```typescript
handler: async (ctx) => {
  const orgId = ctx.organizationId as string;
  const { tierId } = ctx.input.params;
  await ctx.services.tier.deleteTier(tierId, orgId);
  warmTierCache(ctx, orgId);
  return null;
},
```

**POST `/reorder`** — add write-through:
```typescript
handler: async (ctx) => {
  const orgId = ctx.organizationId as string;
  await ctx.services.tier.reorderTiers(orgId, ctx.input.body.tierIds);
  warmTierCache(ctx, orgId);
  return null;
},
```

### Client-side staleness detection

The org layout's `readOrgVersions()` in `_org/[slug]/+layout.server.ts` already reads org-scoped version keys. The tier version key uses `orgId` as its entity ID — the same `invalidate(orgId)` call bumps the version for tiers.

However, tiers are **shared data** (not user-scoped), so they don't go in a localStorage collection. The client staleness check for tiers triggers `invalidate('cache:org-versions')` → server re-reads from warm KV → fresh tiers in SSR data. No localStorage collection needed.

## Estimated Impact

- KV hit: ~10ms vs Neon query: ~80-150ms
- With write-through: effectively 0ms Neon cost for all readers after first org creation
- Impacts: every authenticated org page load (layout), pricing page, content detail subscription context

## Verification

1. Load pricing page → tiers appear correctly with all fields (name, price, features)
2. In studio, create a new tier → pricing page shows it on next load
3. Update tier name/price → pricing page reflects change
4. Delete a tier → pricing page no longer shows it
5. Reorder tiers → pricing page shows new order
6. Check worker logs → GET handler shows "Cache hit" after admin warms cache
7. Cold start (no prior cache) → first visitor triggers cache-aside, second visitor gets KV hit

## Dependencies

- Adds `ORG_TIERS` to `packages/cache/src/cache-keys.ts` — shared with Section 3
- Otherwise independent of all other sections

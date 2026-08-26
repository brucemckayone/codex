# @codex/cache

Versioned KV cache for Cloudflare Workers. Cache-aside pattern with atomic version-based invalidation — incrementing a version number stales all cached data for an entity in one KV write.

## Key Exports

- **`VersionedCache`** — Main cache class
- **`CacheType`** — Const object of cache type string values (see below)
- **`buildCacheKey(type, id)`** — Build unversioned key (used internally)
- **`buildVersionKey(id)`** — Build version key (used internally)
- **`buildVersionedCacheKey(prefix, type, id, version)`** — Build fully qualified key

## VersionedCache

**Constructor**: `new VersionedCache({ kv: KVNamespace, prefix?: string, obs?: ObservabilityClient, waitUntil?: WaitUntilFn })`

`waitUntil` is REQUIRED on any read path — see [Cache writes need a waitUntil](#cache-writes-need-a-waituntil-codex-e32xz).

| Method | Signature | Purpose |
|---|---|---|
| `get<T>(id, type, fetcher, options?)` | `(string, CacheType, () => Promise<T>, { ttl? }) => Promise<T>` | Cache-aside; fetcher called on miss or KV failure |
| `getWithResult<T>(id, type, fetcher, options?)` | Same + returns `{ data: T, hit: boolean }` | Cache-aside with hit/miss tracking |
| `invalidate(id)` | `(string) => Promise<void>` | Bump version — all cached data for this id becomes stale |
| `delete(id, type)` | `(string, CacheType) => Promise<void>` | Delete one specific cache entry |
| `getStats()` | `() => CacheStats` | Hit rate, misses, total requests |
| `resetStats()` | `() => void` | Reset in-process stats |

```ts
import { VersionedCache, CacheType } from '@codex/cache';

// On a READ path, ALWAYS pass waitUntil — without it the data-slot write is
// cancelled when the response returns and the cache can never hit (Codex-e32xz).
const cache = new VersionedCache({
  kv: env.CACHE_KV,
  prefix: 'cache',
  waitUntil: (p) => ctx.executionCtx.waitUntil(p),
});

// Cache-aside: returns cached data or calls fetcher on miss
const profile = await cache.get(
  userId,
  CacheType.USER_PROFILE,
  () => db.query.users.findFirst({ where: eq(users.id, userId) }),
  { ttl: 600 } // 10 minutes
);

// Invalidate AFTER successful DB mutation
await db.update(users).set(input).where(eq(users.id, userId));
await cache.invalidate(userId); // stales USER_PROFILE, USER_PREFERENCES, etc.

// Fire-and-forget invalidation in route handlers (don't block the response)
ctx.executionCtx.waitUntil(
  cache.invalidate(userId).catch(() => {})
);
```

## CacheType Values

```ts
CacheType.USER_PROFILE         // 'user:profile'
CacheType.USER_PREFERENCES     // 'user:preferences'
CacheType.ORG_CONFIG           // 'org:config'
CacheType.ORG_STATS            // 'org:stats'
CacheType.ORG_CREATORS         // 'org:creators'
CacheType.ORG_MEMBERS          // 'org:members'
CacheType.CONTENT_METADATA     // 'content:metadata'
CacheType.CONTENT_ACCESS       // 'content:access'
CacheType.USER_SESSION         // 'user:session'

// Collection version IDs (used for invalidate(), not get())
CacheType.COLLECTION_CONTENT_PUBLISHED        // 'content:published'
CacheType.COLLECTION_ORG_CONTENT(orgId)       // 'org:{orgId}:content'
CacheType.COLLECTION_USER_LIBRARY(userId)     // 'user:{userId}:library'
```

The `COLLECTION_*` types are version IDs only — they're passed to `cache.invalidate()` to bump a version that the web app client manifest tracks, not to store data.

## Key Structure

```
cache:version:{id}                           ← current version timestamp
cache:{type}:{id}:v{version}                 ← cached data
```

Example: invalidating `userId = 'abc'` increments `cache:version:abc` from `v1` to `v2`. All `cache:user:*:abc:v1` keys become unreachable and expire via TTL.

## TTL Guidelines

| Data | TTL |
|---|---|
| User profile / preferences | 600s (10 min) |
| Org config / branding | 1800s (30 min) |
| Org members | 1800s (30 min) |
| Content metadata | 300s (5 min) |
| Content access / permissions | 60–300s (1–5 min) |

## Cache writes need a waitUntil (Codex-e32xz)

`get()`/`getWithResult()` never await the data-slot put — a cache write must not add latency to a miss response. But in workerd an un-awaited promise is **cancelled**, not merely deferred: the request's IoContext is destroyed as soon as the response is returned.

The evidence: a census of `CACHE_KV_PRODUCTION` found **62 version keys and 0 data keys**. The version key is written with `await` three lines earlier in the same function, same namespace, same request — the only difference was the await. Result: a literal 0% hit rate, paying full DB cost plus the KV reads.

`waitUntil` fixes it without reintroducing the latency: the response returns immediately, and the runtime keeps the context alive until the put settles.

```ts
// procedure() handler — ctx.executionCtx is on the procedure context
const cache = new VersionedCache({
  kv: ctx.env.CACHE_KV,
  waitUntil: (p) => ctx.executionCtx.waitUntil(p),
});

// SvelteKit server load — platform.context is absent under `vite dev`
const cache = new VersionedCache({
  kv: platform.env.CACHE_KV as KVNamespace,
  waitUntil: platform.context
    ? (p: Promise<unknown>) => platform.context.waitUntil(p)
    : undefined,
});
```

- Wrap it in a closure. A bare `executionCtx.waitUntil` reference throws "Illegal invocation" in workerd.
- NOT `ctx.background`: that hook exists so DB work finishes before `procedure()` ends the Postgres pool. A KV put has no pool, and chaining it there would hold a DB connection open for a KV write.
- Every `VersionedCache` built by the service registry already gets it.
- Omitting it is still legal (invalidate-only helpers, unit tests) and keeps the old best-effort behaviour — but it means the cache will not hold data in production.

## Never cache a class instance

Cached values round-trip through `JSON.stringify`/`JSON.parse`, so class identity does not survive a hit. Caching a `PaginatedResult` made `procedure()`'s `result instanceof PaginatedResult` check fail on every hit and silently degraded the list envelope from `{ items, pagination }` to `{ data: { items, pagination } }`. Cache the plain `{ items, pagination }` and re-wrap in `new PaginatedResult(...)` AFTER the cache call — see `workers/organization-api/src/routes/organizations.ts` `/public/:slug/creators`.

## Graceful Degradation

If KV fails (read or write), `get()` calls the fetcher and returns the result — no error is thrown. Cache writes never block the response and never throw.

## Strict Rules

- **MUST** invalidate AFTER successful DB write, NEVER before
- **MUST** use `CacheType` constants — NEVER hand-craft cache key strings
- **MUST** use fire-and-forget for invalidation in route handlers: `ctx.executionCtx.waitUntil(cache.invalidate(...).catch(() => {}))`
- **MUST** pass `waitUntil` when the cache is used for a READ (`get`/`getWithResult`) — omitting it means the data slot is never written (Codex-e32xz)
- **NEVER** cache a class instance (e.g. `PaginatedResult`) — JSON round-tripping strips its identity
- **NEVER** throw from cache operations — degrade gracefully to fetcher
- **NEVER** cache authorization decisions or prices in persistent cache

## Integration

- **Depends on**: Cloudflare `KVNamespace`, `@codex/observability` (optional)
- **Used by**: `@codex/identity` (user profile caching), service-registry in `@codex/worker-utils`, web app version manifest

## Reference Files

- `packages/cache/src/versioned-cache.ts` — VersionedCache implementation
- `packages/cache/src/cache-keys.ts` — CacheType const + key builders
- `packages/cache/src/types.ts` — TypeScript interfaces
- `packages/cache/src/__tests__/versioned-cache-waituntil.test.ts` — the data-slot write contract

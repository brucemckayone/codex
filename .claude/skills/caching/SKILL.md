---
name: caching
description: >
  Decision framework and workflow for implementing caching across all layers of the
  Codex platform. Use when adding, modifying, or debugging any cache — server-side KV,
  client-side localStorage, HTTP headers, version-based invalidation, or cross-device sync.
allowed-tools: Read, Grep, Glob, Bash
---

# Caching — Decision Framework & Workflow

Use this skill when any work touches caching: adding a new cached entity, changing invalidation
logic, wiring a new collection, setting HTTP headers, or debugging stale data.

---

## 0. Before You Start — Read These

Read the files relevant to the layer you are working on. Do not assume names, TTLs, or
key patterns from memory — read the source of truth.

```
docs/caching-strategy.md                         — Full strategy, design principles, layer overview
docs/caching-optimization/                        — Planned optimizations (check status before implementing)
packages/cache/src/cache-keys.ts                  — CacheType enum, TTL constants, key builders
packages/cache/src/versioned-cache.ts             — VersionedCache API (get, invalidate, getVersion, etc.)
apps/web/src/lib/client/version-manifest.ts       — Client staleness detection (getStaleKeys, updateStoredVersions)
apps/web/src/lib/collections/                     — TanStack DB collections, hydration, live queries
packages/constants/src/limits.ts                  — CACHE_PRESETS (the vocabulary)
apps/web/src/lib/server/cache.ts                  — CACHE_HEADERS, re-exports the presets
```

The TanStack DB skill (`tanstack-db`) covers collection internals in depth. This skill covers
the broader decision framework and how layers interact.

---

## 1. The Five Cache Layers

Each layer solves a different latency/scope tradeoff. Most features touch 2-3 layers.

| Layer | Scope | Latency | Where |
|-------|-------|---------|-------|
| **HTTP headers** | Per-URL, all visitors | 0ms (edge hit) | SvelteKit `setHeaders()`, worker middleware |
| **Edge KV** | Per-entity, server-side | ~10ms | `VersionedCache` or raw KV in workers |
| **SvelteKit dedup** | Per-SSR-request | 0ms | `depends()` / `invalidate()` in layouts |
| **Client collections** | Per-user, client-side | 0ms | TanStack DB (localStorage or QueryClient) |
| **Version manifest** | Cross-device sync glue | 0ms | localStorage `codex-versions` ↔ KV version keys |

---

## 2. Decision Framework

### Step 1: Classify the Data

| Question | Determines |
|----------|-----------|
| Who reads it? (all visitors / authenticated users / single user) | HTTP header scope + whether client caching needed |
| Who writes it? (admin only / any user / webhooks / external) | Cache-aside vs write-through |
| How stale can it be? (real-time / minutes / hours) | TTL choice |
| Is it needed for SEO or first paint? | Await vs stream in server load |
| Is it user-scoped? | Server KV vs client localStorage |
| Does it need live queries? (filtering, sorting, joins) | Collection type choice |
| Does it need cross-device sync? | Whether to add a version key |

### Step 2: Pick Server-Side Pattern

```
Is the data on the CRITICAL RENDERING PATH for every page load?
  |
  +-- YES --> Are there a known, finite set of writers?
  |     |
  |     +-- YES --> WRITE-THROUGH
  |     |     |
  |     |     +-- Single entity (e.g. branding, membership flag)
  |     |     |     --> Raw KV put() in mutation handler via waitUntil()
  |     |     |
  |     |     +-- Collection/query result (e.g. tier list)
  |     |           --> VersionedCache invalidate() + get() re-warm in waitUntil()
  |     |
  |     +-- NO (many writers, webhooks) --> Cache-aside with SHORT TTL
  |
  +-- NO --> Is the read/write ratio high (>10:1)?
        |
        +-- YES --> CACHE-ASIDE
        |     Read:  cache.get(id, type, fetcher, { ttl })
        |     Write: cache.invalidate(id) via waitUntil()
        |
        +-- NO --> Probably doesn't need server-side caching
              Consider client-side only
```

**TTL-only (no explicit invalidation):** Use for aggregate/derived data where no single
mutation event exists. Short TTL (2-5 min) provides eventual consistency.

### Step 3: Pick Client-Side Strategy

```
Is the data user-scoped?
  |
  +-- YES --> Does it need live queries (filtering, sorting, joins)?
  |     |
  |     +-- YES --> Should it survive page refresh?
  |     |     |
  |     |     +-- YES --> localStorage Collection (TanStack DB)
  |     |     |     See tanstack-db skill for implementation details
  |     |     |
  |     |     +-- NO  --> QueryClient Collection (session cache)
  |     |
  |     +-- NO  --> Is it a simple boolean/scalar per entity?
  |           |
  |           +-- YES --> Lightweight Svelte 5 store + localStorage
  |           |     $state + read/write/hydrate pattern
  |           |
  |           +-- NO  --> localStorage Collection (safer default)
  |
  +-- NO --> Server-side caching only (HTTP headers + KV)
```

### Step 4: Decide Await vs Stream

```
AWAIT in server load if:
  - Needed for <svelte:head> (SEO title, OG tags, structured data)
  - Needed for page layout structure (hero, above-fold grid)
  - Needed to decide what components to render

STREAM (return bare promise) if:
  - Below-fold content (grids, related items)
  - Personalized data (access checks, subscription status)
  - Meta/sync data (version keys, tier badges)
  - Data that feeds into localStorage on client
```

**Streaming rules:**
- Every streamed promise MUST have `.catch()` with a typed fallback
- Personalized streamed data MUST use a stale promise guard in `$effect` (prevents
  navigation race where old promise resolves over new page's data)
- Version keys should always be streamed (non-blocking, graceful degradation)

### Step 5: Set HTTP Headers

Presets come from `CACHE_PRESETS` in `@codex/constants` — ONE vocabulary shared by
workers and `apps/web`. Never hand-write a `Cache-Control` value; the static-analysis
gate (`scripts/checks/check-data-access-contract.mjs`) rejects it and has no waiver list.

The question a preset answers is **who may store the body**, not how long. Ask:
*would two different viewers get the same bytes?*

```
Body identical for every viewer          --> public      (60s browser + CDN)
Crawler-read document (sitemap etc.)     --> static      (1h + SWR; the ONLY preset with SWR)
Content-addressed asset (R2 media)       --> asset       (1h browser / 24h edge)
Body MAY differ per viewer               --> per-viewer  (public, max-age=0, no-cache)
Authenticated / personalised             --> private     (private, no-cache)  <-- the default
Per-REQUEST body (presigned URL, token)  --> fresh       (private, no-store)
```

**`DYNAMIC_PUBLIC_REVALIDATE` WAS DELETED, AND THIS SECTION USED TO PRESCRIBE IT.**
It was `public, max-age=0, s-maxage=300, stale-while-revalidate=3600`, and the advice
here was to use it for "anything that branches on `locals.user`" — which is precisely
where it leaks. `max-age=0` fixes only the BROWSER half. `s-maxage=300` still lets the
edge store one viewer's rendered HTML and hand it to the next, because **shared caches
key on URL and NEVER on Cookie.** CI reproduced this deterministically on 2026-05-28
(`nav-redesign/a11y-responsive.spec.ts` — an anonymous visit poisoned the entry and the
authenticated visit got the anonymous HTML, with the load function never running), and
two routes were moved to `PRIVATE` by commit `bcc1841b`. The old text even described
the mechanism as a benefit: *"`s-maxage=300` still lets the CDN serve the shared
anonymous response"*.

**What to use instead, for the real problem it was solving.** The underlying bug is
genuine: a page whose HTML differs for anonymous vs signed-in visitors, cached in the
BROWSER for 5 minutes, shows stale anonymous HTML after sign-in — the "sign in to watch
after purchase" class of bug. The fix is `per-viewer`
(`public, max-age=0, no-cache`), and the load-bearing directive is `no-cache`, not
`max-age=0`: RFC 9111 lets a shared cache STORE a `no-cache` response but forbids
serving it to any other request without revalidating at the origin. So an anonymous
burst is still absorbed as 304s, and a signed-in viewer always gets their own body.
If you do not want a shared cache holding a copy at all, use `private`.

**Never put an `s-maxage` on a response that can vary by viewer.** That single rule
replaces the whole of the deleted advice, and it is what the drift guard in
`packages/constants/src/__tests__/cache-presets.test.ts` enforces.

Decision rule: grep the server load for `locals.user`, `locals.userId` and
`locals.session`. If any of those change the response, the body is viewer-varying —
`per-viewer` or `private`, never `public`/`static`/`asset`.

**Worker routes declare the preset on the policy, not in a header:**
`procedure({ policy: { auth: 'none', cache: 'public' } })`. The auth level constrains
which presets are legal, at the TYPE level: `auth: 'required' | 'worker' |
'platform_owner'` may only be `private` or `fresh`, and `auth: 'optional'` may declare
`public` only alongside an explicit `variesBySession: false` — an assertion that the
handler ignores the session, which you must verify by reading it. Share a policy with
`satisfies ProcedurePolicy`, never `: ProcedurePolicy`; the annotation widens the
literals and switches the rule off.

Never set Cache-Control in both a layout AND its child page — SvelteKit errors.

---

## 3. Server-Side KV Patterns

### Cache-Aside (Default)

Read path uses `cache.get()` with a fetcher. Mutation path calls `cache.invalidate()`.
First reader after mutation pays the DB cost; subsequent readers get KV hits.

```typescript
// READ: cache.get(id, type, fetcher, options)
const data = await cache.get(entityId, CacheType.EXAMPLE, 
  () => service.fetchFromDB(entityId), 
  { ttl: CACHE_TTL.EXAMPLE_SECONDS }
);

// WRITE: invalidate after successful mutation
ctx.executionCtx.waitUntil(
  cache.invalidate(entityId).catch(() => {})
);
```

### Write-Through (Raw KV)

Mutation handler writes fresh data directly to KV. No reader ever hits a cold cache.
Use for single entities on the critical path with known writers.

```typescript
// WRITE: fetch fresh from DB, write to KV
async function updateEntityCache(env, entityId) {
  const kv = env.ENTITY_KV;
  if (!kv) return;
  const fresh = await fetchFromDB(entityId);
  await kv.put(`prefix:${key}`, JSON.stringify(fresh), { expirationTtl });
}

// Called from mutation handler
ctx.executionCtx.waitUntil(updateEntityCache(ctx.env, id));
```

### Write-Through (Invalidate + Re-Warm)

Mutation handler invalidates the version, then immediately re-reads to warm the cache.
Use for collection/query results where you need a DB re-query to build the cache value.

```typescript
function warmCache(ctx, entityId) {
  const cache = new VersionedCache({ kv: ctx.env.CACHE_KV });
  ctx.executionCtx.waitUntil(
    (async () => {
      await cache.invalidate(entityId);
      await cache.get(entityId, CacheType.EXAMPLE,
        () => ctx.services.example.list(entityId),
        { ttl: longTtl }
      );
    })().catch(() => {})
  );
}
```

### Key Rules

- All invalidations are fire-and-forget via `waitUntil()` — never block the response
- Exception: blocking `await cache.invalidate()` only when the next read in the SAME
  request must miss (rare — e.g., avatar upload where redirect reads the new URL)
- VersionedCache degrades gracefully — KV failure falls back to fetcher, no error thrown
- TTL is a safety net, not the invalidation strategy. Real invalidation is explicit.
- `cache.invalidate(id)` bumps a version key — all data entries with old versions become
  unreachable and expire naturally via TTL. No need to enumerate and delete keys.

---

## 4. Client-Side Patterns

### localStorage Collection (TanStack DB)

See the `tanstack-db` skill for full implementation details. Key caching concerns:

- **Hydration:** `hydrateIfNeeded(key, data)` in `onMount()` — no-op on return visits
  (localStorage already populated)
- **Reconciliation:** Each collection needs a `loadFromServer()` function that
  upserts fresh items and deletes removed keys
- **Conflict resolution:** Decide per-collection — server-authoritative (upsert from server)
  vs local-first (unsynced local wins, e.g., progress with `syncedAt` tracking)
- **SSR bridge:** `useLiveQuery({ ssrData })` returns static data during SSR, switches
  to live reactivity on client

### QueryClient Collection (Session Cache)

For shared/public data that shouldn't persist in per-user localStorage:

- In-memory only — lost on refresh, re-hydrated from SSR
- Bounded by `staleTime` and `gcTime` (check `query-client.ts` for defaults)
- Invalidated via `queryClient.invalidateQueries({ queryKey })`
- `queryClient` is `undefined` on server — prevents cross-request data leaks

### Lightweight Store (Svelte 5 + localStorage)

For simple boolean/scalar per-entity state:

- `$state` at module level, read from localStorage on init
- `get(id)`, `set(id, value)`, `hydrate(id, value)` API
- `hydrate()` is a no-op if value already exists — prevents overwriting optimistic updates
  with stale server data
- No version key, no cross-device sync (by design)

### Adding a New localStorage Collection — Checklist

1. Create collection file with `localStorageCollectionOptions` + browser guard
2. Write `loadFromServer()` reconciliation (upsert + delete removed)
3. Wire into `hydration.ts` (hydrateCollection, isCollectionHydrated, invalidateCollection)
4. Add storage key to `CODEX_STORAGE_KEYS` in `version-manifest.ts` for logout cleanup
5. If cross-device sync needed: wire version key (see Section 5)
6. Export from barrel index

---

## 5. Cross-Device Sync (Version Manifest)

The version manifest connects server KV to client localStorage. Only add this when
cross-device consistency matters (purchases, subscriptions). Skip for user-initiated
state (following, preferences).

### The Flow

```
Server mutation
  --> Worker bumps version key in CACHE_KV (cache.invalidate(versionKey))

User returns to tab (visibilitychange)
  --> SvelteKit invalidate('cache:...') re-runs layout server load
  --> Layout reads version keys from KV via cache.getVersion()
  --> Passes versions as streamed promise in return data

Client $effect
  --> getStaleKeys(data.versions) diffs SSR vs stored localStorage
  --> Routes stale keys to the correct invalidation function
  --> invalidateCollection() or custom loadFromServer()
  --> updateStoredVersions() saves new versions
```

### Wiring a New Version Key

1. **Define the key** in `cache-keys.ts` (CacheType constant or builder function)
2. **Server: Bump on mutation** — `cache.invalidate(versionKey)` in the relevant worker
3. **Server: Read in layout** — `cache.getVersion(versionKey)` in the layout server load,
   return in the streamed `versions` object
4. **Client: Handle staleness** — add a branch in the layout `$effect` that checks
   `staleKeys.some(k => k.includes(':yourkey'))` and calls the right invalidation

### Staleness Logic

- Key missing from stored manifest = NOT stale (first visit, trust SSR data)
- SSR version is null = NOT stale (no KV entry, nothing to invalidate)
- Stored !== SSR version = STALE (server advanced, trigger re-sync)

---

## 6. Anti-Patterns

| Anti-Pattern | Why It's Bad | Do Instead |
|---|---|---|
| Hard-delete KV keys on mutation | Must enumerate all related keys | Bump version key (atomic, one write) |
| TTL as primary invalidation | Stale data for entire TTL window | Explicit invalidation + TTL as safety net |
| Cache in route handlers | Couples caching to HTTP layer | Cache in service layer or VersionedCache |
| Skip `.catch()` on streamed promises | Unhandled rejection crashes server | Always `.catch(() => fallback)` with typed shape |
| Set Cache-Control in layout + child | SvelteKit errors on duplicate headers | Set in one place only |
| `queryClient` without browser guard | Cross-request data leak in SSR | Check `if (!queryClient) return` |
| Update stored versions before invalidation | Masks mismatch on next check | Invalidate first, then update manifest |
| Hydrate in `$effect` instead of `onMount` | Runs on every reactive update | `hydrateIfNeeded()` in `onMount()` only |
| Overwrite optimistic state on hydrate | Server data is stale vs local click | `hydrate()` should no-op if value exists |
| Write-through without waitUntil | Blocks mutation response for cache | Always fire-and-forget via `waitUntil()` |
| A shared window (`public`/`static`/`asset`) on an auth-varying page | The EDGE stores one viewer's HTML and serves it to the next — shared caches key on URL, never on Cookie. Reproduced in CI 2026-05-28 | Use `per-viewer` (`public, max-age=0, no-cache`) or `private`. NEVER an `s-maxage` on a viewer-varying body |
| `collection.update(key, () => newItem)` | TanStack DB's `update` callback is expected to MUTATE a draft — returned values are silently discarded, producing zero tracked changes and a no-op write. Fresh server data never lands. | `update(key, (draft) => { Object.assign(draft, newItem); })` — or `delete(key)` + `insert(newItem)` if the shape may drop keys |
| Redirect success URL to a page that reads webhook-written data | Stripe redirects before the webhook lands; the destination page sees empty state | Redirect to a verify-before-handoff page (`/subscription/success`, `/checkout/success`) that polls a verify endpoint until the DB row appears, then hands off |
| Dedup "already acquired" on `status='completed'` only | Pending Stripe rows slip through; the same content surfaces under two arms with conflicting accessType tags for seconds | Check `status IN ('completed', 'pending')` — cover the race window |

---

## 7. Debugging Stale Data

When data appears stale, trace through the layers:

1. **Is the HTTP response cached?** Check `Cache-Control` header in devtools.
   Private pages should be `no-cache`. Public pages may serve CDN-cached responses.

2. **Is the KV cache stale?** Check if the mutation handler calls `cache.invalidate()`
   or the write-through function. Verify it runs in `waitUntil()` (check worker logs).

3. **Is the version key bumped?** The layout server load reads version keys — check
   if the relevant key is included in the streamed `versions` object.

4. **Does the client detect staleness?** Add a `console.log` in the layout `$effect`
   after `getStaleKeys()` — does the stale key appear?

5. **Does invalidateCollection run?** Check the stale key routing — does the key
   pattern match the `staleKeys.some()` check?

6. **Does loadFromServer reconcile?** Check the reconciliation function —
   does it upsert new items AND delete removed ones?

7. **Does the live query re-render?** `useLiveQuery` should react automatically
   when the underlying collection updates.

8. **Is the `update()` callback actually mutating the draft?** TanStack DB's
   `collection.update(key, cb)` expects `cb(draft)` to mutate the draft proxy;
   the callback's *return value* is discarded. A callback that just returns
   a new item (`() => freshItem`) is a **silent no-op** — no changes tracked,
   the write is filtered out, and fresh server data never lands in localStorage.
   Fix: `(draft) => { Object.assign(draft, freshItem); }` or `delete` + `insert`.

9. **Did a CDN-cached response pin the pre-auth variant?** If the user sees
   the anonymous response after signing in (and a hard refresh fixes it), the
   page declares a shared window (`public`/`static`/`asset`) on a viewer-varying body
   instead of `per-viewer` or `private` — see
   Section 2 Step 5 and the anti-patterns table.

10. **After a Stripe redirect, is the destination reading webhook-written
    rows?** Stripe always redirects before the webhook lands. If the target
    page queries a purchase/subscription row directly, the first load will
    be empty and the client's localStorage may "lock in" that empty state.
    Route Stripe success URLs to a verify-before-handoff page that polls a
    verify endpoint (e.g. `/subscription/success` → `api.subscription.verify`)
    until the row appears, then redirect to the final destination.

---

## 8. Workflow for New Cached Features

### Phase 1: Classify
Answer the questions in Section 2, Step 1. This determines which layers to touch.

### Phase 2: Server-Side (if needed)
- Add CacheType in `cache-keys.ts`
- Implement cache-aside or write-through in the worker
- Add invalidation in mutation handlers
- Use `waitUntil()` for fire-and-forget

### Phase 3: HTTP Headers
- Choose a preset from `CACHE_PRESETS` (@codex/constants) — never hand-write a value
- Set in `+page.server.ts` via `setHeaders()`

### Phase 4: Streaming
- Decide await vs stream for each data field
- Add `.catch()` on every streamed promise
- Add stale promise guard for personalized streamed data

### Phase 5: Client-Side (if user-scoped)
- Choose strategy: localStorage collection / QueryClient / lightweight store
- Implement collection or store
- Wire hydration and barrel exports

### Phase 6: Cross-Device Sync (if needed)
- Add version key
- Wire server bump, layout read, client staleness detection
- Test: mutate on device A, switch tab on device B, verify data updates

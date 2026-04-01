---
name: tanstack-db
description: >
  Implement TanStack DB collections, live queries, mutations, and optimistic updates
  correctly in the Codex SvelteKit app. Use when adding a new collection, writing a
  live query, wiring up mutations, hydrating SSR data, or extending the TanStack DB
  layer in apps/web.
allowed-tools: Read, Grep, Glob, Bash
---

# TanStack DB — Codex Implementation Guide

TanStack DB is the reactive client store for the Codex web app. It provides normalized
collections, sub-millisecond live queries (incremental differential dataflow), and
automatic optimistic mutations with rollback.

**Library version:** v0.5.x / v0.6.x (beta)
**Key packages:**
- `@tanstack/svelte-db` — Svelte 5 adapter + re-exports all of `@tanstack/db`
- `@tanstack/query-db-collection` — QueryClient-backed collections (server-authoritative data)
- `@tanstack/query-core` — TanStack Query for caching
- `localStorageCollectionOptions` — included in `@tanstack/svelte-db`, no extra install

---

## 0. Before You Start — Read These Files

```
apps/web/src/lib/collections/index.ts        — barrel; start here for exports
apps/web/src/lib/collections/query-client.ts — QueryClient singleton (browser-only)
apps/web/src/lib/collections/hydration.ts    — SSR→client hydration helpers
apps/web/src/lib/collections/library.ts      — localStorage collection example
apps/web/src/lib/collections/progress.ts     — localStorage collection example
apps/web/src/lib/collections/content.ts      — QueryClient collection example
apps/web/src/lib/collections/use-live-query-ssr.ts — SSR-safe useLiveQuery wrapper
apps/web/src/routes/(platform)/library/+page.svelte — full real-world usage example
```

---

## 1. Collection Type Decision Tree

```
Is the data user-owned (per-user) AND needs offline/local-first?
  YES → localStorage collection (localStorageCollectionOptions)
      Examples: playback progress, user library

Is the data server-authoritative (catalogue, published content)?
  YES → QueryClient collection (queryCollectionOptions)
      Examples: content catalogue, org listings

Is the data purely ephemeral UI state (modals, form drafts)?
  YES → localOnly collection (localOnlyCollectionOptions)
      Examples: open/close state, wizard steps

Do you need a derived/filtered view of another collection?
  YES → liveQueryCollectionOptions (no sync, just a query)
```

---

## 2. The Non-Negotiable Rules for This Codebase

### SSR Safety (CRITICAL)

Collections **must be undefined on the server**. Cloudflare Workers are stateless —
a collection defined at module level would be shared across all requests (data leak).

```typescript
// ALWAYS browser-guard collections
import { browser } from '$app/environment'

export const myCollection = browser
  ? createCollection(localStorageCollectionOptions({ ... }))
  : undefined
```

The `QueryClient` singleton is also browser-only (see `query-client.ts`):
```typescript
const queryClient = browser ? new QueryClient({ ... }) : undefined
```

### Never Use `useLiveQuery` Directly in Pages

Use the project's **SSR-safe wrapper** instead:

```typescript
// WRONG — crashes on server
import { useLiveQuery } from '@tanstack/svelte-db'

// CORRECT — use the project wrapper
import { useLiveQuery } from '$lib/collections'
// or
import { useLiveQuerySSR } from '$lib/collections/use-live-query-ssr'
```

The wrapper returns static `ssrData` on the server and delegates to the real
`useLiveQuery` on the client.

### Always Guard Collection Calls

```typescript
// ALWAYS guard before calling collection methods
if (!myCollection) return

myCollection.insert({ ... })
myCollection.update(key, draft => { ... })
myCollection.delete(key)
```

### Svelte 5: No `$` Prefix on Query Results

`useLiveQuery` returns values via **getters** (Svelte 5 runes). Access them directly:

```svelte
<script>
  const query = useLiveQuery(...)
</script>

<!-- CORRECT -->
{query.data}
{query.isLoading}

<!-- WRONG — no $ prefix needed -->
{$query.data}
```

---

## 3. Creating a New localStorage Collection

Use this pattern for user-owned, offline-capable data (like `library.ts`/`progress.ts`).

```typescript
// apps/web/src/lib/collections/my-feature.ts
import { browser } from '$app/environment'
import { createCollection } from '@tanstack/svelte-db'
import { localStorageCollectionOptions } from '@tanstack/svelte-db'
import type { MyItem } from '$lib/types'

export const myCollection = browser
  ? createCollection<MyItem, string>(
      localStorageCollectionOptions({
        id: 'codex-my-feature',       // unique across all collections
        storageKey: 'codex-my-feature', // localStorage key
        getKey: (item) => item.id,
      })
    )
  : undefined

// Server reconciliation — call this after fetching fresh data from server
export function loadMyFeatureFromServer(serverItems: MyItem[]): void {
  if (!myCollection) return

  const existingKeys = new Set(myCollection.state.keys())

  for (const item of serverItems) {
    const key = getKey(item)
    if (existingKeys.has(key)) {
      myCollection.update(key, () => item)
    } else {
      myCollection.insert(item)
    }
    existingKeys.delete(key)
  }

  // Remove items no longer on server (access revoked, deleted, etc.)
  for (const key of existingKeys) {
    myCollection.delete(key)
  }
}

function getKey(item: MyItem): string {
  return item.id
}
```

**Then export from the barrel** (`apps/web/src/lib/collections/index.ts`):
```typescript
export { myCollection, loadMyFeatureFromServer } from './my-feature'
```

**Then register in hydration.ts** — add your collection key to `COLLECTION_KEYS`
and handle it in `hydrateCollection`, `isCollectionHydrated`, and `invalidateCollection`.

---

## 4. Creating a New QueryClient Collection

Use for server-authoritative data (like `content.ts`).

```typescript
// apps/web/src/lib/collections/my-content.ts
import { createCollection } from '@tanstack/svelte-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { queryClient } from './query-client'
import { listMyContent } from '$lib/remote/content.remote'

export const myContentCollection = queryClient
  ? createCollection(
      queryCollectionOptions({
        queryKey: ['my-content'],
        queryFn: async () => {
          const result = await listMyContent()
          return result?.items ?? []
        },
        queryClient,
        getKey: (item) => item.id,
      })
    )
  : undefined
```

**Important QueryClient collection rules:**
- `queryFn` returning `[]` **deletes all items** in the collection — always return correct data
- After `onInsert`/`onUpdate`/`onDelete` completes, a refetch is triggered automatically
- To skip automatic refetch: `return { refetch: false }` from handler
- Use `myCollection.utils.refetch()` to manually trigger a refetch

---

## 5. Using useLiveQuery in a Svelte Component

```svelte
<script lang="ts">
  import { onMount } from 'svelte'
  import { useLiveQuery, hydrateIfNeeded, myCollection } from '$lib/collections'
  import { eq, and, or, not, gt, gte } from '@tanstack/svelte-db'

  let { data } = $props()

  // Hydrate from SSR data (idempotent — safe to call every mount)
  onMount(() => {
    if (data.myItems?.items) {
      hydrateIfNeeded('my-collection', data.myItems.items)
    }
  })

  // Live query — updates reactively as collection changes
  const query = useLiveQuery(
    (q) =>
      q
        .from({ item: myCollection })
        .where(({ item }) => eq(item.status, 'active'))
        .orderBy(({ item }) => item.createdAt, 'desc'),
    undefined,                              // no dynamic deps
    { ssrData: data.myItems?.items ?? [] }  // shown during SSR
  )

  // Client-side derived filtering (don't re-query for simple derived state)
  const filtered = $derived.by(() => {
    return (query.data ?? []).filter((item) => item.category === activeCategory)
  })
</script>

{#if query.isLoading && !data.myItems?.items?.length}
  <!-- Skeleton UI -->
{:else if !query.data?.length}
  <!-- Empty state -->
{:else}
  {#each filtered as item (item.id)}
    <!-- Render item -->
  {/each}
{/if}
```

### Dependency Arrays — When Required

Pass dependencies when the query uses **external reactive values** (props, `$state`, etc.):

```svelte
<script>
  let { userId, filter } = $props()

  const query = useLiveQuery(
    (q) =>
      q.from({ item: myCollection })
       .where(({ item }) => and(
         eq(item.userId, userId),
         eq(item.filter, filter)
       )),
    [() => userId, () => filter]  // wrap each dep in a function
  )
</script>
```

### Conditional Queries (disable when data not ready)

```typescript
const query = useLiveQuery((q) => {
  if (!userId) return undefined  // disables query cleanly
  return q.from({ item: myCollection })
          .where(({ item }) => eq(item.userId, userId))
}, [() => userId])

// query.isEnabled === false when userId is falsy
```

---

## 6. All Query Builder Operators

### Filtering (`.where`)
```typescript
import { eq, gt, gte, lt, lte, like, ilike, inArray, isNull, isUndefined, and, or, not } from '@tanstack/svelte-db'

.where(({ item }) => eq(item.status, 'active'))
.where(({ item }) => gt(item.age, 18))
.where(({ item }) => gte(item.price, 10))
.where(({ item }) => lt(item.stock, 5))
.where(({ item }) => lte(item.rating, 4))
.where(({ item }) => like(item.name, 'John%'))          // case-sensitive
.where(({ item }) => ilike(item.email, '%@gmail.com'))  // case-insensitive
.where(({ item }) => inArray(item.id, [1, 2, 3]))
.where(({ item }) => isNull(item.deletedAt))            // explicitly null
.where(({ item }) => isUndefined(item.profile))         // absent (left join)

// Composing
.where(({ item }) => and(eq(item.active, true), gt(item.age, 18)))
.where(({ item }) => or(eq(item.role, 'admin'), eq(item.role, 'mod')))
.where(({ item }) => not(eq(item.active, false)))

// Multiple .where() calls = implicit AND
.where(({ item }) => eq(item.active, true))
.where(({ item }) => gt(item.score, 0))
```

### Sorting (`.orderBy`)
```typescript
.orderBy(({ item }) => item.createdAt, 'desc')
.orderBy(({ item }) => item.name, 'asc')   // multiple calls = multi-sort
.orderBy(({ $selected }) => $selected.total, 'desc')  // sort by computed field
```

### Selecting / Projecting (`.select`)
```typescript
import { upper, lower, length, concat, add, coalesce } from '@tanstack/svelte-db'

.select(({ item }) => ({
  id: item.id,
  displayName: upper(item.name),
  fullName: concat(item.firstName, ' ', item.lastName),
  total: add(item.price, item.tax),
  label: coalesce(item.displayName, item.name, 'Unknown'),
  ...item,  // spread to include all fields
}))
```

### Pagination (`.limit` / `.offset`)
```typescript
.orderBy(({ item }) => item.createdAt, 'desc')
.limit(20)
.offset(page * 20)
```

### Single Result (`.findOne`)
```typescript
const singleQuery = createLiveQueryCollection((q) =>
  q.from({ item: myCollection })
   .where(({ item }) => eq(item.id, targetId))
   .findOne()
)
// Returns: MyItem | undefined
```

### Aggregation (`.groupBy` + `.having`)
```typescript
import { count, sum, avg, min, max } from '@tanstack/svelte-db'

.from({ order: ordersCollection })
.groupBy(({ order }) => order.customerId)
.select(({ order }) => ({
  customerId: order.customerId,
  total: sum(order.amount),
  count: count(order.id),
  avg: avg(order.amount),
}))
.having(({ $selected }) => gt($selected.total, 1000))
```

### Joins
```typescript
// Only eq() conditions supported in joins
q.from({ user: usersCollection })
 .join({ post: postsCollection }, ({ user, post }) => eq(user.id, post.userId))
 // or explicit type:
 .leftJoin(...)
 .rightJoin(...)
 .innerJoin(...)
 .fullJoin(...)
```

### Deduplicate (`.distinct`) — requires `.select`
```typescript
.select(({ item }) => ({ country: item.country }))
.distinct()
```

---

## 7. Optimistic Mutations

### Direct Collection Mutations (simple CRUD)

```typescript
if (!myCollection) return

// Insert
myCollection.insert({
  id: crypto.randomUUID(),
  text: 'New item',
  status: 'pending',
})

// Update (Immer-like draft — mutate properties, don't reassign)
myCollection.update(itemId, (draft) => {
  draft.status = 'completed'
  draft.completedAt = new Date().toISOString()
})

// Delete
myCollection.delete(itemId)
```

**Automatic rollback:** If the `onInsert`/`onUpdate`/`onDelete` handler throws, the
optimistic state is **automatically rolled back**.

### With Metadata (intent signaling)

```typescript
myCollection.update(
  itemId,
  { metadata: { intent: 'complete' } },
  (draft) => { draft.status = 'completed' }
)

// In handler:
onUpdate: async ({ transaction }) => {
  const mutation = transaction.mutations[0]
  if (mutation.metadata?.intent === 'complete') {
    await api.items.complete(mutation.original.id)
  } else {
    await api.items.update(mutation.original.id, mutation.changes)
  }
}
```

### Custom Optimistic Actions (multi-collection or complex)

```typescript
import { createOptimisticAction } from '@tanstack/svelte-db'

const purchaseContent = createOptimisticAction<{ contentId: string; price: number }>({
  onMutate: ({ contentId }) => {
    // Optimistic guess — may be overridden by server sync
    libraryCollection?.insert({ contentId, status: 'pending', ... })
  },
  mutationFn: async ({ contentId, price }) => {
    const result = await api.purchase(contentId, price)
    // Ensure server data syncs back before returning
    await libraryCollection?.utils.refetch()
    return result
  },
})

// Usage in event handler
purchaseContent({ contentId: '123', price: 999 })
```

### Manual Transactions (multi-step workflows)

```typescript
import { createTransaction } from '@tanstack/svelte-db'

const reviewTx = createTransaction({
  autoCommit: false,
  mutationFn: async ({ transaction }) => {
    await api.batchUpdate(transaction.mutations)
  },
})

// Accumulate mutations
reviewTx.mutate(() => {
  myCollection?.update(id1, draft => { draft.status = 'reviewed' })
  myCollection?.update(id2, draft => { draft.status = 'reviewed' })
})

// More changes...
reviewTx.mutate(() => {
  myCollection?.update(id3, draft => { draft.status = 'reviewed' })
})

// Commit all or cancel
await reviewTx.commit()
// reviewTx.rollback()  // cancels everything

// For localStorage/localOnly collections in manual transactions:
// MUST call utils.acceptMutations() inside mutationFn
const localTx = createTransaction({
  mutationFn: async ({ transaction }) => {
    await api.save(data)
    localCollection?.utils.acceptMutations(transaction)  // persist local
  },
})
```

---

## 8. Collection Write Handlers (QueryCollection)

```typescript
queryCollectionOptions({
  queryKey: ['items'],
  queryFn: async () => { ... },
  queryClient,
  getKey: (item) => item.id,

  onInsert: async ({ transaction }) => {
    const mutation = transaction.mutations[0]
    await api.create(mutation.modified)
    // Auto-refetch happens after this resolves
    // Return { refetch: false } to skip refetch and use writeInsert instead:
    // myCollection.utils.writeInsert(serverResponse)
    // return { refetch: false }
  },

  onUpdate: async ({ transaction }) => {
    const { original, changes } = transaction.mutations[0]
    await api.update(original.id, changes)
    // Auto-refetch happens after this resolves
  },

  onDelete: async ({ transaction }) => {
    const { original } = transaction.mutations[0]
    await api.delete(original.id)
  },
})
```

### Direct Writes (bypass optimistic system)

Use to apply server-computed data (IDs, timestamps) without triggering a full refetch:

```typescript
myCollection.utils.writeBatch(() => {
  serverItems.forEach((item) => myCollection.utils.writeInsert(item))
})
return { refetch: false }
```

Other direct write methods: `writeUpdate`, `writeDelete`, `writeUpsert`.

---

## 9. SSR Hydration Pattern

### In `+page.server.ts`

```typescript
import type { PageServerLoad } from './$types'
import { createServerApi } from '$lib/server/api'

export const load: PageServerLoad = async ({ platform, cookies, locals }) => {
  if (!locals.user) redirect(303, '/login')

  const api = createServerApi(platform, cookies)
  const myItems = await api.myService.list()

  return { myItems }
}
```

### In `+page.svelte`

```svelte
<script lang="ts">
  import { onMount } from 'svelte'
  import { useLiveQuery, hydrateIfNeeded, myCollection } from '$lib/collections'

  let { data } = $props()

  onMount(() => {
    hydrateIfNeeded('my-collection', data.myItems?.items ?? [])
  })

  const query = useLiveQuery(
    (q) => q.from({ item: myCollection }),
    undefined,
    { ssrData: data.myItems?.items ?? [] }
  )
</script>
```

### Registering in `hydration.ts`

Add your collection to the `COLLECTION_KEYS` map and all three helper functions.
Follow the existing pattern for `'library'` or `'content'`.

---

## 10. Version-Based Cache Invalidation (Platform Layout)

The platform layout uses a **version manifest** to detect stale data:

1. Server load computes version keys via `VersionedCache` → `data.versions`
2. `$effect` in `(platform)/+layout.svelte` diffs SSR versions against localStorage manifest
3. Stale collections trigger `invalidateCollection(key)` → refetch from server
4. Tab focus triggers `invalidate('cache:versions')` → re-runs server load

**If your new collection needs cross-device invalidation:**

```typescript
// In (platform)/+layout.server.ts
depends('cache:versions')
const cache = new VersionedCache({ kv: platform.env.CACHE_KV })
versions[CacheType.COLLECTION_MY_FEATURE(locals.user.id)] =
  await cache.getVersion(...)
return { versions }

// In (platform)/+layout.svelte $effect
if (staleKeys.some(k => k.includes(':my-feature'))) {
  void invalidateCollection('my-feature')
}
```

---

## 11. Progress Sync Pattern

Progress sync (30s interval + visibility change + beforeunload beacon) is initialized
**once** in `(platform)/+layout.svelte`. Do NOT add sync loops to nested pages/layouts.

```typescript
// apps/web/src/lib/collections/progress-sync.ts
export function initProgressSync(userId: string): void { ... }
export function cleanupProgressSync(): void { ... }
```

Called in `(platform)/+layout.svelte` onMount/onDestroy. All background sync
for other collections should follow this same pattern.

---

## 12. Schema Validation

```typescript
import { z } from 'zod'

const mySchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  createdAt: z.date().default(() => new Date()),

  // IMPORTANT: if transforming A→B, input must accept both A and B
  // (required for update() to work — draft.createdAt is already a Date)
  publishedAt: z.union([z.string(), z.date()])
    .nullable()
    .optional()
    .transform(val => val instanceof Date ? val : val ? new Date(val) : null),
})

// Usage
const myCollection = browser
  ? createCollection(
      localStorageCollectionOptions({
        id: 'codex-my-feature',
        storageKey: 'codex-my-feature',
        getKey: (item) => item.id,
        schema: mySchema,
      })
    )
  : undefined
```

**Schema rules:**
- Schema validates **client mutations only** (insert/update) — NOT server/sync data
- Do NOT pass an explicit type parameter when using schema: no `createCollection<MyType>()`
- Use `z.infer<typeof mySchema>` for the TypeScript type

---

## 13. Error Handling

```typescript
import {
  SchemaValidationError,
  DuplicateKeyError,
  UpdateKeyNotFoundError,
  DeleteKeyNotFoundError,
} from '@tanstack/svelte-db'

try {
  myCollection?.insert({ id: 'existing', ... })
} catch (error) {
  if (error instanceof SchemaValidationError) {
    // error.issues — array of { path, message }
    console.error('Validation failed:', error.issues)
  } else if (error instanceof DuplicateKeyError) {
    // key already exists — use update() or delete+insert
  } else if (error instanceof UpdateKeyNotFoundError) {
    // tried to update non-existent key
  }
}

// Monitor collection status
if (myCollection?.status === 'error') {
  // Collection is in error state — recreate or reload
}

// QueryCollection error tracking
const isError = myCollection?.utils.isError
const lastError = myCollection?.utils.lastError
myCollection?.utils.clearError()  // clears and triggers refetch
```

**Key rules:**
- Cannot change an item's key — throws `KeyUpdateNotAllowedError`. Delete + re-insert instead.
- `updateKeyNotFoundError` on update — check the key exists before updating
- Transaction failure → optimistic state auto-rolls back; conflicting transactions cascade

---

## 14. Derived / Filtered Views (liveQueryCollectionOptions)

For read-only views derived from other collections (no sync, no backend):

```typescript
import { createCollection, liveQueryCollectionOptions, eq } from '@tanstack/svelte-db'

const publishedContent = createCollection(liveQueryCollectionOptions({
  query: (q) =>
    q.from({ item: contentCollection })
     .where(({ item }) => eq(item.status, 'published'))
     .orderBy(({ item }) => item.publishedAt, 'desc'),
  getKey: (item) => item.id,
}))
```

Or use the convenience function:
```typescript
import { createLiveQueryCollection } from '@tanstack/svelte-db'

const publishedContent = createLiveQueryCollection((q) =>
  q.from({ item: contentCollection })
   .where(({ item }) => eq(item.status, 'published'))
)
```

---

## 15. Reusable Query Fragments (Ref<T> pattern)

```typescript
import type { Ref } from '@tanstack/svelte-db'
import { eq, gt, and } from '@tanstack/svelte-db'
import type { MyItem } from '$lib/types'

// Reusable filter
const isActive = ({ item }: { item: Ref<MyItem> }) => eq(item.active, true)
const isPremium = ({ item }: { item: Ref<MyItem> }) => eq(item.tier, 'premium')

// Reusable select shape
const summaryFields = ({ item }: { item: Ref<MyItem> }) => ({
  id: item.id,
  title: item.title,
  tier: item.tier,
})

// Compose in queries
const query = useLiveQuery((q) =>
  q.from({ item: myCollection })
   .where(isActive)
   .where(isPremium)
   .select(summaryFields)
)
```

**Important:** Do NOT type parameters as `QueryBuilder` — use callback functions with `Ref<T>` instead.

---

## 16. One-Shot Queries (queryOnce)

For server-side or imperative data reads that don't need reactivity:

```typescript
import { queryOnce } from '@tanstack/svelte-db'

const results = await queryOnce((q) =>
  q.from({ item: myCollection })
   .where(({ item }) => eq(item.status, 'pending'))
)
// Collection auto-cleans up after this
```

**Not suitable for ongoing subscriptions** — use `createLiveQueryCollection` for those.

---

## 17. Virtual Properties on Query Results

Every row returned by a live query includes:

| Property | Type | Description |
|----------|------|-------------|
| `$synced` | `boolean` | `true` = confirmed by sync; `false` = still optimistic |
| `$origin` | `string` | `"local"` if last confirmed change came locally |
| `$key` | `string\|number` | Row identifier |
| `$collectionId` | `string` | Source collection ID |

```svelte
{#each query.data as item (item.id)}
  <div class:optimistic={!item.$synced}>
    {item.title}
    {#if !item.$synced}<span>Saving...</span>{/if}
  </div>
{/each}
```

---

## 18. Common Gotchas

| Gotcha | What Happens | Fix |
|--------|-------------|-----|
| `queryFn` returns `[]` | All items deleted from QueryCollection | Always return correct array |
| Transform `A→B` schema without union | `update()` breaks (draft is type B, schema expects A) | Use `z.union([A, B])` |
| Calling `useLiveQuery` directly in page | Crashes on server | Use `$lib/collections` wrapper |
| Calling `collection.insert()` on server | Runtime error (collection is undefined) | Always browser-guard |
| `$` prefix on query result | `$query.data` = undefined | Remove `$` — getters not stores |
| Changing item key | `KeyUpdateNotAllowedError` | `delete()` + `insert()` instead |
| `distinct()` without `select()` | Error | Always pair with `.select()` |
| Join with non-eq condition | Not supported | Only `eq()` in join conditions |
| localStorage collection + manual transaction | Changes not persisted | Call `utils.acceptMutations(tx)` |
| `initProgressSync` in nested layout | Multiple sync loops | Only call in `(platform)/+layout.svelte` |
| Calling `hydrateIfNeeded` without registering in `hydration.ts` | Collection not tracked | Add to `COLLECTION_KEYS` and all helpers |

---

## 19. Checklist for Adding a New Collection

```
[ ] Define TypeScript type / Zod schema
[ ] Create collection file in apps/web/src/lib/collections/
[ ] Browser-guard the collection (browser ? createCollection(...) : undefined)
[ ] Add server reconciliation function (loadXFromServer)
[ ] Export from apps/web/src/lib/collections/index.ts
[ ] Register in hydration.ts (COLLECTION_KEYS + 3 helper functions)
[ ] If cross-device invalidation needed: add version key to platform layout
[ ] In page.svelte: call hydrateIfNeeded in onMount
[ ] Use useLiveQuery from $lib/collections (SSR-safe wrapper)
[ ] Pass ssrData to useLiveQuery options
[ ] Test SSR: page renders without JS (check ssrData used)
[ ] Test client: collection hydrates and live queries update reactively
```

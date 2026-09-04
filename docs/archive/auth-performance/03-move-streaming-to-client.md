# Fix 3: Move Streaming Calls to Client-Side

> **Parent:** [Auth Performance Investigation](../auth-performance-investigation.md)
> **Priority:** HIGH — single biggest latency win
> **Impact:** -2.9 seconds from server streaming time (1542ms + 847ms + 567ms)
> **Effort:** Medium (4-6 hours for all 3 moves)

---

## Problem

Three streamed promises in the org layout/page server loads account for 2.9 seconds of latency:

| Call | Source | Time | Already has client store? |
|---|---|---|---|
| `continueWatching` | `+page.server.ts:52-64` | **1,542ms** | YES — `libraryCollection` (localStorage) |
| `isFollowing` | `+layout.server.ts:85-90` | **847ms** | YES — `followingStore` (localStorage) |
| `subscriptionContext` | `+layout.server.ts:77-82` | **567ms** | YES — `subscriptionCollection` (localStorage) |

All three are:
- User-scoped (not needed for SEO / unauthenticated visitors)
- Already backed by localStorage stores/collections
- Below the fold or purely cosmetic (badge labels, follow button state)

Moving them to client-side `onMount()` fetches means:
- **First paint:** Instant from localStorage (or skeleton if first visit)
- **Background refresh:** Fetch fires in parallel after mount, updates reactively
- **No SSR impact:** Unauthenticated visitors see no change (promises already resolve to defaults)

---

## Move A: `continueWatching` → Client-Side

### Current (Server)

```typescript
// _org/[slug]/(space)/+page.server.ts:52-64
if (locals.user) {
  const api = createServerApi(platform, cookies);
  const searchParams = new URLSearchParams();
  searchParams.set('organizationId', org.id);
  searchParams.set('filter', 'in_progress');
  searchParams.set('limit', '6');
  searchParams.set('sortBy', 'recent');
  continueWatchingPromise = api.access
    .getUserLibrary(searchParams)
    .then((r) => r?.items ?? undefined)
    .catch(() => undefined);
}
```

### Proposed (Client)

**Remove from server load.** In the page component, use `libraryCollection` directly:

```svelte
<!-- _org/[slug]/(space)/+page.svelte -->
<script lang="ts">
  import { browser } from '$app/environment';
  import { libraryCollection, useLiveQuery } from '$lib/collections';

  let { data } = $props();

  // Live query: filter library by org + in_progress, client-side
  const continueWatchingQuery = useLiveQuery(
    (q) => q
      .from({ item: libraryCollection })
      .where(({ item }) =>
        item.organizationId === data.org.id &&
        item.progress?.percentComplete != null &&
        item.progress.percentComplete > 0 &&
        item.progress.percentComplete < 100
      )
      .orderBy(({ item }) => item.progress?.updatedAt, 'desc')
      .limit(6),
    undefined,
    { ssrData: [] }  // Empty on SSR — skeleton shown
  );

  const { data: continueWatching } = $derived(continueWatchingQuery);
</script>

{#if continueWatching && continueWatching.length > 0}
  <ContinueWatchingSection items={continueWatching} />
{/if}
```

**Why this works:** `libraryCollection` is already hydrated from localStorage in the platform/org layout. The live query filters by `organizationId` client-side — no new HTTP call needed.

**Files to modify:**
- `apps/web/src/routes/_org/[slug]/(space)/+page.server.ts` — Remove `continueWatchingPromise` block (lines 52-64), remove from return object
- `apps/web/src/routes/_org/[slug]/(space)/+page.svelte` — Add `useLiveQuery` for continue watching
- Remove `continueWatching` from `{#await}` blocks, replace with reactive `continueWatching` from query

---

## Move B: `isFollowing` → Client-Side

### Current (Server)

```typescript
// _org/[slug]/+layout.server.ts:85-90
const isFollowing = locals.user
  ? api.org.isFollowing(typedOrg.id)
      .then((r) => r.following)
      .catch(() => false)
  : Promise.resolve(false);
```

### Proposed (Client)

**Remove from server load.** Use existing `followingStore`:

```svelte
<!-- _org/[slug]/+layout.svelte -->
<script lang="ts">
  import { followingStore } from '$lib/client/following.svelte';
  import { onMount } from 'svelte';

  let { data } = $props();

  // On mount: fire a background fetch and hydrate the store
  onMount(async () => {
    if (data.user) {
      try {
        // Background fetch via remote function — doesn't block render
        const result = await isFollowingQuery(data.org.id);
        followingStore.hydrate(data.org.id, result);
      } catch {
        // Graceful — store keeps its localStorage value
      }
    }
  });

  // Reactive: reads from localStorage immediately (instant on return visits)
  const isFollowing = $derived(followingStore.get(data.org.id));
</script>
```

**The `followingStore` API:**
- `followingStore.get(orgId)` — read follow state (reactive via `$state`)
- `followingStore.set(orgId, boolean)` — write (optimistic update + localStorage persist)
- `followingStore.hydrate(orgId, boolean)` — server hydration (no-op if org already in store, prevents overwriting optimistic updates)

**No `refresh()` method exists.** Use a remote function (`isFollowingQuery`) to fetch from server, then call `followingStore.hydrate()`. The `hydrate()` method is specifically designed for this — it won't overwrite an optimistic update that happened during the fetch.

**Files to modify:**
- `apps/web/src/routes/_org/[slug]/+layout.server.ts` — Remove `isFollowing` streaming (lines 85-90), remove from both return objects
- `apps/web/src/routes/_org/[slug]/+layout.svelte` — Use `followingStore.isFollowing(org.id)` reactively
- `apps/web/src/lib/client/following.svelte.ts` — Add `refresh(orgId)` if not present
- Update any child components that consume `data.isFollowing` to use the store directly

---

## Move C: `subscriptionContext` → Client-Side

### Current (Server)

```typescript
// _org/[slug]/+layout.server.ts:77-82
const subscriptionContext = locals.user
  ? loadUserSubscriptionContext(api, typedOrg.id)
  : Promise.resolve({ userTierSortOrder: null, tiers: [] });

// loadUserSubscriptionContext (lines 188-200):
async function loadUserSubscriptionContext(api, orgId) {
  const [currentSubscription, tiers] = await Promise.all([
    api.subscription.getCurrent(orgId).catch(() => null),
    api.tiers.list(orgId).catch(() => []),
  ]);
  return { userTierSortOrder: currentSubscription?.tier?.sortOrder ?? null, tiers };
}
```

### Proposed (Client)

This is the most nuanced move because `subscriptionContext` has two parts:
1. **Tiers list** (public, already KV-cached) — keep server-side OR client-side
2. **User's current subscription** (auth-only) — move to `subscriptionCollection`

**Approach:** Keep tiers in server load (cheap: KV hit ~10ms), move subscription to client.

```svelte
<!-- In page/layout component -->
<script lang="ts">
  import { subscriptionCollection, useLiveQuery } from '$lib/collections';

  let { data } = $props();

  // Tiers still come from server (cheap, KV-cached)
  // User subscription comes from localStorage collection
  const subQuery = useLiveQuery(
    (q) => q.from({ sub: subscriptionCollection })
      .where(({ sub }) => sub.organizationId === data.org.id),
    undefined,
    { ssrData: [] }
  );

  const userTierSortOrder = $derived(
    subQuery.data?.[0]?.tier?.sortOrder ?? null
  );
</script>
```

**Files to modify:**
- `apps/web/src/routes/_org/[slug]/+layout.server.ts` — Simplify `subscriptionContext` to only return tiers (public, fast)
- `apps/web/src/routes/_org/[slug]/+layout.svelte` — Use `subscriptionCollection` for user subscription
- Ensure `subscriptionCollection` is hydrated in org layout `onMount`

---

## Before/After Timeline

### Before (Current)

```
t=0ms     Layout: getPublicInfo (200ms, awaited)
t=200ms   Page: stats + content (400ms, awaited)
t=600ms   ─── FIRST PAINT (HTML sent) ───
          Streaming begins:
t=600ms   ├── subscriptionContext query (567ms)
t=600ms   ├── isFollowing query (847ms)
t=600ms   └── continueWatching query (1542ms)
t=2142ms  ─── ALL STREAMS RESOLVED ───
```

**Total: 2.1 seconds of streaming after first paint**

### After (Proposed)

```
t=0ms     Layout: getPublicInfo (200ms, awaited)
t=200ms   Page: stats + content (400ms, awaited)
t=600ms   ─── FIRST PAINT (HTML sent) ───
          Client onMount:
t=600ms   ├── followingStore.read(localStorage) → instant
t=600ms   ├── subscriptionCollection.read(localStorage) → instant
t=600ms   └── libraryCollection.query(orgFilter) → instant
t=600ms   ─── UI POPULATED FROM LOCAL STATE ───
          Background refresh (non-blocking):
t=600ms   ├── followingStore.refresh() → 847ms
t=600ms   ├── subscriptionCollection.refresh() → 567ms
t=600ms   └── (library already synced via initProgressSync)
t=1447ms  ─── BACKGROUND REFRESHES COMPLETE ───
```

**Total: 0ms streaming. Local state renders instantly. Background refreshes invisible to user.**

---

## Edge Cases

### First Visit (No localStorage Data)

- `followingStore`: returns `false` (default) → correct for new visitors
- `subscriptionCollection`: returns empty → no "Included" badges shown until refresh
- `libraryCollection`: returns empty → no "Continue Watching" section shown until hydration

This is acceptable — these are enhancement features, not critical content. Skeletons or hidden sections are fine.

### Cross-Device Sync

- Version manifest already handles this: `COLLECTION_USER_LIBRARY`, `COLLECTION_USER_SUBSCRIPTION`
- Tab visibility change triggers `invalidate('cache:org-versions')` → re-reads version keys → stale keys trigger `invalidateCollection()`

---

## Risks

- **Low:** "Included" badges may flash in 500ms after first visit (subscription loads)
- **Low:** Follow button shows wrong state for ~800ms on first visit
- **Mitigation:** Use `{#if}` guards so sections don't show until data is available (already the pattern)

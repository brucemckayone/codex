# UX, Caching & TanStack DB Deep-Dive Research

> Generated: 2026-04-05
> Scope: Full codebase audit + framework research (SvelteKit, Svelte 5, TanStack DB)
> Goal: Faster navigation, better TanStack DB utilization, caching correctness

---

## Executive Summary

The core UX problem — "click → wait → page renders all at once" — stems from **server load waterfalls**: every `+page.server.ts` currently `await`s all data before rendering begins. SvelteKit has first-class support for **streaming** (returning unresolved promises) that would give instant page shells with progressive data fill. Combined with studio SPA mode, view transitions, and better TanStack DB utilization, the app can feel significantly snappier without sacrificing SSR benefits.

### Key Findings

| Area | Current State | Opportunity |
|------|--------------|-------------|
| **Server load streaming** | 0 pages use streaming | All multi-fetch pages can stream non-critical data |
| **Studio SSR** | Full SSR on all studio pages | `ssr = false` — studio is auth-only, no SEO value |
| **View transitions** | Not implemented | Single root layout addition (~10 lines) |
| **TanStack DB collections** | 3 collections, 2 localStorage | Underutilized — most pages ignore reactive queries |
| **Content collection** | Session-only (QueryClient) | Could be localStorage for offline browse |
| **Prefetching** | Default `hover` preload only | Programmatic prefetching on likely targets |
| **Server KV cache** | Identity only | Content + org branding pending |
| **Error boundaries** | Missing in `_org` tree | `<svelte:boundary>` available in Svelte 5 |

---

## 1. The Streaming Fix (Biggest UX Win)

### Problem

Every server load awaits ALL data before rendering:

```ts
// Current pattern — org landing page
const [content, creators, continueWatching] = await Promise.all([
  contentPromise.catch(() => null),
  creatorsPromise.catch(() => null),
  continueWatchingPromise?.catch(() => null) ?? Promise.resolve(null),
]);

return { newReleases: content?.items, creators, continueWatching };
// ↑ Page blocked until ALL three resolve
```

**User experience**: Click → loading bar → nothing → everything appears at once.

### Solution: Return Promises for Non-Critical Data

SvelteKit streams unresolved promises from `+page.server.ts`. The page renders immediately with awaited data; streamed data fills in with `{#await}` blocks:

```ts
// Streaming pattern — org landing page
const { org } = await parent(); // Critical — needed for layout
const newReleases = await getPublicContent({ orgId: org.id, limit: 6 }); // Critical — hero section

return {
  newReleases: newReleases?.items ?? [],                         // ✅ Awaited — renders immediately
  creators: getPublicCreators({ slug: org.slug, limit: 3 }),     // 🔄 Streamed — shows skeleton
  continueWatching: continueWatchingPromise,                     // 🔄 Streamed — shows skeleton
};
```

```svelte
<!-- Page renders IMMEDIATELY with newReleases -->
<HeroSection items={data.newReleases} />

<!-- Creators stream in with skeleton -->
{#await data.creators}
  <CreatorsSkeleton />
{:then result}
  <CreatorsSection items={result?.items ?? []} />
{:catch}
  <!-- Graceful degradation — section simply doesn't appear -->
{/await}

<!-- Continue watching streams in -->
{#await data.continueWatching}
  <ContinueWatchingSkeleton />
{:then items}
  {#if items?.length}
    <ContinueWatching {items} />
  {/if}
{/await}
```

### Pages That Would Benefit

| Page | Critical (await) | Streamable | Impact |
|------|------------------|------------|--------|
| **Org landing** | `newReleases` (hero) | `creators`, `continueWatching` | High — 3 parallel fetches |
| **Content detail** | `content`, `contentBodyHtml` | `relatedContent`, `progress` | High — related content is secondary |
| **Library** | `library.items` | Sort/filter metadata | Medium |
| **Explore** | `content.items` | (single fetch — less benefit) | Low |
| **Creator profile** | Profile info | Content list, stats | Medium |
| **Studio dashboard** | Layout data | `stats`, `activities` | High — stats are slow queries |

### Streaming Caveats

1. Streaming requires JavaScript — without JS, the page waits for all promises to resolve (degrades gracefully to current behavior)
2. Cannot set headers/status after streaming begins — set them before returning
3. Handle promise rejections: use `.catch(() => null)` on streamed promises or SvelteKit's internal `fetch()` (handles this automatically)
4. Only works in `+page.server.ts` — universal loads (`+page.ts`) do NOT stream

---

## 2. Studio as SPA (No SSR Needed)

### Rationale

The studio is:
- Behind authentication (no anonymous visitors)
- Not SEO-significant (admin panel)
- Data-heavy with frequent mutations
- The place where "click → wait → render" is most painful

### Implementation

```ts
// apps/web/src/routes/_org/[slug]/studio/+layout.ts
export const ssr = false;
```

**What this does:**
- SvelteKit renders an empty shell on the server
- All data loading happens client-side
- Client-side navigation between studio pages is instant (no server round-trip for page data)
- Studio layout/sidebar renders immediately from cached data
- Page-specific data loads with skeletons

**What this DOESN'T break:**
- The parent org layout (`_org/[slug]/+layout.server.ts`) still runs server-side — org resolution, branding, auth checks all happen as before
- Only the studio sub-tree becomes client-rendered
- Cookie forwarding still works (auth state available via parent layout)

### Studio Data Loading Pattern After SPA

```ts
// Instead of +page.server.ts, use +page.ts (universal load)
// or remote functions called from components

// Option A: +page.ts universal load
export async function load({ parent }) {
  const { queryClient } = await parent();
  await queryClient.prefetchQuery({
    queryKey: ['studio', 'dashboard', 'stats'],
    queryFn: () => getStudioStats(),
  });
}

// Option B: Remote functions with {#await} in components
// (simpler, less setup, works well with Svelte 5 async)
```

### Expected UX Improvement

| Action | Before (SSR) | After (SPA) |
|--------|-------------|-------------|
| Click "Dashboard" from Content page | ~400-800ms (server load) | ~0ms (instant swap, data loads in background) |
| Click "Customers" | ~300-600ms | ~0ms (skeleton → data) |
| Navigate back | ~300-600ms | ~0ms (cached data) |

---

## 3. View Transitions (One-Line UX Upgrade)

### Implementation

Add to root `+layout.svelte`:

```svelte
<script>
  import { onNavigate } from '$app/navigation';

  onNavigate((navigation) => {
    if (!document.startViewTransition) return;
    return new Promise((resolve) => {
      document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });
    });
  });
</script>
```

### What This Enables

- Smooth cross-fade between pages during client-side navigation
- Can be customized per-element with CSS `view-transition-name`:
  ```css
  .studio-sidebar { view-transition-name: sidebar; }
  .page-content { view-transition-name: main; }
  
  ::view-transition-old(main) { animation: slide-out 0.15s ease-out; }
  ::view-transition-new(main) { animation: slide-in 0.15s ease-in; }
  ```
- Works with the navigating state for combined effect
- Gracefully degrades — `startViewTransition` returns `undefined` in unsupported browsers

---

## 4. TanStack DB Audit — Current Inventory

### Collections

| Collection | Storage | Key | Hydration | Live Queries | Status |
|------------|---------|-----|-----------|-------------|--------|
| `libraryCollection` | localStorage (`codex-library`) | `content.id` | `hydrateIfNeeded('library', items)` | Used on library page | ✅ Full utilization |
| `progressCollection` | localStorage (`codex-playback-progress`) | `contentId` | Via progress-sync | Used by VideoPlayer | ✅ Full utilization |
| `contentCollection` | QueryClient (session) | `id` | `hydrateIfNeeded('content', items)` | Underutilized | ⚠️ Gaps |

### Content Collection Gaps

The content collection is hydrated in 4 places but `useLiveQuery` is only used on the library page. Most pages render from `data.*` directly:

| Page | Hydrates? | Uses useLiveQuery? | Renders From |
|------|-----------|-------------------|-------------|
| Library | ✅ Yes | ✅ Yes | `libraryQuery.data` |
| Org landing | ✅ Yes (`data.newReleases`) | ❌ No | `data.newReleases` directly |
| Content detail | ✅ Yes (single item) | ❌ No | `data.content` directly |
| Explore | ❌ No | ❌ No | `data.content.items` directly |
| Discover | ❌ No | ❌ No | `data.content` directly |
| Creator profile | ❌ No | ❌ No | `data.content` directly |

**Impact**: Hydration without `useLiveQuery` only benefits subsequent navigations (pre-populates cache for other pages). The hydrating page itself gets no benefit — it already has the SSR data.

### Where TanStack DB Could Add More Value

#### A. Reactive Explore/Discover Pages

Currently: Server load fetches filtered content → page renders static list → user changes filters → full page navigation with new URL params → server load re-fetches.

With TanStack DB: Content collection is pre-populated → filter changes query the local collection instantly → background sync refreshes from server → no page navigation needed for filtering.

```svelte
<!-- Explore page with reactive filtering -->
<script>
  import { contentCollection, useLiveQuery } from '$lib/collections';
  
  let typeFilter = $state('all');
  let sortBy = $state('newest');
  
  const contentQuery = useLiveQuery(
    (q) => {
      let query = q.from({ item: contentCollection });
      if (typeFilter !== 'all') {
        query = query.where(({ item }) => item.contentType === typeFilter);
      }
      return query.orderBy(/* sort logic */);
    },
    [typeFilter, sortBy],
    { ssrData: data.content.items }
  );
</script>

<!-- Instant filter changes, no server round-trip -->
<FilterBar onchange={(filters) => { typeFilter = filters.type; }} />
{#each contentQuery.data as item}
  <ContentCard {item} />
{/each}
```

#### B. Cross-Page Content Cache

If a user browses the explore page and clicks into a content detail, the content data is already in the collection. The detail page could show the cached title/description/thumbnail instantly while streaming the access check + progress:

```ts
// Content detail +page.server.ts with streaming
export const load = async ({ params, parent }) => {
  const content = await getContent(params.contentSlug); // Await — critical for render
  
  return {
    content,
    contentBodyHtml: await renderContentBody(content),
    // Stream secondary data — skeletons show while loading
    accessAndProgress: loadAccessAndProgress(content.id, platform, cookies),
    relatedContent: getPublicContent({ orgId: org.id, limit: 5 }),
  };
};
```

#### C. Studio Data Collections (New)

The studio currently has no TanStack DB integration. Adding collections for studio data would enable:
- Instant navigation between studio pages (data already in cache)
- Optimistic updates (publish/unpublish content without waiting for server)
- Cross-tab synchronization via version manifest

```ts
// Potential: studioContentCollection (localStorage)
// Potential: studioCustomerCollection (QueryClient session)
// Potential: studioAnalyticsCollection (QueryClient session, short gcTime)
```

---

## 5. Caching Layer Audit

### Implementation Status (from `docs/caching-strategy.md`)

| Component | Status | Notes |
|-----------|--------|-------|
| Server KV cache-aside (identity) | ✅ Done | USER_PROFILE, USER_PREFERENCES, 10min TTL |
| progressCollection local-first | ✅ Done | localStorage, 30s sync, sendBeacon |
| libraryCollection local-first | ✅ Done | localStorage, version-based invalidation |
| SSR hydration bridge | ✅ Done | hydrateIfNeeded + useLiveQuery + ssrData |
| Client version manifest | ✅ Done | getStaleKeys + updateStoredVersions |
| Platform layout staleness check | ✅ Done | $effect + visibilitychange → invalidate |
| Org layout staleness check | ✅ Done | Same pattern with org-specific keys |
| **CACHE_KV in content-api** | ❌ Pending | Content metadata not server-cached |
| **CACHE_KV in admin-api** | ❌ Pending | Analytics queries hit DB every time |
| **Content invalidation on publish** | ❌ Pending | No version bump on publish/update |
| **Org branding KV cache** | ❌ Pending | Branding fetched from DB every request |

### Issues Found

#### CACHE-001: Content publish doesn't bump collection version
When content is published/unpublished, the collection version key `content:published` and `org:{orgId}:content` should be bumped. Currently they are not, meaning:
- Server KV has no content cache to invalidate (CACHE_KV not wired)
- Client has no signal that the content catalogue changed
- SSR re-renders get fresh DB data anyway, but there's no CDN invalidation

**Fix**: Wire CACHE_KV in content-api, add `cache.invalidate('content:published')` and `cache.invalidate(orgId + ':content')` in ContentService.publish() and ContentService.update().

#### CACHE-002: Org branding fetched from DB on every request
The org layout calls `api.org.getPublicInfo(slug)` on every page load within the org. This hits the database every time. The caching strategy doc lists `ORG_CONFIG, 30min TTL` as a "natural next addition" but it hasn't been implemented.

**Fix**: Add `ORG_CONFIG` cache type to `@codex/cache`, cache org branding in KV with 30min TTL, invalidate on branding update.

#### CACHE-003: QueryClient staleTime (5min) may be too aggressive for browse pages
The global `staleTime: 5 * 60 * 1000` means TanStack Query considers all data fresh for 5 minutes. For the content catalogue (browse/discover/explore), this is reasonable. But for user-specific data (library, progress), 5 minutes of staleness could mean showing incorrect progress or missing recently purchased content.

The library collection uses localStorage with version-based invalidation (bypasses staleTime), so this is actually fine. But any new QueryClient-backed collections should consider shorter staleTime for user-specific data.

**Status**: Not a bug, but worth noting for future collection design.

#### CACHE-004: HTTP cache headers missing on 4 studio pages
Already flagged in review as SSR-003 and SSR-004. Studio pages behind auth should set `CACHE_HEADERS.PRIVATE`.

#### CACHE-005: contentCollection dies on page refresh
The content collection uses QueryClient (session-only storage). When the user refreshes or opens a new tab, all cached content data is lost and must be re-fetched from SSR. For the library this isn't an issue (localStorage persists), but for browse/explore, it means no offline support and no cross-tab sharing.

**Consideration**: If offline browse support or cross-tab sharing is valued, migrate `contentCollection` to `localStorageCollectionOptions`. The trade-off is localStorage size limits and reconciliation complexity.

---

## 6. SvelteKit Features We're Not Using

### A. Streaming (discussed above)
**Impact**: High — solves the primary UX complaint.

### B. `export const ssr = false` for Studio
**Impact**: High — instant studio navigation.

### C. View Transitions API
**Impact**: Medium — polish, not functionality. ~10 lines of code.

### D. Shallow Routing (`pushState` + `preloadData`)
**Use case**: Content detail modals. User clicks a content card on explore → card expands into a modal with content details → URL updates → back button closes modal.

```svelte
<a
  href="/content/{item.slug}"
  onclick={async (e) => {
    if (e.metaKey || e.ctrlKey) return; // Allow new tab
    e.preventDefault();
    const result = await preloadData(e.currentTarget.href);
    if (result.type === 'loaded' && result.status === 200) {
      pushState(e.currentTarget.href, { contentDetail: result.data });
    } else {
      goto(e.currentTarget.href);
    }
  }}
>
```

**Impact**: Medium — elegant UX for browse → detail flow.

### E. `<svelte:boundary>` (Svelte 5.3+)
**Use case**: Replace manual error handling with declarative boundaries:

```svelte
<svelte:boundary>
  <StudioDashboard />
  
  {#snippet pending()}
    <DashboardSkeleton />
  {/snippet}
  
  {#snippet failed(error, reset)}
    <ErrorCard {error} onretry={reset} />
  {/snippet}
</svelte:boundary>
```

**Impact**: Medium — cleaner error/loading handling, especially in studio.

### F. Experimental Async Components (Svelte 5.36+)
**Use case**: Components that fetch their own data with `await` expressions directly in markup:

```svelte
<script>
  const { contentId } = $props();
  const stats = $derived(await getContentStats(contentId));
</script>

<p>Views: {stats.views}</p>
```

**Impact**: Low for now (experimental flag required), but aligns with future Svelte direction.

### G. `refreshAll()` for Remote Functions
**Use case**: After a mutation, refresh all active remote functions and load functions in one call:

```ts
await deleteContent(id);
await refreshAll(); // Refreshes all active queries + load functions
```

**Impact**: Low — our version-based invalidation already handles this, but `refreshAll()` is simpler for one-off mutations.

---

## 7. Recommended Implementation Plan

### Phase 1: Quick Wins (1-2 days)

| # | Change | Files | Impact |
|---|--------|-------|--------|
| 1 | Add view transitions to root layout | `+layout.svelte` | Polish |
| 2 | Set `ssr = false` on studio layout | `studio/+layout.ts` | Major — instant studio nav |
| 3 | Add skeleton components for streaming | New files in `$lib/components/ui/` | Prep for Phase 2 |

### Phase 2: Streaming (2-3 days)

| # | Page | Stream What | Keep Awaited |
|---|------|-------------|-------------|
| 1 | Org landing | `creators`, `continueWatching` | `newReleases` (hero) |
| 2 | Content detail | `relatedContent`, `progress` | `content`, `contentBodyHtml` |
| 3 | Creator profile | Content list, stats | Profile info |
| 4 | Studio dashboard | `stats`, `activities` | Layout data |
| 5 | Studio customers | Customer list | Layout data |

### Phase 3: TanStack DB Expansion (3-5 days)

| # | Change | Value |
|---|--------|-------|
| 1 | Reactive explore/discover filtering via `useLiveQuery` | Instant client-side filtering |
| 2 | Cross-page content cache hit on detail pages | Instant detail page shell |
| 3 | Studio content collection (new) | Optimistic publish/unpublish |
| 4 | Evaluate `contentCollection` → localStorage migration | Offline browse, cross-tab |

### Phase 4: Server Caching Completion (2-3 days)

| # | Change | Value |
|---|--------|-------|
| 1 | Wire CACHE_KV in content-api | Content metadata cached server-side |
| 2 | Add content publish version bumping | CDN + client invalidation on publish |
| 3 | Cache org branding in KV (30min TTL) | Reduce DB calls per org page load |
| 4 | Set PRIVATE cache headers on studio pages | Security correctness |

### Phase 5: Advanced UX (Opportunistic)

| # | Change | Value |
|---|--------|-------|
| 1 | Shallow routing for content detail modals | Browse → detail without full nav |
| 2 | `<svelte:boundary>` adoption | Declarative error/loading handling |
| 3 | Programmatic `preloadData()` on likely targets | Sub-100ms navigation |
| 4 | `data-sveltekit-preload-data="tap"` on volatile data links | Fresher data on click |

---

## 8. Architecture Recommendation: The "Shell + Stream" Pattern

For the best UX across both public pages (SSR needed) and studio (SPA), adopt a consistent "shell + stream" mental model:

### Public Pages (SSR + Streaming)
```
Server: Await critical layout data → return immediately
        Return promises for secondary data → stream to client
Client: Render shell + skeletons → fill in as promises resolve
        Hydrate collections for subsequent navigations
```

### Studio Pages (SPA + Collections)
```
Server: Parent org layout provides auth + branding (SSR)
Studio: Client-only rendering (ssr = false)
        Remote functions load data → show skeletons while loading
        TanStack DB collections cache data across pages
        Navigation between studio pages is instant (cached)
```

### Shared: Version-Based Invalidation
```
Both: visibilitychange → check versions → invalidate stale collections
      Background sync for mutations (progress, library)
      Server KV for cross-worker cache consistency
```

This gives:
- **Public pages**: Fast first paint (SSR) + progressive data fill (streaming) + offline resilience (collections)
- **Studio**: Instant navigation (SPA) + real-time data (collections) + cross-device sync (versions)
- **Both**: Consistent invalidation pattern, same mental model for devs

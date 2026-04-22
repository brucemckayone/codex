# Section 5: Periodic Version Check + Explore Sorts KV Cache

> Parent: [caching-strategy.md](../caching-strategy.md)

This section covers two small, independent changes that round out the caching strategy.

---

## 5A: Periodic Version Check Interval

### Problem

Staleness detection currently relies entirely on `visibilitychange` — the browser event that fires when a user switches away from and back to a tab. This misses a common scenario:

**A user browses an org for 20+ minutes without leaving the tab.**

During that time:
- Admin publishes new content → user doesn't see it
- User subscribes on phone → desktop tab doesn't reflect it
- Admin changes tiers → pricing page shows stale data

The version keys in KV have been bumped, but the client never checks because `visibilitychange` hasn't fired.

### Solution

Add a periodic `setInterval` alongside the existing `visibilitychange` handler. Same mechanism (invalidate the layout's `depends` key → server re-reads version keys → `$effect` detects stale → refetches), additional trigger.

### Design

```typescript
// In _org/[slug]/+layout.svelte onMount
const VERSION_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const interval = setInterval(() => {
  // Only poll when tab is visible — hidden tabs caught by visibilitychange
  if (document.visibilityState === 'visible') {
    void invalidate('cache:org-versions');
  }
}, VERSION_POLL_INTERVAL_MS);

return () => clearInterval(interval);
```

### Why 5 minutes?

The version check itself is cheap: 3-4 parallel KV reads (~10ms total). The expensive part — refetching actual data from Neon — only happens when a version mismatch is detected, which is rare.

| Interval | Checks/hour | Cost per check | Acceptable for |
|----------|-------------|----------------|----------------|
| 1 min | 60 | ~10ms KV reads | Real-time apps (not us) |
| 5 min | 12 | ~10ms KV reads | Content platforms (us) |
| 15 min | 4 | ~10ms KV reads | Mostly-static sites |

5 minutes balances freshness vs resource usage. For a content streaming platform, content published by a creator appearing within 5 minutes is acceptable.

### Why guard with `visibilityState === 'visible'`?

Without the guard, a background tab polls every 5 minutes for nothing. The `visibilitychange` handler already handles the tab-return case. The guard ensures we only poll when someone is actually looking at the page.

### Also apply to platform layout?

Consider adding the same interval to `apps/web/src/routes/(platform)/+layout.svelte` for the platform routes (discover, library, account). The platform layout currently only uses `visibilitychange`. Same 5-minute interval, same guard.

### Implementation

**`apps/web/src/routes/_org/[slug]/+layout.svelte`** — add `setInterval` in `onMount`, `clearInterval` in cleanup. One line of state, one line in the return cleanup.

**Optionally `apps/web/src/routes/(platform)/+layout.svelte`** — same pattern.

### Estimated Impact

Qualitative: ensures freshness during long browsing sessions. No latency reduction on individual page loads, but prevents stale data from persisting indefinitely.

---

## 5B: KV Cache for Auth-Only Explore Sorts

### Problem

The explore page's `popular` and `top-selling` sorts use the authenticated `api.content.list()` endpoint directly — bypassing the public content endpoint's KV cache entirely. Every page load triggers a fresh Neon query (~80-150ms).

**Current code** (`apps/web/src/routes/_org/[slug]/(space)/explore/+page.server.ts`, lines 67-79):

```typescript
if (AUTH_ONLY_SORTS.has(sort) && locals.user) {
  setHeaders(CACHE_HEADERS.PRIVATE);
  const api = createServerApi(platform, cookies);
  const params = new URLSearchParams();
  // ... build params ...
  contentResult = await api.content.list(params);
}
```

Meanwhile, public sorts (newest, oldest, title) go through `getPublicContent()` which hits the content-api's KV cache.

### Why TTL-Based, Not Event-Driven

Popularity rankings derive from **aggregate data** (view counts, purchase counts) that change continuously from many sources. There's no single mutation event that says "popularity order changed." This is fundamentally different from tiers (admin-only mutations) or subscriptions (webhook-triggered).

TTL is the correct expiry mechanism here. A 3-minute TTL means:
- Popularity data is at most 3 minutes stale (acceptable for "most popular" browsing)
- No invalidation logic needed — TTL handles everything
- Cache key includes sort params, so different sorts cache independently

### Why cache at SvelteKit layer, not in the content-api worker?

The authenticated content endpoint (`api.content.list()`) serves many different consumers:
- Explore page (popular/top-selling sorts)
- Studio content management (draft/published, admin sorts)
- Admin views

Adding KV caching inside the worker would require carefully scoping it to avoid caching studio/admin responses. Caching at the SvelteKit explore page is surgical — only this page's specific query pattern is cached.

### Why not cache search queries?

When the explore page has a `q` search parameter, the cache is bypassed:
- Search results are too dynamic (each query is unique)
- Cache key space explodes (`orgId × sort × contentType × searchTerm × page`)
- Search is already fast (Neon text search, ~100ms)

Only sort-based browse queries (no search) are cached.

### Design

```typescript
if (AUTH_ONLY_SORTS.has(sort) && locals.user) {
  setHeaders(CACHE_HEADERS.PRIVATE);

  // Only cache when not searching — search results are too dynamic
  const shouldCache = !q && platform?.env?.CACHE_KV;
  const cacheId = `${org.id}:${sort}:${contentType ?? 'all'}:${page}`;

  if (shouldCache) {
    const cache = new VersionedCache({
      kv: platform.env.CACHE_KV as KVNamespace,
    });
    contentResult = await cache.get(
      cacheId,
      CacheType.ORG_CONTENT_SORTED,
      () => fetchAuthContent(api, org.id, sort, q, contentType, page),
      { ttl: 180 } // 3 min — popularity shifts slowly
    );
  } else {
    contentResult = await fetchAuthContent(api, org.id, sort, q, contentType, page);
  }
}
```

Extract helper to avoid duplicating `URLSearchParams` construction:

```typescript
async function fetchAuthContent(
  api: ReturnType<typeof createServerApi>,
  orgId: string,
  sort: string,
  q: string | undefined,
  contentType: string | undefined,
  page: number
) {
  const params = new URLSearchParams();
  params.set('organizationId', orgId);
  params.set('status', 'published');
  if (q) params.set('search', q);
  if (contentType) params.set('contentType', contentType);
  params.set('sortBy', AUTH_SORT_MAP[sort].sortBy);
  params.set('sortOrder', AUTH_SORT_MAP[sort].sortOrder);
  params.set('page', String(page));
  params.set('limit', String(PAGE_LIMIT));
  return api.content.list(params);
}
```

### Implementation

**`packages/cache/src/cache-keys.ts`**

Add:
```typescript
/** Org content list with auth-only sort (popular, top-selling) */
ORG_CONTENT_SORTED: 'org:content:sorted',
```

**`apps/web/src/routes/_org/[slug]/(space)/explore/+page.server.ts`**

- Wrap auth-only sort branch with `VersionedCache.get()`
- Extract `fetchAuthContent()` helper
- Add conditional: only cache when no `q` search param

### Estimated Impact

~80-150ms saved on authenticated explore page with popular/top-selling sorts (after first request warms cache). Second visit to same sort/page within 3 minutes gets KV hit.

### Verification

1. Navigate to explore with `?sort=popular` → results load correctly
2. Reload within 3 minutes → faster load (KV hit vs Neon query)
3. Navigate to `?sort=popular&q=test` → search results load (cache bypassed)
4. Wait >3 minutes → cache expires, next load hits Neon, re-warms cache
5. Switch between `?sort=popular` and `?sort=top-selling` → separate cache entries
6. Change page (`?sort=popular&page=2`) → separate cache entry per page

## Dependencies

- Adds `ORG_CONTENT_SORTED` to `packages/cache/src/cache-keys.ts`
- Otherwise independent of all other sections

# Web App (SvelteKit)

Frontend SvelteKit application for the Codex platform.
**Stack**: Svelte 5, SvelteKit, TanStack DB, Vite, Cloudflare Pages.

## Subdomain Routing

The platform uses subdomain-based routing via `src/hooks.ts` `reroute()`:

| Subdomain | Internal Route | Example |
|---|---|---|
| `localhost:3000` (none) | `(platform)/*` | Homepage, discover, library, account |
| `creators.localhost:3000` | `_creators/*` | Creator profiles, content catalogs |
| `{slug}.localhost:3000` | `_org/[slug]/*` | Org landing, explore, studio, settings |

### CRITICAL: No Slug in URL Paths

On org subdomains, the org slug is in the **hostname**, NOT the URL path. All `href`, `goto()`, `baseUrl` in `_org/` routes must use root-relative paths:

```svelte
<!-- CORRECT: paths are root-relative on org subdomains -->
<a href="/">Home</a>
<a href="/explore">Explore</a>
<a href="/studio">Studio</a>
<a href="/studio/content">Content</a>
<a href="/content/{item.slug}">View Content</a>
goto('/studio/analytics?dateFrom=...')

<!-- WRONG: slug is already in the hostname, don't repeat it -->
<a href="/{orgSlug}">Home</a>
<a href="/{orgSlug}/explore">Explore</a>
<a href="/{orgSlug}/studio">Studio</a>
```

The `reroute()` hook maps these root-relative paths to the correct internal routes:
- `bruce-studio.localhost:3000/explore` → `_org/bruce-studio/explore` → matches `(space)/explore/+page.svelte`
- `bruce-studio.localhost:3000/studio` → `_org/bruce-studio/studio` → matches `studio/+page.svelte`

**Exception:** Cross-org navigation (e.g., StudioSwitcher) needs full subdomain URLs since it navigates to a different origin.

**Route groups like `(space)` are filesystem-only** — never include them in rerouted paths or `href` values.

### Public Endpoints for Cross-Subdomain Data

Session cookies set on `localhost:3000` don't propagate to `{slug}.localhost:3000`. For data needed by the org layout (which runs on the org subdomain), use public (no-auth) API endpoints:

- `GET /api/organizations/public/:slug/info` — org identity + branding (used by org layout)
- `GET /api/organizations/public/:slug/creators` — public creator list
- `GET /api/content/public?orgId=...` — published content (no auth)

The org layout (`_org/[slug]/+layout.server.ts`) calls `api.org.getPublicInfo(slug)` directly via `createServerApi` — not through a remote function — to avoid `query()` error propagation issues.

## Key Patterns

### SSR-Safe Live Queries

**Problem:** TanStack DB's `useLiveQuery` requires collections to exist, but our collections are `undefined` on the server (by design, to prevent cross-request data leaks in SSR/Cloudflare Workers).

**Solution:** Use the SSR-safe `useLiveQuery` wrapper from `$lib/collections`.

```svelte
<!-- +page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import {
    hydrateIfNeeded,
    libraryCollection,
    useLiveQuery,  // SSR-safe wrapper
  } from '$lib/collections';

  let { data } = $props();  // From +page.server.ts

  // Hydrate collection with server data on mount
  onMount(() => {
    if (data.library?.items) {
      hydrateIfNeeded('library', data.library.items);
    }
  });

  // Live query - works on both server and client
  const libraryQuery = useLiveQuery(
    (q) => q.from({ item: libraryCollection })
            .orderBy(({ item }) => item.progress?.updatedAt ?? '', 'desc'),
    undefined,  // deps (optional)
    { ssrData: data.library?.items }  // SSR fallback data
  );
</script>
```

**Flow:**
1. **Server (SSR)**: `useLiveQuery` returns static `ssrData` - no reactivity, no errors
2. **Client (onMount)**: `hydrateIfNeeded()` populates the local collection (localStorage for library, QueryClient for content)
3. **Client (after mount)**: `useLiveQuery` uses cached data - no refetch, stays reactive

**Files:**
- `$lib/collections/use-live-query-ssr.ts` - SSR-safe wrapper
- `$lib/collections/query-client.ts` - QueryClient (undefined on server)
- `$lib/collections/library.ts` - Example collection (undefined on server)

**If you need the unsafe version** (runs on server, will error): `useLiveQueryUnsafe`

### Page Data Loading Pattern

```typescript
// +page.server.ts - Server-side data fetch
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const library = await getUserLibrary(locals.session);
  return { library };
};
```

```svelte
<!-- +page.svelte - SSR-safe reactive data -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { hydrateIfNeeded, libraryCollection, useLiveQuery } from '$lib/collections';

  let { data } = $props();

  onMount(() => {
    if (data.library?.items) {
      hydrateIfNeeded('library', data.library.items);
    }
  });

  const libraryQuery = useLiveQuery(
    (q) => q.from({ item: libraryCollection }),
    undefined,
    { ssrData: data.library?.items }
  );
</script>
```

### Remote Functions

Calls to backend workers use the `$lib/remote` layer:

```typescript
import { getUserLibrary } from '$lib/remote/library.remote';

const result = await getUserLibrary({ limit: 10 });
```

**Structure:**
- `$lib/remote/*.remote.ts` - Typed remote function wrappers
- Uses `request()` from `$lib/server/api.ts` for fetch with auth

### Collection Mutations

Optimistic updates with automatic rollback on error:

```svelte
<script>
  import { updateProgress } from '$lib/collections';

  function handleTimeUpdate(e) {
    updateProgress(
      contentId,
      e.target.currentTime,
      e.target.duration
    );
  }
</script>
```

## Data Loading Strategy

When implementing a new page or feature, pick the right data loading approach based on the data's characteristics. **Do not mix strategies unnecessarily** — use the simplest one that fits.

### Decision Tree

```
Is this data user-specific and only needed for one page?
  YES → Server Load only (+page.server.ts)
        Examples: account profile, notification preferences, purchase history

Does the data need client-side reactivity (filtering, sorting, live updates)?
  YES → Is it user-owned and should survive refresh?
          YES → localStorage Collection (localStorageCollectionOptions)
                Examples: library, playback progress
          NO  → QueryClient Collection (queryCollectionOptions)
                Examples: content catalogue

Does the component need to write data back?
  Is it a form (progressive enhancement needed)?
    YES → Remote Function form() — works without JS, enhances with it
          Examples: profile update, notification prefs, Stripe portal
  Is it a fire-and-forget mutation?
    YES → Remote Function command()
          Examples: save playback progress
  Is it a cached read callable from components?
    YES → Remote Function query()
          Examples: listContent, getUserLibrary, getProfile
```

### Strategy Matrix

| Strategy | When to use | SSR | Offline | Reactive |
|---|---|---|---|---|
| **Server Load** (`+page.server.ts`) | Page-scoped data, auth guards, one-off fetches | Yes | No | No (static) |
| **Remote `query()`** | Reusable cached reads, callable from components or collections | Yes | No | Via collection |
| **Remote `query.batch()`** | List pages where each item needs extra data (N+1 prevention) | Yes | No | No |
| **Remote `form()`** | User input → server mutation with progressive enhancement | Yes | No | `.pending`/`.result` |
| **Remote `command()`** | Programmatic mutations (no form UI) | No | No | No |
| **localStorage Collection** | User-owned data, must survive refresh, offline value | Client | Yes | Yes |
| **QueryClient Collection** | Server-authoritative browsing data, session-scoped | Client | No | Yes |

### Typical Page Patterns

**Simple settings page** (account profile, notifications):
```
+page.server.ts  →  loads data via createServerApi()
+page.svelte     →  $props().data, form() for mutations
```
No collections needed. Server load provides data, remote `form()` handles saves.

**Browsable catalogue** (org content listing, discover page):
```
+page.server.ts     →  SSR fetch for first paint + SEO
+page.svelte        →  useLiveQuery(contentCollection, { ssrData })
                        onMount → hydrateIfNeeded('content', data.items)
content.remote.ts   →  query() feeds the collection's queryFn
```

**User library with offline progress**:
```
+layout.server.ts   →  version check (KV), depends('cache:versions')
+layout.svelte      →  $effect(versions) staleness → invalidateCollection
+page.svelte        →  useLiveQuery(libraryCollection, { ssrData })
progress-sync.ts    →  30s interval + visibility + sendBeacon
```

### Rules

1. **Server loads for auth gates and page data** — every `+page.server.ts` should check `locals.user` and redirect if needed
2. **Remote functions for all backend calls** — never call `fetch()` directly from components; always go through `$lib/remote/*.remote.ts` which uses `createServerApi()`
3. **Collections only when reactivity is needed** — don't create a collection just to display a list; use server load data directly
4. **One collection per domain concept** — don't create per-page collections; extend existing ones with filters via `useLiveQuery`
5. **localStorage collections need a reconciliation function** — `loadFromServer()` that upserts fresh items and removes stale ones (see `library.ts`)
6. **Version manifest for cross-device sync** — if data can change on another device, wire a version key through `+layout.server.ts` → `$effect` → `invalidateCollection`

## Caching & Version Invalidation

Four cache layers exist in the platform: **HTTP headers** (CDN/browser), **server KV** (`@codex/cache`), **client collections** (TanStack DB), and **client manifest** (localStorage versions). Frontend devs primarily work with HTTP headers and client-side invalidation. For server KV internals and TTL guidelines, see `docs/caching-strategy.md` and `packages/cache/CLAUDE.md`.

### HTTP Cache Headers

Use presets from `$lib/server/cache.ts` in `+page.server.ts` load functions:

| Preset | Value | Use when |
|---|---|---|
| `CACHE_HEADERS.STATIC_PUBLIC` | `public, max-age=3600, s-maxage=3600` | Public static pages (landing, marketing, about) |
| `CACHE_HEADERS.DYNAMIC_PUBLIC` | `public, max-age=300, s-maxage=300` | Public catalogue/browse pages (discover, org explore) |
| `CACHE_HEADERS.PRIVATE` | `private, no-cache` | Any authenticated/user-specific page |

```typescript
import { CACHE_HEADERS } from '$lib/server/cache';

export const load: PageServerLoad = async ({ setHeaders }) => {
  setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC);
  // ...
};
```

**Rule:** Default to `PRIVATE` for any page behind auth. Only use `STATIC_PUBLIC` or `DYNAMIC_PUBLIC` for unauthenticated public pages.

### Version Invalidation Lifecycle

1. Server `+layout.server.ts` reads versions from KV via `cache.getVersion()`, returns `{ versions }`. Must call `depends('cache:versions')`.
2. Client `$effect` calls `getStaleKeys(data.versions)` — diffs server versions against localStorage manifest.
3. Stale keys trigger `invalidateCollection()` for the affected collection.
4. `updateStoredVersions()` persists the new versions to localStorage.
5. Tab return (`visibilitychange`) fires `invalidate('cache:versions')` — re-runs server load — cycle repeats.
6. Backend workers bump versions via `cache.invalidate(id)` after DB writes.

```
Server KV ──versions──> +layout.server.ts ──data.versions──> $effect
                                                               |
                                          getStaleKeys() <─────┘
                                               |
                                     invalidateCollection()
                                               |
                                     updateStoredVersions()
                                               |
              visibilitychange ──invalidate('cache:versions')──> re-run server load
```

### Version Keys Reference

| Version key | Client manifest? | Bumped by | Client action on stale |
|---|---|---|---|
| `user:{userId}` | Yes | identity-api (profile/prefs update) | `invalidateCollection('library')` |
| `user:{userId}:library` | Yes | ecom-api (purchase completion) | `invalidateCollection('library')` |
| `content:published` | No (server KV only) | content-api (publish/unpublish) | SSR re-renders automatically |
| `org:{orgId}:content` | No (server KV only) | content-api (org content change) | SSR re-renders automatically |

**Rule:** Content catalogue versions are server-authoritative — don't add them to the client manifest.

### Server-Authoritative vs Cacheable

**Never cache client-side** (always fetch fresh from server):
- Auth/session state
- Access control decisions
- Purchase verification
- Prices and billing data
- Content legal status (takedowns, restrictions)

**Safe to cache client-side** (staleness for minutes is acceptable):
- User library (owned content list)
- Playback progress
- Content catalogue for browsing (title, description, thumbnails)

### Checklist: Wiring Version Invalidation

1. Choose or create a version key in `CacheType` (`packages/cache/src/cache-keys.ts`)
2. Bump the version in the backend worker after the DB write: `await cache.invalidate(id)`
3. Read the version in `+layout.server.ts` with `cache.getVersion()`, ensure `depends('cache:versions')` is called
4. Add a staleness branch in the layout `$effect`: `if (staleKeys.some(k => k.includes(':your-key'))) void invalidateCollection('your-collection')`
5. Implement `invalidateCollection()` handler in `hydration.ts` if needed for the new collection
6. Test: mutate data → return to tab → verify collection refreshes

### TTL Awareness

Server KV cache has TTLs (user: 5-15 min, org: 10-30 min, content: 5-10 min, access: 1-5 min). The `visibilitychange` pattern bypasses stale cache by re-reading version keys directly. See `packages/cache/CLAUDE.md` for full TTL guidelines.

## Architecture

### State Management Layers

| Layer | Purpose | SSR Safe |
|-------|---------|----------|
| `+page.server.ts` | Server data fetch | Yes |
| `useLiveQuery()` | Client reactivity | Yes (with ssrData) |
| `hydrateIfNeeded()` | Populate cache | Client only |
| Collection methods | Optimistic mutations | Client only |

### Collection Types

Two backing strategies for TanStack DB collections:

| Collection | Storage | Use when |
|---|---|---|
| `libraryCollection` | `localStorageCollectionOptions` | User-owned, must survive refresh, offline value |
| `progressCollection` | `localStorageCollectionOptions` | User-owned, must survive tab close |
| `contentCollection` | `queryCollectionOptions` | Server-authoritative, SSR is the primary source |

**Decision rule:** If staleness for a few minutes is acceptable and data belongs to the user → localStorage. If the server is always authoritative → QueryClient.

**Adding a new localStorage-backed collection:**
1. Create collection with `localStorageCollectionOptions({ storageKey: 'codex-{name}', getKey })` and a `browser` guard (see `library.ts`)
2. Add `loadFromServer()` reconciliation function — upsert fresh items, delete removed keys
3. In `hydration.ts`, add a branch for the new collection key in `hydrateCollection`, `isCollectionHydrated`, and `invalidateCollection`
4. To wire cross-device staleness: read its version key in `+layout.server.ts` and add a `staleKeys.some(k => k.includes('...'))` branch in the `$effect`

### Platform Layout Pattern

`(platform)/+layout.svelte` owns three cross-cutting concerns. **Do not duplicate these in child layouts.**

```typescript
// 1. Reactive staleness — re-runs whenever data.versions changes (after invalidate re-runs server load)
$effect(() => {
  const staleKeys = getStaleKeys(data.versions ?? {});
  if (staleKeys.some((k) => k.includes(':library'))) void invalidateCollection('library');
  updateStoredVersions(data.versions ?? {});
});

onMount(() => {
  // 2. Tab return → re-run server load → fresh versions → $effect fires again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void invalidate('cache:versions');
  });

  // 3. Progress sync — 30s flush + tab visibility + beforeunload beacon
  if (data.user?.id) initProgressSync(data.user.id);
  return () => cleanupProgressSync();
});
```

`+layout.server.ts` **must** have `depends('cache:versions')` for the `invalidate` call to trigger a re-run.

**Extending the staleness check for a new collection:**
1. Bump its version key in the relevant worker on mutation
2. Read that version in `+layout.server.ts`: `versions[CacheType.X(id)] = await cache.getVersion(...)`
3. Add detection branch to the `$effect`: `if (staleKeys.some(k => k.includes(':your-key'))) void invalidateCollection('your-collection')`

### Important Files

| Path | Purpose |
|------|---------|
| `$lib/collections/index.ts` | Barrel export for all collections |
| `$lib/collections/query-client.ts` | QueryClient (undefined on server) |
| `$lib/collections/use-live-query-ssr.ts` | SSR-safe useLiveQuery wrapper |
| `$lib/collections/hydration.ts` | SSR hydration utilities |
| `$lib/collections/library.ts` | localStorage-backed library collection; undefined on server |
| `$lib/client/version-manifest.ts` | Client version manifest — `getStaleKeys`, `updateStoredVersions` |
| `$lib/collections/progress-sync.ts` | Progress sync manager — 30s flush, beforeunload beacon |
| `$lib/collections/content.ts` | Content collection example |
| `$lib/remote/*.remote.ts` | Remote function wrappers |
| `$lib/server/api.ts` | Authenticated fetch wrapper |
| `$lib/server/cache.ts` | HTTP cache header presets (`CACHE_HEADERS`) |

## Development

- **Dev server**: `pnpm dev` (runs on port 3000)
- **Typecheck**: `pnpm typecheck`
- **E2E tests**: `pnpm test:e2e`
- **Unit tests**: `pnpm test`

## Key Gotchas

1. **Collections are undefined on server** - Always use `useLiveQuery` with `ssrData` option
2. **Don't destructure `useLiveQuery` results directly** - Svelte 5 reactivity requires using `$derived`:
   ```svelte
   <!-- Correct -->
   const query = useLiveQuery(...);
   // Access: query.data, query.isLoading

   <!-- Also correct -->
   const query = useLiveQuery(...);
   const { data, isLoading } = $derived(query);

   <!-- Wrong - loses reactivity -->
   const { data, isLoading } = useLiveQuery(...);
   ```

3. **QueryClient is per-browser-instance** - Not shared across requests (SSR safety)
4. **`hydrateIfNeeded` is a no-op on return visits for localStorage collections** — localStorage survives refresh, so `isCollectionHydrated` returns true before SSR data is inserted. Server data only enters the collection via `invalidateCollection`. This is intentional.
5. **`initProgressSync` lives only in `(platform)/+layout.svelte`** — do not call it again in nested layouts or pages.

## Related

- [TanStack DB Docs](https://tanstack.com/db/latest)
- [SvelteKit Docs](https://kit.svelte.dev)
- Caching architecture: `docs/caching-strategy.md`
- Server cache package: `packages/cache/CLAUDE.md`
- Main platform docs: `/CLAUDE.md`

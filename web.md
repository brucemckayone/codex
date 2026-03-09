# Web App (SvelteKit)

Frontend SvelteKit application for the Codex platform.
**Stack**: Svelte 5, SvelteKit, TanStack DB, Vite, Cloudflare Pages.

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

## Architecture

### State Management Layers

| Layer | Purpose | SSR Safe |
|-------|---------|----------|
| `+page.server.ts` | Server data fetch | ✅ Yes |
| `useLiveQuery()` | Client reactivity | ✅ Yes (with ssrData) |
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

## Development

- **Dev server**: `pnpm dev` (runs on port 3000)
- **Typecheck**: `pnpm typecheck`
- **E2E tests**: `pnpm test:e2e`
- **Unit tests**: `pnpm test`

## Key Gotchas

1. **Collections are undefined on server** - Always use `useLiveQuery` with `ssrData` option
2. **Don't destructure `useLiveQuery` results directly** - Svelte 5 reactivity requires using `$derived`:
   ```svelte
   <!-- ✅ Correct -->
   const query = useLiveQuery(...);
   // Access: query.data, query.isLoading

   <!-- ✅ Also correct -->
   const query = useLiveQuery(...);
   const { data, isLoading } = $derived(query);

   <!-- ❌ Wrong - loses reactivity -->
   const { data, isLoading } = useLiveQuery(...);
   ```

3. **QueryClient is per-browser-instance** - Not shared across requests (SSR safety)
4. **`hydrateIfNeeded` is a no-op on return visits for localStorage collections** — localStorage survives refresh, so `isCollectionHydrated` returns true before SSR data is inserted. Server data only enters the collection via `invalidateCollection`. This is intentional.
5. **`initProgressSync` lives only in `(platform)/+layout.svelte`** — do not call it again in nested layouts or pages.

## Related

- [TanStack DB Docs](https://tanstack.com/db/latest)
- [SvelteKit Docs](https://kit.svelte.dev)
- Main platform docs: `/CLAUDE.md`

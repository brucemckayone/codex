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
2. **Client (onMount)**: `hydrateIfNeeded()` populates QueryClient cache with server data
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

### Important Files

| Path | Purpose |
|------|---------|
| `$lib/collections/index.ts` | Barrel export for all collections |
| `$lib/collections/query-client.ts` | QueryClient (undefined on server) |
| `$lib/collections/use-live-query-ssr.ts` | SSR-safe useLiveQuery wrapper |
| `$lib/collections/hydration.ts` | SSR hydration utilities |
| `$lib/collections/library.ts` | Library collection example |
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

## Related

- [TanStack DB Docs](https://tanstack.com/db/latest)
- [SvelteKit Docs](https://kit.svelte.dev)
- Main platform docs: `/CLAUDE.md`

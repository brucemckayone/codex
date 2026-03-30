# Web App (SvelteKit)

Frontend SvelteKit application for the Codex platform.
**Stack**: Svelte 5, SvelteKit, TanStack DB, Vite, Cloudflare Pages.

## Strict Rules

### Components
- **MUST** use `$props()` rune with typed `Props` interface — NEVER Svelte 4 `export let`
- **MUST** use `$app/state` (`page`, `navigating`) — NEVER `$app/stores` (`$page`, `$navigating`)
- **MUST** use `$state()` for reactive primitives, `$derived()` for computed, `$effect()` for side effects
- **MUST** use `Snippet` type for content slots and `{@render children()}` to invoke them
- **MUST** extend HTML element types in Props (`HTMLButtonAttributes`, `HTMLInputAttributes`) when wrapping native elements

### Data & Caching
- **MUST** guard all collections with `browser` check — they are `undefined` on server
- **MUST** use `useLiveQuery()` with `ssrData` option for SSR safety — NEVER call `useLiveQuery` without it
- **MUST** hydrate collections in `onMount()` — NEVER before first client render
- **MUST** call `depends('cache:versions')` in layout server loads that participate in staleness
- **MUST** call `initProgressSync()` ONLY in `(platform)/+layout.svelte` — NEVER in nested layouts
- **NEVER** destructure `useLiveQuery` result directly — it loses reactivity. Use `query.data`, or `$derived(query)`
- **NEVER** call collection methods outside `onMount` or `$effect`

### Routing
- **MUST** keep paths root-relative on org subdomains — slug is in hostname, not URL path
- **MUST** use `buildOrgUrl()` for cross-org navigation — different org = different origin
- **NEVER** include route group names (`(platform)`, `(space)`, `(auth)`) in hrefs or `goto()`

### Styling
- **MUST** use design tokens for ALL CSS values — NEVER hardcode px, hex colors, or raw values
- **MUST** use spacing scale (`--space-1` through `--space-24`) — NEVER hardcode padding/margin

### API & Auth
- **MUST** use `createServerApi(platform, cookies)` for all backend calls — NEVER call `fetch()` directly
- **MUST** check `locals.user` in `+page.server.ts` for auth gates — NEVER trust client-side auth
- **MUST** use `getCookieConfig()` when deleting cookies — cross-subdomain cookies need matching `domain`
- **MUST** prefix sensitive form fields with `_` (e.g., `_password`) to prevent repopulation on error

### Currency
- Default currency is **GBP (£)**, not USD ($)

---

## Subdomain Routing

The platform uses subdomain-based routing via `src/hooks.ts` `reroute()`:

| Subdomain | Internal Route | Example |
|---|---|---|
| `lvh.me:3000` (none) | `(platform)/*` | Homepage, discover, library, account |
| `creators.lvh.me:3000` | `_creators/*` | Creator profiles, content catalogs |
| `{slug}.lvh.me:3000` | `_org/[slug]/*` | Org landing, explore, studio, settings |

> **Dev note:** Local dev uses `lvh.me` (a wildcard DNS resolving to 127.0.0.1) instead of `localhost` because browsers reject `Domain=.localhost` cookies per RFC 6761, breaking cross-subdomain auth.

### CRITICAL: No Slug in URL Paths

On org subdomains, the org slug is in the **hostname**, NOT the URL path. All `href`, `goto()`, `baseUrl` in `_org/` routes must use root-relative paths:

```svelte
<!-- CORRECT: paths are root-relative on org subdomains -->
<!-- e.g. on bruce-studio.lvh.me:3000 -->
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
- `bruce-studio.lvh.me:3000/explore` → `_org/bruce-studio/explore` → matches `(space)/explore/+page.svelte`
- `bruce-studio.lvh.me:3000/studio` → `_org/bruce-studio/studio` → matches `studio/+page.svelte`

**Exception:** Cross-org navigation (e.g., StudioSwitcher) needs full subdomain URLs since it navigates to a different origin.

**Route groups like `(space)` are filesystem-only** — never include them in rerouted paths or `href` values.

### Public Endpoints for Cross-Subdomain Data

For data needed by the org layout (which runs on the org subdomain), use public (no-auth) API endpoints. While `lvh.me` enables cross-subdomain cookie sharing in dev, public endpoints remain useful for unauthenticated visitors:

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

### API Client (`createServerApi`)

All backend calls go through `$lib/server/api.ts`:

```typescript
import { createServerApi } from '$lib/server/api';

// In +page.server.ts or remote functions
const api = createServerApi(platform, cookies);
const content = await api.content.get(id);
const library = await api.access.listLibrary(params);
```

**Key behaviors:**
- Resolves worker URLs via `getServiceUrl()` from `@codex/constants`
- Forwards session cookie in both `CODEX_SESSION` and `better-auth.session_token` headers
- **Envelope unwrapping**: `{ data: T }` → unwrapped to `T`, `{ items, pagination }` → returned as-is, 204 → `null`
- 10-second fetch timeout prevents hangs on cold workers
- **NEVER** encode cookies — JWT tokens use URL-safe base64, encoding corrupts them

### Remote Functions

Three types of remote functions in `$lib/remote/*.remote.ts`:

**`query()` — cached reads:**
```typescript
export const getContent = query(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.content.get(id);
});
// Usage: {#await getContent(id)} ... {:then content} ... {/await}
```

**`command()` — mutations without forms:**
```typescript
export const deleteContent = command(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  return createServerApi(platform, cookies).content.delete(id);
});
```

**`form()` — progressive enhancement:**
```typescript
export const createContentForm = form(createContentFormSchema, async (input) => {
  const { platform, cookies } = getRequestEvent();
  try {
    const result = await createServerApi(platform, cookies).content.create(input);
    return { success: true as const, contentId: result.id };
  } catch (error) {
    return { success: false as const, error: error.message };
  }
});
// Usage: <form {...createContentForm}> ... </form>
```

**Security note:** Prefix sensitive fields with `_` (e.g., `_password`) — they are NOT repopulated on validation failure.

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

## Styling Rules

**Never hardcode CSS values.** Always use design tokens from `$lib/styles/tokens/`:

```css
/* CORRECT — uses tokens */
border: var(--border-width) var(--border-style) var(--color-error-200);
background-color: var(--color-error-50);
padding: var(--space-3);
border-radius: var(--radius-md);

/* WRONG — hardcoded values */
border: 1px solid #fecaca;
background-color: #fef2f2;
padding: 12px;
border-radius: 8px;
```

Available border tokens: `--border-width` (1px), `--border-width-thick` (2px), `--border-style` (solid), `--border-default` (shorthand with `--color-border`).

Error/success alert pattern:
```css
.auth-error {
  padding: var(--space-3);
  background-color: var(--color-error-50);
  border: var(--border-width) var(--border-style) var(--color-error-200);
  border-radius: var(--radius-md);
  color: var(--color-error-700);
  font-size: var(--text-sm);
}
```

## Svelte 5 Standards

**Always use `$app/state` (runes), not `$app/stores` (legacy):**

```svelte
<!-- CORRECT — Svelte 5 runes -->
<script>
  import { page } from '$app/state';
  import { goto, invalidate } from '$app/navigation';

  // Access directly — no $ prefix
  const url = page.url;
  const params = page.params;
</script>

<!-- WRONG — Svelte 4 stores -->
<script>
  import { page } from '$app/stores';
  // $page.url — requires $ prefix, legacy pattern
</script>
```

**Always verify with MCPs:** Use the Svelte MCP (`mcp__svelte__get-documentation`) and Context7 MCP to check correct Svelte 5 / SvelteKit / Melt UI / TanStack DB usage. Don't guess — look it up.

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

## Layout Hierarchy & Responsibilities

The layout chain determines what each page inherits. **Never duplicate parent responsibilities in child layouts.**

```
+layout.svelte (root)
├── SkipLink, NavigationProgress, Toaster, view transitions
├── Passes data.user to all children
│
├── (platform)/+layout.svelte ★ CRITICAL ORCHESTRATOR
│   ├── PlatformHeader (sticky, UserMenu, MobileNav)
│   ├── PageContainer + Footer
│   ├── Version staleness $effect (getStaleKeys → invalidateCollection)
│   ├── visibilitychange → invalidate('cache:versions')
│   ├── initProgressSync(userId) — ONLY called here
│   └── Server load: depends('cache:versions'), reads KV library version
│
├── _org/[slug]/+layout.svelte
│   ├── Resolves org from subdomain slug (two-tier: public then auth endpoint)
│   ├── Applies org branding as CSS custom properties
│   ├── OrgHeader + org footer
│   ├── id="main-content" on <main> (skip link target)
│   └── Server load: org version keys, depends('cache:versions')
│       │
│       └── studio/+layout.svelte
│           ├── Auth guard (redirect to /login)
│           ├── Role guard (member → redirect to /?error=access_denied)
│           ├── StudioSidebar (role-based links) + StudioSwitcher
│           └── Server load: getMyMembership, getMyOrganizations
│               │
│               └── settings/+layout.svelte
│                   └── SETTINGS_NAV tabs (General, Branding)
│
├── (auth)/+layout.svelte
│   └── Centered card layout for login/register/forgot-pw/reset-pw/verify-email
│
└── _creators/+layout.svelte
    └── Creator subdomain layout (needs work — currently minimal)
```

**Rules:**
- `initProgressSync` lives ONLY in `(platform)/+layout.svelte`
- Version staleness check: platform layout does library, org layout does org-specific keys
- `depends('cache:versions')` MUST be in server loads that participate in staleness
- Each layout's `<main>` needs `id="main-content"` for the skip link

## Cookie Management

**CRITICAL:** Cross-subdomain cookies require `domain` when deleting. Always use `getCookieConfig()` for both setting AND deleting cookies:

```typescript
// CORRECT — matches the domain used when setting the cookie
import { COOKIES, getCookieConfig } from '@codex/constants';
const host = request.headers.get('host') ?? undefined;
const cookieConfig = getCookieConfig(platform?.env, host);
cookies.delete(COOKIES.SESSION_NAME, {
  path: cookieConfig.path,
  domain: cookieConfig.domain,
});

// WRONG — won't delete cross-subdomain cookies (domain mismatch)
cookies.delete(COOKIES.SESSION_NAME, { path: '/' });
```

The session cookie is set with `domain: .lvh.me` (dev) or `.revelations.studio` (prod). Deleting without the domain creates a new cookie on the bare hostname instead of removing the original.

## Component Patterns

### Props Pattern (Svelte 5)

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
    size?: 'sm' | 'md' | 'lg';
    loading?: boolean;
    children: Snippet;
  }

  const {
    variant = 'primary',
    size = 'md',
    loading = false,
    children,
    class: className,
    ...restProps
  }: Props = $props();
</script>

<button class="button {className ?? ''}" data-variant={variant} data-size={size} {...restProps}>
  {@render children()}
</button>
```

**Key rules:**
- Always define `Props` interface extending the HTML element type
- Use `$props()` for destructuring — required for reactivity
- Use `class: className` to accept class prop
- Spread `...restProps` to pass through HTML attributes
- Use `$bindable()` for two-way binding (e.g., input value)
- Use `Snippet<[T]>` for typed content slots

### Reactive State

```svelte
<script>
  let count = $state(0);                    // Reactive primitive
  const doubled = $derived(count * 2);      // Computed value
  $effect(() => { console.log(count); });   // Side effect
</script>
```

## Error Handling

### ErrorBoundary Component

```svelte
<ErrorBoundary fallback={snippet}>
  <ChildComponent />
</ErrorBoundary>
```

Uses `<svelte:boundary onerror={handler}>` internally. Logs errors with context.

### +error.svelte Pages

Each route group has its own `+error.svelte`:
- `(platform)/account/+error.svelte` — account-specific errors
- `_org/[slug]/+error.svelte` — org-level errors
- `_org/[slug]/studio/+error.svelte` — studio-specific errors
- `+error.svelte` (root) — catch-all

## Auth on Frontend

### Session Validation (every request)

`hooks.server.ts` validates the session cookie on every request:
```typescript
// Extracts codex-session cookie
// Calls auth worker GET /api/auth/session
// Sets event.locals.user and event.locals.session
// Fails gracefully — treats auth worker unavailable as unauthenticated
```

### Protected Routes

```typescript
// +page.server.ts
export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  return { user: locals.user };
};
```

### Role Guards (Studio)

```typescript
// studio/+layout.server.ts
export const load: LayoutServerLoad = async ({ locals, params }) => {
  if (!locals.user) throw redirect(303, '/login');
  const membership = await api.org.getMyMembership(params.slug);
  if (!membership) throw redirect(303, '/?error=access_denied');
  return { membership };
};
```

## Design Token Categories

NEVER hardcode CSS values. Use tokens from `$lib/styles/tokens/`:

| Category | Examples | Token Pattern |
|---|---|---|
| **Colors** | Primary, error, success, text, surface | `--color-primary-500`, `--color-error-50`, `--color-text` |
| **Spacing** | Padding, margin, gap | `--space-1` (4px) through `--space-24` |
| **Typography** | Font family, size, weight | `--font-sans`, `--text-sm`, `--font-medium` |
| **Borders** | Width, style, radius | `--border-width`, `--radius-md`, `--border-default` |
| **Shadows** | Box shadows | `--shadow-sm`, `--shadow-md` |
| **Transitions** | Animation timing | `--transition-colors`, `--transition-shadow` |
| **Z-index** | Stacking | `--z-sticky`, `--z-modal` |
| **Layout** | Container widths, breakpoints | `--layout-max-width`, `--breakpoint-md` |

### Org Branding

Org branding is injected as CSS custom properties in `_org/[slug]/+layout.svelte`:
```css
--org-brand-primary: var(--brand-primary-color);
--org-brand-density: var(--brand-density-scale, 1);
```

Density scaling affects all spacing tokens via `--space-unit: calc(0.25rem * var(--brand-density-scale, 1))`.

## Related

- [TanStack DB Docs](https://tanstack.com/db/latest)
- [SvelteKit Docs](https://kit.svelte.dev)
- Caching architecture: `docs/caching-strategy.md`
- Server cache package: `packages/cache/CLAUDE.md`
- Main platform docs: `/CLAUDE.md`

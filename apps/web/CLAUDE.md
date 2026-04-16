# Web App (SvelteKit)

Frontend SvelteKit application for the Codex platform.

**Stack:** Svelte 5.55, SvelteKit 2.55, TanStack DB 0.5 + svelte-db 0.1, Melt UI 0.86, Paraglide i18n, Vite 6, Cloudflare Pages adapter.

---

## Strict Rules

### Components
- **MUST** use `$props()` rune with typed `Props` interface — NEVER Svelte 4 `export let`
- **MUST** use `$app/state` (`page`, `navigating`) — NEVER `$app/stores` (`$page`, `$navigating`)
- **MUST** use `$state()` for reactive primitives, `$derived()` for computed, `$effect()` for side effects
- **MUST** use `Snippet` type for content slots and `{@render children()}` to invoke them
- **MUST** extend HTML element types in Props (`HTMLButtonAttributes`, etc.) when wrapping native elements

### Data & Caching
- **MUST** guard all collections with `browser` check — they are `undefined` on server
- **MUST** use `useLiveQuery()` (from `$lib/collections`) with `ssrData` option for SSR safety
- **MUST** hydrate collections in `onMount()` — NEVER before first client render
- **MUST** call `depends('cache:versions')` in platform layout server load; `depends('cache:org-versions')` in org layout server load
- **MUST** call `initProgressSync()` ONLY once per layout tree — called in both `(platform)/+layout.svelte` and `_org/[slug]/+layout.svelte`
- **NEVER** destructure `useLiveQuery` result directly — loses reactivity. Use `query.data` or `const { data } = $derived(query)`

### Routing
- **MUST** use root-relative paths on org subdomains — slug is in hostname, not URL path
- **MUST** use `buildContentUrl(page.url, content)` for content links — handles cross-org subdomain routing
- **MUST** use `buildOrgUrl()` for cross-org navigation — different org = different origin
- **NEVER** include route group names (`(platform)`, `(space)`, `(auth)`) in hrefs or `goto()`

### Styling
- **MUST** use design tokens for ALL CSS — NEVER hardcode px, hex, or raw values
- **MUST** use spacing scale (`--space-1` through `--space-24`)

### API & Auth
- **MUST** use `createServerApi(platform, cookies)` for all backend calls in server-side code
- **MUST** check `locals.user` in `+page.server.ts` for auth gates
- **MUST** use `getCookieConfig()` when deleting cookies — cross-subdomain cookies need matching `domain`
- **MUST** prefix sensitive form fields with `_` (e.g., `_password`) to prevent repopulation on error

---

## Routing Structure

Subdomain routing via `src/hooks.server.ts`:

| Host | Internal Route | Notes |
|---|---|---|
| `lvh.me:3000` | `(platform)/*` | Homepage, discover, library, account |
| `{slug}.lvh.me:3000` | `_org/[slug]/*` | Org space, studio, settings |
| `creators.lvh.me:3000` | `_creators/[username]/*` | Creator profiles |

> **Dev note:** Use `lvh.me` (resolves to 127.0.0.1) not `localhost` — browsers reject `Domain=.localhost` cookies per RFC 6761.

### Route tree

```
src/routes/
├── +layout.svelte             Root — SkipLink, NavigationProgress, Toaster, view transitions,
│                              cross-subdomain auth sync (visibilitychange → invalidate('app:auth'))
├── +layout.server.ts          depends('app:auth'), returns { user }
│
├── (platform)/                Platform routes (no subdomain)
│   ├── +layout.svelte         SidebarRail, PageContainer, Footer, version staleness $effect,
│   │                          visibilitychange → invalidate('cache:versions'), initProgressSync
│   ├── +layout.server.ts      depends('cache:versions'), reads library version from KV
│   ├── +page                  Platform homepage
│   ├── discover/              Browse content across all orgs
│   ├── library/               User's purchased/free content
│   ├── account/               Profile, notifications, purchases
│   ├── pricing/
│   ├── about/
│   └── become-creator/
│
├── _org/[slug]/               Org subdomain routes
│   ├── +layout.svelte         Org branding injection, BrandEditorPanel,
│   │                          ShaderHero fullpage canvas, SidebarRail/MobileNav,
│   │                          version staleness $effect, initProgressSync
│   ├── +layout.server.ts      depends('cache:org-versions'), public org info, streams
│   │                          versions/subscriptionContext/isFollowing
│   ├── (space)/               Public org pages
│   │   ├── +page              Org landing
│   │   ├── explore/           Content catalogue
│   │   ├── content/[slug]/    Content detail + player
│   │   ├── creators/          Creator list
│   │   ├── library/           User's org library
│   │   ├── pricing/
│   │   └── checkout/success/
│   └── studio/                Creator studio (ssr=false — client SPA)
│       ├── +layout.ts         export const ssr = false
│       ├── +layout.server.ts  Auth guard, role guard (creator/admin/owner), membership
│       ├── +page              Dashboard
│       ├── content/           Content list + new + edit/[id]
│       ├── media/             Media library
│       ├── analytics/
│       ├── customers/
│       ├── team/
│       ├── billing/
│       ├── monetisation/
│       └── settings/          General, Branding, Email Templates
│
├── (auth)/                    Auth pages — centered card layout
│   ├── login/, register/, forgot-password/, reset-password/, verify-email/
│
├── _creators/[username]/      Creator subdomain
│
├── api/                       SvelteKit API routes
│   ├── health/
│   ├── progress-beacon/       sendBeacon endpoint for tab-close progress flush
│   └── search/
│
└── logout/, unsubscribe/[token]/
```

### CRITICAL: No Slug in URL Paths

On org subdomains, the slug is in the **hostname**. All paths must be root-relative:

```svelte
<!-- CORRECT — on bruce-studio.lvh.me:3000 -->
<a href="/">Home</a>
<a href="/explore">Explore</a>
<a href="/studio/content">Content</a>
goto('/studio/analytics?dateFrom=...')

<!-- WRONG — slug is already in hostname -->
<a href="/{orgSlug}/studio">Studio</a>
```

Rerouting: `bruce-studio.lvh.me:3000/explore` → `_org/bruce-studio/(space)/explore/+page.svelte`

**Exception:** StudioSwitcher and other cross-org navigation uses `buildOrgUrl()` since it targets a different origin.

**Content links:** Always `buildContentUrl(page.url, content)` from `$lib/utils/subdomain.ts`.

---

## State Management

### Collections

Three collections in `src/lib/collections/`:

| Collection | Storage | Key | Use case |
|---|---|---|---|
| `libraryCollection` | `localStorage` (`codex-library`) | `content.id` | User's purchased/free content — survives refresh |
| `progressCollection` | `localStorage` (`codex-playback-progress`) | `contentId` | Playback position — survives tab close |
| `contentCollection` | QueryClient (session) | `['content']` | Browsable catalogue — server-authoritative |

All three are `undefined` on the server. Always guard with `browser` or use `useLiveQuery` with `ssrData`.

### SSR-Safe Live Queries

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { hydrateIfNeeded, libraryCollection, useLiveQuery } from '$lib/collections';

  let { data } = $props();

  onMount(() => {
    if (data.library?.items) hydrateIfNeeded('library', data.library.items);
  });

  const libraryQuery = useLiveQuery(
    (q) => q.from({ item: libraryCollection }).orderBy(({ item }) => item.progress?.updatedAt, 'desc'),
    undefined,
    { ssrData: data.library?.items }
  );
  // Access: libraryQuery.data, libraryQuery.isLoading
  // Or: const { data: items } = $derived(libraryQuery);
</script>
```

**Flow:** SSR returns `ssrData` statically → `onMount` calls `hydrateIfNeeded()` → live query switches to collection reactivity.

**`hydrateIfNeeded` is a no-op on return visits** for localStorage collections — localStorage already has data, so `isCollectionHydrated` returns true. Server data only enters via `invalidateCollection`.

### Adding a New localStorage Collection

1. Create collection with `localStorageCollectionOptions({ storageKey: 'codex-{name}', getKey })` and a `browser` guard (see `library.ts`)
2. Add `loadFromServer()` reconciliation — upsert fresh items, delete removed keys
3. In `hydration.ts`: add a branch for the new collection key in `hydrateCollection`, `isCollectionHydrated`, and `invalidateCollection`
4. To wire cross-device staleness: read its version key in the appropriate layout server load and add a `staleKeys.some(...)` branch in the `$effect`

### Progress Sync

`initProgressSync(userId)` is called in both `(platform)/+layout.svelte` and `_org/[slug]/+layout.svelte` (when `data.user?.id` exists). It manages:
- 2-minute periodic flush to server
- Sync on tab visibility change
- `beforeunload` sendBeacon to `/api/progress-beacon`

`forceSync()` is called in `beforeNavigate` to flush progress before server loads run.

---

## Version-Based Cache Invalidation

### Platform layout pattern

```
Server KV ──versions──> +layout.server.ts ──data.versions──> $effect
                         depends('cache:versions')             |
                                                    getStaleKeys() → invalidateCollection()
                                                               |
                                                    updateStoredVersions()
                                                               |
         visibilitychange → invalidate('cache:versions') ──> re-run load
```

**Platform layout** tracks `user:{id}:library`. **Org layout** tracks `org:{id}:config` and `org:{id}:content`. Both layouts call `initProgressSync` independently since each is a separate route tree.

The org layout uses `invalidate('cache:org-versions')` (separate from platform's `'cache:versions'`) and has a 60-second cooldown to prevent hammering.

### Version Keys

| Key | Who bumps it | Client action on stale |
|---|---|---|
| `collection:user:{id}:library` | ecom-api (purchase) | `invalidateCollection('library')` |
| `org:{id}:config` | identity-api (branding save) | `invalidateCollection('content')` |
| `collection:org:{id}:content` | content-api (publish/unpublish) | `invalidateCollection('content')` |

### HTTP Cache Headers

From `$lib/server/cache.ts`:

```typescript
import { CACHE_HEADERS } from '$lib/server/cache';
setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC);   // Public catalogue pages: 5 min
setHeaders(CACHE_HEADERS.STATIC_PUBLIC);    // Static pages: 1 hour
setHeaders(CACHE_HEADERS.PRIVATE);          // Auth pages: no-cache (default for studio)
```

---

## API Client

### `createServerApi(platform, cookies)` — `$lib/server/api.ts`

All backend calls go through this in `+page.server.ts` and remote functions.

```typescript
const api = createServerApi(platform, cookies);
const content = await api.content.list(params);
const org = await api.org.getPublicInfo(slug);
```

**Key behaviours:**
- Resolves worker URLs via `getServiceUrl()` from `@codex/constants`
- Forwards session cookie as both `CODEX_SESSION` and `better-auth.session_token`
- **NEVER** encode cookie values — JWT tokens use URL-safe base64; encoding corrupts them
- Unwraps procedure envelopes: `{ data: T }` → `T`, `{ items, pagination }` → as-is, 204 → `null`
- 10-second fetch timeout with `AbortController`
- Throws `ApiError` (from `$lib/server/errors.ts`) on non-2xx

### API namespaces

| Namespace | Worker | Key methods |
|---|---|---|
| `api.auth` | auth | `getSession()` |
| `api.account` | identity | `getProfile()`, `updateProfile()`, `uploadAvatar()` |
| `api.content` | content | `list()`, `get()`, `create()`, `update()`, `publish()`, `getPublicContent()`, `getDiscoverContent()` |
| `api.access` | content/access | `getStreamingUrl()`, `getUserLibrary()`, `saveProgress()` |
| `api.org` | org | `getPublicInfo()`, `getPublicCreators()`, `getMyMembership()`, `getMembers()`, `follow()` |
| `api.checkout` | ecom | `create()`, `verify()`, `createPortalSession()` |
| `api.subscription` | ecom | `getCurrent()`, `checkout()`, `cancel()`, `getSubscribers()` |
| `api.tiers` | org | `list()`, `create()`, `update()`, `reorder()` |
| `api.connect` | ecom | `onboard()`, `getStatus()`, `getDashboardLink()` |
| `api.analytics` | admin | `getDashboardStats()`, `getRevenue()`, `getTopContent()` |
| `api.admin` | admin | `getCustomers()`, `getActivity()`, `getCustomerDetail()`, `grantContentAccess()` |
| `api.media` | content/media | `list()`, `create()`, `upload()`, `uploadComplete()`, `transcodingStatus()` |

### Remote Functions — `$lib/remote/*.remote.ts`

Three types, all import from `$app/server` and use `getRequestEvent()`:

```typescript
// query() — cached reads, can be awaited in templates or used in collections
export const getContent = query(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  return createServerApi(platform, cookies).content.get(id);
});

// command() — mutations without a form
export const deleteContent = command(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  return createServerApi(platform, cookies).content.delete(id);
});

// form() — progressive enhancement (works without JS)
export const createContentForm = form(schema, async (input) => {
  const { platform, cookies } = getRequestEvent();
  try {
    const result = await createServerApi(platform, cookies).content.create(input);
    return { success: true as const, contentId: result.id };
  } catch (error) {
    return { success: false as const, error: error.message };
  }
});
```

Available remote modules: `account`, `admin`, `auth`, `avatar-delete`, `avatar-upload`, `billing`, `branding`, `checkout`, `content`, `library`, `media`, `org`, `settings`, `subscription`.

---

## Org Branding

Org branding is applied in `_org/[slug]/+layout.svelte` as inline CSS custom properties on `.org-layout`:

```
--brand-color          primary hex
--brand-secondary      secondary hex
--brand-accent         accent hex
--brand-bg             background hex
--brand-density        numeric (default 1)
--brand-radius         rem value (e.g. 0.5rem)
--brand-font-body      Google Font name + fallback
--brand-font-heading   Google Font name + fallback
--brand-shadow-scale   fine-tune shadow multiplier
--brand-text-scale     fine-tune text size multiplier
...etc
```

The `[data-org-brand]` attribute gates the CSS selectors in `org-brand.css` that activate these overrides. A full OKLCH-derived colour palette is computed from `--brand-color` via relative colour syntax in the CSS file.

Hero visibility toggles (stats, pills, description, logo, title) are stored as `tokenOverrides` JSON in branding settings and applied as `data-hero-hide-*` attributes. All hero visibility CSS keys live under `tokenOverrides`.

**Token overrides** (shader preset, custom CSS vars, hero toggles) are stored as JSON string in `branding_settings.tokenOverrides`, parsed and injected via `injectTokenOverrides(el, overrides)` from `$lib/brand-editor/css-injection.ts`.

### Brand Editor

A floating panel activated by `?brandEditor` URL param. State is managed in `$lib/brand-editor/brand-editor-store.svelte.ts` using module-level Svelte 5 runes (`$state`, `$derived`). Live CSS injection runs via `$effect` — no React-style state lifting needed.

`brandEditor.open(orgId, savedState)` / `brandEditor.close()` / `brandEditor.getSavePayload()` / `brandEditor.markSaved()`

The panel is rendered OUTSIDE `.org-layout` so it uses system tokens unaffected by org branding.

---

## Layout Hierarchy

```
+layout.svelte (root)
└── (platform)/+layout.svelte      ★ SidebarRail, PageContainer, Footer
│   └── depends('cache:versions')   version staleness + initProgressSync
│
└── _org/[slug]/+layout.svelte      ★ Org branding, ShaderHero, BrandEditorPanel
    └── depends('cache:org-versions') version staleness + initProgressSync
    │
    └── studio/+layout.svelte        ssr=false, auth+role guard
        └── depends('cache:studio')

└── (auth)/+layout.svelte            Centered card layout
└── _creators/+layout.svelte         Creator subdomain
```

**Never duplicate parent responsibilities** in child layouts:
- `initProgressSync` is called in BOTH platform and org layouts (they are separate route trees with independent lifecycles)
- `depends('cache:versions')` lives in platform layout; `depends('cache:org-versions')` in org layout
- Studio layout calls `depends('cache:studio')` to prevent re-running on every sub-page navigation

---

## Data Loading Strategy

| Strategy | When to use | SSR | Reactive |
|---|---|---|---|
| `+page.server.ts` load | Page-scoped data, auth guards | Yes | No |
| Remote `query()` | Reusable cached reads callable from components | Yes | Via collection |
| Remote `form()` | User input with progressive enhancement | Yes | `.pending`/`.result` |
| Remote `command()` | Programmatic mutations | No | No |
| localStorage collection | User-owned, must survive refresh | Client | Yes |
| QueryClient collection | Server-authoritative browsing | Client | Yes |

**Shell + Stream pattern** — await critical data, stream secondary:

```typescript
// +page.server.ts
export const load: PageServerLoad = async ({ parent }) => {
  const { org } = await parent();
  const content = await getPublicContent({ orgId: org.id, limit: 6 });  // Await: critical for SEO
  return {
    newReleases: content?.items ?? [],
    creators: getCreators({ slug: org.slug })                            // Stream: skeleton → data
      .then(r => ({ items: r?.items ?? [], total: r?.pagination?.total ?? 0 }))
      .catch(() => ({ items: [], total: 0 })),                           // MUST .catch() on every promise
  };
};
```

```svelte
{#await data.creators}
  <CreatorsSkeleton />
{:then creators}
  <CreatorsSection items={creators.items} />
{/await}
```

**Rules:**
- `.catch()` on every returned promise — unhandled rejections crash the server
- Await data needed for SEO (`<svelte:head>`) and page structure
- Streaming only works in `+page.server.ts`, NOT universal `+page.ts`

---

## Component Library

**Location:** `src/lib/components/`

| Directory | Purpose |
|---|---|
| `ui/` | Shared primitives — Button, Card, Badge, Dialog, Input, Select, Toast, Tabs, etc. |
| `layout/` | SidebarRail, Header, MobileNav (MobileBottomNav, MobileBottomSheet), StudioSidebar |
| `brand-editor/` | Floating brand editor panel + level components |
| `content/` | ContentCard, content viewers |
| `VideoPlayer/` | HLS video player with cinema mode |
| `AudioPlayer/` | Audio player + ImmersiveShaderPlayer |
| `editor/` | Rich text editor (Tiptap) |
| `search/` | CommandPaletteSearch |
| `seo/` | SEO meta helpers |
| `studio/` | Studio-specific components |
| `ui/ShaderHero/` | WebGL shader background (GLSL presets, audio-reactive) |

Components use Melt UI headless primitives. Always check `$lib/components/ui/index.ts` barrel for available exports before creating a new primitive.

---

## Design Tokens

**Location:** `src/lib/styles/tokens/`

| File | Token prefix | Examples |
|---|---|---|
| `colors.css` | `--color-*` | `--color-primary-500`, `--color-text`, `--color-surface-secondary` |
| `spacing.css` | `--space-*` | `--space-1` (4px) … `--space-24` |
| `typography.css` | `--font-*`, `--text-*` | `--font-sans`, `--text-sm`, `--font-medium` |
| `borders.css` | `--border-*`, `--radius-*` | `--border-width`, `--border-default`, `--radius-md` |
| `shadows.css` | `--shadow-*` | `--shadow-sm`, `--shadow-md` |
| `motion.css` | `--transition-*` | `--transition-colors`, `--transition-shadow` |
| `z-index.css` | `--z-*` | `--z-sticky`, `--z-modal` |
| `layout.css` | `--container-*`, breakpoint media | `--container-max`, `@media (--below-md)` |
| `materials.css` | `--blur-*` | `--blur-2xl` |

**Never hardcode CSS values.** Example:
```css
/* CORRECT */
border: var(--border-width) var(--border-style) var(--color-error-200);
padding: var(--space-3);
border-radius: var(--radius-md);

/* WRONG */
border: 1px solid #fecaca;
padding: 12px;
```

---

## Auth on the Frontend

`hooks.server.ts` runs three hooks in sequence:
1. `sessionHook` — validates `codex-session` cookie against auth worker, sets `locals.user`, `locals.session`, `locals.userId`
2. `securityHook` — applies security headers (`X-Frame-Options`, `X-Content-Type-Options`, etc.)
3. `cdnRewriteHook` — dev-only: rewrites `localhost:4100` CDN URLs to `nip.io` for LAN mobile access

Session validation fails gracefully — auth worker unavailable = treat as unauthenticated.

**Protecting a route:**
```typescript
// +page.server.ts
export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  return { user: locals.user };
};
```

**Cookie deletion** — always use `getCookieConfig()`:
```typescript
import { getCookieConfig } from '@codex/constants';
const cookieConfig = getCookieConfig(platform?.env, request.headers.get('host') ?? undefined);
cookies.delete(COOKIES.SESSION_NAME, { path: cookieConfig.path, domain: cookieConfig.domain });
```

**Cross-subdomain auth sync:** Root layout detects `codex-session` cookie appearance/disappearance on tab return (login/logout on another subdomain) and calls `invalidate('app:auth')`.

---

## Error Handling

- Each route group has its own `+error.svelte`: `(platform)/account/`, `_org/[slug]/`, `_org/[slug]/studio/`, and root
- `ErrorBoundary.svelte` uses `<svelte:boundary onerror>` for component-level boundaries
- `$lib/server/errors.ts` exports `ApiError` — thrown by `createServerApi` on non-2xx responses

---

## i18n

Paraglide (`@inlang/paraglide-sveltekit`). Messages imported as:
```typescript
import * as m from '$paraglide/messages';
// Usage: m.footer_powered_by({ platform: m.footer_powered_by_platform() })
```

---

## Important Files

| Path | Purpose |
|---|---|
| `src/hooks.server.ts` | Session validation, security headers, CDN rewrite |
| `src/lib/server/api.ts` | `createServerApi` — all backend calls |
| `src/lib/server/cache.ts` | `CACHE_HEADERS` presets + `invalidateCache()` |
| `src/lib/server/errors.ts` | `ApiError` class |
| `src/lib/collections/index.ts` | Barrel — collections, hydration, live query |
| `src/lib/collections/hydration.ts` | `hydrateIfNeeded`, `invalidateCollection`, `isCollectionHydrated` |
| `src/lib/collections/library.ts` | localStorage library collection |
| `src/lib/collections/progress.ts` | localStorage progress collection |
| `src/lib/collections/progress-sync.ts` | `initProgressSync`, `forceSync`, `cleanupProgressSync` |
| `src/lib/collections/use-live-query-ssr.ts` | SSR-safe `useLiveQuery` wrapper |
| `src/lib/client/version-manifest.ts` | `getStaleKeys`, `updateStoredVersions`, `clearClientState` |
| `src/lib/brand-editor/` | Brand editor store, CSS injection, palette generator, presets |
| `src/lib/utils/subdomain.ts` | `buildContentUrl`, `buildOrgUrl` |
| `src/lib/remote/*.remote.ts` | Remote function wrappers |

---

## Development

- **Dev server:** `pnpm dev` from monorepo root (port 3000, `lvh.me`)
- **Typecheck:** `pnpm typecheck`
- **Unit tests:** `pnpm test`
- **E2E tests:** `pnpm test:e2e`
- **Local dev uses `lvh.me`** — wildcard DNS to 127.0.0.1 for cross-subdomain cookie support
- **Local CDN:** dev-cdn worker on port 4100 (Miniflare R2) — never use external placeholder images

## Related Docs

- Caching architecture: `docs/caching-strategy.md`
- Cache package: `packages/cache/CLAUDE.md`
- Root platform docs: `CLAUDE.md`

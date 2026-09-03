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
│   ├── +layout.svelte         Org branding injection + inert live-preview bridge
│   │                          (no editor UI), ShaderHero fullpage canvas,
│   │                          SidebarRail/MobileNav, version staleness $effect,
│   │                          initProgressSync
│   ├── +layout.server.ts      depends('cache:org-versions'), public org info, streams
│   │                          versions/subscriptionContext/isFollowing
│   ├── (space)/               Public org pages
│   │   ├── +page              Org landing
│   │   ├── explore/           Content catalogue
│   │   ├── content/[slug]/    Content detail + player
│   │   ├── creators/          Creator list
│   │   ├── library/           User's org library
│   │   ├── pricing/
│   │   ├── journeys/         Public journey sell pages (/journeys/[slug])
│   │   ├── subscription/
│   │   └── checkout/success/
│   └── studio/                Creator studio (ssr=false — client SPA)
│       ├── +layout.ts         export const ssr = false
│       ├── +layout.server.ts  Auth guard, role guard (creator/admin/owner), membership
│       ├── +page              Dashboard
│       ├── content/           Content list + new + edit/[id]
│       ├── media/             Media library
│       ├── journeys/          Journey builder (page-builder canvas)
│       ├── analytics/
│       ├── customers/
│       ├── team/
│       ├── billing/
│       ├── monetisation/
│       ├── payouts/
│       ├── sales/
│       ├── subscribers/
│       ├── categories/
│       ├── brand/             Unified brand editor — two-pane workspace (control
│       │                      rail + live-preview iframe), admin/owner-gated
│       └── settings/          General, Email Templates (Branding 301-redirects
│                              to /studio/brand)
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

Five collections in `src/lib/collections/` (library, progress, content, subscription, dismissals):

| Collection | Storage | Key | Use case |
|---|---|---|---|
| `libraryCollection` | `localStorage` (`codex-library`) | `content.id` | User's purchased/free content — survives refresh |
| `progressCollection` | `localStorage` (`codex-playback-progress`) | `contentId` | Playback position — survives tab close |
| `getContentCollection(orgId)` | QueryClient (per-org) | `['content', orgId]` | Browsable catalogue — server-authoritative, org-scoped to prevent cross-org cache leakage |
| `subscriptionCollection` | `localStorage` | `organizationId` | Per-org subscription state |
| `dismissalCollection` | `localStorage` | caller key | Dismissed UI banners |

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
- `pagehide` sendBeacon to `/api/progress-beacon` (deliberately NOT `beforeunload` — registering any beforeunload listener disables bfcache)

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

**Platform layout** tracks `user:{id}:library`. **Org layout** tracks `org:{id}:content` plus, when signed in, `user:{id}:library` and `user:{id}:subscription:{orgId}` — it no longer reads `org:{id}:config` (dead key, removed in Codex-kgrdp.6; the org worker bumps `cache:version:{slug}` instead). Both layouts call `initProgressSync` independently since each is a separate route tree.

The org layout uses `invalidate('cache:org-versions')` (separate from platform's `'cache:versions'`) and has a 60-second cooldown to prevent hammering.

### Version Keys

| Key | Who bumps it | Client action on stale |
|---|---|---|
| `user:{id}:library` | ecom-api (purchase) | `invalidateCollection('library')` |
| `org:{id}:content` | content-api (publish/unpublish) | `invalidateCollection({ kind: 'content', orgId })` |
| `user:{id}:subscription:{orgId}` | ecom-api (checkout/tier change/cancel) | `invalidateCollection('subscription')` |

### HTTP Cache Headers

**The values do not live in apps/web.** They live in `CACHE_PRESETS`
(`packages/constants/src/limits.ts`), one paragraph of reasoning each, because a
Worker has to be able to declare the same vocabulary and cannot import
`$lib/server/cache.ts`. `CACHE_HEADERS` is only a `setHeaders()`-shaped view of
that object, and `src/lib/server/cache.test.ts` asserts the pairing byte for
byte. **Never re-type a `Cache-Control` string** — the CI gate
`scripts/checks/check-data-access-contract.mjs` fails the build on a
hand-written one, and it has no waivers by design. If you need a window the
vocabulary does not have, add a preset with its reasoning.

```typescript
import { CACHE_HEADERS } from '$lib/server/cache';
setHeaders(CACHE_HEADERS.PRIVATE);          // the answer for almost every page here
setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC);   // body IDENTICAL for every viewer
setHeaders(CACHE_HEADERS.PER_VIEWER);       // body MAY differ per viewer
```

| `CACHE_HEADERS` | preset | emits | use when |
|---|---|---|---|
| `DYNAMIC_PUBLIC` | `public` | `public, max-age=60, s-maxage=60` | every viewer gets the same bytes |
| `STATIC_PUBLIC` | `static` | 1h browser + 1h CDN + 1d SWR | **crawlers only** — no human reads it |
| `PER_VIEWER` | `per-viewer` | `public, max-age=0, no-cache` | may differ per viewer; a shared cache may store but MUST revalidate |
| `PRIVATE` | `private` | `private, no-cache` | the viewer's own browser only |
| `FRESH` | `fresh` | `private, no-store` | per-REQUEST bodies (embeds a short-lived credential) |

`CACHE_PRESETS.asset` (`public, max-age=3600, s-maxage=86400`) has no
`CACHE_HEADERS` entry: its only apps/web consumer is `$lib/server/cdn-proxy.ts`,
which writes onto a `Headers` instance rather than through `setHeaders()`.

**`STATIC_PUBLIC` is not "static pages".** Its window outlives every
invalidation path this platform has — a publish is invisible for up to an hour,
and the `stale-while-revalidate=86400` day has no purge path. It is licensed by
its READERS, not by a shorter number: the two `sitemap.xml` routes, read by
crawlers on their own multi-hour cadence, name `CACHE_PRESETS.static` directly.
Never put it on a page a human loads.

**Rule (MANDATORY):** any preset whose value begins `public` —
`DYNAMIC_PUBLIC`, `STATIC_PUBLIC`, `PER_VIEWER` — MUST be set only AFTER every
`await` that could throw has succeeded. SvelteKit applies headers set in a load
to error responses too, so `setHeaders(...)` followed by a thrown `error(404)`
or a rejected `await` hands the 4xx/5xx body the preset's own window: 60s of CDN
storage for `DYNAMIC_PUBLIC`, and an hour plus a day of SWR for `STATIC_PUBLIC`.
Every subsequent visitor is served the error page (cache poisoning).

`CACHE_HEADERS.PRIVATE` and `.FRESH` are safe to set anywhere, including before
an await that can throw — `private, no-cache` is exactly what an error response
should carry. Nothing in apps/web sets a default `Cache-Control`, so a load that
sets nothing emits none of ours; that is why nearly every load here calls
`PRIVATE` explicitly rather than relying on absence.

Correct pattern:

```typescript
export const load: PageServerLoad = async ({ setHeaders, ... }) => {
  const data = await thingThatCanThrow();
  // Awaits BEFORE setHeaders. If they throw, the error response inherits
  // no Cache-Control of ours — never a `public` window.
  setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC);
  return { data };
};
```

For loaders with multiple return paths (auth-aware pages, content detail),
hoist the chosen preset into a `successCacheHeaders` const and call
`setHeaders(successCacheHeaders)` immediately before each `return`. See
`apps/web/src/routes/_org/[slug]/(space)/content/[contentSlug]/+page.server.ts`
for the canonical pattern.

### Why `DYNAMIC_PUBLIC_REVALIDATE` was DELETED, not renamed

It was `public, max-age=0, s-maxage=300, stale-while-revalidate=3600`, and it
was added in good faith to fix exactly this bug — the name says "revalidate".
It fixed half of it.

`max-age=0` binds the BROWSER. `s-maxage=300` binds a SHARED cache, and it does
not say "revalidate" — it says "this body is fresh for 300 seconds, serve it to
anyone who asks for this URL". **Shared caches key on URL and NEVER on Cookie.**
So an anonymous render stored during one visit was handed to the next
authenticated visitor: the platform landing page showed a Sign In link to a
signed-in user, and the `stale-while-revalidate=3600` extended that by an hour
with no purge path. CI reproduced it deterministically on 2026-05-28 —
miniflare's CF cache emulation honours `s-maxage` for HTML by URL key alone.
The record is at the top of `src/routes/(platform)/+page.server.ts`.

It was deleted rather than renamed because **the value has no safe form.** A
name cannot make a shared window per-viewer; the only fix is to stop declaring
one. Its replacement is `PER_VIEWER`, which drops `s-maxage` entirely and leans
on `no-cache`: RFC 9111 lets a shared cache STORE a `no-cache` body but forbids
serving it to another request without revalidating at the origin, so an
anonymous burst is still absorbed as 304s while a signed-in viewer always gets
their own body. If you are unsure whether a page varies by viewer, use
`PRIVATE`.

**Never write an `s-maxage` onto a response that can vary by viewer.** That is
the whole rule, and it is a reproduced leak in this repo, not a theory. Guards:
`cache.test.ts` here, `cache-presets.test.ts` in `@codex/constants`, and the
drift gate for any hand-written string.

### `variesBySession`, and the auth-to-preset table (Workers)

Worker routes declare `policy.cache` on `procedure()` and the TYPE SYSTEM
rejects the illegal pairings — `auth: 'required'` with `cache: 'public'` does
not compile (`CachePolicyRule`, `packages/worker-utils/src/procedure/types.ts`).
Undeclared resolves to `private`, so saying nothing is safe.

| `policy.auth` | may declare |
|---|---|
| `'none'` | any preset |
| `'optional'` | `per-viewer` \| `private` \| `fresh` — plus `public`, ONLY with `variesBySession: false` |
| `'required'` / `'worker'` / `'platform_owner'` | `private` \| `fresh` |

`variesBySession: false` is the carve-out, and it is a claim you are making out
loud: *this body ignores the session*. `auth: 'optional'` covers two kinds of
route and no type can tell them apart — some ignore the session entirely (a
fully public portal read), others branch on it, and publicly caching the second
kind leaks one member's data to the next visitor. The dangerous reading is
therefore the default. Only the literal `false` counts; `true` and a widened
`boolean` both read as "not asserted". The carve-out grants `public` alone — not
`static` or `asset`, whose far longer windows are for `auth: 'none'` bodies.

**apps/web has no such guard.** `setHeaders()` takes any object, so nothing
stops a load from putting `DYNAMIC_PUBLIC` on an auth-varying page. Apply the
table by hand: if the response can differ for a signed-in viewer, it is
`PER_VIEWER` at most and `PRIVATE` in practice — the org and platform layouts
inject the signed-in user into the SSR shell, which is why every auth-varying
page in the app is `PRIVATE` today.

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
- Resolves worker URLs via `buildServiceUrl()` from `@codex/urls` (imported in api.ts under the local alias `getServiceUrl`)
- Forwards session cookie as both `CODEX_SESSION` and `better-auth.session_token`
- **NEVER** encode cookie values — JWT tokens use URL-safe base64; encoding corrupts them
- Unwraps procedure envelopes: `{ data: T }` → `T`, `{ items, pagination }` → as-is, 204 → `null`
- 10-second fetch timeout with `AbortController`
- Throws `ApiError` (from `$lib/server/errors.ts`) on non-2xx

### API namespaces

| Namespace | Worker | Key methods |
|---|---|---|
| `api.auth` | auth | `getSession()` |
| `api.account` | identity | `getProfile()`, `updateProfile()`, `uploadAvatar()`, `getPublicProfile(username)` — anonymous creator profile; returns `null` on 404 only, rethrows anything else |
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
| `api.categories` | content | `list()`, `create()`, `update()`, `remove()`, `reorder()`, `uploadCover()` |
| `api.courses` | ecom | `offer()`, `upsertSubscriptionPlan()`, `withdrawSubscriptionPlan()`, `setTierAccess()` |
| `api.agreements` | ecom | `list()`, `listPending()` — owner↔creator revenue-share agreements |

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

Available remote modules: `account`, `admin`, `agreements`, `auth`, `avatar-delete`, `avatar-upload`, `billing`, `branding`, `categories`, `checkout`, `content`, `journey-checkout`, `journey-insights`, `journeys`, `library`, `media`, `onboarding`, `org`, `sales`, `settings`, `subscription`.

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

Brand editing lives at `/studio/brand` — a two-pane workspace (control rail + live-preview iframe), admin/owner-gated in its `+page.server.ts`. The old `/studio/settings/branding` page 301-redirects here, and the retired `?brandEditor` floating overlay is gone.

State is managed in `$lib/brand-editor/brand-editor-store.svelte.ts` using module-level Svelte 5 runes (`$state`, `$derived`); live CSS injection runs via `$effect`. The route owns the store lifecycle: `brandEditor.open(orgId, savedState)` on mount → edit → Save (`getSavePayload()` → `updateBrandingCommand` → `markSaved()`) → `close()` on destroy.

**Live preview:** the studio page posts the pending brand state to the same-origin preview iframe(s) via the WP-1.4 bridge (`createBrandPreviewSender` + `createPreviewWiring`). The public org layout (`_org/[slug]/+layout.svelte`) applies branding and hosts the INERT applier (`initBrandPreviewBridge`, embedded-only) but renders no editor UI itself.

---

## Layout Hierarchy

```
+layout.svelte (root)
└── (platform)/+layout.svelte      ★ SidebarRail, PageContainer, Footer
│   └── depends('cache:versions')   version staleness + initProgressSync
│
└── _org/[slug]/+layout.svelte      ★ Org branding, ShaderHero, inert preview bridge
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
| `layout/` | SidebarRail, MobileNav (MobileBottomNav, MobileBottomSheet), StudioSidebar (incl. StudioSwitcher) |
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
| `borders.css` | `--border-*` | `--border-width`, `--border-default` |
| `radius.css` | `--radius-*` | `--radius-md` |
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

`hooks.server.ts` runs five hooks in sequence:
1. `junkHostHook` — terminates reserved junk hosts (`cdn*`, `preview`, `api`, …) with a cached 404 before any SvelteKit work
2. `cdnAssetHook` — serves public CDN assets (`cdn-assets*`/`cdn-platform*`) from bound R2
3. `sessionHook` — validates `codex-session` cookie against auth worker, sets `locals.user`, `locals.session`, `locals.userId`
4. `securityHook` — applies security headers (`X-Frame-Options`, `X-Content-Type-Options`, etc.)
5. `cdnRewriteHook` — dev-only: rewrites `localhost:4100` CDN URLs to `nip.io` for LAN mobile access

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
import { getCookieConfig } from '@codex/urls';
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
| `src/lib/server/cache.ts` | `CACHE_HEADERS` — the `setHeaders()` view of `CACHE_PRESETS` (`@codex/constants`), which is where the values live — + `invalidateCache()` |
| `src/lib/server/errors.ts` | `ApiError` class |
| `src/lib/collections/index.ts` | Barrel — collections, hydration, live query |
| `src/lib/collections/hydration.ts` | `hydrateIfNeeded`, `invalidateCollection`, `isCollectionHydrated` |
| `src/lib/collections/library.ts` | localStorage library collection |
| `src/lib/collections/progress.ts` | localStorage progress collection |
| `src/lib/collections/progress-sync.ts` | `initProgressSync`, `forceSync`, `cleanupProgressSync` |
| `src/lib/collections/use-live-query-ssr.ts` | SSR-safe `useLiveQuery` wrapper |
| `src/lib/client/version-manifest.ts` | `getStaleKeys`, `updateStoredVersions` |
| `src/lib/client/user-scoped-state.ts` | `reconcileStateOwner`, `clearUserScopedState`, `registerUserScopedReset` — the user-scoped-vs-device-scoped key inventory and the clear-on-identity-change primitive |
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

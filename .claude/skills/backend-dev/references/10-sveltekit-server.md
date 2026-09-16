---
name: sveltekit-server
description: >
  Deep reference for the SvelteKit server layer in Codex — server API client, hooks,
  subdomain reroute, cache headers, server loads, remote functions, streaming patterns.
  Paired with caching + tanstack-db skills.
type: reference
---

# SvelteKit Server Layer

The SvelteKit server layer is the bridge between Cloudflare Workers and the browser.
Every page load passes through:

1. Cloudflare reaches the SvelteKit adapter
2. `hooks.server.ts` validates session, sets headers, rewrites URLs
3. `hooks.ts` (`reroute`) translates subdomain → internal route
4. `+page.server.ts` / `+layout.server.ts` runs, calls workers via `api.ts`
5. SvelteKit renders HTML, streams data, hydrates on client

This reference covers **how to write server loads and remote functions** for a
Codex feature — not the full SvelteKit reference.

Reference implementations:
- `apps/web/src/lib/server/api.ts` — typed API client
- `apps/web/src/hooks.server.ts` — session, security, CDN rewrite
- `apps/web/src/hooks.ts` — subdomain reroute
- `apps/web/src/lib/server/cache.ts` — `CACHE_HEADERS` presets
- `apps/web/src/lib/remote/` — remote function examples
- `apps/web/src/routes/_org/[slug]/+layout.server.ts` — complex streaming load
- `apps/web/src/routes/(platform)/+layout.server.ts` — versioned cache headers

For **client-side caching and collections**, load the `caching` and `tanstack-db`
skills. This reference complements them by documenting the server-side plumbing.

---

## 1. The API Client (`src/lib/server/api.ts`)

This is how server loads talk to workers. Typed, cookie-forwarding, timeout-protected.

```typescript
import { createServerApi } from '$lib/server/api';

export const load = async ({ platform, cookies }) => {
  const api = createServerApi(platform, cookies);
  const content = await api.content.list({ page: 1, limit: 20 });
  return { content };
};
```

### What the factory does

1. Resolves worker URLs via `getServiceUrl(service, env)` — handles dev vs prod
2. Forwards `CODEX_SESSION` cookie as both `CODEX_SESSION` and `better-auth.session_token` headers (BetterAuth uses the latter internally)
3. Sets a 10-second `AbortController` timeout (protects against cold KV / DB hangs)
4. Unwraps `{ data: T }` → `T` and `{ items, pagination }` stays as-is
5. Throws `ApiError` (status, code, message) on non-2xx

### Never URL-encode cookie values

JWTs use URL-safe base64 (`A-Z a-z 0-9 - _`). Encoding converts `- _ .` to `%2D %5F %2E`
which corrupts the token. The API client intentionally does NOT encode cookie values.
If you add a new cookie-forwarding path, preserve this.

### API namespaces

| Namespace | Worker | Purpose |
|-----------|--------|---------|
| `auth` | auth | Session lookup |
| `account` | identity | Profile, avatar, purchase history |
| `content` | content | Content CRUD, public browsing |
| `access` | content (access routes) | Streaming URLs, progress, library |
| `org` | organization | Org CRUD, membership, branding, followers |
| `checkout` | ecom | Stripe checkout session |
| `subscription` | ecom | Tiers, checkout, management |
| `tiers` | organization | Tier CRUD |
| `connect` | ecom | Stripe Connect onboarding |
| `analytics` | admin | Dashboard stats |
| `media` | content | Media upload, transcoding status |
| `admin` | admin | Platform owner tools |

Adding a new namespace: extend the `createServerApi` return object in
`src/lib/server/api.ts`. Each method wraps a `fetch` call with the right worker
URL and auth headers.

---

## 2. Server Hooks (`src/hooks.server.ts`)

Three middleware composed via `sequence`:

### `sessionHook`

Runs on every request. Reads `CODEX_SESSION` cookie, calls auth worker's
`/session`, populates `locals.user`, `locals.session`, `locals.userId`.

If auth worker is down: treats as unauthenticated, doesn't fail the request.
Login pages still render, public pages still work.

### `securityHook`

Sets response headers:
- `X-Frame-Options: SAMEORIGIN` (not DENY — need iframes for self)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Request-Id: <requestId>` (set from `crypto.randomUUID`)

### `cdnRewriteHook`

Dev-only. Rewrites `localhost:4100` references in response HTML to `<lan-ip>.nip.io:4100`
so phones on the same WiFi can reach the dev CDN. No-op in prod.

---

## 3. Subdomain Routing (`src/hooks.ts`)

Codex uses subdomain-based routing:

| Hostname | Internal route |
|----------|----------------|
| `codex.lol` | `(platform)/*` |
| `bruce-studio.codex.lol` | `_org/[slug]/*` (with `params.slug = 'bruce-studio'`) |
| `creators.codex.lol` | `_creators/*` |

The `reroute({ url })` hook translates hostname + path into the internal route
tree. The key insight: **the subdomain is in the hostname, not the URL path**.
On `bruce-studio.codex.lol/explore`, the path is just `/explore` — `reroute`
adds the `_org/bruce-studio/` prefix for SvelteKit's router.

Route groups `(platform)`, `(space)`, `(auth)` are parenthetical — they organise
routes without appearing in URLs. `_org` and `_creators` are underscore prefixes —
they don't match URL paths (only `reroute` routes to them).

---

## 4. Cache Headers (`src/lib/server/cache.ts`)

Four presets, used via `setHeaders(CACHE_HEADERS.XXX)` in server loads:

| Preset | Cache-Control | Use |
|--------|---------------|-----|
| `STATIC_PUBLIC` | `public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400` | Public pages that change rarely (homepage, branding) |
| `DYNAMIC_PUBLIC` | `public, max-age=300, s-maxage=300, stale-while-revalidate=3600` | Public pages that do **not** vary by auth (discover, creator list — response identical for everyone) |
| `DYNAMIC_PUBLIC_REVALIDATE` | `public, max-age=0, s-maxage=300, stale-while-revalidate=3600` | Public pages whose payload varies by `locals.user` (content detail, org landing, pricing, creator profile) — anonymous branch |
| `PRIVATE` | `private, no-cache` | Authenticated pages (studio, account, library) — and the authenticated branch of any `REVALIDATE`-using page |

### SWR (Stale-While-Revalidate)

The browser/CDN serves the stale cached copy immediately on return visits while
fetching a fresh copy in background. User sees instant UX, eventual freshness.

### Conditional on auth state

```typescript
// DO: REVALIDATE for pages whose response differs by locals.user.
// `max-age=0` forces the browser to revalidate on every navigation so the
// session cookie is sent and the server returns the auth-aware response;
// `s-maxage=300` keeps the CDN win for anonymous visitors.
setHeaders(
  locals.user
    ? CACHE_HEADERS.PRIVATE
    : CACHE_HEADERS.DYNAMIC_PUBLIC_REVALIDATE
);
```

**Decision rule:** grep the server load for `locals.user`, `locals.userId`,
`locals.session`. If any change the returned payload — or the rendered template
branches on `data.user` — use `DYNAMIC_PUBLIC_REVALIDATE` (not plain `DYNAMIC_PUBLIC`).

**Why this matters:** Plain `DYNAMIC_PUBLIC` gives the browser `max-age=300`,
which pins *whichever response came first* in the HTTP cache for 5 minutes,
keyed by URL only. A user who visits anonymously then signs in (or buys /
subscribes) will keep seeing the stale anonymous response on SvelteKit
client-nav until the 5-min window elapses. Hard refresh bypasses the cache and
"fixes" it, so the bug looks intermittent. Root-caused on post-purchase "sign in
to watch" regression (commit f65cf5e7).

`REVALIDATE` flips `max-age=0` so the browser always revalidates — the origin
re-evaluates `locals.user` and returns the correct per-session response every
time. The CDN still caches the shared anonymous variant for 5 min.

### Pages that genuinely don't vary — keep `DYNAMIC_PUBLIC`

Explore (server-downgrades auth-only sorts before branching, so the anonymous
branch's payload is deterministic regardless of who requests it), discover,
creator list, creator content list. If `locals.user` is *referenced* but only
to gate a fetch path that produces the same output, `DYNAMIC_PUBLIC` is fine.
The test: two requests to the same URL — one with no cookie, one with a
session cookie — produce byte-identical payloads in the non-PRIVATE branch.

### Never set Cache-Control in both a layout and its child

SvelteKit errors on duplicate header sets. Pick one place. Usually the leaf page
owns Cache-Control.

### No Vary: Accept-Language

Codex is currently English-only (Paraglide with single locale). If we add more,
Vary needs careful thought — each locale becomes a separate cache entry.

---

## 5. Server Load Patterns

### Shell + Stream (await critical, stream secondary)

The page renders immediately with awaited data. Streamed promises fill in as they
resolve, with skeleton loading states in the template.

```typescript
// +page.server.ts
export const load: PageServerLoad = async ({ parent, platform, cookies, setHeaders }) => {
  const { org } = await parent();   // critical, must be awaited

  setHeaders(CACHE_HEADERS.DYNAMIC_PUBLIC);

  // AWAIT: critical for first paint
  const content = await getPublicContent({ orgId: org.id, limit: 6 });

  return {
    newReleases: content?.items ?? [],                 // Awaited — in the render
    creators: getCreators({ slug: org.slug })          // Streamed
      .then(r => ({ items: r?.items ?? [], total: r?.pagination?.total ?? 0 }))
      .catch(() => ({ items: [], total: 0 })),
    continueWatching: getContinueWatching()            // Streamed
      .catch(() => undefined),
  };
};
```

```svelte
<!-- +page.svelte -->
<HeroSection items={data.newReleases} />

{#await data.creators}
  <CreatorsSkeleton />
{:then creators}
  <CreatorsSection items={creators.items} />
{/await}
```

**Rules for streaming:**
- **MUST** `.catch()` every streamed promise — unhandled rejections crash the server
- **MUST** await data needed for `<svelte:head>` (SEO titles, OG tags)
- **MUST** use `{#await}` blocks with skeletons for streamed data
- With JS disabled, SvelteKit waits for all promises before sending HTML (graceful degradation)
- Streaming only works in `+page.server.ts` / `+layout.server.ts`, NOT `+page.ts`

### Parent data

`await parent()` grabs data from the closest `+layout.server.ts` up the tree.
Org pages use this to reuse `org` without re-fetching.

```typescript
export const load: PageServerLoad = async ({ parent, ... }) => {
  const { org } = await parent();  // from _org/[slug]/+layout.server.ts
  // use org.id, org.slug, etc.
};
```

### Auth gates (redirect unauthenticated)

```typescript
import { redirect } from '@sveltejs/kit';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    redirect(302, `/login?redirect=${encodeURIComponent(url.pathname)}`);
  }
  return { user: locals.user };
};
```

### Role gates

```typescript
const membership = await api.org.getMyMembership(org.id);
if (!membership?.role || membership.role === 'member') {
  redirect(302, '/?error=access_denied');
}
```

### Studio SPA mode

The studio sub-tree at `_org/[slug]/studio/+layout.ts` has `export const ssr = false`.
Entire studio is client-rendered for instant navigation between pages.

What still works:
- Parent layouts SSR (auth guard still runs server-side)
- `+page.server.ts` files still execute (SvelteKit fetches them client-side)
- View source shows no studio content (client-only)

When to use `ssr = false`: auth-gated subtrees where SEO doesn't matter and
instant nav is worth the blank-shell-on-first-load tradeoff.

---

## 6. Remote Functions

Remote functions are SvelteKit's RPC primitive — typed, cached, auto-serialized
calls from client to server. Located in `apps/web/src/lib/remote/`.

### `query(schema, asyncFn)` — cached reads

```typescript
import { query } from '$app/server';
import { z } from 'zod';
import { getRequestEvent } from '$app/server';
import { createServerApi } from '$lib/server/api';

export const getContent = query(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.content.get(id);
});
```

Usage in templates:
```svelte
{#await getContent(contentId)}
  <Skeleton />
{:then content}
  <h1>{content.title}</h1>
{/await}
```

- Automatically cached by SvelteKit
- Works with `{#await}` blocks
- Can be invalidated with `invalidate('query:contentId')` if needed

### `form(schema, asyncFn)` — progressive enhancement

```typescript
export const createContentForm = form(createContentSchema, async (input) => {
  const { platform, cookies } = getRequestEvent();
  try {
    const result = await createServerApi(platform, cookies).content.create(input);
    return { success: true as const, contentId: result.id };
  } catch (err) {
    return { success: false as const, error: err.message };
  }
});
```

Usage:
```svelte
<form use:enhance use:applyAction method="POST" action={createContentForm}>
  <input name="title" />
  <button type="submit">Create</button>
</form>
```

- Works without JavaScript (progressive enhancement)
- Returns typed `{ success: boolean, ... }` discriminated union
- `.pending` state available for loading UI

### `command(schema, asyncFn)` — client-only mutations

```typescript
export const deleteContent = command(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  return createServerApi(platform, cookies).content.delete(id);
});
```

Usage:
```svelte
<script>
  async function handleDelete() {
    await deleteContent(contentId);
  }
</script>
<button onclick={handleDelete}>Delete</button>
```

- Client-side only (no progressive enhancement)
- For programmatic mutations where `form` is overkill

### Decision tree

```
Need the result in template during SSR? → query()
Is it a form submission with progressive enhancement? → form()
Is it a click-to-mutate without form semantics? → command()
```

---

## 7. Streaming Pitfalls

### Promise race on navigation

A streamed promise may resolve AFTER the user navigates away. If the new page
reads that data, it gets stale values.

Defense: stale promise guard in `$effect`:

```svelte
<script>
  let { data } = $props();
  let currentPromise = $state(data.streamedValue);

  $effect(() => {
    currentPromise = data.streamedValue;  // reset on nav
  });
</script>

{#await currentPromise}
  <Skeleton />
{:then value}
  <Display {value} />
{/await}
```

The `$effect` re-binds `currentPromise` when `data` changes. The `{#await}` block
restarts from skeleton rather than showing the previous page's data.

### `.catch()` with typed shape

Every streamed promise needs a fallback of the same shape:

```typescript
// WRONG — `creators` could be undefined in the template
creators: getCreators({ slug }).catch(() => undefined)

// CORRECT — fallback matches happy path shape
creators: getCreators({ slug })
  .then(r => ({ items: r?.items ?? [], total: r?.pagination?.total ?? 0 }))
  .catch(() => ({ items: [], total: 0 }))
```

Typed fallbacks mean the template doesn't need `{#if creators}` guards.

---

## 8. Version Manifest Integration

For user-scoped data that can change on other devices (subscriptions, library),
the layout reads version keys from KV and streams them. The client detects
staleness on focus/visibility change and refetches.

```typescript
// _org/[slug]/+layout.server.ts (simplified)
export const load = async ({ params, locals, platform, depends }) => {
  depends('cache:org-versions');  // allows invalidate('cache:org-versions')

  const versions: Record<string, string | null> = {};
  if (locals.user && platform?.env?.CACHE_KV) {
    const cache = new VersionedCache({ kv: platform.env.CACHE_KV });
    versions[CacheType.COLLECTION_USER_LIBRARY(locals.user.id)] =
      await cache.getVersion(...);
  }
  return { versions };
};
```

For the full pattern (client-side staleness detection, `getStaleKeys`,
`invalidateCollection`, `updateStoredVersions`), **load the `caching` skill.**
This reference only covers the server-side plumbing.

---

## 9. Adding a New Server Load

1. **Choose the file**: `+page.server.ts` for page-specific; `+layout.server.ts` for shared
2. **Decide on streaming**: await only what's critical; everything else streamed with `.catch`
3. **Set cache headers**: conditional on `locals.user` if public/private mixed
4. **Use `api.ts`**: don't call worker fetches directly — centralise in the client
5. **Type the return** (`PageServerLoad` / `LayoutServerLoad` from `./$types`)
6. **Handle errors gracefully**: use `error(404)` / `redirect(302)` where appropriate; `.catch` on streamed promises

---

## 10. Adding a New Remote Function

1. Create `src/lib/remote/<domain>.remote.ts`
2. Import `query` / `form` / `command` from `$app/server`
3. Define Zod schema (or import from `@codex/validation`)
4. Inside the function, `getRequestEvent()` → `{ platform, cookies }` → `createServerApi`
5. Export from the file; consume from components

---

## 11. Anti-Patterns

| Anti-pattern | Why it breaks | Fix |
|--------------|---------------|-----|
| URL-encoding cookie values | JWT corruption | Never encode in `api.ts` |
| Raw `fetch` to worker URLs in loads | Duplicates session-forwarding logic | `createServerApi` |
| Streamed promise without `.catch` | Unhandled rejection crashes server | `.catch(() => typedFallback)` |
| Awaiting everything in a server load | Slow TTFB, no streaming benefit | Await SEO data only, stream rest |
| Cache-Control in layout AND child | SvelteKit errors | One place only |
| `+page.ts` with streaming | Only works in `+page.server.ts` | Move to `.server.ts` |
| Session token logged in API client | Credential leak | Log `userId` only |
| Hardcoded worker ports | Breaks in prod | `getServiceUrl(service, env)` |
| Re-fetching parent data | Duplicate work | `await parent()` |
| `ssr = true` on studio (current) | Slower initial nav | `ssr = false` on auth-gated instant-nav trees |
| Trusting `platform?.env` without check | Undefined in dev/test for missing bindings | Always guard: `if (!platform?.env?.CACHE_KV) return ...` |
| Returning complex non-serializable objects from `load` | SvelteKit can't hydrate | Return plain JSON |
| Computing things in template that should be in `load` | SSR/CSR drift, flash of wrong content | Compute in `load` |
| Using `+page.svelte` for SEO text | Component renders after header → too late | `<svelte:head>` with data from `load` |

---

## 12. Debugging Server Loads

1. **TTFB too slow** — awaited too much. Move non-critical data to streaming.
2. **Streamed data missing in `{#await}`** — forgot to include in `return`.
3. **"Unhandled promise rejection" crash** — missing `.catch()` on streamed promise.
4. **Auth working locally, failing in prod** — cookie domain mismatch. Subdomain cookies need `.codex.lol` domain.
5. **CSS not applying to SSR'd HTML** — `{#if browser}` guard wrapping something that should SSR. Check `$app/environment`.
6. **"platform is undefined"** — running on `+page.ts` instead of `+page.server.ts`, or local dev without wrangler adapter.
7. **View Source shows blank page on studio** — `ssr = false` is working as intended. Data appears after client hydration.
8. **`locals.user` undefined** — `sessionHook` failed. Check auth worker availability.

---

## When to Re-Verify This Reference

Re-read this doc against current code if you see changes in:

- `apps/web/src/lib/server/api.ts` (API client shape / auth forwarding)
- `apps/web/src/hooks.server.ts` (session validation, security headers)
- `apps/web/src/hooks.ts` (subdomain reroute logic)
- `apps/web/src/lib/server/cache.ts` (header presets)
- `apps/web/src/lib/remote/` (remote function patterns)
- `apps/web/src/routes/_org/[slug]/+layout.server.ts` (canonical streaming load)

For client-side caching, collection hydration, live queries: those are in the
`caching` and `tanstack-db` skills.

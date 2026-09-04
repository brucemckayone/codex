# Caching Strategy

## The Layers

```
HTTP / CDN cache (Cache-Control) → SSR HTML + public API JSON, at browser AND Cloudflare edge
SvelteKit query()                → request-scoped dedup within one SSR render
@codex/cache (KV)                → server-side, cross-request, cross-worker
TanStack DB (localStorage)       → client-side local-first, persists across tabs
```

These are complementary, not overlapping. Each solves a different problem. The
HTTP/CDN layer is the one most easily misused — it is the only layer that can
serve one user's render to another user — so it has its own section below.

---

## HTTP / CDN Cache (Cache-Control)

Governs the **browser cache** and the **Cloudflare edge cache** for the rendered
HTML document and for public JSON. It does NOT touch `@codex/cache` (KV) or the
client collections — those are the separate layers below.

There is now ONE vocabulary for the whole platform, and both entry points name
it rather than writing a header value:

- **Workers** — `procedure({ policy: { cache: '<preset>' } })`. Declaring
  nothing means `private`; the safe reading is the default.
- **apps/web** — `setHeaders(CACHE_HEADERS.*)` in a `+page.server.ts` load
  (`apps/web/src/lib/server/cache.ts`), which is a header-shaped VIEW of the
  same presets and contains no `Cache-Control` value of its own.

### The vocabulary

The presets live in `CACHE_PRESETS` (`packages/constants/src/limits.ts`) and are
named by **who may STORE the body** — never by how long the window is.

**Do not trust the values below over the code.** They are a copy for
orientation. `packages/constants/src/limits.ts` is the source of truth, and
`node scripts/checks/check-data-access-contract.mjs` prints the CURRENT
vocabulary in its failure message — parsed out of that file, so it cannot fall
behind. If this table and that output ever disagree, the output is right.

Viewer-invariant — every viewer receives the same bytes, so a shared cache may
store AND reuse the body:

| Preset | `Cache-Control` | Use for |
|---|---|---|
| `public` | `public, max-age=60, s-maxage=60` | Public JSON / HTML that ignores the session. 60s because a shared window is a window during which a publish is INVISIBLE, and the KV version-bump that makes a publish visible cannot reach a CDN. |
| `static` | `public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400` | Documents read by CRAWLERS on their own cadence — the two `sitemap.xml` routes. The only preset permitted `stale-while-revalidate`, because a crawler indexing yesterday's sitemap is the normal case rather than a defect. |
| `asset` | `public, max-age=3600, s-maxage=86400` | Content-addressed bytes streamed through the R2 proxies (`apps/web/src/lib/server/cdn-proxy.ts`, `workers/dev-cdn`). The 24× shared/browser asymmetry is an R2-egress decision: the KEY changes when the bytes change, so a stored copy is never stale, only superseded. |

Viewer-variant — the body may differ per viewer, so **no shared cache may reuse
a stored copy**:

| Preset | `Cache-Control` | Use for |
|---|---|---|
| `per-viewer` | `public, max-age=0, no-cache` | A shared cache may STORE it but must revalidate with the origin before serving it to anyone (RFC 9111). An anonymous burst is absorbed as 304s; a signed-in viewer always gets their own body. |
| `private` | `private, no-cache` | The viewer's own browser only. **The default when nothing is declared.** Anything whose SSR output varies by auth. |
| `fresh` | `private, no-store` | Not merely per-viewer but per-REQUEST: bodies that embed a credential, such as the HLS playlists in `content-api`'s `content-access.ts`, where a copy on the browser's own disk outlives the presigned URL inside it. |

The apps/web view, `CACHE_HEADERS` name → preset name: `STATIC_PUBLIC` →
`static`, `DYNAMIC_PUBLIC` → `public`, `PER_VIEWER` → `per-viewer`, `PRIVATE` →
`private`, `FRESH` → `fresh`. `asset` has no `CACHE_HEADERS` entry: its only
apps/web consumer sets the header on a `Headers` instance rather than through
`setHeaders()`. That pairing is asserted byte-for-byte by
`apps/web/src/lib/server/cache.test.ts`.

### Which preset may an endpoint declare? (enforced by the compiler)

`policy.cache` is type-checked against `policy.auth` in
`packages/worker-utils/src/procedure/types.ts` (`CachePolicyRule`), so an
illegal pairing does not compile — it is not a review note:

| `auth` | may declare |
|---|---|
| `'none'` | any preset |
| `'optional'` | `per-viewer` \| `private` \| `fresh` — plus `public`, but ONLY alongside the literal `variesBySession: false` |
| `'required'` \| `'worker'` \| `'platform_owner'` | `private` \| `fresh` |

`variesBySession: false` is the author's explicit assertion that the response
body does not branch on the session. It exists because `auth: 'optional'` covers
two unlike things — routes that ignore the session entirely (the journeys portal
reads) and routes that branch on it — and no type can tell them apart. A widened
`boolean` (`variesBySession: someFlag`) deliberately fails the rule: an
assertion the compiler cannot read is not an assertion. The carve-out admits
`public` alone, not `static` or `asset`; a day-long `stale-while-revalidate`
window on a route that even LOOKS at the session would be a far longer leak than
the one that shipped here.

Two more things are checked rather than documented:

- **No hand-written `Cache-Control` anywhere outside `limits.ts`** —
  `scripts/checks/check-data-access-contract.mjs`, a hard step in the
  static-analysis CI job. It has no waiver list and must not be given one: if
  nothing in the vocabulary fits a response, the vocabulary is incomplete and
  the fix is to ADD a preset with its reasoning.
- **A route that declares nothing gets `private`** — `resolveCacheControl()` in
  `procedure/helpers.ts`, pinned by
  `procedure/__tests__/procedure-cache-control.test.ts`.

### The golden rule (MANDATORY)

**If a page's SSR output varies by auth state, it MUST NOT carry an `s-maxage`.**
In practice that means `private` (or `per-viewer` when an anonymous burst is
worth absorbing as 304s).

Stated as the invariant rather than as a list of numbers, because the numbers
drift and the invariant does not: **never an `s-maxage` — or a
`stale-while-revalidate` — on a response that can vary by viewer.** A shared
cache keys on **URL, never on Cookie**, so a window it may reuse is a window in
which one viewer's body is handed to the next.

Every page under the `(platform)`, `_org/[slug]`, and `_creators` layouts is
auth-varying, because those layouts inject the auth-aware `user` (the sidebar
user section). A page need not branch on `locals.user` itself — inheriting the
layout's `user` is enough.

**Why a shared window is unsafe here:** shared caches (Cloudflare edge,
miniflare's CF emulation in CI, any intermediate proxy) key entries by **URL —
NOT by Cookie**. A body a shared cache may reuse, cached during an anonymous
visit, is then served to *authenticated* visitors of the same URL, who get the
logged-out render — the "You need to sign in" bug for content owners. Verified
in production 2026-07-16: an anonymous content page returned
`cf-cache-status: HIT` with anon HTML, and Cloudflare had rewritten origin
`max-age=0` → `max-age=14400` (its default Browser Cache TTL), defeating the
browser-revalidate half of the header it was sent.

**`DYNAMIC_PUBLIC_REVALIDATE` WAS DELETED, NOT DEPRECATED — and it is worth
knowing why.** It was `public, max-age=0, s-maxage=300,
stale-while-revalidate=3600`, and the shape LOOKS safe: `max-age=0` means the
browser revalidates every navigation. But `max-age=0` fixes only the browser
half. `s-maxage=300` still licenses the edge to store the render and hand it to
the next viewer, because a shared cache keys on URL and never on Cookie. CI
reproduced the leak deterministically on 2026-05-28 (miniflare's CF cache
emulation honours `s-maxage` for HTML by URL key alone) and the preset was
removed from the platform landing page — the comment at the top of
`apps/web/src/routes/(platform)/+page.server.ts` is the full record. Nothing in
the current vocabulary has this shape, and
`scripts/checks/check-data-access-contract.mjs` reports any reintroduction of it
as its most severe class (`SHARED WINDOW`). If you want "cacheable for anonymous
visitors, revalidated per viewer", that is `per-viewer` — `no-cache` with no
shared window at all.

### Shield the DB at the data layer, not the HTML layer

Making an auth-varying page `PRIVATE` removes its edge cache — but that must NOT
translate into per-request DB load. The **public data** underneath is auth-safe
and belongs in the KV layer; cache the data (version-invalidated), never the
auth-varying HTML. Example: content-detail SSR fetches the content list by slug;
that query is KV-cached in content-api (`getCachedPublicContent`, keyed by
`COLLECTION_ORG_CONTENT(orgId)` with the slug folded into the data-slot key), so
the `PRIVATE` page costs an SSR render, not a Neon query — for anonymous AND
authenticated viewers.

### Decision record — auth-caching fix (2026-07-16)

- **Chosen (A):** auth-varying loads → `PRIVATE`; shield the DB via the KV data
  cache (slug lookups now cached). In code, testable, version-invalidated.
- **Rejected (B):** a Cloudflare "bypass cache on session cookie" rule. Correct,
  but relocates a correctness invariant into un-versioned dashboard config CI
  can't see, which fails silently on a cookie-name change (BetterAuth's
  `__Secure-` prefix has broken prod before).
- **Deferred (C):** make the SSR shell auth-agnostic and hydrate auth
  client-side so pages become genuinely public + edge-cacheable. Best long-term
  perf, but a cross-cutting refactor plus a first-paint flash. Revisit only if
  measurement shows the lost anonymous edge cache actually hurts.

### Poisoning guard

The viewer-invariant presets (`public`, `static`, `asset`) must be set only
AFTER every `await` that can throw — a thrown `error()` otherwise inherits the
header and the CDN caches the *error page* for every visitor. `private` and
`fresh` are safe to set anywhere.

---

## Server-Side: @codex/cache

Cloudflare KV-backed versioned cache. Cache-aside pattern with version-based invalidation.

**Key structure:**
```
cache:version:{id}               → current version string (timestamp)
cache:{type}:{id}:v{version}     → cached data
```

**Invalidation:** bump the version key → all old versioned data instantly stale → expires via TTL. Single atomic KV write.

### The data-slot write MUST be handed a `waitUntil` (Codex-e32xz)

`get()` / `getWithResult()` do NOT await their data-slot put — a cache write must
never add latency to a cache-miss response. In workerd an un-awaited promise is
not merely slower, it is **cancelled**: the request's IoContext is destroyed the
moment the response is returned.

That is a real production outage, not a theory. A census of
`CACHE_KV_PRODUCTION` found **62 version keys and 0 data keys** — the version key
is written with `await` three lines earlier in the same function, in the same
namespace, in the same request, so the only difference was the await. The cache
had a literal 0% hit rate: every request paid the full DB cost AND the KV reads.

So on any READ path, construct the cache with a `waitUntil`:

```ts
// In a procedure() handler
const cache = new VersionedCache({
  kv: ctx.env.CACHE_KV,
  waitUntil: (p) => ctx.executionCtx.waitUntil(p),
});

// In a SvelteKit server load (platform.context is absent under vite dev)
const cache = new VersionedCache({
  kv: platform.env.CACHE_KV as KVNamespace,
  waitUntil: platform.context
    ? (p: Promise<unknown>) => platform.context.waitUntil(p)
    : undefined,
});
```

`waitUntil` is **not** `ctx.background`. `ctx.background` exists so DB work
finishes before `procedure()` tears down the per-request Postgres pool; chaining
a KV put onto it would hold a DB connection open for the duration of a KV write
for no reason. A KV put touches no pool, so plain `waitUntil` is correct.

Every `VersionedCache` built by the service registry gets this automatically.
`waitUntil` stays optional so invalidate-only call sites and unit tests are
unaffected — they keep the old best-effort, non-blocking behaviour.

**Corollary: never cache a class instance.** The cache round-trips values through
`JSON.stringify`/`JSON.parse`, so class identity does not survive a hit. Caching a
`PaginatedResult` made `procedure()`'s `instanceof` check fail on every hit and
silently degraded the list envelope to `{ data: { items, pagination } }`. Cache the
plain `{ items, pagination }` and re-wrap in `new PaginatedResult(...)` **after**
the cache call.

**Currently wired up:**
- `IdentityService.getProfile()` → `USER_PROFILE`, 10 min TTL
- `IdentityService.getNotificationPreferences()` → `USER_PREFERENCES`, 10 min TTL
- `IdentityService.getPublicProfileByUsername()` → two hops:
  `USERNAME_TO_ID` (1 h, keyed by lowercased username) then
  `USER_PUBLIC_PROFILE` (10 min, keyed by **user id**). The profile is keyed by
  id so the three existing `invalidate(userId)` calls clear it for free; only a
  username *rename* needs its own bump, which `updateProfile` does for the old
  and the new value. It is a separate `CacheType` from `USER_PROFILE` because
  that entry carries the user's `email` and this one feeds an unauthenticated
  endpoint.
- Invalidated via `cache.invalidate(userId)` on profile/preferences update

**Natural next additions:**
- `PlatformSettingsFacade` org branding → `ORG_CONFIG`, 30 min TTL
- Published content metadata → `CONTENT_METADATA`, 5-10 min TTL
- Content access checks → `CONTENT_ACCESS`, 1-5 min TTL

---

## Client-Side: TanStack DB

Two strategies in use — they solve different problems.

### Session cache (`queryCollectionOptions`)
Backed by TanStack Query. In-memory only. Lost on tab close.
- `contentCollection` — published content browse/discover (SSR is the primary source anyway)

### True local-first (`localStorageCollectionOptions`)
Persists across tab close. Works offline. Has conflict resolution.
- `progressCollection` ✅ — playback progress
- `libraryCollection` ✅ — user's purchased/free content library

**SSR hydration bridge:** SSR fetches data → passes in page data → `onMount` hydrates local collection → `useLiveQuery` takes over → no double fetch. SSR wins first paint, local-first wins every subsequent interaction.

---

## Invalidation: Version Manifest

### The problem with naive per-entity versioning on the client

Tracking a version key per content item in localStorage doesn't scale — the manifest grows unbounded as the user browses, and the focus-check becomes hundreds of KV reads.

The fix: distinguish between **entity versions** (owned data) and **collection versions** (shared catalogue data).

### Entity versions — for data the user owns
```
cache:version:{userId}        → user profile, preferences, library
cache:version:{orgId}         → org config, branding
```
One writer, bounded set, clear ownership.

### Collection versions — for shared catalogue data
```
cache:version:content:published      → global published content catalogue
cache:version:org:{orgId}:content    → org-specific content list
```
One version key for the entire dataset. When any content is published/updated/unpublished — one key gets bumped. The client stores one string, not hundreds.

**On content publish/update:**
```ts
await cache.invalidate('content:published');        // collection version
await cache.invalidate(`org:${orgId}:content`);    // org collection version
await cache.invalidate(contentId);                  // server KV entity cache
```

### Client version manifest

Small, bounded, never grows regardless of browsing history:
```ts
// localStorage: codex-versions
{
  "user:{userId}":        "1712345678",   // user's own data
  "org:{orgId}":          "1712340000",   // org they belong to
  "content:published":    "1712341000",   // global content catalogue
  "org:{orgId}:content":  "1712342000",   // org's content list
}
```

Individual content item versions do **not** go in the client manifest — server KV only.

### SSR version passthrough

SSR includes current versions for everything it rendered:
```ts
// +layout.server.ts
return {
  versions: {
    [`user:${userId}`]:        await env.CACHE_KV.get(`cache:version:${userId}`),
    [`content:published`]:     await env.CACHE_KV.get(`cache:version:content:published`),
    [`org:${orgId}:content`]:  await env.CACHE_KV.get(`cache:version:org:${orgId}:content`),
  }
}
```

### Client mount check

```ts
onMount(() => {
  const stored = getStoredVersions(); // from localStorage
  const staleKeys = Object.entries(data.versions)
    .filter(([key, version]) => stored[key] !== version)
    .map(([key]) => key);

  if (staleKeys.some(k => k.startsWith('user:')))              invalidateCollection('library');
  if (staleKeys.some(k => k.startsWith('content:published')))  invalidateCollection('content');
  if (staleKeys.some(k => k.startsWith('org:')))               invalidateCollection('orgData');

  updateStoredVersions(data.versions);
});
```

### Focus check (long-lived sessions)

Lightweight endpoint — always ~4 KV reads regardless of browsing history:
```
GET /api/versions?keys=user:{id},content:published,org:{id}:content
→ { "user:{id}": "...", "content:published": "...", ... }
```

Check on `visibilitychange`, diff against stored manifest, invalidate only what changed.

---

## Rules: When to use which

**Local-first (localStorage-backed):**
- User is the primary writer
- Staleness for a few minutes is acceptable
- Offline functionality has real value
- Data is user-scoped (library, progress, preferences)

**Server-authoritative always:**
- Auth / session state
- Access control — streaming URL generation, purchase gates
- Purchase verification
- Prices, availability, content legal status (publish/unpublish)

---

## Version Key Taxonomy

| Key | Client manifest? | Bumped when |
|---|---|---|
| `cache:version:{userId}` | ✅ Yes | Profile updated, prefs changed |
| `cache:version:user:{userId}:library` | ✅ Yes | Purchase completed; subscription lifecycle event; **content mutation (update/publish/unpublish/delete); membership role change; follow/unfollow** |
| `cache:version:user:{userId}:subscription:{orgId}` | ✅ Yes | Subscription checkout / tier change / cancel / reactivate / webhook events |
| `cache:version:{orgId}` | ✅ Yes | Org settings/branding changed |
| `cache:version:content:published` | ❌ Server KV only | Any content published/unpublished/updated |
| `cache:version:org:{orgId}:content` | ❌ Server KV only | Content in this org changed |

### Content mutation fanout (Codex-c01do)

Content-scoped mutations (`update`, `publish`, `unpublish`, `delete`) fan
per-user library version bumps in addition to the catalogue version bumps.
The fanout set is the union of:

- Completed purchasers of the content (from `purchases`)
- Active/cancelling subscribers to the owning org (from `subscriptions`)
- Management members (owner/admin/creator) of the owning org
- Optionally — followers of the org when `includeFollowers: true` is passed

A safety cap (`DEFAULT_MAX_LIBRARY_FANOUT = 500`) skips the per-user fanout
for unbounded audiences (popular follower-gated content) and logs a warning
— the platform layout's `visibilitychange → invalidate('cache:versions')`
loop catches up on the user's next focus event.

**Catalogue bump on edit + thumbnail (2026-07-16):** `PATCH /content/:id`
(update) and the thumbnail upload/delete endpoints now also call
`bumpOrgContentVersion` → invalidate `COLLECTION_ORG_CONTENT(orgId)`.
Previously only publish/unpublish/delete did, so an edit or thumbnail swap left
the cached public list — and, once slug lookups became KV-cached, the
content-detail page — stale until the 5-min TTL. This keeps the `PRIVATE`-page
DB-shield (see §HTTP/CDN Cache) coherent: the slug-keyed detail slot shares the
org version key, so any content mutation stales it atomically.

Membership (`inviteMember`, `updateMemberRole`, `removeMember`) and follower
(`followOrganization`, `unfollowOrganization`) mutations bump the single
affected user's library version — no fanout query needed because the target
user id is already known.

Implementation: `packages/content/src/services/content-invalidation.ts`
(entry points: `invalidateContentAccess`, `invalidateOrgMembership`).
Wired into content-api routes (`workers/content-api/src/routes/content.ts`)
and organization-api routes (`workers/organization-api/src/routes/{members,followers}.ts`).

**Why content keys are server-only:** Content availability is "server-authoritative always" — SSR renders the correct published list on every page load. There's no localStorage-backed `contentCollection` to invalidate. Bumping the key on the server means the next SSR request gets a fresh DB fetch instead of a stale KV list.

### `CacheType` constants (in `@codex/cache`)

```typescript
// Entity-level (data cache + client manifest)
CacheType.USER_PROFILE           // 'user:profile'  (carries email)
CacheType.USER_PUBLIC_PROFILE    // 'user:public-profile'
CacheType.USERNAME_TO_ID         // 'user:username-to-id'
CacheType.USER_PREFERENCES       // 'user:preferences'
CacheType.ORG_CONFIG             // 'org:config'

// Collection version identifiers (server KV only)
CacheType.COLLECTION_CONTENT_PUBLISHED             // 'content:published'
CacheType.COLLECTION_ORG_CONTENT(orgId)            // 'org:{orgId}:content'

// Collection version identifiers (client manifest + server KV)
CacheType.COLLECTION_USER_LIBRARY(userId)          // 'user:{userId}:library'
```

---

## Implementation Status

| Piece | Status |
|---|---|
| Server entity versioning (user, org) | ✅ Done |
| Server KV cache-aside (identity) | ✅ Done |
| `progressCollection` local-first | ✅ Done |
| SSR hydration bridge (query-backed) | ✅ Done |
| `getVersion()` on VersionedCache | ✅ Done |
| Collection-level `CacheType` constants | ✅ Done |
| Client version manifest module | ✅ Done |
| Account layout SSR version passthrough | ✅ Done |
| Account layout mount-time staleness check | ✅ Done |
| `libraryCollection` → localStorage | ✅ Done |
| `CACHE_KV` in content-api (version bumping) | ✅ Done |
| Content invalidation on publish/update | ✅ Done (via `bumpOrgContentVersion` in content-api routes) |
| `CACHE_KV` in admin-api | ❌ Pending |
| `CACHE_KV` in ecom-api (purchase → library version) | ✅ Done |
| Platform/org layout version passthrough | ✅ Done |
| Versions endpoint — superseded by depends/invalidate pattern | ✅ Done (design complete, no separate endpoint needed) |
| `initProgressSync` activation | ✅ Done |
| Tab visibility re-invalidation (depends + invalidate pattern) | ✅ Done |

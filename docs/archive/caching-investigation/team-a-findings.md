# Team A — Caching Investigation Findings

## Bug 1: Cross-device auth sync (stale "sign in to view" prompt)

### Root cause

The cross-subdomain / cross-device auth sync pathway is built around **same-device
cookie presence diffing**. When the user signs in on their phone, no cookie ever
appears on the laptop — the invalidation trigger therefore never fires, the SvelteKit
server load never re-runs, `locals.user` stays `null`, and `ContentDetailView` keeps
rendering the `auth_required` gate.

Evidence:

- `apps/web/src/routes/+layout.svelte` — `onMount()` handler polls
  `document.cookie` for `codex-session` on `visibilitychange`. Only invalidates
  `app:auth` when `nowHasCookie !== lastHadCookie`. BetterAuth's
  `crossSubDomainCookies` (see `workers/auth/src/auth-config.ts#createAuthInstance`)
  bind the cookie to `.lvh.me` / `.revelations.studio` — so cross-subdomain
  same-device flows work, but cross-device flows never deposit a cookie on the
  other device.
- `apps/web/src/hooks.server.ts#sessionHook` — derives `locals.user` purely from
  the presence of a local `codex-session` cookie. If no cookie, `locals.user =
  null`. No server-side revalidation mechanism exists beyond "server load runs
  again".
- `apps/web/src/routes/_org/[slug]/(space)/content/[contentSlug]/+page.server.ts`
  — uses `depends('app:auth')`, so an `invalidate('app:auth')` would re-run the
  load and the prompt would disappear — but the invalidation never happens.
- `apps/web/src/lib/components/player/access-state.ts#deriveAccessState` —
  returns `{ status: 'locked', reason: 'auth_required' }` when `!isAuthenticated`.
  The flag is driven by `data.user` straight from the server load.

Additionally, `session-auth.ts`/BetterAuth caches validated sessions in
`AUTH_SESSION_KV` for 5 minutes (`cookieCache.maxAge = 300`, or `expiresAt` TTL
in `cacheSessionInKV`). Even once a cookie eventually arrives on the laptop (not
the bug's scenario), a separate staleness window exists.

### Affected layers

- `apps/web/src/routes/+layout.svelte` (root cookie-diff trigger)
- `apps/web/src/routes/+layout.server.ts` (single `depends('app:auth')` hook)
- `apps/web/src/hooks.server.ts#sessionHook` (no cross-device signal input)
- Any `+page.server.ts` that uses `depends('app:auth')` and branches on
  `locals.user` (content detail, library auth guards, etc.)

### Fix approach

The real trigger is "the server-side session is now valid for a token I don't
have yet". Cookies are the wrong signal — the manifest-version pattern already
in use for library/org data is the right model. Two complementary fixes:

1. **Add an `app:auth` periodic/focus re-check independent of cookie state.** In
   `apps/web/src/routes/+layout.svelte`, unconditionally call
   `invalidate('app:auth')` on `visibilitychange → visible` (with a ≤60s
   cooldown mirroring the org layout's `VERSION_CHECK_COOLDOWN_MS` pattern) when
   `data.user == null`. Keep the cookie-diff path as the fast trigger for
   same-device logouts but remove it as the only trigger. The existing
   `depends('app:auth')` wiring does the rest.

2. **Drop the 5-minute cache window on sign-in revocation-sensitive flows.**
   Keep BetterAuth's `cookieCache.maxAge = 300` for perf, but when the root
   layout re-validates after visibility gain, force a fresh `getSession()` call
   by adding a cache-buster header or by calling a new `/api/auth/session?fresh=1`
   that bypasses KV — otherwise even the invalidation above can hit a stale
   5-minute KV cache entry saying "null user" (if the cookie was set, reloaded,
   and the phone-login race landed in that window).
   Smaller alternative: keep as-is and rely on the 5-min TTL to elapse
   naturally. Given the laptop in this scenario has **no session cookie at all**,
   there is no KV entry to be stale — the server simply re-runs `sessionHook`
   with no cookie. Fix 1 alone is sufficient for this bug.

No backend schema change needed. This is a front-end invalidation-trigger gap
only. Caching-skill rule: "Keep invalidation server-authoritative via `depends`;
don't make the client guess" — we add one more trigger to an existing depend
channel.

---

## Bug 2: Cross-org library cache bleed

### Root cause

`libraryCollection` is a **global** localStorage store keyed by `content.id`.
It contains every library item the user owns across every org they have joined.
The org-scoped library page attempts to filter client-side using
`item.content.organizationSlug === orgSlug`, but the server endpoint this page
ultimately relies on has never been called with an org filter — so the in-memory
collection is "whole world" data. When the filter predicate is `=== orgSlug`,
the org page is correct in the *steady state*, but a real bug manifests when:

- On first visit to the org `/library` page, the collection is already hydrated
  from a previous platform `/library` visit. The `$effect` derived from the
  live-query runs **before** `organizationSlug` is reliably populated on older
  library entries (the schema only gained this field post-Codex-k7ppt per
  `subscription.ts` comment), and any entry written prior to that migration has
  `organizationSlug === null`. The client filter `item.content.organizationSlug
  === orgSlug` returns `false`, so legacy entries drop out — **but** items whose
  slug happens to match something from another org (e.g. orgs that share a slug
  string through mis-migrated data, or demo content) slip through.
- More importantly, when the user visits `acme.codex.app/library`, the page
  component runs `loadLibraryFromServer()` which hits
  `api.access.getUserLibrary()` **without an org filter** (see
  `apps/web/src/lib/remote/library.remote.ts#getUserLibrary`). The server worker
  (`workers/content-api/src/routes/content-access.ts#/user/library`) scopes to
  `ctx.user.id` only — the Zod schema `listUserLibrarySchema` supports
  `organizationId` but the client never passes it. The server therefore returns
  the whole library; the store gets whole-library data; the "org library" view
  inherits the user's cross-org contents.

Evidence:

- `apps/web/src/lib/collections/library.ts#libraryCollection` — single
  `localStorageCollectionOptions({ storageKey: 'codex-library', getKey: item =>
  item.content.id })`. Storage key is not org-scoped.
- `apps/web/src/lib/collections/library.ts#loadLibraryFromServer` — `await
  getUserLibrary({})`. No org filter.
- `apps/web/src/routes/_org/[slug]/(space)/library/+page.svelte` — allItems
  filter: `item.content.organizationSlug === orgSlug`. Filter depends on server
  payload having `organizationSlug` set for every row. `packages/access/src/
  types.ts#UserLibraryResponse.items.content.organizationSlug` is typed
  `string | null` — null rows fail the filter silently, and any null-org row on
  a path that writes to the shared collection via `hydrateIfNeeded('library',
  ...)` stays in the store forever, visible on every org.
- `apps/web/src/routes/(platform)/library/+page.svelte` — writes the whole
  response into `libraryCollection` via `loadLibraryFromServer()` without any
  guarantee that items are tagged to an org. The org page then inherits this
  pollution.

This is **not** a server KV cache bleed. The KV version key
`cache:version:user:{userId}:library` is correctly user-scoped (see
`packages/cache/src/cache-keys.ts#CacheType.COLLECTION_USER_LIBRARY`); the bleed
is entirely client-side in a cross-org shared localStorage collection.

### Affected layers

- `apps/web/src/lib/collections/library.ts` — collection + loader
- `apps/web/src/routes/_org/[slug]/(space)/library/+page.svelte` — consuming
  page, faulty filter semantics
- `apps/web/src/lib/remote/library.remote.ts#getUserLibrary` — does not forward
  `organizationId`
- `workers/content-api/src/routes/content-access.ts` (server endpoint honours
  `organizationId` already — filter already implemented, just unused)

### Fix approach

The cleanest fix mirrors `subscriptionCollection`'s pattern (storage survives
logout clear via `clearClientState`, per-org data is keyed into the same
collection by `organizationId`). Two concrete changes:

1. **Ensure server payload always carries `organizationId`** (not just slug) on
   every library item. Update
   `packages/access/src/services/ContentAccessService.ts#listUserLibrary` /
   `packages/access/src/types.ts#UserLibraryResponse` to expose
   `organizationId: string` (non-null — all content belongs to an org). Bump
   `apps/web/src/lib/collections/library.ts#LibraryItem` derivation. Remove the
   slug-based filter.

2. **Scope the org library page view by `organizationId`, not slug, and
   reconcile only that subset.** In
   `apps/web/src/routes/_org/[slug]/(space)/library/+page.svelte`, change the
   filter to `item.content.organizationId === data.org.id`. Add an
   `onMount` call to `loadLibraryFromServer({ organizationId: data.org.id })`
   (forwarded via `getUserLibrary({ organizationId })`) that does a full-library
   reconciliation (to preserve the platform-wide view) but with an additional
   safeguard: after the reconciliation, `libraryCollection` entries with
   `organizationId === null` or missing must be purged (treat as corrupt legacy
   data — log once and delete).

3. **Invalidate on subdomain switch.** When the root layout detects a hostname
   change that crosses org subdomains (currently not done — `+layout.server.ts`
   treats each subdomain as an independent SvelteKit instance because cookies
   propagate but SPA state doesn't cross origins), `clearClientState()` should
   not be needed per org switch, but adding a one-time migration:
   `loadLibraryFromServer()` at the root layout mount checks for any cached
   entries where `organizationId` is `null` (old schema) and does a
   full-refresh from server. Minimum backfill.

Platform `/library` continues to render the global view via the same store (no
filter predicate), unchanged.

No server KV change — `cache:version:user:{userId}:library` bumps stay correct;
this is purely a client filter / payload shape fix.

---

## Proposed beads tasks

- **[P0, bug]** Fix cross-device auth sync — unconditional `invalidate('app:auth')`
  on visibility-return when `!data.user`, with cooldown. Root layout only.
- **[P0, bug]** Fix cross-org library bleed — add `organizationId` to
  `UserLibraryResponse` + switch org library filter/query to use it.
- **[P1, task]** Migration: backfill `organizationId` on pre-Codex-k7ppt library
  items (server payload fix) and purge `organizationId === null` entries from
  `libraryCollection` on next client hydration.
- **[P1, task]** Forward `organizationId` through
  `getUserLibrary()` → `createServerApi.access.getUserLibrary()` so the server
  path is exercised end-to-end with the filter (tests + remote function typing).
- **[P2, task]** Revisit `AUTH_SESSION_KV` 5-minute cookieCache TTL in the
  context of cross-device revocation: document trade-off or shorten for auth-
  gated content pages (see `docs/caching-strategy.md` "server-authoritative
  always" rule).

## Open questions

- Does the team want cross-device "you signed in on your phone" to be
  **instant** on the laptop (requires SSE/polling on the focussed tab) or
  **on-focus** (the current model, once fixed)? The fix above is on-focus.
- Should the platform `/library` also trim to a smaller per-org "recent"
  view, or keep the global list? Current bug scope is the org page only.

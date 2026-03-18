# Caching Strategy

## The Four Layers

```
Browser HTTP Cache         → static assets only, not API data
SvelteKit query()          → request-scoped dedup within one SSR render
@codex/cache (KV)          → server-side, cross-request, cross-worker
TanStack DB (localStorage) → client-side local-first, persists across tabs
```

These are complementary, not overlapping. Each solves a different problem.

---

## Server-Side: @codex/cache

Cloudflare KV-backed versioned cache. Cache-aside pattern with version-based invalidation.

**Key structure:**
```
cache:version:{id}               → current version string (timestamp)
cache:{type}:{id}:v{version}     → cached data
```

**Invalidation:** bump the version key → all old versioned data instantly stale → expires via TTL. Single atomic KV write.

**Currently wired up:**
- `IdentityService.getProfile()` → `USER_PROFILE`, 10 min TTL
- `IdentityService.getNotificationPreferences()` → `USER_PREFERENCES`, 10 min TTL
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
| `cache:version:user:{userId}:library` | ✅ Yes | Purchase completed (cross-device library staleness) |
| `cache:version:{orgId}` | ✅ Yes | Org settings/branding changed |
| `cache:version:content:published` | ❌ Server KV only | Any content published/unpublished/updated |
| `cache:version:org:{orgId}:content` | ❌ Server KV only | Content in this org changed |

**Why content keys are server-only:** Content availability is "server-authoritative always" — SSR renders the correct published list on every page load. There's no localStorage-backed `contentCollection` to invalidate. Bumping the key on the server means the next SSR request gets a fresh DB fetch instead of a stale KV list.

### `CacheType` constants (in `@codex/cache`)

```typescript
// Entity-level (data cache + client manifest)
CacheType.USER_PROFILE           // 'user:profile'
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
| `CACHE_KV` in content-api / admin-api | ❌ Pending |
| Content invalidation on publish/update | ❌ Pending |
| `CACHE_KV` in ecom-api (purchase → library version) | ✅ Done |
| Platform/org layout version passthrough | ✅ Done |
| Versions endpoint — superseded by depends/invalidate pattern | ✅ Done (design complete, no separate endpoint needed) |
| `initProgressSync` activation | ✅ Done |
| Tab visibility re-invalidation (depends + invalidate pattern) | ✅ Done |

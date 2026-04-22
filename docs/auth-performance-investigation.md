# Auth Performance Investigation — Master Doc

> **Epic:** Codex-byz6 — Auth Performance: Reduce org page load from 2-4s to <1s
> **Issue:** Codex-7byh — Org landing page SSR streaming takes 2-4s
> **Root cause:** Redundant session validation (5-6× per page) + uncached org membership + 2.9s of unnecessary server-side streaming
> **Impact:** Every authenticated org page load pays 800-1000ms in redundant auth + 2.9s in streaming calls that should be client-side
> **Target:** Authenticated org page total load under 1 second

---

## Investigation Summary

Full codebase investigation completed 2026-04-16. Five areas investigated, five implementation design docs created.

### Key Findings

| Finding | Severity | Impact |
|---|---|---|
| Session KV cache likely has near-zero cross-worker hit rate due to token key mismatch | **CRITICAL** | 800-1000ms wasted per page load |
| `checkOrganizationMembership()` is uncached (TODO already in code) | **HIGH** | 200ms per `requireOrgMembership` call, ~46 routes across 5 workers |
| 3 streamed calls (2.9s total) already have client-side stores built | **HIGH** | 2.9s unnecessary server streaming |
| 5-6 redundant session validations per authenticated org page load | **HIGH** | 600ms+ in redundant KV/DB round-trips |
| No HTTP connection pooling or request batching in SvelteKit→worker calls | **MEDIUM** | 30-80ms overhead from multiple round-trips |

---

## Implementation Plan

### Phase 1: Quick Wins (Independent, parallel-safe)

| # | Fix | Sub-doc | Impact | Effort | Dependencies |
|---|---|---|---|---|---|
| 1 | **Session KV cache alignment** | [01-session-kv-cache-alignment.md](auth-performance/01-session-kv-cache-alignment.md) | -800ms (KV hits instead of DB) | 2-4h | None |
| 2 | **Org membership KV cache** | [02-org-membership-kv-cache.md](auth-performance/02-org-membership-kv-cache.md) | -200ms per membership check | 3-4h | None |
| 3a | **Move `isFollowing` to client** | [03-move-streaming-to-client.md](auth-performance/03-move-streaming-to-client.md) (Move B) | -847ms streaming | 1-2h | None |
| 3b | **Move `continueWatching` to client** | [03-move-streaming-to-client.md](auth-performance/03-move-streaming-to-client.md) (Move A) | -1,542ms streaming | 2-3h | None |
| 3c | **Move `subscriptionContext` to client** | [03-move-streaming-to-client.md](auth-performance/03-move-streaming-to-client.md) (Move C) | -567ms streaming | 2-3h | None |

**All Phase 1 fixes are independent — can be implemented in parallel by different agents.**

### Phase 2: Architectural (Requires Phase 1 measurement)

| # | Fix | Sub-doc | Impact | Effort | Dependencies |
|---|---|---|---|---|---|
| 4 | **Trusted internal caller pattern** | [04-trusted-internal-caller.md](auth-performance/04-trusted-internal-caller.md) | Eliminates redundant session validation | 1-2 weeks | Phase 1 measurement |
| 5 | **Batch org context endpoint** | [05-batch-org-context-endpoint.md](auth-performance/05-batch-org-context-endpoint.md) | 4 calls → 1 | 2-3h | Evaluate after Fix 3 |

**Note:** Fix 5 may not be needed if Fix 3 moves enough calls client-side. Evaluate after Phase 1.

### Implementation Order

```
Fix 1 (Session KV)     ─┐
Fix 2 (Membership KV)  ─┤── All independent, parallel-safe
Fix 3a (isFollowing)    ─┤
Fix 3b (continueWatch)  ─┤
Fix 3c (subscription)   ─┘

       ↓ Measure impact ↓

Fix 4 (Trusted caller)  ─── Only if redundant auth is still >200ms after Fix 1
Fix 5 (Batch endpoint)  ─── Only if HTTP overhead is still >50ms after Fix 3
```

---

## The Problem (Detailed)

Profiled the org landing page (`of-blood-and-bones.lvh.me:3000/`) with an authenticated user:

| Metric | Value |
|---|---|
| TTFB (first byte) | 238ms (acceptable — awaited calls are fast) |
| Total (stream complete) | **3.9 seconds** (unacceptable) |
| Streamed call: continueWatching | **1,542ms** |
| Streamed call: isFollowing | **847ms** |
| Streamed call: subscriptionContext | **567ms** |

Individual worker calls (direct, bypassing SvelteKit):

| Call | Auth? | Warm response | Notes |
|---|---|---|---|
| Auth session (no cookie) | — | 11ms | Fast |
| Auth session (with cookie) | Yes | 136-238ms | KV miss → Neon |
| Public org info | No | 28ms | KV cached |
| Public content | No | 46ms | KV cached |
| Public stats | No | 27ms | KV cached |
| Tiers | No | 31ms | KV cached |

**Pattern:** Public/unauthenticated calls are ~30ms (KV hit). Authenticated calls are 136-238ms minimum.

---

## Current Auth Architecture

### Session Validation Flow (per worker call)

```
SvelteKit hooks.server.ts
  └── createServerApi(platform, cookies)
        └── api.auth.getSession()           ← validates session ONCE (sets locals.user)

Then each worker call:
  └── Cookie forwarded in header: "codex-session=X; better-auth.session_token=X"
        └── Worker procedure() → createSessionMiddleware()
              └── extractSessionToken() → decodeURIComponent → split('.')[0]
                    └── KV lookup: try `session:{splitToken}` then `{splitToken}`
                          ├── HIT → parse, check expiry → return user
                          └── MISS → Neon query (sessions JOIN users) ~200ms
                                └── Fire-and-forget KV write: `session:{splitToken}`
```

**Key insight:** SvelteKit validates once, but this is NOT forwarded. Each of 4-5 worker calls re-validates independently.

### Total Validations Per Authenticated Org Page Load

| Path | Worker | Validation | Cost |
|---|---|---|---|
| SvelteKit hook | auth | Cookie → auth worker → KV/DB | 150ms (authoritative) |
| Layout: getBySlug fallback | org-api | Cookie → KV/DB | 10-200ms (redundant) |
| Layout: getCurrent | ecom-api | Cookie → KV/DB | 10-200ms (redundant) |
| Layout: isFollowing | org-api | Cookie → KV/DB | 10-200ms (redundant) |
| Page: getUserLibrary | content-api | Cookie → KV/DB | 10-200ms (redundant) |
| **Total** | | **5 validations** | **150-1000ms** |

### The Smoking Gun: Uncached Org Membership

**File:** `packages/worker-utils/src/procedure/org-helpers.ts:105-147`

```typescript
export async function checkOrganizationMembership(...) {
  // TODO: Add KV caching here for performance    ← THE TODO IS ALREADY THERE
  const membership = await db.query.organizationMemberships.findFirst({ ... });
```

~46 routes across 5 workers (org-api, ecom-api, admin-api, notifications-api, identity-api) use `requireOrgMembership` or `requireOrgManagement`, each hitting Neon uncached. Additionally, `workers/identity-api/src/routes/membership.ts` calls `checkOrganizationMembership()` directly (bypassing the `procedure()` policy).

### Session KV Key Format Mismatch (Likely Root Cause)

**BetterAuth writes** via `createKVSecondaryStorage` (`packages/security/src/kv-secondary-storage.ts:106-112`):
- Passive adapter — stores whatever key BetterAuth passes
- BetterAuth's internal key format is **opaque** to our code

**Worker middleware reads** (`packages/worker-utils/src/auth-middleware.ts:228-240`):
- URL-decodes cookie token
- Splits on `.`: `splitToken = fullToken.split('.')[0]`
- Tries `session:{splitToken}` then `{splitToken}`
- Writes back as `session:{splitToken}`

**If BetterAuth uses the full unsplit token as its key, the worker will never find what BetterAuth cached.**

---

## Streaming Audit

### Current Streaming Timeline

```
t=0ms     Layout: getPublicInfo (200ms, awaited, KV hit)
t=200ms   Page: stats + content (400ms, awaited, KV hits)
t=600ms   ─── FIRST PAINT ───
          Streaming begins:
t=600ms   ├── subscriptionContext (567ms, auth, DB)
t=600ms   ├── isFollowing (847ms, auth, DB)
t=600ms   └── continueWatching (1542ms, auth, DB)
t=2142ms  ─── ALL STREAMS RESOLVED ───
```

### All Three Already Have Client Stores

| Streamed Call | Client Store | Storage | Status |
|---|---|---|---|
| `isFollowing` | `followingStore` | localStorage (`codex-following`) | EXISTS ✓ |
| `subscriptionContext` | `subscriptionCollection` | localStorage (`codex-subscription`) | EXISTS ✓ |
| `continueWatching` | `libraryCollection` | localStorage (`codex-library`) | EXISTS ✓ |

Moving all three to client `onMount()` eliminates 2.9s of server streaming.

---

## SvelteKit → Worker HTTP Overhead

- `createServerApi` creates a fresh `fetch()` per call — no connection pooling
- Per-call fixed overhead: ~3-8ms (headers, AbortController, JSON parse, logging)
- 7-8 total HTTP calls per authenticated org page load
- No request deduplication within a single SSR render
- No aggregate/batch endpoints exist

---

## Measurement Plan

Before and after each fix:

```bash
# Unauthenticated baseline
curl -s -o /dev/null -w "TTFB: %{time_starttransfer}s\nTotal: %{time_total}s\n" \
  http://of-blood-and-bones.lvh.me:3000/

# Authenticated
curl -s -o /dev/null -w "TTFB: %{time_starttransfer}s\nTotal: %{time_total}s\n" \
  -b "codex-session=$SESSION" \
  http://of-blood-and-bones.lvh.me:3000/
```

**Target:** Authenticated org landing page total load under 1 second.

---

## Expected Impact (Cumulative)

| After Fix | Est. Total Load Time | Improvement |
|---|---|---|
| Current state | 3.9s | — |
| Fix 3 (streaming → client) | ~1.0s | -2.9s (streaming eliminated) |
| Fix 1 (session KV) | ~0.6s | -0.4s (KV hits vs DB) |
| Fix 2 (membership KV) | ~0.5s | -0.1s (cached membership) |
| Fix 4 (trusted caller) | ~0.4s | -0.1s (no re-validation) |

**Projected result: ~0.4-0.6s total load time for authenticated org page.**

---

## File Reference

### Investigation Areas → Sub-Docs

| Area | Sub-Doc | Key Files |
|---|---|---|
| Session KV | [01-session-kv-cache-alignment.md](auth-performance/01-session-kv-cache-alignment.md) | `packages/security/src/kv-secondary-storage.ts`, `packages/worker-utils/src/auth-middleware.ts:230-233` |
| Membership | [02-org-membership-kv-cache.md](auth-performance/02-org-membership-kv-cache.md) | `packages/worker-utils/src/procedure/org-helpers.ts:105-147`, `workers/organization-api/src/routes/members.ts`, `workers/identity-api/src/routes/membership.ts` |
| Streaming | [03-move-streaming-to-client.md](auth-performance/03-move-streaming-to-client.md) | `apps/web/src/routes/_org/[slug]/+layout.server.ts:77-90`, `apps/web/src/routes/_org/[slug]/(space)/+page.server.ts:52-64` |
| Trusted caller | [04-trusted-internal-caller.md](auth-performance/04-trusted-internal-caller.md) | `packages/worker-utils/src/procedure/helpers.ts:284-326`, `apps/web/src/lib/server/api.ts` |
| Batch endpoint | [05-batch-org-context-endpoint.md](auth-performance/05-batch-org-context-endpoint.md) | `workers/organization-api/src/routes/` (new), `apps/web/src/routes/_org/[slug]/+layout.server.ts` |

### Key Source Files

| File | Relevance |
|---|---|
| `packages/security/src/kv-secondary-storage.ts` | BetterAuth KV adapter |
| `packages/worker-utils/src/auth-middleware.ts` | Worker session validation (KV read/write) |
| `packages/worker-utils/src/procedure/helpers.ts` | Policy enforcement, session middleware inline |
| `packages/worker-utils/src/procedure/org-helpers.ts` | Uncached `checkOrganizationMembership()` |
| `packages/cache/src/cache-keys.ts` | CacheType constants (needs `ORG_MEMBERSHIP`) |
| `workers/auth/src/auth-config.ts` | BetterAuth configuration |
| `workers/organization-api/src/routes/members.ts` | Membership mutation endpoints (need invalidation) |
| `apps/web/src/hooks.server.ts` | SvelteKit session validation |
| `apps/web/src/lib/server/api.ts` | `createServerApi` — cookie forwarding, HTTP calls |
| `apps/web/src/routes/_org/[slug]/+layout.server.ts` | Org layout — streaming calls |
| `apps/web/src/routes/_org/[slug]/(space)/+page.server.ts` | Org page — continueWatching streaming |
| `apps/web/src/lib/client/following.svelte.ts` | `followingStore` (already exists) |
| `apps/web/src/lib/collections/subscription.ts` | `subscriptionCollection` (already exists) |
| `apps/web/src/lib/collections/library.ts` | `libraryCollection` (already exists) |

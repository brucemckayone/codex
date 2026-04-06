# Customer-Facing Performance Analysis

> Generated: 2026-04-05
> Measured via Playwright on studio-alpha.lvh.me:3000 (local dev)
> User: authenticated as creator@test.com

## Current Performance (Measured)

| Page / Action | Time | Server Reqs | Assessment |
|---|---|---|---|
| Org landing (cold SSR) | **6.3s** DOM | Full SSR | ❌ Unacceptable |
| Org landing (warm, full reload) | **4.3s** | Full SSR | ❌ Unacceptable |
| Explore (cold SSR) | **3.2s** DOM, 5.6s idle | Full SSR | ⚠️ Slow |
| Explore type filter (Video/Audio) | **541ms**, 0 server reqs | None (client-side) | ✅ Good |
| Landing → Explore (client nav) | **1.4s** | `__data.json` | ⚠️ Acceptable |
| Explore → Library (client nav) | **3.1s** | `__data.json` (2s TTFB) | ❌ Slow |
| Library → Explore (warm return) | **349ms** | Cached | ✅ Excellent |
| Landing → Library (client nav) | **2.2s** | `__data.json` (2s TTFB) | ❌ Slow |

## Root Causes — UPDATED WITH PROFILING DATA

### 1. Org Landing Page — The "6s" Was Misleading

**Deep profiling via browser Performance API reveals the actual numbers:**

| Metric | Time | Meaning |
|---|---|---|
| TTFB | **34ms** | Server responds almost instantly |
| HTML download | **3ms** | Tiny SSR HTML payload |
| DOM interactive | **232ms** | Page is interactive |
| DOM content loaded | **232ms** | All critical JS parsed |
| Load event | **340ms** | Full page load |
| Total resources | **5** | Only 5 network requests |
| Cache-Control | `public, max-age=300, s-maxage=300` | ✅ CDN-cacheable for 5 min |

**The actual page loads in 340ms. The 6-8s numbers were `networkidle` waiting for slow thumbnail images.**

Three media thumbnails each take **2,655ms** to load from the local dev-cdn (Miniflare R2). In production on Cloudflare R2 with CDN edge caching, these would be ~50-100ms.

**SSR performance is GOOD. The bottleneck is thumbnail serving in dev.**

### Landing page is NOT broken — it's dev-mode image loading

The org layout server load chain works correctly:
1. `api.org.getPublicInfo(slug)` — KV-cached (30min TTL) ✅
2. `readOrgVersions()` — lightweight KV reads ✅
3. `getPublicContent()` — awaited for hero (fast — simple DB query) ✅
4. `getPublicCreators()` — streamed (non-blocking) ✅
5. `getUserLibrary()` — streamed for auth users (non-blocking) ✅
6. Cache-Control header set correctly (DYNAMIC_PUBLIC for unauth) ✅

### What to actually fix
- **Thumbnail loading in dev**: The dev-cdn (Miniflare R2) serves images slowly. Consider lazy-loading thumbnails with `loading="lazy"` on images below the fold.
- **In production**: CDN will serve cached thumbnails in ~50ms. The landing page SSR HTML will be cached at the CDN edge for 5 minutes. Return visits will be near-instant.
- **For authenticated visitors**: Continue watching is streamed (non-blocking). The only per-user overhead is the auth session check.

### 2. Library Page (2-3s) — Personal Data, No SEO Value

The library `__data.json` takes 2s because:
- `+page.server.ts` calls `await parent()` (org layout chain)
- Then fetches user library via `api.access.getUserLibrary()`
- All filters/sort trigger `goto()` → new `__data.json` → full re-fetch

**This page has NO SEO value** — it's personal content behind auth. There's no reason to SSR it.

### 3. Explore Page (3.2s cold, 349ms warm) — Partially Fixed

Type/category filters are now instant (client-side via TanStack DB). But:
- Initial load still SSR's everything (correct for SEO)
- Search/sort changes trigger server round-trips (correct — need DB queries)
- Return visits (warm) are fast because SvelteKit caches the data

## Strategy: What Should Be SSR'd vs Client-Side

### Must SSR (SEO + first paint)
| Page | What to SSR | What to stream/defer |
|---|---|---|
| Org landing | Hero, org name/description, new releases grid | Continue watching (auth), creators |
| Explore | Content grid (first page), filters structure | Nothing — already working |
| Content detail | Title, body, metadata | Related content, access/progress |
| Creator profiles | Profile info, content list | Stats |

### Should NOT SSR (personal/dynamic, behind auth)
| Page | Current | Target |
|---|---|---|
| Library | Full SSR + server load | Client-side fetch like studio |
| Account/settings | SSR | Client-side fetch |
| Checkout success | SSR | Minimal server load |

### Should be aggressively cached
| Page | Cache Strategy | TTL |
|---|---|---|
| Org landing (unauth) | CDN/HTTP cache of SSR HTML | 5 min (DYNAMIC_PUBLIC) |
| Explore (unauth) | CDN/HTTP cache | 5 min |
| Org branding/layout | KV cache | 30 min (✅ already done) |
| Content metadata | KV cache | 10 min |

## Proposed Improvements

### Phase 1: Library Page → Client-Side (like studio)
Same pattern as studio: remove `+page.server.ts`, fetch library data via remote functions in `onMount`/`$derived`. All filters become instant client-side. Continue watching section loads from localStorage-backed `libraryCollection`.

**Expected result**: Library navigation instant (~300ms like studio), filters instant.

### Phase 2: Org Landing Performance
The landing page should render near-instantly for return visitors:
1. **HTTP caching for unauth visitors**: The `DYNAMIC_PUBLIC` header (5 min) means Cloudflare CDN caches the full HTML. In production, this means instant loads. In dev, there's no CDN — so the 6s is dev-only overhead.
2. **For auth visitors**: The landing page sets `PRIVATE` but still re-renders everything. Consider:
   - Cache the public portion (hero, new releases) separately
   - Only fetch "continue watching" client-side (like library)
   - The hero section doesn't change per-user — it could use the same cached HTML

### Phase 3: SvelteKit Navigation Caching
When navigating between pages via links (not full reloads), SvelteKit fetches `__data.json`. These responses could be:
- Cached client-side (TanStack Query with staleTime)
- Prefetched on hover (already enabled via `data-sveltekit-preload-data="hover"`)
- The `depends()` + `invalidate()` pattern prevents stale data

The key gap: SvelteKit re-runs server loads on every client-side navigation. For pages with `depends('cache:...')`, the layout data is cached, but the page data always re-fetches. This is why Library takes 2s on every visit — its page server load always runs.

## Dev vs Production Performance Note

Local dev (Miniflare + Vite) is significantly slower than production (Cloudflare Workers + CDN):
- Miniflare simulates Workers but with Node.js overhead
- Vite does on-demand module compilation (adds 200-500ms per new module)
- No CDN layer — every request hits the dev server
- No HTTP caching (dev sets `no-cache` headers)

Production estimates (based on Cloudflare Workers typical latency):
- SSR render: ~50-200ms (vs 500-2000ms local)
- KV reads: ~5-10ms (vs 20-50ms local)
- DB queries: ~50-100ms (vs 200-500ms local)
- CDN-cached responses: ~5-20ms (vs N/A local)

The 6s landing page in dev would likely be ~500ms-1s in production for first visit, and near-instant for CDN-cached return visits.

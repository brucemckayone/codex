# Feasibility Classification — API Cross-Reference

**Purpose**: Every ideation idea classified as frontend-only or needs-backend, ranked by effort.
**Date**: 2026-04-04

**Scope exclusions** (per your feedback):
- No gamification (badges, streaks, leaderboards)
- No offline/PWA/download features
- No content calendar
- No student counts (for now)
- No reviews/ratings (not implemented yet — future)
- No bundles/series entity (future feature)
- No content scheduling

---

## API Surface Summary

### Key Content API Capabilities

| Feature | Auth Endpoint | Public Endpoint |
|---------|--------------|-----------------|
| Search (`?search=`) | Yes | Yes |
| Type filter (`?contentType=`) | Yes | Yes |
| Category filter (`?category=`) | Yes | **No** |
| Creator filter (`?creatorId=`) | Yes | **No** |
| Sort by viewCount | Yes | **No** |
| Sort by purchaseCount | Yes | **No** |
| Sort by title | Yes | Yes |
| Visibility filter | Yes | **No** |
| Pagination | Yes | Yes |

**Implication**: Many "explore" features work for authenticated users but NOT for anonymous visitors via the public endpoint. This is a key gap.

### Admin Analytics APIs (Exist, Underutilized)
- `GET /api/admin/analytics/dashboard-stats` — combined revenue + customers + top content in one call
- `GET /api/admin/analytics/revenue` — **already returns `revenueByDay` array** with `{ date, revenueCents, purchaseCount }`
- `GET /api/admin/activity` — unified activity feed with type filtering
- These are **already built** — the frontend just doesn't use them fully.

### Public Creators API Returns
`{ name, avatarUrl, role, joinedAt, contentCount }`
**Missing**: bio, username, socialLinks, specialties/tags

### Content Schema Has (in DB, potentially exposable)
`category`, `tags` (jsonb), `viewCount`, `purchaseCount`, `priceCents`, `durationSeconds` (on media)

### User Schema Has (in DB, available)
`username` (unique), `bio`, `socialLinks` (jsonb: website/twitter/youtube/instagram) — all set via profile update

---

## TIER 1: Frontend-Only (No API Changes)

These use existing endpoints and data. Pure UI/UX work.

### Effort: Small (1-2 hours each)

| # | Idea | Page | What to do |
|---|------|------|-----------|
| 1.1 | **Loading skeleton states** for content grids | All pages | Use existing Skeleton component on content grids during fetch |
| 1.2 | **View toggle** (grid/list) with localStorage persistence | Explore, Library | Add toggle state, render same data in list layout, save pref |
| 1.3 | **"View All" links** on landing page sections | Org Landing | Add href="/explore" below featured section |
| 1.4 | **Active nav indicator** in headers | All headers | Add CSS class based on current route (`page.url.pathname`) |
| 1.5 | **Breadcrumbs** on nested studio pages | Studio Content Edit, Settings > Branding | Build simple Breadcrumb component from route |
| 1.6 | **Empty state improvements** | Multiple pages | Use EmptyState component with contextual messaging + illustrations |
| 1.7 | **Content type icon overlays** on thumbnails | ContentCard | Add icon (Video/Audio/Article) in corner of thumbnail |
| 1.8 | **Duration badge** on content cards | ContentCard | Display `durationSeconds` from media item (already in ContentWithRelations) |
| 1.9 | **Price badge component** | ContentCard | Extract price display into reusable PriceBadge (Free/£29/Purchased) |
| 1.10 | **Card hover animations** | ContentCard | CSS: scale, shadow, smooth transition using brand motion tokens |
| 1.11 | **Mobile hamburger improvements** | OrgHeader | Full-screen slide-out nav overlay with all links + search |
| 1.12 | **"Back to top" button** | Long pages | Appears on scroll, smooth-scrolls to top |
| 1.13 | **Collapsible studio sidebar** | Studio layout | Icon-only mode toggle, save preference in localStorage |

### Effort: Medium (2-4 hours each)

| # | Idea | Page | What to do |
|---|------|------|-----------|
| 1.14 | **Improved org landing hero** | Org Landing | Org logo (large), name, description, tagline, branded background using `--org-brand-*` tokens. Data already in org layout. |
| 1.15 | **Continue Watching section** on org landing | Org Landing | For auth'd users: query libraryCollection for in-progress items filtered by org. Data exists in progress collection. |
| 1.16 | **New Releases section** on org landing | Org Landing | Use `getPublicContent(orgId, sort=newest, limit=6)`. Already fetched — just render a second section. |
| 1.17 | **Category navigation strip** | Org Explore | Extract distinct categories from content items client-side (from loaded data), render as horizontal pill tabs |
| 1.18 | **Sort dropdown improvements** | Explore, Library | Already has sort — add more visual options, better UI (icons per sort) |
| 1.19 | **Filter chips with clear** | Explore, Library | Show active filters as removable chips above grid, "Clear All" button |
| 1.20 | **Library card design** (progress-focused) | Library | Different card variant: progress bar, time remaining, completion badge, NO price |
| 1.21 | **Continue Watching as top section in Library** | Library | ContinueWatching component already exists — make it prominent at page top |
| 1.22 | **Content detail two-state layout** | Content Detail | Distinct preview vs full-access visual treatment. Data (access state) already exists. |
| 1.23 | **"What you'll get" section** on content detail | Content Detail | Static/template section: "HD video", "Lifetime access", "Progress tracking", "Any device" — no API needed |
| 1.24 | **Related content by same creator** | Content Detail | Use `getPublicContent(orgId, sort=newest)` with existing creatorId — client-side filter from already-loaded org content |
| 1.25 | **Checkout success celebration** | Checkout Success | Animated checkmark, "Start Watching" as primary CTA, onboarding tips. All data exists. |
| 1.26 | **Studio dashboard quick actions grid** | Studio Dashboard | 6 icon+label cards linking to create/upload/analytics/team/branding/preview. No API needed. |
| 1.27 | **Studio sidebar badge counts** | Studio Sidebar | Draft count from content list (already loaded), badge on nav item |
| 1.28 | **Enhanced studio switcher** | Studio Header | Show org logo + role badge in switcher. Data from `getMyOrganizations()` already loaded. |
| 1.29 | **Content list search** in studio | Studio Content | Add search input, use existing `?search=` param on content list API |
| 1.30 | **Customer search** in studio | Studio Customers | Add search input — need to check if admin customers endpoint supports search |
| 1.31 | **Creator profile hero** improvements | Creator Profile | Larger avatar, tagline, stats strip (content count from loaded data), social links row |
| 1.32 | **Org affiliations section** on creator profile | Creator Profile | Already derived from content items. Improve visual: org logos, role badges, links |
| 1.33 | **Shared content detail template** refactor | Content Detail (both) | Extract shared component used by both org and creator content detail — reduce duplication |
| 1.34a | **Revenue time series chart** on dashboard | Studio Dashboard | API already returns `revenueByDay[]` via `dashboard-stats` endpoint. RevenueChart component exists. Wire it up with date range controls. |
| 1.34b | **Dashboard stats from single endpoint** | Studio Dashboard | Use `GET /api/admin/analytics/dashboard-stats` instead of multiple calls. Returns revenue + customers + content + top items in one response. |

### Effort: Large (4-8 hours each)

| # | Idea | Page | What to do |
|---|------|------|-----------|
| 1.34 | **Reusable ContentCard component** (proper) | Shared | Multiple variants (explore/library/featured/compact), configurable props, design token aware |
| 1.35 | **Reusable FilterBar component** | Shared | Extract from explore page: filter config array, active state, URL sync, responsive layout |
| 1.36 | **Horizontal carousel component** | Shared | Scrollable row with nav arrows, snap points, touch support, "View All" link |
| 1.37 | **SearchBar component** (global) | Headers | Debounced input, search scope, recent searches (localStorage), suggestion dropdown |
| 1.38 | **Org landing page full redesign** | Org Landing | Hero + new releases + continue watching + creator preview + categories — combining 1.14-1.17 |
| 1.39 | **Command palette** (Cmd+K) | Studio | Search pages/content/actions, keyboard navigation, recent items |
| 1.40 | **Content detail preview state** | Content Detail | Preview video auto-play (muted), gradient overlay, purchase CTA section, trust badges |
| 1.41 | **DataTable enhancement** | Studio | Sortable columns, selectable rows, bulk actions bar, column visibility toggle |

---

## TIER 2: Needs Backend — Small Changes (1-2 hour API work)

Existing endpoints need minor additions/modifications.

| # | Idea | Page | API Change Needed | Risk |
|---|------|------|-------------------|------|
| 2.1 | **Category filter on public content** | Explore (unauth) | Add `?category=` param to `/api/content/public` endpoint | Low — same query pattern as auth endpoint |
| 2.2 | **Creator filter on public content** | Explore (unauth) | Add `?creatorId=` param to `/api/content/public` endpoint | Low |
| 2.3 | **Sort by popularity on public content** | Explore, Landing | Add `sort=popular` option to `/api/content/public` (uses viewCount/purchaseCount) | Low |
| 2.4 | **Creator bio + username in public creators** | Creators page | Add `bio`, `username`, `socialLinks` to `getPublicCreators()` response | Low — fields exist in users table |
| 2.5 | **Search on admin customers** | Studio Customers | Add `?search=` param to `/api/admin/customers` endpoint (search name/email) | Low |
| ~~2.6~~ | ~~Library filtered by org~~ | ~~Org Library~~ | **MOVED TO TIER 1** — library endpoint ALREADY supports `?organizationId=` filter + `?filter=` (all/in_progress/completed/not_started) + `?sortBy=` (recent/title/duration) | N/A |
| 2.7 | **Distinct categories endpoint** | Explore, Landing | New: `GET /api/content/public/categories?orgId=` returning `[{name, count}]` | Low — simple `SELECT DISTINCT category` |
| 2.8 | **Creator list on landing page** | Org Landing | Already exists: `getPublicCreators(slug, {limit: 3})` — just call it in landing page loader | Very low — endpoint exists, just needs frontend wiring |

---

## TIER 3: Needs Backend — Medium Changes (2-8 hour API work)

New endpoints or significant modifications.

| # | Idea | Page | API Change Needed | Risk |
|---|------|------|-------------------|------|
| 3.1 | **Related content endpoint** | Content Detail | New: `GET /api/content/public/related?contentId=&orgId=` — returns same-category content excluding current item | Medium — new query logic |
| 3.2 | **Related creators** | Content Detail | New: `GET /api/organizations/public/:slug/creators?exclude=&limit=3` — or reuse existing with offset | Low-Med |
| 3.3 | **Featured content flag** | Landing page | Add `featured` boolean column to content table + expose in API + admin toggle | Medium — schema migration |
| ~~3.4~~ | ~~Revenue time series~~ | ~~Analytics~~ | **MOVED TO TIER 1** — `/api/admin/analytics/revenue` already returns `revenueByDay[]` array | N/A |
| 3.5 | **Content funnel data** | Analytics | New: endpoint returning views → purchases conversion per content | Medium — aggregation query |
| ~~3.6~~ | ~~Customer detail view~~ | ~~Studio Customers~~ | **MOVED TO TIER 1** — `GET /api/admin/customers/:id` ALREADY EXISTS and returns profile + purchase history via `getCustomerDetails()` | N/A |
| 3.7 | **Bulk content operations** | Studio Content | New: `POST /api/content/bulk` for publish/archive/delete multiple items | Medium — batch logic |
| 3.8 | **Activity feed real-time** | Studio Dashboard | Consider SSE or polling for live activity feed updates | Medium-High — new pattern |
| 3.9 | **Cross-org content suggestions** | Content Detail | New: `GET /api/content/public/discover?exclude=&category=&limit=3` — content from other orgs | Medium — cross-org query |

---

## TIER 4: Not Now (Future / Advanced)

Ideas explicitly deferred or requiring significant new systems.

| Idea | Reason |
|------|--------|
| Reviews/ratings/comments | No review system exists. Needs new tables, moderation, etc. |
| Bundles/series/collections | No bundle entity. Needs new tables, pricing logic, access grants. |
| Learning paths | Needs content ordering system, progress tracking per path. |
| Following/feed system | Needs follow table, feed generation, notification triggers. |
| Content scheduling | Needs cron/queue for timed publish. |
| Subscriptions | Stripe subscription billing not implemented. |
| Download/offline | Needs download token system, PWA infrastructure. |
| Gamification | Not wanted. |
| Content calendar | Too advanced for now. |
| Custom domains | DNS, SSL, routing changes. |
| Newsletter/email signup | Needs email collection + integration with notifications service. |
| Student count per creator | Needs purchase aggregation endpoint (could be Tier 2 but deprioritized). |

---

## RECOMMENDED IMPLEMENTATION ORDER

### Phase A: Quick Wins (1-2 days total)
All frontend-only, highest visual impact:

1. **1.14** — Improved org landing hero (branded background, logo, tagline)
2. **1.16** — New Releases section on landing
3. **2.8** — Creator list on landing (API exists, just wire it)
4. **1.1** — Loading skeleton states on all grids
5. **1.8 + 1.9** — Duration + price badges on ContentCard
6. **1.10** — Card hover animations
7. **1.7** — Content type icon overlays

### Phase B: Core UX Improvements (3-5 days)
Mix of frontend-only and small backend:

8. **1.15** — Continue Watching on org landing (auth'd users)
9. **2.1 + 2.2 + 2.3** — Category, creator, popularity filters on public content API
10. **1.17** — Category navigation strip on explore
11. **1.34** — Reusable ContentCard component (all variants)
12. **1.22 + 1.40** — Content detail two-state layout (preview vs full)
13. **1.23** — "What you'll get" section
14. **2.4** — Creator bio + username in public creators response
15. **1.29** — Content list search in studio

### Phase C: Navigation & Components (3-5 days)

16. **1.37** — SearchBar component (global, all headers)
17. **1.36** — Horizontal carousel component
18. **1.35** — Reusable FilterBar component
19. **1.5** — Breadcrumbs on studio pages
20. **1.13** — Collapsible studio sidebar
21. **1.28** — Enhanced studio switcher
22. **1.27** — Sidebar badge counts
23. **1.33** — Shared content detail template refactor

### Phase D: Deeper Features (5-8 days)
Mix of backend work + larger frontend effort:

24. **1.34a** — Revenue time series chart (API exists! Just wire it up) — **moved from Tier 3**
25. **Customer detail view** — API already exists (`/api/admin/customers/:id`) — just build the UI — **moved from Tier 3**
26. **3.1** — Related content endpoint + UI (needs backend)
27. **1.24** — Related content section on content detail
28. **3.2** — Related creators on content detail
29. **2.7** — Categories endpoint for proper category browsing (needs backend)
30. **1.38** — Full org landing page redesign (combining all landing pieces)
31. **1.41** — Enhanced DataTable for studio
32. **2.5** — Customer search (needs small backend change)

---

---

## Verification Corrections (2026-04-04)

Items moved after code verification:

### Moved FROM Tier 2/3 TO Tier 1 (Frontend-Only)

| Item | Was | Now | Reason |
|------|-----|-----|--------|
| **Library org filtering** (2.6) | Tier 2 | Tier 1 | `listUserLibrarySchema` already has `organizationId`, `filter` (all/in_progress/completed/not_started), `sortBy` (recent/title/duration) |
| **Customer detail view** (3.6) | Tier 3 | Tier 1 | `GET /api/admin/customers/:id` already exists, calls `getCustomerDetails(orgId, customerId)` |
| **Revenue time series** (3.4) | Tier 3 | Tier 1 | Revenue endpoint already returns `revenueByDay[]` array |
| **Dashboard combined stats** (new 1.34b) | Not listed | Tier 1 | `GET /api/admin/analytics/dashboard-stats` already returns combined data |

### New Gap Identified: Public Creator Profile Endpoint

The frontend calls `GET /api/user/public/{username}` on creator profile pages but **this endpoint does not exist in the identity-api worker**. The call is wrapped in a try/catch with the comment `"Profile endpoint may not exist yet - degrade gracefully"`.

**Impact**: Creator profile enhancement features (richer bio, social links, stats) require this endpoint to be built. This is a **Tier 2 backend change** — add a public read-only endpoint to the identity worker:

```
GET /api/user/public/:username
  Auth: none
  Returns: { id, name, username, bio, image, avatarUrl, socialLinks, role }
```

This affects items: 1.31 (creator profile hero), 1.32 (org affiliations on profile), 15-series ideation.

### Confirmed Correct

All other claims verified accurate:
- Public content endpoint: no category/creator/popularity sort (confirmed)
- Auth'd content endpoint: supports viewCount/purchaseCount sort (confirmed)
- Public creators: returns only name/avatarUrl/role/joinedAt/contentCount (confirmed)
- Activity feed: supports `?type=` filter (confirmed)
- Content table: has viewCount, purchaseCount, category, tags columns (confirmed)
- Admin customers endpoint: no search param (confirmed)

### Additional API Capabilities Found (Not Previously Documented)

| Endpoint | What It Does | Useful For |
|----------|-------------|-----------|
| `GET /api/admin/customers/:id` | Customer detail with purchase history | Studio customers page (Tier 1) |
| `POST /api/admin/customers/:customerId/grant-access/:contentId` | Grant free content access | Studio customers (grant access button) |
| Library `?filter=in_progress` | Filter by watch progress state | Library continue watching, completion sections |
| Library `?sortBy=duration` | Sort by content duration | Library sorting options |
| `POST /api/transcoding/retry/:id` | Retry failed transcoding | Studio media page (retry button) |
| `GET /api/organizations/public/:slug/info` | Full org info + branding (no auth) | Already used by org layout |

---

## Your Feedback Integration Notes

| Your Note | Where It Lands |
|-----------|---------------|
| "Creator list on landing page" | Added as 2.8 — API exists, just needs wiring. Phase A. |
| "Dynamic hero is cool" | 1.14 in Phase A — branded hero using existing org tokens |
| "Creator provenance on explore" | 2.2 (creator filter on public API) + card showing creator name |
| "Learning paths — even for landing" | Tier 4 for now (needs content ordering system) |
| "Responsive + tokens mandatory" | Every item above assumes full token usage + responsive design |
| "Creators page needs more thought" | 2.4 adds bio/username/social to API. Specialty tags need new field. |
| "Continue watching is good" | 1.15 (landing) + 1.21 (library top) — both frontend-only |
| "No gamification" | Removed from all tiers |
| "No offline/download" | Removed from all tiers |
| "Two-state content detail" | 1.22 + 1.40 in Phase B |
| "Related content + related creators" | 3.1 + 3.2 in Phase D (needs backend) |
| "Reviews/ratings/comments — future" | Tier 4 |
| "Bundles/series — advanced" | Tier 4 |
| "Cross-org suggestions" | 3.9 in Tier 3 |

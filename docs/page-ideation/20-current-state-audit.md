# Current State Audit — Corrections & Detailed Findings

**Purpose**: Supplements the ideation docs (01-19) with accurate current-state data from a full codebase read.
**Date**: 2026-04-04

---

## Key Corrections to Ideation Docs

The ideation docs assumed some pages were sparser than they actually are. Here's the reality:

### Pages That Are More Complete Than Expected

| Page | Assumed State | Actual State |
|------|--------------|--------------|
| **Org Landing** | "No hero" | Has hero with org logo, name, description, Explore CTA. Shows 6 featured items with ContentCard. |
| **Org Explore** | "No filtering" | Has search input, type filter buttons (All/Video/Audio/Article), sort dropdown, pagination. URL-driven filters. |
| **Content Detail** | "Basic" | Comprehensive: 3-tier access control (public→auth→streaming), preview player, article rendering (Tiptap+markdown), form-based purchase with Stripe redirect. |
| **Org Library** | "Basic" | Has sort dropdown, LibraryFilters component, progress tracking, completion badges, pagination, cross-org platform library link. |
| **Studio Dashboard** | "Very sparse" | Has 4 role-gated stat cards + ActivityFeed component showing purchases/publishes/signups. |
| **Studio Analytics** | "Very minimal" | Has date preset buttons (7d/30d/90d/year), 3 summary cards (revenue/purchases/AOV), RevenueChart, TopContentTable. |
| **Studio Media** | "Basic" | Full CRUD with status/type filter buttons, MediaUpload with completion callback, MediaGrid, EditMediaDialog. |

### Pages That Really Are Sparse

| Page | Current Reality |
|------|----------------|
| **Org Creators** | Just a grid of CreatorCards + pagination. No search, no sort, no filtering. Username derivation fragile (transforms display name, not using username field). |
| **Creator Profile** | Centered profile header + content grid. Follow button is UI-only (navigates to login). Orgs inferred from content items, not explicit API. |
| **Creator Studio Dashboard** | Literally just 3 navigation cards (Content, Media, Settings). No stats at all — backend doesn't support creator-scoped queries without orgId. |
| **Studio Branding** | Logo upload works, but brand editor is separate floating panel (Edit Brand Live). Color/font/shape editing not in this page. |
| **Creators Layout** | Minimal header with static nav links. No customization or branding. |

---

## Component Library — What Actually Exists

### Confirmed Existing Components (Not Just Stories)

| Component | Location | Props/Features |
|-----------|----------|---------------|
| **ContentCard** | `ui/ContentCard/` | Reusable content display card. Used across landing, explore, library, creator pages. |
| **CreatorCard** | `ui/CreatorCard/` | Creator display card. Used on creators page, creator profile orgs section. |
| **ContentTable** | `studio/ContentTable` | Title link, type badge, status dot, created date, publish toggle, edit link. Optimistic updates. |
| **ContentForm** | `studio/ContentForm` | Complex composite: ContentTypeSelector, ContentDetails, MediaSection, WrittenContentEditor, ThumbnailUpload, PublishSidebar. |
| **StatCard** | `studio/StatCard` | Label, value, optional % change badge, loading skeleton. |
| **ActivityFeed** | `studio/ActivityFeed` | Event type icons (purchase/publish/member_joined), title, description, timestamp. |
| **MediaUpload** | `studio/MediaUpload` | Upload zone with completion callback. |
| **MediaGrid** | `studio/MediaGrid` | Grid of MediaCards with onEdit/onDelete callbacks. |
| **MediaCard** | `studio/MediaCard` | Thumbnail, title, status, action buttons. |
| **RevenueChart** | `studio/RevenueChart` | Line/bar chart of daily revenue. |
| **TopContentTable** | `studio/TopContentTable` | Revenue-ranked content table with skeleton loading. |
| **CustomerTable** | `studio/CustomerTable` | Read-only table (email, purchases, total spent, joined). |
| **MemberTable** | `studio/MemberTable` | Role dropdown, remove action. |
| **LogoUpload** | `studio/LogoUpload` | Logo upload with preview and delete. |
| **LibraryFilters** | `library/LibraryFilters` | Filter component for library page. |
| **ContinueWatching** | `library/ContinueWatching` | Continue watching section. |
| **PageHeader** | `ui/PageHeader` | Title, optional description, optional actions slot. |
| **EmptyState** | `ui/EmptyState` | Centered placeholder with title, description, icon, action slot. |
| **ErrorBanner** | `ui/Feedback/ErrorBanner` | Error display with title + description. |
| **Spinner** | `ui/Feedback/Spinner` | Loading spinner. |
| **NavigationProgress** | `ui/Feedback/NavigationProgress` | Page load progress bar. |
| **Alert** | `ui/Alert` | Variant-based alert (success/error/warning/info). |
| **ProgressBar** | `ui/ProgressBar` | Linear progress indicator. |
| **ResponsiveImage** | `ui/ResponsiveImage` | Responsive image wrapper. |

### Confirmed Missing (Updates Doc 19)

These were identified as missing by the component audit:
- **DatePicker** — Analytics uses button presets only, no calendar picker
- **Breadcrumb** — No breadcrumb component anywhere
- **Drawer/SlidePanel** — No slide-out drawer component
- **SearchBar** (global) — Search is inline per-page, not reusable
- **FilterBar** (reusable) — Filters built inline per-page
- **Carousel/HorizontalScroll** — No horizontal scrolling component
- **Chart library** — RevenueChart exists but no reusable chart system
- **CommandPalette** — Does not exist
- **Combobox/Autocomplete** — No search-with-suggestions
- **Stepper/Wizard** — No multi-step form component
- **TreeView** — Not needed yet but noted
- **BulkActionBar** — No bulk selection/action component

---

## Patterns & Inconsistencies Found

### Good Patterns (Keep These)
- URL-driven filters across all list pages (SEO-friendly, bookmarkable)
- Reactive `$derived` for computed state from URL params
- SSR-safe data hydration via `hydrateIfNeeded()` + `useLiveQuery(ssrData)`
- Progressive enhancement with remote `form()` on all mutations
- Role-gated UI sections (admin-only stat cards, etc.)
- Consistent use of design tokens (no hardcoded values found)
- Graceful empty states with EmptyState component + action slot
- Error handling with specific messages (401/503/generic)

### Inconsistencies to Address
- **Hardcoded currency**: "GBP" appears in ContentCard, checkout pages, library — should come from org/platform settings
- **Hardcoded limits**: 6 featured items, 12 content per page, 20 creators per page — should be configurable
- **Duplicate code**: Creator content detail is nearly identical to org content detail (could refactor shared template)
- **Sort mapping opacity**: Library page maps `watched` → `recent`, `az`/`za` → `title` — unclear without reading loader
- **Type naming mismatch**: UI uses "article" but API uses "written" — inconsistent across pages
- **Username derivation**: `name.toLowerCase().replace(/\s+/g, '-')` is fragile; should use dedicated username field from API
- **Follow button**: Exists in UI but only navigates to login; no follow action implemented
- **Organizations inference**: Creator profile derives org list from content items, not from an explicit membership API call

---

## Quick Wins Identified by Research

### Highest Impact, Lowest Effort

1. **Extract shared content detail template** — Org + creator versions are 95% identical
2. **Add loading skeleton states** to content grids (Skeleton component exists but not used in grids)
3. **Centralize currency constant** — Replace hardcoded "GBP" strings with org/platform setting
4. **Use username field** in CreatorCard instead of name-to-slug transformation
5. **Add "View All" links** to landing page sections (currently just top CTA)
6. **Add breadcrumbs** to nested studio pages (Content Edit, Settings > Branding)
7. **Add customer search** on studio customers page (search input exists in other pages)
8. **Add content search** on studio content list (currently no search)
9. **Show creator bio** in CreatorCard on creators page (data exists, not displayed)
10. **Make featured content limit configurable** instead of hardcoded 6

### Medium Impact, Medium Effort

1. **Reusable SearchBar component** extracted from explore page pattern
2. **Reusable FilterBar component** extracted from explore/library pattern
3. **Bulk actions** on studio content list (publish/archive/delete selected)
4. **Customer detail view** (drawer or page) showing purchase history + engagement
5. **Content recommendations** ("More from this creator" / "Similar content")
6. **Date range picker** for analytics (replace button presets)
7. **Creator stats** on profile (follower count, total views, content count)
8. **Social sharing buttons** on content detail page
9. **Studio command palette** (Cmd+K) for power user navigation
10. **Enhanced studio switcher** with org logos and role badges

---

## Data Flow Summary

### What's Already Wired

| Feature | API | Cache | Collection | Status |
|---------|-----|-------|------------|--------|
| Content listing | content API (public) | DYNAMIC_PUBLIC (5min) | contentCollection | Working |
| User library | access API (auth) | PRIVATE | libraryCollection (localStorage) | Working |
| Watch progress | progress API | N/A | progressCollection (localStorage) | Working |
| Org branding | identity/org API | KV-cached | N/A (CSS vars) | Working |
| Version staleness | KV versions | cache:versions | Invalidation cycle | Working |
| Org members | org membership API | DYNAMIC_PUBLIC | N/A | Working |
| Revenue/analytics | admin API | PRIVATE | N/A | Working |
| Media items | content API | PRIVATE | N/A | Working |
| Stripe checkout | ecom API | N/A | N/A | Working |

### What's Not Wired

| Feature | Needed For | Status |
|---------|------------|--------|
| Content popularity/trending | Landing page trending section | No endpoint |
| Creator follower count | Creator profile stats | No endpoint |
| Customer detail view | Studio customers | No detail endpoint |
| Content recommendations | Content detail page | No recommendation engine |
| Aggregate creator stats | Creators page | No aggregation endpoint |
| Activity feed (real-time) | Studio dashboard | Static fetch, no live updates |
| Featured content admin selection | Landing page | No admin flag/setting |
| Content collections/bundles | Landing + explore | No bundle entity |
| Testimonials/reviews | Landing + content detail | No review system |

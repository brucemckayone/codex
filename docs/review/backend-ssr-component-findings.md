# Backend, SSR & Component Review — Consolidated Findings

> Cross-referenced from: 3 specialist agents (security+database, SSR+data-flow, component+architecture)
> Generated: 2026-04-05
> Scope: ~78 files changed across 10 commits (Apr 2-5)
> Excludes: All items already in `action-plan.md` (ACT-001 through ACT-036)

## Executive Summary

| Metric | Count |
|--------|-------|
| Files reviewed | ~94 (across 3 agents, with overlap) |
| Blocking issues | 4 |
| Warnings | 17 |
| Info | 10 |
| **Total unique issues** | **31** |

Three specialist agents reviewed security/database patterns, SSR/data-flow correctness, and component quality/architecture. The backend service layer is strong — auth policies, query scoping, and Zod validation are applied consistently. The primary gaps are: (1) missing error boundaries in the entire `_org` route tree, (2) pervasive i18n violations in new components, (3) an XSS vector in the markdown rendering path, and (4) a raw Error throw that bypasses the typed error system.

---

## BLOCKING (Must Fix)

### SEC-001: Raw `throw new Error()` in ContentAccessService
- **Domain**: SERVICE
- **File**: `packages/access/src/services/ContentAccessService.ts:338`
- **Description**: `throw new Error('INVALID_MEDIA_TYPE')` bypasses typed ServiceError pattern. `InvalidContentTypeError` exists in `../errors.ts` but is never used. Raw Error produces opaque 500 instead of semantic error response.
- **Fix**: `throw new InvalidContentTypeError(input.contentId, mediaType);`
- **Remediation**:
  1. Add `InvalidContentTypeError` to imports
  2. Replace the raw throw
  3. Add to re-throw check in outer catch block (lines 388-392)

### SSR-001: No `+error.svelte` anywhere in `_org/[slug]` route tree
- **Domain**: ERROR-BOUNDARY
- **File**: `apps/web/src/routes/_org/[slug]/` (entire tree)
- **Description**: Zero error boundary files in the org route hierarchy. Any server load error (org 404, content fetch failure, studio auth failure) bubbles to root `+error.svelte` — rendering without org branding or studio chrome. The `_creators` tree has 10 error boundaries at every level.
- **Fix**: Create at minimum:
  - `apps/web/src/routes/_org/[slug]/+error.svelte` (org-level, with org chrome)
  - `apps/web/src/routes/_org/[slug]/studio/+error.svelte` (studio-level, with sidebar)
  - `apps/web/src/routes/_org/[slug]/(space)/+error.svelte` (space-level, with org header)

### SSR-002: Studio sub-pages consume `data.*` properties with no server load source
- **Domain**: SSR
- **Files**:
  - `_org/[slug]/studio/+page.svelte` → references `data.stats`, `data.activities`
  - `_org/[slug]/studio/customers/+page.svelte` → references `data.customers`
  - `_org/[slug]/studio/content/[contentId]/edit/+page.svelte` → references `data.content`, `data.mediaItems`
  - `_org/[slug]/studio/content/new/+page.svelte` → references `data.organizationId`, `data.mediaItems`
- **Description**: These 4 pages destructure `data` from `$props()` but have no `+page.server.ts` or `+page.ts`. The parent studio layout only returns `org`, `userRole`, `orgs`, `studioUser`, `badgeCounts`. SSR render will have undefined/empty data. Dashboard shows `--` placeholders on first paint.
- **Fix**: Add `+page.server.ts` for each page, or verify data contract through layout cascade and document it.

### I18N-001: Hardcoded English in CommandPalette (all labels, ~15 strings)
- **Domain**: I18N
- **File**: `apps/web/src/lib/components/command-palette/CommandPalette.svelte`
- **Description**: Every label in `pageItems` and `actionItems`, the placeholder, group labels ("Pages", "Actions"), "No results found", and footer hints ("Navigate", "Select", "Close") are hardcoded English. The entire component is untranslatable.
- **Fix**: Define paraglide keys for all ~15 strings and use `m.*()` calls.

---

## WARNINGS (Should Fix)

### SEC-002: `{@html}` rendering of markdown without sanitization (XSS vector)
- **Domain**: SECURITY
- **Files**: `apps/web/src/lib/editor/render.ts:25-26`, `apps/web/src/lib/components/editor/ProseContent.svelte:19`
- **Description**: Legacy markdown fallback calls `marked.parse()` without HTML sanitization. Output is injected via `{@html html}`. `marked` does not sanitize — embedded `<script>` tags or `onerror` handlers in creator markdown will execute for all viewers. The TipTap JSON path is safe (uses `generateHTML` with known extensions).
- **Fix**: Either sanitize with DOMPurify (`DOMPurify.sanitize(rawHtml)`) or remove the legacy markdown path if no content still uses it.

### SEC-003: No auth check on checkout success pages
- **Domain**: SECURITY
- **Files**: `_creators/checkout/success/+page.server.ts`, `_org/[slug]/(space)/checkout/success/+page.server.ts`
- **Description**: Both pages accept a `session_id` query param and call `api.checkout.verify(sessionId)` without first checking `locals.user`. Unauthenticated users with a session ID can reach the verify endpoint.
- **Fix**: Add `if (!locals.user) redirect(302, '/login');` before session ID extraction.

### OBS-001: `console.error` in studio layout server load
- **Domain**: OBSERVABILITY
- **File**: `apps/web/src/routes/_org/[slug]/studio/+layout.server.ts:38`
- **Description**: `console.error('[STUDIO DEBUG] parent() failed:', err)` logs unfiltered error objects. File already uses `logger` elsewhere. `[STUDIO DEBUG]` prefix suggests leftover debug code.
- **Fix**: `logger.error('studio-layout:parent failed', { error: String(err) });`

### SSR-003: Studio layout missing `CACHE_HEADERS.PRIVATE`
- **Domain**: SSR
- **File**: `apps/web/src/routes/_org/[slug]/studio/+layout.server.ts`
- **Description**: Loads user-specific data (membership role, orgs, draft count) but never calls `setHeaders(CACHE_HEADERS.PRIVATE)`. If a child page forgets to set PRIVATE, user data could be cached publicly.
- **Fix**: Add `setHeaders` to destructured params and call `setHeaders(CACHE_HEADERS.PRIVATE)`.

### SSR-004: Studio content page missing `CACHE_HEADERS.PRIVATE`
- **Domain**: SSR
- **File**: `apps/web/src/routes/_org/[slug]/studio/content/+page.server.ts`
- **Description**: Fetches authenticated content lists scoped by org but does not call `setHeaders`.
- **Fix**: Same as SSR-003.

### I18N-002: Hardcoded English in Carousel (4 strings)
- **File**: `apps/web/src/lib/components/carousel/Carousel.svelte`
- **Strings**: `'View all'`, `'Content carousel'`, `'Scroll left'`, `'Scroll right'`

### I18N-003: Hardcoded English in DataTable (3 strings)
- **File**: `apps/web/src/lib/components/ui/DataTable/DataTable.svelte`
- **Strings**: `"{N} of {M} selected"`, `"Select all rows"`, `"Select row"`

### I18N-004: Hardcoded English in ViewToggle (3 strings)
- **File**: `apps/web/src/lib/components/ui/ViewToggle/ViewToggle.svelte`
- **Strings**: `"View mode"`, `"Grid view"`, `"List view"`

### I18N-005: Hardcoded English in BackToTop (2 strings)
- **File**: `apps/web/src/lib/components/ui/BackToTop/BackToTop.svelte`
- **Strings**: `"Back to top"` (aria-label + title)

### I18N-006: Hardcoded English in PreviewPlayer (5 strings)
- **File**: `apps/web/src/lib/components/player/PreviewPlayer.svelte`
- **Strings**: `'Failed to load preview.'`, `'Failed to initialize preview player.'`, `'Play'/'Pause'`, `'Unmute'/'Mute'`, `'Fullscreen'`

### I18N-007: Hardcoded English in NavBadge, StudioSidebar, BrandEditorFineTuneColors, SearchBar
- **Files**: `NavBadge.svelte` (`"{count} items"`), `StudioSidebar.svelte` (`"Admin"`, `"Owner"`), `BrandEditorFineTuneColors.svelte` (`"Auto"`, `"Customize"`, hint strings), `SearchBar.svelte` (`"Clear search"`, `"Recent"`, `"Clear"`)

### TYPE-001: `Component<any>` type violation in StudioSidebar
- **Domain**: TYPES
- **File**: `apps/web/src/lib/components/layout/StudioSidebar/StudioSidebar.svelte:29`
- **Current**: `Record<SidebarIcon, Component<any>>`
- **Fix**: `Record<SidebarIcon, Component<IconProps>>`

### TYPE-002: `Snippet` imported from wrong module in ContentCard
- **Domain**: TYPES
- **File**: `apps/web/src/lib/components/ui/ContentCard/ContentCard.svelte:22`
- **Current**: `import type { Snippet, HTMLAttributes } from 'svelte/elements';`
- **Fix**: `import type { Snippet } from 'svelte'; import type { HTMLAttributes } from 'svelte/elements';`

### STORY-001: Missing Storybook stories for all 18 new components
- **Domain**: ARCHITECTURE
- **Files**: Carousel, CommandPalette, SearchBar, DataTable, FilterBar, BackToTop, Breadcrumb, CheckoutSuccess, PriceBadge, ViewToggle, SkeletonContentCard, SkeletonCreatorCard, 5 icon components, ProseContent
- **Description**: None of the 18 new components have `.stories.svelte` files.

### A11Y-001: CommandPalette dialog focus trap incomplete
- **Domain**: A11Y
- **File**: `CommandPalette.svelte:129`
- **Description**: `Tab` is `preventDefault()`'d but doesn't cycle focus among elements. Pressing Tab does nothing — not WCAG-compliant focus trapping.
- **Fix**: Implement proper Tab/Shift+Tab cycling, or use a focus-trap library.

### A11Y-002: CommandPalette + SearchBar missing `aria-controls` on combobox
- **Domain**: A11Y
- **Files**: `CommandPalette.svelte`, `SearchBar.svelte`
- **Description**: Both inputs have `role="combobox"` but no `aria-controls` pointing to the results listbox. WAI-ARIA combobox pattern requires this association.
- **Fix**: Add `id` to listbox, `aria-controls` to input.

### A11Y-003: FilterBar conflicting ARIA — `aria-pressed` + `role="radio"`
- **Domain**: A11Y
- **File**: `FilterBar.svelte:119-129`
- **Description**: Pill buttons have both `aria-pressed` (for toggle buttons) and `role="radio"` with `aria-checked`. These are conflicting ARIA patterns.
- **Fix**: Remove `aria-pressed`, keep `role="radio"` + `aria-checked`.

---

## INFO (Nice to Have)

### DB-001: Pagination bug in dual-source library merge
- **File**: `ContentAccessService.ts:795-849`
- **Description**: When a user has both purchased and membership content, both queries independently apply LIMIT/OFFSET. Merge-sort then trims to limit. Page 2+ may show duplicates or gaps. Only manifests with both content types and past page 1.
- **Fix**: Fetch both sources with higher limit (no offset), merge-sort, then slice to page window.

### SSR-005: Org library/creators pages have no `+page.server.ts`
- **Files**: `_org/[slug]/(space)/library/+page.svelte`, `_org/[slug]/(space)/creators/+page.svelte`
- **Description**: Both reference `data.*` properties. Creators page is public-facing — should have SSR for SEO.

### SSR-006: Creator content detail URLs missing `@` prefix
- **Files**: `_creators/[username]/content/[contentSlug]/+page.svelte:65,69`
- **Description**: `buildRelatedHref` and creator attribution link use `/{data.username}` but convention is `/@username`. Verify reroute hook handles both.

### SSR-007: Org landing page hydrates collection but doesn't use `useLiveQuery`
- **File**: `_org/[slug]/(space)/+page.svelte:22-25`
- **Description**: Calls `hydrateIfNeeded('content', ...)` but renders from `data.newReleases` directly. Hydration only benefits subsequent navigations.

### SSR-008: Discover page doesn't use `depends()` for cache invalidation
- **File**: `(platform)/discover/+page.server.ts`
- **Description**: No way to programmatically re-run this load from client. Content listing stays stale until navigation/refresh.

### A11Y-004: SearchBar items missing `aria-selected`, missing click-outside handler
- **File**: `SearchBar.svelte`

### RUNES-001: `$effect` mutating `$state` in FilterBar
- **File**: `FilterBar.svelte:69-75`
- **Description**: Initializes `searchValues` from `values` inside `$effect`. Functional but counter to Svelte 5 guidance of avoiding state mutation in effects.

---

## Implementation Order

**Phase 1 — Security + Error Boundaries (immediate)**
1. SEC-001 (raw Error throw — 1 file, ~5 min)
2. SSR-001 (create 3 error boundary files — ~30 min)
3. SEC-002 (markdown XSS sanitization — 1 file, ~15 min)

**Phase 2 — SSR Correctness (high value)**
4. SSR-002 (4 studio page server loads — ~2 hours)
5. SEC-003 (checkout auth guards — 2 files, ~10 min)
6. SSR-003 + SSR-004 (cache headers — 2 files, ~5 min)
7. OBS-001 (console.error cleanup — 1 file, ~2 min)

**Phase 3 — i18n Pass (bulk, parallel-safe)**
8. I18N-001 (CommandPalette — ~15 strings, ~30 min)
9. I18N-002 through I18N-007 (8 components, ~30 strings total, ~1 hour)

**Phase 4 — A11Y + Type Fixes (parallel-safe)**
10. A11Y-001 (CommandPalette focus trap — ~30 min)
11. A11Y-002 (aria-controls on 2 comboboxes — ~10 min)
12. A11Y-003 (FilterBar ARIA conflict — ~5 min)
13. TYPE-001 + TYPE-002 (~5 min)

**Phase 5 — Stories + Cleanup**
14. STORY-001 (18 new component stories — ~3-4 hours)
15. Info-level items as bandwidth allows

---

## Estimated Impact

| Phase | Actions | Risk | Time Est |
|-------|---------|------|----------|
| Phase 1 | 3 | Low-Medium | ~50 min |
| Phase 2 | 4 | Medium | ~2.5 hours |
| Phase 3 | 8 | Low | ~1.5 hours |
| Phase 4 | 4 | Low | ~50 min |
| Phase 5 | 1+ | Low | ~3-4 hours |
| **Total** | **20+** | | **~9 hours** |

---

## Cross-Reference with Existing Action Plan

These findings are **complementary** to `action-plan.md` (ACT-001—ACT-036). No overlap. Combined summary:

| Source | Blocking | Warning | Info | Total |
|--------|----------|---------|------|-------|
| CSS/Dup/Simplification (action-plan.md) | 7 | 12 | 17 | 36 |
| Security/SSR/Component (this report) | 4 | 17 | 10 | 31 |
| **Combined** | **11** | **29** | **27** | **67** |

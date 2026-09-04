# Frontend Review — Unified Action Plan

> Cross-referenced from: css-token-findings.md, duplication-findings.md, simplification-findings.md
> Generated: 2026-04-05
> Scope: 166 files changed across 40 commits (Apr 3-5)

## Executive Summary

| Metric | Count |
|--------|-------|
| Files audited | ~160 (across 3 agents, with overlap) |
| CSS token violations | 94 (6 P0, 50 P1, 8 P2, 32 P3) |
| Duplication findings | 27 (3 P0, 6 P1, 12 P2, 6 P3) |
| Simplification findings | 86 issues + 14 cross-cutting patterns |
| Estimated redundant lines | ~1,900+ |
| Bugs found | 2 (USD currency, Cmd+K conflict) |

---

## Action Items (Ordered by Priority)

### P0 — Must Fix (Bugs + Branding Breakage)

#### ACT-001: Fix USD currency bug on payment page
- **Source**: DUP-013, XC-14
- **File**: `(platform)/account/payment/+page.svelte`
- **Issue**: `formatAmount()` uses `currency: 'USD'` and `en-US` locale instead of GBP/en-GB
- **Fix**: Replace local `formatAmount` with shared `formatPrice()` from `$lib/utils/format`
- **Effort**: Small (1 file, ~10 min)

#### ACT-002: Fix hardcoded hex colors in ContentDetailView
- **Source**: CSS audit P0 #1-4
- **File**: `components/content/ContentDetailView.svelte`
- **Issue**: Hardcoded `#dcfce7`, `#15803d`, `#dc2626`, `#fef2f2` fallbacks on badge/error elements; `--color-neutral-900` on player background
- **Fix**: Replace with `--color-success-100`, `--color-success-700`, `--color-error-600`, `--color-error-50`, `--color-surface-tertiary`
- **Effort**: Small (1 file, ~10 min)

#### ACT-003: Fix primitive neutral tokens in PreviewPlayer
- **Source**: CSS audit P0 #5-6, P2 #1-5
- **File**: `components/player/PreviewPlayer.svelte`
- **Issue**: 9 violations — `--color-neutral-900` (3x), `--color-neutral-300`, hardcoded px sizes, hardcoded durations
- **Fix**: Replace neutrals with `--color-surface-tertiary` / `--color-text-muted`, px with tokens, durations with `--duration-*`
- **Effort**: Small (1 file, ~15 min)

#### ACT-004: Extract shared ErrorCard component (eliminate 3 cloned error pages)
- **Source**: DUP-003
- **Files**: `_creators/[username]/+error.svelte`, `_creators/[username]/content/+error.svelte`, `+error.svelte`
- **Issue**: 95%+ identical markup, 105 identical CSS lines across 3 files (~315 redundant lines)
- **Fix**: Create `$lib/components/ui/ErrorCard/ErrorCard.svelte` with props for title/message/actions. Each route page becomes a thin wrapper (~20 lines)
- **Effort**: Medium (~1 hour)

#### ACT-005: Extract shared StudioMediaPage component
- **Source**: DUP-007
- **Files**: `_creators/studio/media/+page.svelte`, `_org/[slug]/studio/media/+page.svelte`
- **Issue**: 98% identical clone, only title differs (~280 duplicated lines)
- **Fix**: Create `$lib/components/studio/StudioMediaPage.svelte`. Each route imports it with a title prop
- **Effort**: Medium (~45 min)

#### ACT-006: Extract shared ProfileForm component
- **Source**: DUP-008
- **Files**: `(platform)/account/+page.svelte`, `_creators/studio/settings/+page.svelte`
- **Issue**: Near-complete copies of profile edit form (~200 duplicated lines)
- **Fix**: Create `$lib/components/ProfileForm.svelte`. Each page passes user data as props
- **Effort**: Medium (~1 hour)

#### ACT-007: Fix Cmd+K keyboard shortcut conflict
- **Source**: DUP-026
- **Files**: `SearchBar.svelte`, `CommandPalette.svelte`
- **Issue**: Both register global `Cmd+K` handlers. If co-mounted, they'll fight
- **Fix**: Decide which owns Cmd+K. SearchBar should probably use `/` (search convention) and CommandPalette keeps Cmd+K. Or use a central keyboard shortcut registry
- **Effort**: Small (~20 min)

---

### P1 — Should Fix (Density/Token Compliance + Major Duplication)

#### ACT-008: Consolidate formatCurrency/formatRevenue (5 definitions)
- **Source**: DUP-011, DUP-017, XC-5
- **Files**: `TopContentTable.svelte`, `CustomerDetailDrawer.svelte`, `ActivityFeed.svelte`, `_org/studio/+page.svelte`, `(platform)/account/payment/+page.svelte`
- **Issue**: `formatRevenue`/`formatCurrency`/`formatAmount` defined locally 5 times with slight variations
- **Fix**: Consolidate into `formatPrice()` in `$lib/utils/format.ts` (already exists). Ensure it handles cents-to-pounds conversion. Delete all local copies
- **Effort**: Small (~30 min)

#### ACT-009: Extract shared form field CSS
- **Source**: DUP-022, XC-1
- **Files**: `PublishSidebar`, `ThumbnailUpload`, `EditMediaDialog`, `InviteMemberDialog`, `LogoUpload`, `GrantAccessDialog`, `CustomerDetailDrawer` (7 files)
- **Issue**: `.field-input`, `.field-label`, `.form-field` CSS duplicated in 7 files (~105 redundant lines)
- **Fix**: Either extend the existing `FormField.svelte` component to cover these cases, or extract a `form-fields.css` utility stylesheet
- **Effort**: Medium (~1 hour)

#### ACT-010: Migrate Button heights to spacing tokens
- **Source**: CSS audit P1 #1
- **File**: `Button.svelte`
- **Issue**: 5 hardcoded rem heights (xs=1.75rem through xl=3rem) that ignore density scaling
- **Fix**: Map to `--space-7`, `--space-8`, `--space-10`, `--space-11`, `--space-12`
- **Effort**: Small (~10 min)

#### ACT-011: Extract shared content grid CSS
- **Source**: DUP-006, XC-12
- **Files**: 7 route pages with identical responsive grid (1col -> 2col -> 3col)
- **Issue**: ~77 lines of identical CSS across 7 files
- **Fix**: Add `.content-grid` to `utilities.css` or create a `ContentGrid.svelte` layout component
- **Effort**: Small (~30 min)

#### ACT-012: Extract shared LibraryPageView component
- **Source**: DUP-009, DUP-010
- **Files**: `(platform)/library/+page.svelte`, `_org/[slug]/(space)/library/+page.svelte`, both `+page.server.ts`
- **Issue**: ~70% identical page code (~150 lines) + duplicated `parseSortParam()` in server loads (~50 lines)
- **Fix**: Create `$lib/components/library/LibraryPageView.svelte` + extract `parseSortParam()` to `$lib/server/utils.ts`
- **Effort**: Medium (~1 hour)

#### ACT-013: Extract shared content detail server load helper
- **Source**: DUP-002
- **Files**: Both `content/[contentSlug]/+page.server.ts` files
- **Issue**: Parallel Promise.all for streaming/progress/access duplicated (~60 lines)
- **Fix**: Extract `loadContentDetail()` helper to `$lib/server/content-detail.ts`
- **Effort**: Small (~30 min)

#### ACT-014: Refactor MediaPicker to use Melt UI Combobox
- **Source**: Simplification P1 (672-line component)
- **File**: `studio/MediaPicker.svelte`
- **Issue**: 672 lines reimplementing a combobox from scratch with manual keyboard/mouse handling
- **Fix**: Replace with Melt UI `Combobox` builder. Eliminates ~150 lines of manual ARIA/keyboard handling
- **Effort**: Large (~2 hours)

#### ACT-015: Deduplicate MediaUpload XHR functions
- **Source**: Simplification P1
- **File**: `studio/MediaUpload.svelte`
- **Issue**: `uploadToR2` and `uploadViaWorker` are structurally identical XHR wrappers
- **Fix**: Extract generic `xhrUpload(url, method, file, headers, onProgress)` helper
- **Effort**: Small (~20 min)

#### ACT-016: Fix css-injection.ts duplicated style removal loop
- **Source**: Simplification P1
- **File**: `brand-editor/css-injection.ts`
- **Issue**: Style removal loop duplicated in `injectBrandVars` and `clearBrandVars`
- **Fix**: Extract `removeOverrideVars(el, excludeProps?)` helper
- **Effort**: Small (~10 min)

#### ACT-017: Fix CustomerDetailDrawer !important overrides
- **Source**: Simplification P1
- **File**: `studio/CustomerDetailDrawer.svelte`
- **Issue**: 13 `!important` overrides forcing Dialog into drawer mode
- **Fix**: Use a proper Drawer/Sheet component (Melt UI `Dialog` with `side` config) or refactor CSS specificity
- **Effort**: Medium (~1 hour)

#### ACT-018: Fix remaining hardcoded spacing/sizes across components
- **Source**: CSS audit P1 (remaining items)
- **Files**: `CheckoutSuccess.svelte` (48px spinner), `Spinner.svelte` (3px border), `ContinueWatching.svelte` (4px scrollbar), `Carousel.svelte` (4px scrollbar), `MobileNav.svelte` (7px translateY), `StudioSidebar.svelte` (1px divider), plus brand editor components (various px dimensions)
- **Fix**: Replace with corresponding token values where they exist
- **Effort**: Small-Medium (~45 min across all files)

#### ACT-019: Resolve DataTable adoption gap
- **Source**: DUP-015
- **Files**: `DataTable.svelte` (generic), `ContentTable.svelte`, `CustomerTable.svelte`, `MemberTable.svelte`, `TopContentTable.svelte`
- **Issue**: DataTable was built as a generic solution but has zero adoption. Three other table components exist independently
- **Fix**: Either adopt DataTable in the studio tables (breaking change), or remove DataTable if the specialized tables are preferred. Decide on ONE table strategy
- **Effort**: Large (~2-3 hours, architectural decision needed)

---

### P2 — Minor (Consolidation + Cleanup)

#### ACT-020: Extract shared `calculateProgressPercent()` utility
- **Source**: DUP-019
- **Files**: `ContentCard.svelte`, `LibraryCard.svelte`, `ContinueWatchingCard.svelte`
- **Fix**: Create `$lib/utils/progress.ts` with the shared progress calculation

#### ACT-021: Extract shared `getInitials()` utility
- **Source**: DUP-018
- **Files**: `MemberTable.svelte`, `CustomerDetailDrawer.svelte`, `TopContentTable.svelte`
- **Fix**: Add to `$lib/utils/format.ts`

#### ACT-022: Delete redundant local `formatFileSize` definitions
- **Source**: DUP-020
- **Files**: `MediaCard.svelte`, `MediaSection.svelte`
- **Fix**: Import from `$lib/utils/format.ts` (already exported there)

#### ACT-023: Extract shared upload drag-and-drop handler
- **Source**: DUP-023
- **Files**: `MediaUpload.svelte`, `LogoUpload.svelte`
- **Fix**: Extract `useDropZone()` helper with shared event handlers + CSS

#### ACT-024: Fix Svelte 5 state-mirroring anti-pattern in brand editor levels
- **Source**: XC-2
- **Files**: `BrandEditorShape.svelte`, `BrandEditorShadows.svelte`, `BrandEditorFineTuneTypography.svelte`, `BrandEditorTypography.svelte`
- **Fix**: Replace `$state` + sync `$effect` with `$derived`. Write directly to store on input events

#### ACT-025: Extract shared dialog form boilerplate
- **Source**: DUP-021
- **Files**: `GrantAccessDialog.svelte`, `InviteMemberDialog.svelte`, `EditMediaDialog.svelte`
- **Fix**: Create a `DialogForm.svelte` wrapper that handles submit state, error display, and layout

#### ACT-026: Fix brand editor barrel export bloat
- **Source**: Simplification P3
- **File**: `brand-editor/index.ts`
- **Fix**: Only re-export what consumers actually import. Remove internal-only types

#### ACT-027: Extract shared view mode localStorage helper
- **Source**: DUP-014
- **Files**: 3 pages with identical `viewMode` pattern
- **Fix**: Create `$lib/utils/view-mode.ts` with `useViewMode()` helper

#### ACT-028: Fix `form: any` type holes
- **Source**: Simplification P1
- **Files**: `PublishSidebar.svelte`, `ThumbnailUpload.svelte`
- **Fix**: Type the form prop properly

#### ACT-029: Fix checkout success duplicate fallback branches
- **Source**: Simplification P1
- **File**: `CheckoutSuccess.svelte`
- **Fix**: Merge `{:else if retriesExhausted}` and `{:else}` — they render identical UI

#### ACT-030: Replace native `confirm()` with ConfirmDialog in MemberTable
- **Source**: Simplification P2
- **File**: `MemberTable.svelte`
- **Fix**: Use the app's `ConfirmDialog` component for UX consistency

---

### P3 — Nits (Optional Cleanup)

#### ACT-031: Remove unnecessary hardcoded fallback values in var() expressions
- **Source**: CSS audit P3 (25 instances across 2 route files)
- **Fix**: Remove fallbacks from `var(--token, fallback)` where tokens are always defined

#### ACT-032: Extract shared `@keyframes spin` to global CSS
- **Source**: Simplification P3
- **Files**: `Button.svelte`, `CheckoutSuccess.svelte`, `PreviewPlayer.svelte`
- **Fix**: Define once in `utilities.css`

#### ACT-033: Clean up brand editor panel minimized save button
- **Source**: Simplification P2
- **File**: `BrandEditorPanel.svelte`
- **Fix**: Wire the empty `onclick={() => {}}` to actual save handler, or remove the button

#### ACT-034: Extract shared slider+label brand editor pattern
- **Source**: DUP-024
- **Files**: 3 brand editor levels
- **Fix**: Create `BrandSliderField.svelte` component

#### ACT-035: Consolidate `@keyframes pulse` skeleton animations
- **Source**: Simplification P3
- **Files**: `MemberTable.svelte`, `TopContentTable.svelte`
- **Fix**: Use the existing `Skeleton` component or extract to shared CSS

#### ACT-036: Remove stale comments and dead CSS
- **Source**: Various P3 findings
- **Fix**: Clean pass across files flagged with stale comments

---

## Implementation Order

Recommended execution sequence (respects dependencies):

**Phase 1 — Bug Fixes (immediate, no deps)**
1. ACT-001 (USD currency bug)
2. ACT-007 (Cmd+K conflict)

**Phase 2 — Token Compliance (parallel-safe)**
3. ACT-002 (ContentDetailView hex colors)
4. ACT-003 (PreviewPlayer neutral tokens)
5. ACT-010 (Button heights)
6. ACT-018 (remaining hardcoded sizes)

**Phase 3 — Utility Consolidation (parallel-safe)**
7. ACT-008 (formatCurrency 5 places)
8. ACT-020 (calculateProgressPercent)
9. ACT-021 (getInitials)
10. ACT-022 (formatFileSize)
11. ACT-027 (view mode helper)

**Phase 4 — Shared Component Extraction (sequential — touches multiple files)**
12. ACT-004 (ErrorCard)
13. ACT-005 (StudioMediaPage)
14. ACT-006 (ProfileForm)
15. ACT-012 (LibraryPageView)
16. ACT-009 (form field CSS)
17. ACT-011 (content grid CSS)
18. ACT-025 (DialogForm)
19. ACT-023 (useDropZone)

**Phase 5 — Component Refactors (higher risk)**
20. ACT-013 (content detail server load helper)
21. ACT-014 (MediaPicker -> Melt UI)
22. ACT-015 (MediaUpload XHR dedup)
23. ACT-016 (css-injection dedup)
24. ACT-017 (CustomerDetailDrawer)
25. ACT-019 (DataTable strategy decision)
26. ACT-024 (brand editor state-mirroring)

**Phase 6 — Cleanup (parallel-safe nits)**
27. ACT-028 through ACT-036

---

## Estimated Impact

| Phase | Actions | Lines Saved | Risk |
|-------|---------|-------------|------|
| Phase 1 | 2 | ~20 | Low (bug fixes) |
| Phase 2 | 4 | ~50 | Low (CSS only) |
| Phase 3 | 5 | ~80 | Low (import changes) |
| Phase 4 | 8 | ~1,200 | Medium (new shared components) |
| Phase 5 | 7 | ~400 | Medium-High (refactors) |
| Phase 6 | 9 | ~150 | Low (cosmetic) |
| **Total** | **35** | **~1,900** | |

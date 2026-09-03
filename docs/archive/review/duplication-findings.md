# Code Duplication Findings

> Systematic audit of recently-changed frontend files for duplicated code, logic, and patterns.
> Focus on cross-route duplication (`_org/`, `_creators/`, `(platform)/`) and repeated component patterns.

## Known Shared Extractions (already done)
These components were recently extracted to reduce duplication — verify they're fully adopted:
- `ContentDetailView.svelte` — shared content detail page
- `CheckoutSuccess.svelte` — shared checkout success
- `publish-toggle.ts` — shared publish status toggle
- `$lib/utils/format` — shared format utilities

## What to Flag
1. **Cross-route duplication**: Similar markup/logic in `_org/`, `_creators/`, `(platform)/` route variants
2. **Incomplete extraction**: Shared component exists but some routes still use inline version
3. **Copy-paste components**: Two components with >60% structural similarity
4. **Repeated inline logic**: Same computed value / transformation in 3+ places
5. **Repeated CSS blocks**: Identical style blocks across multiple components
6. **Repeated fetch/data patterns**: Same API call pattern in multiple server loads

## Severity Scale
- **P0 Critical**: Identical logic in multiple places that WILL drift (bug fix needed in N places)
- **P1 Major**: Large duplicated blocks (>20 lines) that should be a shared component/util
- **P2 Minor**: Small repeated patterns (5-20 lines) that could be extracted
- **P3 Nit**: Similar but not identical patterns — extraction optional

---

## Files Reviewed

| # | File | Status | Issues |
|---|------|--------|--------|
| 1 | `_creators/[username]/+page.svelte` | Reviewed | -- |
| 2 | `_creators/[username]/+error.svelte` | Reviewed | DUP-003 |
| 3 | `_creators/[username]/content/+page.svelte` | Reviewed | DUP-006 |
| 4 | `_creators/[username]/content/+error.svelte` | Reviewed | DUP-003 |
| 5 | `_creators/[username]/content/[contentSlug]/+page.svelte` | Reviewed | DUP-001 |
| 6 | `_creators/[username]/content/[contentSlug]/+page.server.ts` | Reviewed | DUP-002 |
| 7 | `_creators/checkout/success/+page.svelte` | Reviewed | -- (extracted) |
| 8 | `_creators/checkout/success/+page.server.ts` | Reviewed | DUP-004 |
| 9 | `_creators/studio/content/+page.svelte` | Reviewed | DUP-005 |
| 10 | `_creators/studio/media/+page.svelte` | Reviewed | DUP-007 |
| 11 | `_creators/studio/settings/+page.svelte` | Reviewed | DUP-008 |
| 12 | `_org/[slug]/(space)/+page.svelte` | Reviewed | DUP-006 |
| 13 | `_org/[slug]/(space)/+page.server.ts` | Reviewed | -- |
| 14 | `_org/[slug]/(space)/checkout/success/+page.svelte` | Reviewed | -- (extracted) |
| 15 | `_org/[slug]/(space)/checkout/success/+page.server.ts` | Reviewed | DUP-004 |
| 16 | `_org/[slug]/(space)/content/[contentSlug]/+page.svelte` | Reviewed | DUP-001 |
| 17 | `_org/[slug]/(space)/content/[contentSlug]/+page.server.ts` | Reviewed | DUP-002 |
| 18 | `_org/[slug]/(space)/creators/+page.svelte` | Reviewed | -- |
| 19 | `_org/[slug]/(space)/explore/+page.svelte` | Reviewed | DUP-006 |
| 20 | `_org/[slug]/(space)/explore/+page.server.ts` | Reviewed | -- |
| 21 | `_org/[slug]/(space)/library/+page.svelte` | Reviewed | DUP-009 |
| 22 | `_org/[slug]/(space)/library/+page.server.ts` | Reviewed | DUP-010 |
| 23 | `_org/[slug]/+layout.svelte` | Reviewed | -- |
| 24 | `_org/[slug]/+layout.server.ts` | Reviewed | -- |
| 25 | `_org/[slug]/studio/+page.svelte` | Reviewed | DUP-011 |
| 26 | `_org/[slug]/studio/+layout.svelte` | Reviewed | -- |
| 27 | `_org/[slug]/studio/+layout.server.ts` | Reviewed | -- |
| 28 | `_org/[slug]/studio/content/+page.svelte` | Reviewed | DUP-005 |
| 29 | `_org/[slug]/studio/content/+page.server.ts` | Reviewed | -- |
| 30 | `_org/[slug]/studio/content/[contentId]/edit/+page.svelte` | Reviewed | -- |
| 31 | `_org/[slug]/studio/content/new/+page.svelte` | Reviewed | -- |
| 32 | `_org/[slug]/studio/customers/+page.svelte` | Reviewed | -- |
| 33 | `_org/[slug]/studio/analytics/+page.svelte` | Reviewed | DUP-011 |
| 34 | `_org/[slug]/studio/billing/+page.svelte` | Reviewed | DUP-011 |
| 35 | `_org/[slug]/studio/media/+page.svelte` | Reviewed | DUP-007 |
| 36 | `_org/[slug]/studio/team/+page.svelte` | Reviewed | DUP-012 |
| 37 | `_org/[slug]/studio/settings/+layout.svelte` | Reviewed | -- |
| 38 | `_org/[slug]/studio/settings/+page.svelte` | Reviewed | DUP-012 |
| 39 | `_org/[slug]/studio/settings/branding/+page.svelte` | Reviewed | -- |
| 40 | `(platform)/+page.svelte` | Reviewed | -- |
| 41 | `(platform)/library/+page.svelte` | Reviewed | DUP-009 |
| 42 | `(platform)/library/+page.server.ts` | Reviewed | DUP-010 |
| 43 | `(platform)/discover/+page.svelte` | Reviewed | DUP-006 |
| 44 | `(platform)/account/+layout.svelte` | Reviewed | -- |
| 45 | `(platform)/account/+page.svelte` | Reviewed | DUP-008 |
| 46 | `(platform)/account/notifications/+page.svelte` | Reviewed | -- |
| 47 | `(platform)/account/payment/+page.svelte` | Reviewed | DUP-013 |
| 48 | `(platform)/become-creator/+page.svelte` | Reviewed | DUP-012 |
| 49 | `(platform)/pricing/+page.svelte` | Reviewed | -- |
| 50 | `+layout.svelte` | Reviewed | -- |
| 51 | `+layout.server.ts` | Reviewed | -- |
| 52 | `+error.svelte` | Reviewed | DUP-003 |
| 53 | `(auth)/+layout.svelte` | Reviewed | -- |

---

## Findings

### DUP-001: Content Detail Page Wrappers — Nearly Identical Script Logic — P2

**Type**: Cross-route duplication
**Files involved**:
- `_creators/[username]/content/[contentSlug]/+page.svelte` (lines 8-51)
- `_org/[slug]/(space)/content/[contentSlug]/+page.svelte` (lines 8-54)

**Description**: Both content detail page wrappers share ~80% identical script logic. The `displayPrice()` function (4 lines), `handlePurchase()` function (9 lines), `purchasing` state, `priceCents` derivation, `onMount` hydration, and the `purchaseForm` snippet (14 lines of identical markup) are duplicated verbatim. The only differences are: (a) how `creatorName` is derived, (b) `titleSuffix` source, (c) how `buildRelatedHref` works, and (d) creators version includes a `creatorAttribution` snippet.

**Similarity**: ~75% structural similarity / ~30 identical lines of script+template

**Suggested fix**: The `ContentDetailView` extraction was the right call, but the remaining wrapper boilerplate could be reduced further. Extract `displayPrice()` to `$lib/utils/format` (it already has `formatPrice` but not the "free" fallback). Extract `handlePurchase()` to a shared `$lib/utils/purchase-form.ts` helper. The `purchaseForm` snippet template is identical and could be a shared Svelte component.

---

### DUP-002: Content Detail Server Loads — Duplicated Access/Progress/Purchase Pattern — P1

**Type**: Repeated server load patterns
**Files involved**:
- `_creators/[username]/content/[contentSlug]/+page.server.ts` (lines 90-182)
- `_org/[slug]/(space)/content/[contentSlug]/+page.server.ts` (lines 60-148)

**Description**: The authenticated user path is nearly identical in both files. The parallel `Promise.all` for `getStreamingUrl` + `getProgress` (lines 106-119 in creators, 78-91 in org), the `hasAccess`/`streamingUrl`/`progress` destructuring, the unauthenticated early return, the `relatedPromise` pattern, `renderContentBody()` call, and the entire `purchase` form action (40+ lines) are structurally identical. The `purchase` action differs only in how `successUrl` is constructed (creators includes `username` param; org does not) and creators has an extra phase-1 personal content error case.

**Similarity**: ~70% structural similarity / ~60 identical lines across load + actions

**Suggested fix**: Extract a shared `loadContentDetail(api, contentId, isAuthenticated)` helper in `$lib/server/content-detail.ts` that returns `{ hasAccess, streamingUrl, progress }`. Extract a shared `createPurchaseAction(buildSuccessUrl)` factory for the form action, parameterized by how the success URL is built.

---

### DUP-003: Error Pages — Three Identical Copy-Paste Variants — P0

**Type**: Cross-route duplication
**Files involved**:
- `_creators/[username]/+error.svelte` (lines 1-177, 177 lines)
- `_creators/[username]/content/+error.svelte` (lines 1-176, 176 lines)
- `+error.svelte` (lines 1-162, root error page)

**Description**: The two creator error pages are **95%+ identical** — same imports, same `errorInfo` derivation pattern, same icon-per-status switching, same card layout, same button row, **and the entire CSS block is identical** (105 lines of `.error-page`, `.error-card`, `.error-icon`, `.error-code`, `.error-title`, `.error-description`, `.error-detail`, `.error-actions`, `.btn`, `.btn-primary`, `.btn-secondary`). The only difference between the two creator files is: (a) the default case message function (`m.creator_content_error_title()` vs `m.errors_server_error()`) and (b) the `<title>` suffix (`| Creator` vs `| Creator Content`). The root error page uses a slightly different pattern (config object instead of switch) but the same CSS/layout.

**Similarity**: ~95% between creator error files / ~80% with root error page / 105 identical CSS lines across all three

**Suggested fix**: This is the highest-priority finding. Create a single shared `ErrorCard.svelte` component in `$lib/components/ui/` that accepts `status`, `titleSuffix`, and optional message overrides. All three error pages should be thin wrappers around it. The `.btn` / `.btn-primary` / `.btn-secondary` CSS is also duplicated in `_org/studio/team/+page.svelte` and `_org/studio/settings/+page.svelte` (see DUP-012).

---

### DUP-004: Checkout Success Server Loads — Identical Verification Pattern — P2

**Type**: Repeated server load patterns
**Files involved**:
- `_creators/checkout/success/+page.server.ts` (lines 1-49)
- `_org/[slug]/(space)/checkout/success/+page.server.ts` (lines 1-53)

**Description**: Both server loads follow the exact same pattern: set `CACHE_HEADERS.PRIVATE`, `depends('checkout:verify')`, extract `session_id` and `contentSlug` from URL params, call `api.checkout.verify(sessionId)`, return `{ verification, contentSlug }` on success or `{ verification: null, contentSlug }` on failure. The only differences are: (a) creators also extracts `username` from params, (b) org calls `parent()` to get org data.

**Similarity**: ~85% structural similarity / ~25 identical lines

**Suggested fix**: Extract a shared `verifyCheckoutSession(api, sessionId)` helper in `$lib/server/checkout.ts`. Each route's server load would call it and add its route-specific return fields (`username` or `org`).

---

### DUP-005: Studio Content List Pages — Duplicated Table+Pagination Pattern — P2

**Type**: Cross-route duplication
**Files involved**:
- `_creators/studio/content/+page.svelte` (lines 1-123)
- `_org/[slug]/studio/content/+page.svelte` (lines 1-255)

**Description**: Both pages share the same core structure: `PageHeader` with create button, `ContentTable` component, conditional `Pagination` wrapper, and `EmptyState` fallback with `FileIcon`. The `.create-btn`, `.pagination-wrapper`, and `.empty-cta` CSS blocks are **identical** (each ~15-20 lines). The org version adds search functionality (debounced search input, `navigateWithSearch()`) which the creator version lacks, but the base table+pagination+empty pattern and all shared CSS could be unified.

**Similarity**: ~65% structural / ~50 identical CSS lines

**Suggested fix**: The `.create-btn` CSS (12 lines), `.pagination-wrapper` CSS (5 lines), and `.empty-cta` CSS (12 lines) are duplicated verbatim. These should be extracted to shared utility classes or a `StudioPageShell` component that provides the header+table+pagination+empty layout.

---

### DUP-006: Content Grid CSS — Identical Responsive Grid in 5+ Pages — P1

**Type**: Identical CSS blocks
**Files involved**:
- `(platform)/library/+page.svelte` (lines 243-259 `.content-grid`)
- `_org/[slug]/(space)/library/+page.svelte` (lines 240-256 `.content-grid`)
- `_org/[slug]/(space)/explore/+page.svelte` (lines 553-569 `.explore__grid`)
- `_org/[slug]/(space)/+page.svelte` (lines 325-341 `.content-grid`)
- `_creators/[username]/+page.svelte` (lines 460-484 `.content-grid`)
- `_creators/[username]/content/+page.svelte` (lines 286-303 `.content-grid`)
- `(platform)/discover/+page.svelte` (lines 147-163 `.content-grid`)

**Description**: The same responsive grid pattern appears in 7 files:
```css
.content-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-4); /* or --space-6 */
}
@media (--breakpoint-sm) { grid-template-columns: repeat(2, 1fr); }
@media (--breakpoint-lg) { grid-template-columns: repeat(3, 1fr); }
```
This 10-12 line block is copy-pasted in every page that shows a content grid. The gap size varies slightly (`--space-4` in library pages, `--space-6` in explore/landing pages) but the structure is identical.

**Similarity**: ~95% structural / 10-12 identical lines per instance, 7 instances = ~77 redundant lines

**Suggested fix**: Extract a `.content-grid` utility class to `$lib/styles/` (or a layout utility CSS file) with a `--grid-gap` custom property for the minor gap variation. Alternatively, create a `ContentGrid.svelte` wrapper component.

---

### DUP-007: Studio Media Pages — Near-Identical Clone — P0

**Type**: Cross-route duplication
**Files involved**:
- `_creators/studio/media/+page.svelte` (lines 1-305, 305 lines)
- `_org/[slug]/studio/media/+page.svelte` (lines 1-333, 333 lines)

**Description**: These two files are **functionally identical**. Every piece of script logic is the same: delete state (`showDeleteConfirm`, `deleteTargetId`, `isDeleting`), edit state (`showEditDialog`, `editTarget`), pagination derivations, `paginationBaseUrl`, filter options arrays (`mediaTypeOptions`, `statusOptions`), `setFilter()`, `handleUploadComplete()`, `handleEdit()`, `handleSave()`, `confirmDelete()`, `handleDeleteDialogChange()`, `handlePageChange()` — all identical. The template is identical: `PageHeader`, `MediaUpload`, filter buttons loop, `MediaGrid`, `Pagination`, `EditMediaDialog`, delete confirmation `Dialog.Root`. The **entire CSS block** (~95 lines) is identical. The only difference is the `<title>` tag: `My Studio` vs `{data.org.name}`.

**Similarity**: ~98% structural / ~280 identical lines (script + template + CSS)

**Suggested fix**: This is the most severe duplication in the codebase. Create a shared `StudioMediaPage.svelte` component that accepts a `titleSuffix` prop. Both route pages become 5-line wrappers.

---

### DUP-008: Account Profile vs Creator Studio Settings — Full Page Clone — P0

**Type**: Cross-route duplication
**Files involved**:
- `(platform)/account/+page.svelte` (lines 1-489)
- `_creators/studio/settings/+page.svelte` (lines 1-410)

**Description**: The creator studio settings page is a **near-complete copy** of the platform account profile page. Both share: identical imports (same 8 component imports + 3 remote form imports), identical avatar management logic (preview state, `handleAvatarSelect`, `handleAvatarCancel`, `showDeleteAvatar`, `initials` derivation — ~35 lines), identical success message pattern (`showSuccess`, `successTimeout`, `showSuccessMessage`, `onDestroy` cleanup — ~15 lines), identical `$effect` blocks for `updateProfileForm.result`, `avatarUploadForm.result`, `avatarDeleteForm.result` (~30 lines), identical form field destructuring and population, and identical template structure (avatar section with upload/delete/cancel buttons, profile form with displayName/email/username/bio/social links). The CSS blocks share ~30 identical lines (`.field-error`, `.avatar-container`, `.avatar-actions`, `.avatar-upload-form`, `.avatar-help`, `.form-group`, `.form-help`).

**Similarity**: ~85% structural / ~200+ identical lines

**Suggested fix**: Extract a shared `ProfileForm.svelte` component that handles avatar management, form field binding, success/error messages, and the form template. Both pages become thin wrappers that provide their page title, description, and any page-specific additions (like the upgrade banner on the account page).

---

### DUP-009: Library Pages — Large Structural Duplication — P1

**Type**: Cross-route duplication
**Files involved**:
- `(platform)/library/+page.svelte` (lines 1-328)
- `_org/[slug]/(space)/library/+page.svelte` (lines 1-332)

**Description**: Both library pages share ~70% identical code. Duplicated elements include: the `STORAGE_KEY` / `viewMode` / `handleViewChange` pattern (~10 lines), `sortOptions` array (~6 lines), `buildFilterParams()` function (~12 lines), `handleSortChange()` function (~5 lines), `paginationBaseUrl` derivation (~5 lines), `handleFilterChange()` function (~10 lines), `hasActiveFilters` derivation (~4 lines), the full template structure (error banner, loading skeletons, empty state, ContinueWatching, sort bar with Select+ViewToggle, LibraryFilters, content grid with LibraryCard+Pagination, BackToTop), and large CSS blocks (`.content-grid`, `.browse-btn`, `.clear-filters-btn`, `.sort-bar`, `.content-grid[data-view='list']`, `.pagination-wrapper` — ~70 identical CSS lines).

The org version adds: org-specific header with "View full library" link, `accessType` filter, hardcoded error messages (vs i18n in platform version), and uses `data.library?.pagination` vs `data.library` with computed totalPages.

**Similarity**: ~70% structural / ~150 identical lines (script + template + CSS)

**Suggested fix**: Extract a shared `LibraryPageView.svelte` component that accepts: `items`, `sortOptions`, `filters`, `pagination`, `titleSlot`, `emptyState`, `onFilterChange`, `onSortChange`. Both pages pass their route-specific props. The CSS grid/button/pagination styles should be shared (see DUP-006).

---

### DUP-010: Library Server Loads — Identical Fetch + Parse Pattern — P1

**Type**: Repeated server load patterns
**Files involved**:
- `(platform)/library/+page.server.ts` (lines 1-99)
- `_org/[slug]/(space)/library/+page.server.ts` (lines 1-106)

**Description**: Both server loads share: identical `LIBRARY_LIMIT = 12` constant, identical `parseSortParam()` function (9 lines), identical URL param parsing pattern (page, sort, contentType, progressStatus, search), identical `api.access.getUserLibrary(params)` call, identical error handling with dynamic `ApiError` import, and identical return shape. The org version adds: `organizationId` param, `accessType` filter, `parent()` call for org data, and uses `pagination` subobject instead of flat `total`/`page`/`limit`.

**Similarity**: ~75% structural / ~50 identical lines

**Suggested fix**: Extract a shared `loadLibrary(api, baseParams, urlSearchParams)` helper in `$lib/server/library.ts` that handles param parsing, API call, and error wrapping. `parseSortParam()` is duplicated verbatim and should be a shared util.

---

### DUP-011: formatRevenue / formatCurrency — Same Intl.NumberFormat GBP Formatter in 3 Places — P2

**Type**: Repeated inline logic
**Files involved**:
- `_org/[slug]/studio/+page.svelte` (lines 41-48, `formatRevenue`)
- `_org/[slug]/studio/analytics/+page.svelte` (lines 71-78, `formatRevenue`)
- `_org/[slug]/studio/billing/+page.svelte` (lines 23-29, `formatCurrency`)

**Description**: Three studio pages define functionally identical GBP currency formatters:
```ts
function formatRevenue(cents: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: 'GBP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(cents / 100);
}
```
The only differences are: the function name (`formatRevenue` vs `formatCurrency`), and the analytics version accepts `number | undefined | null`.

**Similarity**: ~95% identical / 6-7 lines x 3 instances

**Suggested fix**: `$lib/utils/format` already exports `formatPrice()`. Verify it handles the GBP + cents-to-pounds conversion and use it everywhere. If it differs, add a `formatCurrencyGBP(cents)` helper there.

---

### DUP-012: Inline `.btn` / `.btn-primary` CSS — Repeated Button Styles — P2

**Type**: Identical CSS blocks
**Files involved**:
- `_creators/[username]/+error.svelte` (lines 142-175, `.btn`/`.btn-primary`/`.btn-secondary`)
- `_creators/[username]/content/+error.svelte` (lines 142-175)
- `_org/[slug]/studio/team/+page.svelte` (lines 103-136, `.btn`/`.btn-primary`)
- `_org/[slug]/studio/settings/+page.svelte` (lines 316-348, `.btn`/`.btn-primary`)
- `(platform)/become-creator/+page.svelte` (lines 157-181, `.form-group`/`.field-error`/`.form-help`)

**Description**: Multiple pages define their own `.btn`, `.btn-primary`, `.btn-secondary` CSS classes with identical styles instead of using the shared `Button` component. The team page and settings page both define `~35 lines` of button CSS that matches the error pages. The `become-creator` page duplicates `.form-group`, `.field-error`, and `.form-help` CSS that also appears in the account page and creator settings.

**Similarity**: ~90% identical button CSS / 30-35 lines per instance, 4 instances

**Suggested fix**: Replace inline `.btn` classes with the existing `Button` component (which is already imported in some of these files). For `.form-group`/`.field-error`/`.form-help`, these are repeated across all form pages and should be extracted to a shared form utilities CSS file or a `FormField.svelte` component.

---

### DUP-013: Payment Page Currency Bug — Uses USD Instead of GBP — P1

**Type**: Incomplete extraction (related to DUP-011)
**Files involved**:
- `(platform)/account/payment/+page.svelte` (lines 98-112)

**Description**: The payment page defines `formatAmount()` using `currency: 'USD'` and `en-US` locale, contradicting the project-wide requirement that default currency is GBP. Both `formatAmount` and `formatDate` use `en-US` locale. Every other page in the codebase uses `en-GB` + `GBP`. This is a bug introduced by not using the shared format utility.

**Similarity**: N/A — this is a consistency bug, not structural duplication

**Suggested fix**: Replace with the shared `formatPrice()` from `$lib/utils/format` (or the proposed `formatCurrencyGBP()` from DUP-011). Fix locale to `en-GB`.

---

### DUP-014: View Mode localStorage Pattern — Repeated in 3 Pages — P3

**Type**: Repeated inline logic
**Files involved**:
- `(platform)/library/+page.svelte` (lines 43-51)
- `_org/[slug]/(space)/library/+page.svelte` (lines 27-35)
- `_org/[slug]/(space)/explore/+page.svelte` (lines 153-162)

**Description**: Three pages independently implement the same `STORAGE_KEY = 'codex-view-mode'` / `viewMode = $state(...)` / `handleViewChange()` pattern for persisting grid/list view preference. Each is 8-10 lines of identical logic.

**Similarity**: ~95% identical / 8-10 lines x 3 instances

**Suggested fix**: Extract a `useViewMode()` helper function in `$lib/utils/view-mode.ts` that returns `{ viewMode, handleViewChange }`. Minor improvement, hence P3.

---

## Summary

| ID | Severity | Type | Duplicated Lines | Files |
|----|----------|------|-----------------|-------|
| DUP-007 | **P0** | Media pages clone | ~280 lines | 2 |
| DUP-003 | **P0** | Error pages clone | ~300 lines (3 files) | 3 |
| DUP-008 | **P0** | Profile/settings clone | ~200 lines | 2 |
| DUP-006 | **P1** | Content grid CSS | ~77 lines (7 files) | 7 |
| DUP-009 | **P1** | Library page duplication | ~150 lines | 2 |
| DUP-010 | **P1** | Library server load | ~50 lines | 2 |
| DUP-002 | **P1** | Content detail server load | ~60 lines | 2 |
| DUP-013 | **P1** | Currency bug (USD not GBP) | N/A (bug) | 1 |
| DUP-001 | **P2** | Content detail wrappers | ~30 lines | 2 |
| DUP-004 | **P2** | Checkout success server load | ~25 lines | 2 |
| DUP-005 | **P2** | Studio content list pages | ~50 CSS lines | 2 |
| DUP-011 | **P2** | formatRevenue duplication | ~21 lines | 3 |
| DUP-012 | **P2** | Inline .btn CSS | ~120 lines (4 files) | 4 |
| DUP-014 | **P3** | View mode localStorage | ~30 lines | 3 |

**Total estimated redundant lines**: ~1,400+

**Top 3 highest-impact fixes**:
1. **DUP-007**: Shared `StudioMediaPage.svelte` — eliminates ~280 duplicated lines
2. **DUP-008 + DUP-003**: Shared `ProfileForm.svelte` + shared `ErrorCard.svelte` — eliminates ~500 lines
3. **DUP-006 + DUP-009**: Shared content grid CSS + `LibraryPageView.svelte` — eliminates ~230 lines

---

## Wave 2 Findings — Component Cross-Comparison

> Systematic comparison of 32 components across table, card, dialog, upload, brand editor, and shared component categories.

### Components Reviewed

| # | Component | Status | Issues |
|---|-----------|--------|--------|
| 1 | `ui/DataTable/DataTable.svelte` | Reviewed | DUP-015 |
| 2 | `studio/ContentTable.svelte` | Reviewed | DUP-015 |
| 3 | `studio/CustomerTable.svelte` | Reviewed | DUP-015 |
| 4 | `studio/MemberTable.svelte` | Reviewed | DUP-015, DUP-016, DUP-018 |
| 5 | `studio/TopContentTable.svelte` | Reviewed | DUP-015, DUP-016, DUP-017 |
| 6 | `ui/ContentCard/ContentCard.svelte` | Reviewed | DUP-019 |
| 7 | `library/LibraryCard.svelte` | Reviewed | DUP-019 |
| 8 | `library/ContinueWatchingCard.svelte` | Reviewed | DUP-019 |
| 9 | `studio/MediaCard.svelte` | Reviewed | DUP-020 |
| 10 | `studio/GrantAccessDialog.svelte` | Reviewed | DUP-021 |
| 11 | `studio/InviteMemberDialog.svelte` | Reviewed | DUP-021, DUP-022 |
| 12 | `studio/EditMediaDialog.svelte` | Reviewed | DUP-021, DUP-022 |
| 13 | `studio/CustomerDetailDrawer.svelte` | Reviewed | DUP-018 |
| 14 | `studio/MediaUpload.svelte` | Reviewed | DUP-023 |
| 15 | `studio/content-form/ThumbnailUpload.svelte` | Reviewed | -- |
| 16 | `studio/LogoUpload.svelte` | Reviewed | DUP-023 |
| 17 | `brand-editor/levels/BrandEditorColors.svelte` | Reviewed | -- |
| 18 | `brand-editor/levels/BrandEditorFineTuneColors.svelte` | Reviewed | -- |
| 19 | `brand-editor/levels/BrandEditorFineTuneTypography.svelte` | Reviewed | DUP-024 |
| 20 | `brand-editor/levels/BrandEditorHome.svelte` | Reviewed | -- |
| 21 | `brand-editor/levels/BrandEditorShadows.svelte` | Reviewed | DUP-024 |
| 22 | `brand-editor/levels/BrandEditorShape.svelte` | Reviewed | DUP-024 |
| 23 | `brand-editor/levels/BrandEditorTypography.svelte` | Reviewed | -- |
| 24 | `ui/FilterBar/FilterBar.svelte` | Reviewed | DUP-025 |
| 25 | `carousel/Carousel.svelte` | Reviewed | -- |
| 26 | `search/SearchBar.svelte` | Reviewed | DUP-026 |
| 27 | `command-palette/CommandPalette.svelte` | Reviewed | DUP-026 |
| 28 | `studio/ActivityFeed.svelte` | Reviewed | DUP-027 |
| 29 | `studio/ContentForm.svelte` | Reviewed | -- |
| 30 | `studio/MediaPicker.svelte` | Reviewed | DUP-020 |
| 31 | `studio/MediaGrid.svelte` | Reviewed | -- |
| 32 | `studio/content-form/PublishSidebar.svelte` | Reviewed | DUP-022 |

---

### DUP-015: Table Components — Three Implementation Approaches, Zero Reuse — P1

**Type**: Structurally similar components
**Files involved**:
- `ui/DataTable/DataTable.svelte` (274 lines) — generic column-driven table with sort + selection
- `studio/ContentTable.svelte` (332 lines) — hand-rolled `<table>` with inline colgroup, status dots, action buttons
- `studio/CustomerTable.svelte` (123 lines) — uses `Table.*` compound components
- `studio/MemberTable.svelte` (285 lines) — uses `Table.*` compound components
- `studio/TopContentTable.svelte` (149 lines) — uses `Table.*` compound components

**Description**: The codebase has three competing table implementations:
1. **DataTable** (generic, snippet-based): Accepts `ColumnDef[]`, `renderCell` snippet, handles sort/selection. Not used by any studio table.
2. **Table.* compound components**: Used by CustomerTable, MemberTable, TopContentTable (and CustomerDetailDrawer's purchase history). Consistent API via `Table.Root/Header/Row/Body/Cell/Head`.
3. **Raw `<table>` with manual CSS**: ContentTable builds its own `<table>` with colgroup, custom header styles, and 190 lines of CSS.

All four studio tables share the same structural pattern: `isEmpty ? EmptyState : table-wrapper > table-with-headers > rows-with-cells`. CustomerTable, MemberTable, and TopContentTable all import the same `Table.*` components and follow the same `Table.Root > Table.Header > Table.Row > Table.Head + Table.Body > Table.Row > Table.Cell` markup pattern. ContentTable duplicates this structure manually.

**DataTable** was built as a reusable solution (sort, selection, bulk actions) but remains completely unadopted. None of the 4 studio tables use it.

**Similarity**: ContentTable is ~70% structurally similar to the Table.* pattern used by the other three / DataTable is 0% adopted

**Suggested fix**: Two options:
- **(A)** Migrate ContentTable to use `Table.*` compound components (matching CustomerTable/MemberTable/TopContentTable), then evaluate if DataTable adds value for future sort/selection needs.
- **(B)** Migrate all tables to DataTable, providing `renderCell` snippets for domain-specific content. This eliminates all per-table CSS since DataTable owns the styling.
Option A is lower risk. Option B is more thorough but requires snippet refactoring for all 4 tables.

---

### DUP-016: Loading Skeleton Pattern — Identical CSS in MemberTable + TopContentTable — P2

**Type**: Identical CSS blocks
**Files involved**:
- `studio/MemberTable.svelte` (lines 249-271)
- `studio/TopContentTable.svelte` (lines 91-113)

**Description**: Both components define identical loading state markup (`loading-state` + `skeleton-row` with pulse animation) and identical CSS:
```css
.loading-state {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
}
.skeleton-row {
  height: 48px; /* or 40px */
  border-radius: var(--radius-md);
  background-color: var(--color-surface-secondary);
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse { ... }
```
The only difference is `skeleton-row` height (48px in MemberTable, 40px in TopContentTable). Both define `@keyframes pulse` identically.

**Similarity**: ~95% identical / 22 lines x 2 instances

**Suggested fix**: Extract a shared `TableSkeleton.svelte` component (or a `SkeletonRows` component) that accepts `rows` count and `rowHeight`. The `@keyframes pulse` should be defined once in a shared styles file. Alternatively, the existing `Skeleton` component could be used here instead of manual skeleton rows.

---

### DUP-017: formatRevenue — Now in 5 Places (Expanded from DUP-011) — P1

**Type**: Repeated utility function
**Files involved**:
- `routes/_org/[slug]/studio/+page.svelte` (line 41)
- `routes/_org/[slug]/studio/analytics/+page.svelte` (line 71)
- `routes/_org/[slug]/studio/billing/+page.svelte` (line 23, as `formatCurrency`)
- `studio/TopContentTable.svelte` (line 33)
- `studio/RevenueChart.svelte` (line 30)

**Description**: This is an expansion of DUP-011. Wave 2 found two additional instances in components: `TopContentTable.formatRevenue()` and `RevenueChart.formatRevenue()`. All five are functionally identical `Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(cents / 100)` wrappers. The only variation is `maximumFractionDigits` (0 in three places, 2 in TopContentTable, unset in RevenueChart) and the analytics version accepting `number | undefined | null`.

**Similarity**: ~95% identical / 6-7 lines x 5 instances = ~30+ redundant lines

**Suggested fix**: `$lib/utils/format.ts` should export a single `formatCurrencyGBP(cents, options?)` function. All 5 instances should import and use it. This eliminates a class of bugs where one instance gets a fix and the others don't.

---

### DUP-018: getInitials — Identical Function in 3 Places — P2

**Type**: Repeated utility function
**Files involved**:
- `studio/MemberTable.svelte` (lines 72-80)
- `studio/CustomerDetailDrawer.svelte` (lines 86-95)
- `layout/Header/UserMenu.svelte` (line 23)

**Description**: Three components independently define a `getInitials(name)` function that splits a name by spaces, takes the first character of each word, joins them, and slices to 2 characters. MemberTable and CustomerDetailDrawer accept `string | null` (with `'?'` fallback); UserMenu accepts `string`. The logic is identical.

**Similarity**: ~90% identical / 5-8 lines x 3 instances

**Suggested fix**: Extract `getInitials(name: string | null, fallback?: string): string` to `$lib/utils/format.ts` alongside the existing format helpers. All three consumers import from there.

---

### DUP-019: Progress Percent Calculation — Same Derivation in 3 Card Components — P2

**Type**: Repeated inline logic
**Files involved**:
- `ui/ContentCard/ContentCard.svelte` (lines 89-97)
- `library/LibraryCard.svelte` (lines 24-32)
- `library/ContinueWatchingCard.svelte` (lines 25-32)

**Description**: All three card components compute `progressPercent` using the same algorithm:
1. If no progress data, return 0
2. If `completed`, return 100
3. If `percentComplete` is set, use it
4. Otherwise calculate `positionSeconds / durationSeconds * 100`

The code is structurally identical across all three, each using `$derived.by(() => { ... })` with the same cascade. ContentCard also has a `hasProgress` derivation that LibraryCard duplicates differently (`hasStarted` + `isCompleted`).

**Similarity**: ~85% identical / 8-10 lines x 3 instances

**Suggested fix**: Extract a `calculateProgressPercent(progress)` pure function in `$lib/utils/progress.ts`. All three components call it in their `$derived`. This also prevents divergence — if the progress data shape changes, one fix covers all cards.

---

### DUP-020: formatFileSize — Defined in 3 Places, Already Exported from Utils — P1

**Type**: Redundant local definition of existing utility
**Files involved**:
- `$lib/utils/format.ts` (line 29) — canonical export
- `studio/MediaCard.svelte` (lines 134-141) — local redefinition
- `studio/content-form/MediaSection.svelte` (line 52) — local redefinition

**Description**: `formatFileSize` is already exported from `$lib/utils/format.ts` with the same logic (bytes to B/KB/MB/GB). MediaCard and MediaSection each define their own identical copy instead of importing the shared version. MediaPicker correctly imports `formatFileSize` from `$lib/utils/format`, proving the shared version works.

**Similarity**: ~95% identical / 7 lines x 2 redundant instances

**Suggested fix**: Delete the local `formatFileSize` definitions in MediaCard and MediaSection. Replace with `import { formatFileSize } from '$lib/utils/format'`. MediaPicker already does this correctly.

---

### DUP-021: Dialog Form Pattern — Identical Boilerplate in 3 Dialogs — P2

**Type**: Structurally similar components
**Files involved**:
- `studio/GrantAccessDialog.svelte` (160 lines)
- `studio/InviteMemberDialog.svelte` (174 lines)
- `studio/EditMediaDialog.svelte` (191 lines)

**Description**: All three dialogs follow the exact same structural pattern:

**Script**: `let submitting = $state(false)`, `let error = $state<string | null>(null)`, `handleSubmit(event: SubmitEvent)` with `event.preventDefault()` + validation + try/catch + reset/close, `handleOpenChange(isOpen)` with reset logic.

**Template**: `Dialog.Root > Dialog.Content > Dialog.Header > Dialog.Title + form.onsubmit > {#if error} Alert > form-fields > Dialog.Footer > Cancel Button + Submit Button with loading state`.

**CSS**: All three define identical `.{name}-form` (flex column + gap), `.form-field` (flex column + gap). InviteMemberDialog and EditMediaDialog also share identical `.field-label` (6 lines) and `.field-input` + `:focus` + `:disabled` CSS (18 lines).

The _only_ differences are: which fields are in the form body, the submit handler's API call, and the dialog title text.

**Similarity**: ~75% structural pattern / ~40 identical CSS lines between InviteMember and EditMedia / ~20 shared CSS across all three

**Suggested fix**: Two approaches:
- **(A)** Extract the identical CSS (`.form-field`, `.field-label`, `.field-input`) to a shared dialog form CSS utility — reduces redundancy without changing component structure.
- **(B)** Create a `DialogForm.svelte` wrapper that accepts title, description, submitLabel, and a `fields` snippet. Provides the Dialog.Root/Content/Header/Footer shell, error display, submit handling, and loading state. Each specific dialog becomes a thin wrapper providing only its form fields and submit callback.

---

### DUP-022: .field-input CSS — Same 12-Line Block in 7 Components — P1

**Type**: Identical CSS blocks
**Files involved**:
- `studio/InviteMemberDialog.svelte` (lines 150-171)
- `studio/EditMediaDialog.svelte` (lines 161-181)
- `studio/content-form/ContentDetails.svelte` (line 100)
- `studio/content-form/SlugField.svelte` (line 75)
- `studio/content-form/PublishSidebar.svelte` (lines 365-381)
- `studio/content-form/ThumbnailUpload.svelte` (lines 187-203)
- `routes/_org/[slug]/studio/settings/+page.svelte` (line 293)

**Description**: Seven files define the same `.field-input` CSS block:
```css
.field-input {
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  border-radius: var(--radius-md);
  border: var(--border-width) var(--border-style) var(--color-border);
  background-color: var(--color-background);
  color: var(--color-text);
  transition: var(--transition-colors);
  width: 100%;
}
.field-input:focus {
  outline: var(--border-width-thick) solid var(--color-focus);
  outline-offset: -1px;
  border-color: var(--color-border-focus);
}
```
Some add `.field-input:disabled` (3 more lines). The block is 12-15 lines repeated 7 times = ~84-105 redundant lines.

**Similarity**: ~95% identical / 12-15 lines x 7 instances

**Suggested fix**: Extract a shared `.field-input` class into a global form utilities stylesheet (e.g., `$lib/styles/form.css`) imported by all form-containing components, or create an `Input.svelte` primitive component. This is the most-duplicated single CSS block in the frontend codebase.

---

### DUP-023: Upload Drop Zone — Shared Drag-and-Drop Pattern in MediaUpload + LogoUpload — P2

**Type**: Structurally similar components
**Files involved**:
- `studio/MediaUpload.svelte` (515 lines)
- `studio/LogoUpload.svelte` (323 lines)

**Description**: Both components share the same drag-and-drop upload zone pattern:

**Script**: `let isDragging = $state(false)`, `let fileInput = $state()`, `handleDragOver(e)` with `e.preventDefault(); isDragging = true`, `handleDragLeave(e)` with `e.preventDefault(); isDragging = false`, `handleDrop(e)`, `handleFileSelect(e)`, `handleBrowseClick()` calling `fileInput?.click()`. These 5 event handlers are functionally identical in both files (each is 3-5 lines, total ~20 identical lines of script).

**CSS**: Both define `.drop-zone` with nearly identical styles:
- flex column, centered, gap, dashed border, rounded corners, cursor pointer, transition
- `.drop-zone:hover/:focus-visible` with `border-color: var(--color-focus)` and background change
- `.drop-zone.dragging` with `border-color: var(--color-interactive)`
- `.drop-text`, `.drop-hint`, `.upload-icon` classes
- Hidden file input (sr-only pattern)

The only meaningful differences: MediaUpload uses `border: var(--border-width-thick) var(--border-style-dashed)` while LogoUpload uses `border: 2px dashed` (a token violation), and MediaUpload supports multi-file queue while LogoUpload is single-file.

**Similarity**: ~70% structural / ~40 identical CSS lines / ~20 identical script lines

**Suggested fix**: Extract a `DropZone.svelte` component that handles: isDragging state, drag event handlers, browse click delegation, the drop zone visual (icon + text + hint), and hidden file input. Props: `accept`, `multiple`, `onFiles(files)`, `text`, `hint`. MediaUpload and LogoUpload each wrap DropZone and add their domain-specific logic (queue management for media, validation for logo). Also fixes the `2px dashed` token violation in LogoUpload.

---

### DUP-024: Brand Editor Slider Pattern — Repeated Range Input + Label + Value Layout — P3

**Type**: Repeated markup patterns
**Files involved**:
- `brand-editor/levels/BrandEditorFineTuneTypography.svelte` (lines 57-106)
- `brand-editor/levels/BrandEditorShadows.svelte` (lines 60-106)
- `brand-editor/levels/BrandEditorShape.svelte` (lines 25-79)

**Description**: Three brand editor levels share the same slider UI pattern:
```
section.{prefix}__section
  label.{prefix}__label > "Label" + span.{prefix}__value "X.XX"
  div.{prefix}__range-row
    span.{prefix}__range-hint "Min label"
    input[type=range].{prefix}__slider
    span.{prefix}__range-hint "Max label"
```
The CSS for this pattern is also structurally identical across all three:
- `__section`: flex column, gap
- `__label`: flex, space-between, text-sm, font-medium
- `__value`: font-mono, text-xs, text-muted
- `__range-row`: flex, center, gap
- `__range-hint`: text-xs, text-muted, width fixed, last-child text-align right
- `__slider`: flex 1, accent-color interactive

Each uses its own BEM prefix (`fine-type__`, `shadows-level__`, `shape-level__`) but the structure is identical. Shape has 2 sliders, Shadows has 1, FineTuneTypography has 1 + 2 selects.

**Similarity**: ~90% structural / 15-20 CSS lines x 3 instances

**Suggested fix**: Extract a `BrandSlider.svelte` component that renders the label+value+range+hints pattern. Props: `label`, `value`, `minLabel`, `maxLabel`, `min`, `max`, `step`, `onInput`, `valueFormatter`. Each brand editor level calls `<BrandSlider .../>` instead of repeating the markup/CSS. Lower priority since these are all within the brand editor domain and use BEM naming.

---

### DUP-025: FilterBar — Built but Not Fully Adopted — P3

**Type**: Incomplete adoption of shared component
**Files involved**:
- `ui/FilterBar/FilterBar.svelte` — shared filter bar with pills, select, search
- Various route pages with inline filter implementations

**Description**: The `FilterBar` component was recently extracted as a config-driven filter bar supporting pill groups, select dropdowns, and debounced search. It exports a `FilterConfig` type. However, based on Wave 1 findings (DUP-005, DUP-009), the studio content pages and library pages still implement their own filter button loops and search inputs inline rather than using FilterBar.

**Similarity**: N/A — this is an adoption gap, not structural duplication

**Suggested fix**: Audit all pages with filter/sort UI and migrate them to use `FilterBar` where applicable. Priority pages: studio content list (DUP-005), library pages (DUP-009), explore page. This compounds with existing findings to eliminate more duplication.

---

### DUP-026: SearchBar vs CommandPalette — Duplicated Cmd+K Handler — P3

**Type**: Conflicting keyboard shortcut handlers
**Files involved**:
- `search/SearchBar.svelte` (lines 97-103) — `handleGlobalKeydown` with `(e.metaKey || e.ctrlKey) && e.key === 'k'`
- `command-palette/CommandPalette.svelte` (lines 134-145) — `handleGlobalKeydown` with the same check

**Description**: Both components register a global `svelte:window onkeydown` handler for Cmd/Ctrl+K. If both are mounted on the same page, they will conflict. SearchBar focuses its input; CommandPalette opens/closes a modal dialog. CommandPalette includes an escape hatch for TipTap editors (`isContentEditable` check) that SearchBar lacks.

Neither component deduplicates the shortcut or coordinates with the other.

**Similarity**: ~80% identical handler logic / 6-8 lines

**Suggested fix**: Designate one component as the primary Cmd+K target per context. In studio layouts, CommandPalette should own Cmd+K. In platform/org layouts, SearchBar should own it. The simplest fix: SearchBar should NOT register the global shortcut if CommandPalette is present on the page. Alternatively, extract a shared keyboard shortcut registry utility.

---

### DUP-027: formatRelativeTime — Inline in ActivityFeed, Missing from Utils — P3

**Type**: Utility function defined inline instead of shared
**Files involved**:
- `studio/ActivityFeed.svelte` (lines 31-44)

**Description**: `formatRelativeTime(timestamp)` computes "Just now", "Xm ago", "Xh ago", "Xd ago" or falls back to `toLocaleDateString()`. This is only in one place currently, but it is a general utility that will likely be needed elsewhere as the platform grows (notification list, comment timestamps, etc.). It would benefit from being in `$lib/utils/format.ts`.

**Similarity**: N/A — single instance, but should be shared

**Suggested fix**: Move `formatRelativeTime` to `$lib/utils/format.ts`. Low priority since it is only in one place today.

---

## Wave 2 Summary

| ID | Severity | Type | Duplicated Lines | Files |
|----|----------|------|-----------------|-------|
| DUP-022 | **P1** | .field-input CSS (7 files) | ~84-105 lines | 7 |
| DUP-017 | **P1** | formatRevenue/Currency (5 files) | ~30 lines | 5 |
| DUP-020 | **P1** | formatFileSize redefined despite shared export | ~14 lines | 2 (+1 canonical) |
| DUP-015 | **P1** | Table components — 3 approaches, 0 reuse of DataTable | structural | 5 |
| DUP-016 | **P2** | Loading skeleton CSS in tables | ~44 lines | 2 |
| DUP-018 | **P2** | getInitials function (3 files) | ~18 lines | 3 |
| DUP-019 | **P2** | progressPercent calculation (3 cards) | ~27 lines | 3 |
| DUP-021 | **P2** | Dialog form boilerplate (3 dialogs) | ~60 CSS + ~30 script | 3 |
| DUP-023 | **P2** | Upload drop zone pattern (2 files) | ~60 lines | 2 |
| DUP-024 | **P3** | Brand editor slider pattern | ~45-60 lines | 3 |
| DUP-025 | **P3** | FilterBar not fully adopted | structural | 1+ |
| DUP-026 | **P3** | Cmd+K shortcut conflict (2 components) | ~14 lines | 2 |
| DUP-027 | **P3** | formatRelativeTime inline | ~13 lines | 1 |

**Wave 2 total estimated redundant lines**: ~420-520

**Combined total (Wave 1 + Wave 2)**: ~1,820-1,920+

### Top 3 highest-impact Wave 2 fixes:
1. **DUP-022**: Shared `.field-input` CSS class — eliminates ~84-105 lines across 7 files and prevents future CSS drift
2. **DUP-017 + DUP-020**: Consolidate `formatRevenue`/`formatCurrency`/`formatFileSize` to `$lib/utils/format.ts` — eliminates ~44 lines across 7 files and fixes DUP-013 currency bug
3. **DUP-015 + DUP-021**: Standardize table approach + dialog form pattern — structural cleanup that prevents further divergence


# Frontend Code Review: SvelteKit Web Application

**Scope:** `apps/web/src/` -- components, routes, state management, remote functions, utilities, editor
**Reviewed by:** Claude Opus 4.6

## Review History

| Pass | Date | Reviewer | Notes |
|------|------|----------|-------|
| 1 | 2026-04-07 | Claude Opus 4.6 | Initial review |
| 2 | 2026-04-07 | Claude Opus 4.6 | Verified all claims from Pass 1. Corrected 3 false/misleading findings. Added 5 new findings. Expanded coverage to editor, player, subscription, more studio components. |
| 3 | 2026-04-07 | Claude Opus 4.6 | Verified all Pass 2 findings. Corrected `form: any` count (5 files, not 5 sub-components -- JSDoc says typed, Props says `any`). Added 6 new findings: SearchBar combobox keyboard gap, missing `(platform)` and `(auth)` error pages, hardcoded English in ContentTypeSelector/DialogContent/Toaster/Select, image alt text i18n gaps, NavigationProgress hardcoded CSS. Deep-dived routing, form handling, error boundaries, loading states, accessibility (5 interactive components). |

### Pass 3 Corrections

1. **Refined: `form: any` count** -- Pass 2 listed "5 content-form sub-components". Verified: exactly 5 files have `form: any` (ContentDetails, ContentTypeSelector, SlugField, MediaSection, WrittenContentEditor). `ThumbnailUpload.svelte` already uses the correct `ContentForm` type (line 14). `PublishSidebar.svelte` also correctly typed. `TagsInput.svelte` does not use `form` at all. The JSDoc on `ContentTypeSelector.svelte` line 7 says `{typeof createContentForm | typeof updateContentForm}` but the actual `Props` interface on line 17 says `any` -- the JSDoc is aspirational, not enforced.
2. **Verified: formatPrice/formatCurrency duplicates** -- Pass 2 listed 9 duplicates. Exact count is 9 local duplicates plus 1 canonical: `formatPrice` (2 local), `formatCurrency` (3 local), `formatRevenue` (2 local), `formatDate` (2 local). All verified at the file/line locations listed.
3. **Verified: Dead ErrorBoundary** -- `src/lib/components/ErrorBoundary.svelte` has zero imports anywhere in the codebase. All production code uses `$lib/components/ui` barrel export.
4. **Verified: Auth hardcoded strings** -- All 10 hardcoded English strings in auth server actions confirmed at exact file/line locations.
5. **Verified: `.sr-only` duplication** -- All 7 locations confirmed.
6. **Added: SearchBar combobox keyboard navigation gap** (Medium severity) -- `role="combobox"` declared but no `ArrowDown`/`ArrowUp` handling or `aria-activedescendant` for the listbox items.
7. **Added: Missing `(platform)/+error.svelte`** (Low-Med) -- library, discover, pricing, about, become-creator routes fall through to root error page without platform header/footer.
8. **Added: Missing `(auth)/+error.svelte`** (Low) -- auth routes fall through to root error page, which is acceptable since the auth layout is minimal, but inconsistent with the comprehensive coverage elsewhere.
9. **Added: More hardcoded English strings** -- ContentTypeSelector type descriptions (3), DialogContent `aria-label="Close"`, Toaster `aria-label="Close"`, Select default placeholder `"Select an option..."`, ThumbnailUpload `alt="Content thumbnail"`, ProfileForm `alt="Avatar"`, BrandEditorLogo `alt="Organization logo"`, NavigationProgress `aria-label="Page loading"`.
10. **Added: NavigationProgress hardcoded CSS** -- `height: 3px` and `box-shadow: 0 0 8px` without tokens.

---

## Executive Summary

The frontend codebase is mature and well-architected. Svelte 5 migration is **100% complete** -- zero instances of legacy `export let`, `$:`, or `$app/stores` patterns remain. The UI component library is high quality with consistent design token usage, typed Props interfaces, and scoped styles. The shell+stream pattern for server loads is correctly implemented with proper `.catch()` guards.

### Top 10 Findings

| # | Severity | Finding | Impact |
|---|----------|---------|--------|
| 1 | Medium | **SearchBar `role="combobox"` without keyboard navigation** -- declares ARIA combobox but recent search items are mouse-only | WCAG 2.1 failure, keyboard users cannot navigate dropdown |
| 2 | Medium | **5 content-form sub-components use `form: any`** in Props interfaces | Type safety gap across most of studio content creation |
| 3 | Medium | **Monetisation page uses `as any` casts** (6 instances) to work around remote function types | Type safety gap, runtime errors possible |
| 4 | Medium | **9 duplicate formatting functions** -- `formatPrice` (2), `formatCurrency` (3), `formatRevenue` (2), `formatDate` (2) local copies | Drift risk, GBP formatting inconsistency |
| 5 | Low-Med | **Missing `(platform)/+error.svelte`** -- 5 platform pages (library, discover, pricing, about, become-creator) fall through to root error page, losing platform header/footer | Broken UX on error states |
| 6 | Low-Med | **Hardcoded English strings** in 30+ locations across auth actions, PublishSidebar, ContentTypeSelector, Select, Dialog, Toaster, TagsInput, image alt texts | i18n incomplete, blocks future localisation |
| 7 | Low-Med | **Hardcoded pixel breakpoints** in `@media` queries across 8 components instead of design token custom media | Token system partially bypassed |
| 8 | Low-Med | **Duplicated `.sr-only` CSS class** defined identically in 7 components | Unnecessary code duplication |
| 9 | Low | **Dead code: root-level `ErrorBoundary.svelte`** is never imported | Confusing for developers |
| 10 | Low | **Duplicated content form schemas** -- create/update share ~95% of field definitions | Maintenance burden |

---

## 1. Svelte 5 Compliance

**Verdict: Excellent -- full compliance. Verified by grep.**

Grep searches across all `.svelte` files in `apps/web/src/` confirmed:
- **Zero** `export let` declarations
- **Zero** `$:` reactive statements
- **Zero** `$app/stores` imports

All components use:
- `$props()` with typed `Props` interfaces
- `$state()`, `$derived()`, `$effect()` consistently
- `$bindable()` for two-way bindings (Dialog `open`, Input `value`, Select `value`)
- `Snippet` type for content slots with `{@render children()}`
- `page` imported from `$app/state` (not `$app/stores`) throughout

The `biome-ignore` comments in `Input.svelte` (lines 26, 30) correctly explain why `let` is needed for `$bindable()` and `$state()`. These are the only two biome-ignore comments in the component library.

---

## 2. Component Quality

### UI Components (`src/lib/components/ui/`)

**Verdict: Excellent.**

The UI library follows a consistent pattern across all ~22 component families:

- **Typed Props** extending HTML element types (`HTMLButtonAttributes`, `HTMLInputAttributes`, etc.)
- **Component documentation** via `@component` JSDoc blocks with `@prop` and `@example`
- **Design tokens** for all CSS values (spacing, colors, typography, borders, shadows)
- **`class: className` pattern** with rest props spread for composability
- **Scoped `<style>`** blocks -- no leaking styles
- **Accessibility**: `aria-busy`, `aria-label`, `role="alert"`, `focus-visible` outlines, `tabindex` management

Standout examples:
- `Button.svelte`: Clean variant/size system via `data-*` attributes, proper loading state with `aria-busy`
- `ContentCard.svelte`: Four variants (explore/library/featured/compact), progress bar with `role="progressbar"`, lazy loading images with srcset
- `Dialog.svelte`: Properly syncs Melt UI state with Svelte 5 runes via `$effect`. Focus trapping handled by Melt UI's `createDialog`.
- `PurchaseOrSubscribeModal.svelte`: Clean billing toggle with `role="radiogroup"`, tier comparison, Stripe checkout integration. All CSS uses design tokens.
- `SubscriptionBadge.svelte`: Minimal, well-scoped, correct use of tokens
- `Carousel.svelte`: Excellent accessibility -- `role="region"` with `aria-roledescription="carousel"`, arrow buttons with i18n'd `aria-label`, `prefers-reduced-motion` respected for scroll behavior, focus-in handler scrolls items into view, arrows hidden on touch devices via `@media (hover: none)`.
- `ResponsiveImage.svelte`: Clean skeleton placeholder pattern, auto-generates `srcset` from thumbnail URL, uses `loading="lazy"` by default.

### Editor Components (`src/lib/components/editor/`)

**Verdict: Very good.**

- `RichTextEditor.svelte`: Clever reactivity pattern -- uses a `txVersion` counter bumped on every Tiptap transaction to force `$derived` re-evaluation (since the Editor object reference never changes). Hidden textarea bridges Tiptap to the `form()` progressive enhancement pattern. Late-arriving content handled via `$effect` with infinite-loop guard.
- `EditorToolbar.svelte`: `role="toolbar"` with `aria-label="Text formatting"`. 18 `aria-label` instances across toolbar buttons. Link popover uses `role="dialog"`.
- `BubbleMenuBar.svelte`, `SlashMenu.svelte`: Clean separation of concerns. SlashMenu uses `role="listbox"` with `role="option"` items.
- `ProseContent.svelte`: Renders sanitized HTML with proper scoped prose styles.
- `render.ts`: Server-side rendering with dynamic imports for `@tiptap/html` and `marked` (code-splitting friendly). DOMPurify sanitization for legacy markdown.

**Minor issue:** `RichTextEditor.svelte` uses hardcoded `min-height: 300px` (line 206) and `min-height: 120px` (line 212) instead of design tokens. Also `font-size: 0.9em` for inline code (line 274).

### Player Components (`src/lib/components/player/`)

**Verdict: Very good.**

- `PreviewPlayer.svelte`: Custom HLS player with 30-second preview limit, muted autoplay support, CTA overlay for locked/expired content. All i18n strings use `$paraglide/messages`. Good use of `color-mix(in srgb, ...)` for overlay gradients. 2 `focus-visible` styles, `prefers-reduced-motion` support, `role="alert"` on error state.
- `deriveAccessState`: Clean access state derivation for multi-reason gating (auth, purchase, subscription, tier).

### Studio Components (`src/lib/components/studio/`)

**Verdict: Good, with specific type safety concerns.**

- `ContentForm.svelte`: Well-decomposed into 6 sub-components. Good `beforeNavigate` unsaved changes guard.
- `MediaCard.svelte`: Excellent transcoding progress polling with visibility-aware polling, error count limits, and clean cleanup.
- `CustomerTable.svelte`, `CustomerDetailDrawer.svelte`: Properly import utilities from `$lib/utils/format`. `CustomerTable` has 2 `focus-visible` styles.
- `MemberTable.svelte`: Clean role badge mapping, confirm dialog for removals.
- `MediaPicker.svelte`: Built on Melt UI's `createCombobox` for full keyboard navigation and ARIA compliance.
- `MediaUpload.svelte`: Drop zone with `role="button"`, `tabindex="0"`, keyboard Enter/Space handler, 2 `focus-visible` styles. Upload queue uses `role="list"`/`role="listitem"`.

**Issue: Inline SVG in CustomerTable.svelte (line 100):**
```svelte
<svg width="14" height="14" viewBox="0 0 24 24" ...>
```
This copy icon is the only inline SVG in the codebase -- all other icons use the Icon component system (`EyeIcon`, `EditIcon`, etc. on the same page use the system). Should use a `CopyIcon` component for consistency.

### Layout Components

**Verdict: Very good.**

- `UserMenu.svelte`: Handles subdomain-aware navigation correctly using `buildCreatorsUrl`, `buildPlatformUrl`, `extractSubdomain`. All CSS uses design tokens including the responsive breakpoint (`@media (--breakpoint-md)`).
- `StudioSwitcher.svelte`: Cross-org navigation with full subdomain URL construction. Org logos correctly use `alt=""` (decorative, org name is in adjacent text).
- `StudioSidebar.svelte`: 6 `aria-label` attributes on navigation sections, `role="list"` on nav groups, `aria-current="page"` via `.loading` class, `focus-visible` outlines.
- `MobileNav.svelte`: Excellent accessibility -- `aria-expanded`, `aria-controls`, `aria-label` with i18n (open/close), `aria-current="page"` on active links, Escape key handler, `aria-hidden="true"` on backdrop overlay. All CSS uses design tokens.
- `CommandPalette.svelte`: Full keyboard navigation (ArrowUp/Down, Enter, Escape, Tab trap), `role="dialog"`, `role="combobox"` with `aria-activedescendant`, `role="listbox"` with `role="option"` and `aria-selected`. All strings from `$paraglide/messages`. Footer shows keyboard hints.
- Platform layout properly owns version staleness, progress sync, and visibility change handling.
- Org layout correctly mirrors progress sync and staleness patterns (as a sibling route group, not a child).

---

## 3. Type Safety Concerns

### 3.1 Content Form Sub-Components: `form: any` (Medium Severity)

Five content-form sub-components declare `form: any` in their Props interface:

| File | Line |
|------|------|
| `content-form/ContentDetails.svelte` | 15 |
| `content-form/ContentTypeSelector.svelte` | 17 |
| `content-form/SlugField.svelte` | 18 |
| `content-form/MediaSection.svelte` | 29 |
| `content-form/WrittenContentEditor.svelte` | 14 |

Two siblings are already properly typed:
- `ThumbnailUpload.svelte` (line 14): `type ContentForm = typeof createContentForm | typeof updateContentForm`
- `PublishSidebar.svelte` (line 24): Same `ContentForm` union type

`ContentTypeSelector.svelte` is particularly notable: the JSDoc on line 7 says `@prop {typeof createContentForm | typeof updateContentForm} form` but the actual Props interface on line 17 says `form: any`. The documentation is aspirational; the type system is not enforcing it.

**Recommendation:** Copy the `ContentForm` type definition from `ThumbnailUpload.svelte` or `PublishSidebar.svelte` into the 5 remaining files. This is a 2-line change per file.

### 3.2 Monetisation Page `as any` Casts (Medium Severity)

`_org/[slug]/studio/monetisation/+page.svelte` contains 6 `as any` casts across lines 66-78:

```typescript
const tiers = $derived((tiersQuery as any)?.current ?? []) as SubscriptionTier[];
const connectStatus = $derived((connectQuery as any)?.current ?? { ... });
const enableSubscriptionsFromServer = $derived(
  (settingsQuery as any)?.current?.features?.enableSubscriptions ?? false
);
const stats = $derived((statsQuery as any)?.current ?? { ... });
const dataLoading = $derived(
  (tiersQuery as any)?.loading || (connectQuery as any)?.loading || (settingsQuery as any)?.loading
);
```

This suggests the remote function return types don't match the expected query shape. The `as any` casts bypass type checking entirely.

**Recommendation:** Type the remote function return values properly, or create a typed wrapper for the SPA query pattern.

### 3.3 `use-live-query-ssr.ts` (Low Severity)

One `as any` at line 67: `collection: undefined as any`. This is in the SSR stub path and is a pragmatic workaround for TanStack DB's type system. Acceptable but should have a `// TODO` comment.

---

## 4. Code Duplication

### 4.1 `formatPrice` / `formatCurrency` / `formatRevenue` (Medium Severity)

The canonical `formatPrice` in `$lib/utils/format.ts` (line 67) handles `null`, uses a pre-constructed `Intl.NumberFormat` instance, and always formats as GBP with 2 decimal places.

**Local duplicates that should be removed:**

| File | Function | Line | Difference from canonical |
|------|----------|------|---------------------------|
| `PurchaseOrSubscribeModal.svelte` | `formatPrice` | 42 | Creates new `Intl.NumberFormat` per call, no null handling |
| `pricing/+page.svelte` | `formatPrice` | 25 | Creates new `Intl.NumberFormat` per call, no null handling |
| `monetisation/+page.svelte` | `formatCurrency` | 116 | Same behavior, different name |
| `billing/+page.svelte` | `formatCurrency` | 43 | Adds `minimumFractionDigits: 0` (rounds to whole pounds) |
| `account/subscriptions/+page.svelte` | `formatCurrency` | 34 | Same behavior as canonical |
| `analytics/+page.svelte` | `formatRevenue` | 117 | Adds `minimumFractionDigits: 0, maximumFractionDigits: 2` |
| `RevenueChart.svelte` | `formatRevenue` | 30 | Adds `minimumFractionDigits: 0, maximumFractionDigits: 2` |

The `billing`, `analytics`, and `RevenueChart` variants intentionally round differently (whole pounds for dashboard stats). Consider adding a `formatPriceCompact(cents)` variant to the canonical `format.ts` instead of local copies.

**Recommendation:** Delete local copies. For the rounding variants, add `formatPriceCompact()` to `$lib/utils/format.ts`.

### 4.2 `formatDate` Duplication (Low-Medium Severity)

The canonical `formatDate` in `$lib/utils/format.ts` (line 46) accepts `string | Date` and formats as `1 Jan 2026`.

**Local duplicates:**

| File | Line | Difference |
|------|------|------------|
| `RevenueChart.svelte` | 42 | Adds weekday (`Mon, 1 Jan`) |
| `account/subscriptions/+page.svelte` | 41 | Same as canonical but only accepts `string` |

**Recommendation:** Remove `subscriptions/+page.svelte` duplicate (identical behavior). For `RevenueChart`, add a `formatDateShort()` variant to the canonical module.

### 4.3 `getInitials` Duplication (Low Severity)

`UserMenu.svelte` (line 32) has an inline `getInitials` that takes `string` (not `string | null | undefined`). The canonical version in `$lib/utils/format.ts` (line 77) handles null/undefined with a fallback.

**Recommendation:** Remove inline version, import from `$lib/utils/format`.

### 4.4 `.sr-only` CSS Class (Low-Medium Severity)

The `.sr-only` utility class is defined identically in 7 component `<style>` blocks:

1. `ContentCard.svelte` (line 245)
2. `CreatorCard.svelte` (line 179)
3. `Select.svelte` (line 195)
4. `Spinner.svelte` (line 38)
5. `RichTextEditor.svelte` (line 325)
6. `ColorPicker.svelte` (line 212)
7. `ContentTypeSelector.svelte` (line 146)

Each is ~10 lines of identical CSS. Total: ~70 lines of duplication.

**Recommendation:** Move to `global.css` or a shared utility layer.

### 4.5 Content Form Schemas (Low Severity)

In `content.remote.ts`, `createContentFormSchema` (line 379) and `updateContentFormSchema` (line 466) share ~95% of their field definitions. The only difference is `updateContentFormSchema` adds `contentId: z.string().uuid()`.

**Recommendation:** Extract shared base schema and extend:
```typescript
const contentFormBaseSchema = z.object({ /* shared fields */ });
const createContentFormSchema = contentFormBaseSchema;
const updateContentFormSchema = contentFormBaseSchema.extend({ contentId: z.string().uuid() });
```

---

## 5. Internationalisation (i18n)

### Pattern

Most of the codebase correctly uses `$paraglide/messages` (`* as m`). The `messages/en.json` file is the source of truth, and components reference messages via function calls like `m.studio_content_form_access_free()`.

### Hardcoded English Strings (Low-Medium Severity)

**UI components:**

| File | Line(s) | Hardcoded String |
|------|---------|------------------|
| `Spinner.svelte` | 10 | `Loading...` |
| `Input.svelte` | 52 | `Hide password` / `Show password` |
| `Select.svelte` | 46 | `Select an option...` (default placeholder) |
| `DialogContent.svelte` | 24 | `aria-label="Close"` |
| `Toaster.svelte` | 27 | `aria-label="Close"` |
| `NavigationProgress.svelte` | 25 | `aria-label="Page loading"` |
| `PublishSidebar.svelte` | 118-135 | `Title is set`, `Slug is valid`, `Media attached`, `Content body written`, `Price set for paid content`, `Subscription tier selected` |
| `PublishSidebar.svelte` | 150 | `Select a tier` |
| `PublishSidebar.svelte` | 219 | `Complete all readiness checks before publishing` |
| `PublishSidebar.svelte` | 248 | `Publish Readiness` |
| `PublishSidebar.svelte` | 311 | `Paid content requires a price greater than...` |
| `PublishSidebar.svelte` | 313 | `Optional. Leave at...if only available via subscription.` |
| `PublishSidebar.svelte` | 321 | `Minimum Tier` |
| `PublishSidebar.svelte` | 326 | `Select a minimum tier` |
| `PublishSidebar.svelte` | 329 | `Subscribers at or above this tier can access this content.` |
| `PublishSidebar.svelte` | 336 | `Category`, `Optional` |
| `PublishSidebar.svelte` | 340 | `e.g. Tutorial, Review, Guide` |
| `PublishSidebar.svelte` | 360 | `Danger Zone` |
| `PublishSidebar.svelte` | 370 | `Deleting...` |
| `ContentTypeSelector.svelte` | 28, 33, 38 | `Upload or link a video`, `Upload or link audio`, `Write an article` (type descriptions) |
| `TagsInput.svelte` | 52 | `Tags`, `Optional` |
| `TagsInput.svelte` | 82 | `Add tags...` (placeholder) |
| `TagsInput.svelte` | 89 | `Press Enter or comma to add. Max 50 chars each.` |
| `TagsInput.svelte` | 70 | `Remove tag {tag}` (aria-label) |

**Image alt texts (hardcoded English):**

| File | Line | String |
|------|------|--------|
| `ThumbnailUpload.svelte` | 49 | `alt="Content thumbnail"` |
| `ProfileForm.svelte` | 200 | `alt="Avatar"` |
| `BrandEditorLogo.svelte` | 30 | `alt="Organization logo"` |

**Auth server actions (10+ instances):**

| File | Line | String |
|------|------|--------|
| `login/+page.server.ts` | 69 | `Your email hasn't been verified yet...` |
| `login/+page.server.ts` | 76 | `Invalid email or password` |
| `login/+page.server.ts` | 83 | `Too many login attempts...` |
| `login/+page.server.ts` | 89 | `Login failed. Please try again.` |
| `login/+page.server.ts` | 123 | `An unexpected error occurred...` |
| `register/+page.server.ts` | 78 | `An account with this email already exists.` |
| `register/+page.server.ts` | 85 | `Registration failed...` |
| `register/+page.server.ts` | 115 | `An unexpected error occurred...` |
| `forgot-password/+page.server.ts` | 42 | `An unexpected error occurred...` |
| `forgot-password/+page.server.ts` | 53 | `An unexpected error occurred...` |
| `reset-password/+page.server.ts` | 54 | `Password reset failed. Token may be invalid or expired.` |
| `reset-password/+page.server.ts` | 64 | `An unexpected error occurred...` |
| `verify-email/+page.server.ts` | 34 | `Invalid or expired verification link.` |
| `verify-email/+page.server.ts` | 63 | `An unexpected error occurred.` |

**Note:** Auth server action strings are returned in form `fail()` responses and rendered client-side. These are user-facing and should use i18n. Content form error strings in `content.remote.ts` (line 381: `'Title is required'`, line 382: `'Slug is required'`, line 461: `'Failed to create content'`) are also hardcoded.

---

## 6. State Management

### Collections

**Verdict: Well-implemented.**

- `libraryCollection` and `progressCollection` correctly use `localStorageCollectionOptions` with `browser` guard
- `contentCollection` uses `queryCollectionOptions` for session-scoped data
- `hydration.ts` provides clean `hydrateIfNeeded`, `isCollectionHydrated`, `invalidateCollection` API
- `use-live-query-ssr.ts` wraps TanStack DB's `useLiveQuery` with SSR safety (returns static `ssrData` on server)

### Version Manifest

**Verdict: Correct.** The staleness detection lifecycle is properly wired:
1. Server layout reads KV versions via `depends('cache:versions')` (platform) or `depends('cache:org-versions')` (org)
2. Client `$effect` diffs versions via `getStaleKeys()`
3. Stale keys trigger `invalidateCollection()`
4. Tab return fires `invalidate('cache:versions')` or `invalidate('cache:org-versions')` to re-run the cycle

### Progress Sync

`initProgressSync` is correctly called in two places:
- `(platform)/+layout.svelte` (line 53) -- for platform routes (library, account, discover)
- `_org/[slug]/+layout.svelte` (line 144) -- for org subdomain routes (where content is watched)

These are sibling route groups, not parent/child, so calling it in both is correct and necessary. The `progress-sync.ts` module is internally idempotent (prevents double-initialization).

**Note:** The web CLAUDE.md (line 629) states "initProgressSync lives ONLY in `(platform)/+layout.svelte`" -- this is incorrect and should be updated to reflect the actual (correct) pattern.

---

## 7. Server Loads & Data Fetching

### Shell + Stream Pattern

**Verdict: Correctly implemented across all checked server loads.**

Verified pages:
- **Org landing** (`_org/[slug]/(space)/+page.server.ts`): Awaits `contentPromise` for hero; streams `creatorsPromise` and `continueWatchingPromise` with `.catch()`.
- **Content detail** (`_org/[slug]/(space)/content/[contentSlug]/+page.server.ts`): Awaits content + render; streams `relatedPromise`, `accessAndProgress`, and `subscriptionContext` with `.catch()`.
- **Platform landing**: Simple static cache header, no streaming needed.

All streamed data uses `{#await}` blocks with skeleton loading states in the corresponding `+page.svelte` files. Skeletons verified in: org landing (2 `{#await}` blocks), content detail (2 `{#await}` blocks), studio dashboard.

### Cache Headers

Consistently applied via `CACHE_HEADERS` presets:
- `STATIC_PUBLIC` for platform landing
- `DYNAMIC_PUBLIC` for public org/content pages
- `PRIVATE` for authenticated users
- Conditional downgrade when `locals.user` exists

### Missing `.catch()` Review

All streamed promises in server loads have `.catch()` handlers. No unguarded promises found.

### Raw `fetch` Usage

Raw `fetch` (not via `createServerApi`) is used in:
- Auth server actions (`login`, `register`, `forgot-password`, `reset-password`, `verify-email`) -- **Correct**: these need direct access to `Set-Cookie` response headers
- `/api/media/[id]/upload/+server.ts` -- **Correct**: binary upload proxy that streams the request body, commented explanation provided

---

## 8. Design System / CSS Findings

### Token Usage

**Verdict: Very good across production components, weak in stories (expected).**

Production components consistently use design tokens for:
- Spacing: `var(--space-1)` through `var(--space-24)`
- Colors: `var(--color-text)`, `var(--color-surface)`, `var(--color-interactive)`, etc.
- Typography: `var(--text-sm)`, `var(--font-medium)`, etc.
- Borders: `var(--border-width)`, `var(--border-style)`, `var(--radius-md)`
- Shadows: `var(--shadow-sm)`, `var(--shadow-lg)`
- Transitions: `var(--transition-colors)`, `var(--duration-fast)`

### Hardcoded Media Query Breakpoints

8 components use raw pixel values in `@media` queries instead of custom media tokens:

| File | Line | Value | Should be |
|------|------|-------|-----------|
| `ContentForm.svelte` | 363 | `min-width: 768px` | `(--breakpoint-md)` |
| `ContentForm.svelte` | 377 | `max-width: 767px` | `(--below-md)` |
| `PreviewPlayer.svelte` | 444 | `max-width: 640px` | `(--below-sm)` |
| `StudioMediaPage.svelte` | 243 | `min-width: 640px` | `(--breakpoint-sm)` |
| `ContentTypeSelector.svelte` | 105 | `max-width: 480px` | `(--below-xs)` |
| `BrandEditorPanel.svelte` | 190 | `max-width: 639px` | `(--below-sm)` |
| `PageHeader.svelte` | 34 | `min-width: 640px` | `(--breakpoint-sm)` |
| `CheckoutSuccess.svelte` | 369 | `min-width: 640px` | `(--breakpoint-sm)` |

Compare with `UserMenu.svelte`, `MobileNav.svelte`, and `SearchBar.svelte` which correctly use `@media (--breakpoint-md)`.

### Other Hardcoded CSS Values

| File | Line | Value | Issue |
|------|------|-------|-------|
| `Spinner.svelte` | 35 | `border-width: 3px` | Should use `var(--border-width-thick)` or a token |
| `MemberTable.svelte` | 203 | `width: 32px; height: 32px` | Should use `var(--space-8)` |
| `MemberTable.svelte` | 269 | `height: 48px` | Should use `var(--space-12)` |
| `BrandEditorPanel.svelte` | 146 | `height: 48px` | Should use `var(--space-12)` |
| `PublishSidebar.svelte` | 429 | `letter-spacing: 0.05em` | Should use `var(--tracking-wide)` |
| `CustomerDetailDrawer.svelte` | 408 | `letter-spacing: 0.05em` | Should use `var(--tracking-wide)` |
| `NavigationProgress.svelte` | 38 | `height: 3px` | Should use a token |
| `NavigationProgress.svelte` | 44 | `box-shadow: 0 0 8px` | Should use a shadow token |
| `RichTextEditor.svelte` | 274 | `font-size: 0.9em` | Relative sizing for inline code -- acceptable |
| `Input.svelte` | 111 | `box-shadow: 0 0 0 2px var(--color-error-50)` | The `2px` should use a token; color is tokenized |
| `TextArea.svelte` | 116 | `box-shadow: 0 0 0 2px var(--color-error-50)` | Same as Input |
| `MobileNav.svelte` | 142 | `translateY(7px)` | Transform offset for hamburger animation -- acceptable |
| `TagsInput.svelte` | 187 | `min-width: 80px` | Minor, acceptable for input minimum |

### Hardcoded `max-width` Values

Many components use inline `max-width` pixel values for content containers (e.g., `max-width: 960px`, `max-width: 480px`, `max-width: 320px`). Some use token fallbacks (e.g., `var(--container-lg, 1024px)`) which is a reasonable defensive pattern. Others use raw values.

Affected files: `ContentDetailView.svelte`, `LibraryPageView.svelte`, `StudioMediaPage.svelte`, `CheckoutSuccess.svelte`, `ErrorCard.svelte`, `OrgErrorBoundary.svelte`, `Carousel.svelte`, `SearchBar.svelte`, `LogoUpload.svelte`, `ContinueWatchingCard.svelte`.

### Color-mix and Fallback Values

`color-mix(in srgb, ...)` is used correctly for overlay/gradient effects in PreviewPlayer, ContentDetailView, TagsInput (dark mode), and ContentTypeSelector (dark mode). The `var(--token, fallback)` defensive pattern (e.g., `var(--radius-full, 9999px)`) is used consistently to prevent breakage when brand editor tokens aren't defined. This is correct.

### Hex Colors in Production Components

Hex colors in production code are limited to the brand editor components (`OklchColorPicker.svelte`, `ColorInput.svelte`, `BrandEditorColors.svelte`, `BrandEditorHome.svelte`, `BrandEditorShadows.svelte`, `studio/ColorPicker.svelte`). These are default/preset values for the color picker UI, not styling values -- this is correct and expected. Story files also use hex colors, which is acceptable.

---

## 9. Dead Code & Unused Components

### Root-Level ErrorBoundary (Low Severity)

`src/lib/components/ErrorBoundary.svelte` is an older, simpler version of the ErrorBoundary component. The production UI uses `src/lib/components/ui/Feedback/ErrorBoundary/ErrorBoundary.svelte` (exported via `$lib/components/ui` barrel).

Differences:
- Root version: No icon, no styled fallback, no `onreset`/`onerror` callbacks, uses manual `error` state
- UI version: Uses `<svelte:boundary>` `{#snippet failed}`, styled error display with `AlertCircleIcon`, `onreset` callback, proper `reset()` function

No file in the codebase imports from `$lib/components/ErrorBoundary` -- all imports use `$lib/components/ui`. The root file can be safely deleted.

### No Other Dead Code Found

- No commented-out code blocks in sampled files
- No unused component imports detected
- All stories are properly co-located with their components

---

## 10. Accessibility (Deep Dive)

### Strengths

- `SkipLink` component in root layout targeting `id="main-content"`
- `role="alert"` on error messages throughout (error pages, form errors, player errors)
- `aria-busy` on loading buttons
- `aria-label` on icon buttons and badges (101 `aria-*` attributes across 30 component files)
- `focus-visible` outlines on interactive elements (28 occurrences across 20 files)
- `sr-only` class for screen-reader-only text
- `prefers-reduced-motion` respected in 7 files (ContentDetailView, Spinner, CheckoutSuccess, Carousel, NavigationProgress, motion tokens, theme reset)
- `aria-live="polite"` on all error pages (24 instances) and ActivityFeed
- RadioGroup with `role="radiogroup"` in PublishSidebar, PurchaseOrSubscribeModal, and SwatchRow
- `role="progressbar"` with `aria-valuenow`/`aria-valuemin`/`aria-valuemax` in MediaCard, LibraryCard, ContinueWatchingCard, MediaUpload
- `aria-hidden="true"` on decorative elements (meta separators, avatars, backdrops)
- `loading="lazy"` on non-critical images (ContentCard, LibraryCard, ContinueWatchingCard, MemberTable)
- `aria-current="page"` for active nav links (MobileNav, StudioSidebar)
- Decorative images use `alt=""` correctly (MemberTable avatars, StudioSwitcher org logos)

### Component-Level Accessibility Audit (5 Components)

**1. CommandPalette -- Excellent**
- Full keyboard: ArrowUp/Down for items, Enter to select, Escape to close, Tab cycles within palette
- `role="dialog"` with `aria-label`
- `role="combobox"` with `aria-controls`, `aria-expanded`, `aria-activedescendant`
- `role="listbox"` + `role="option"` with `aria-selected`
- All strings internationalised via paraglide
- Focus automatically set to input on open

**2. SearchBar -- Keyboard Gap (Medium Severity)**
- Declares `role="combobox"`, `aria-controls="search-results"`, `aria-expanded`
- BUT: No ArrowDown/ArrowUp keyboard handler for the recent searches dropdown
- No `aria-activedescendant` to highlight the active suggestion
- Users can only select recent searches via mouse click
- Escape correctly closes the dropdown and blurs the input
- "/" global shortcut correctly excludes inputs/textareas/contentEditable
- **Recommendation:** Add ArrowUp/Down/Enter keyboard navigation and `aria-activedescendant`, following the same pattern as CommandPalette

**3. MobileNav -- Excellent**
- `aria-expanded` on hamburger toggle
- `aria-controls="mobile-nav"` links trigger to drawer
- `aria-label` with i18n for both open and close states
- `aria-current="page"` on active links
- Escape key closes drawer
- `aria-hidden="true"` on backdrop overlay
- All text from paraglide messages

**4. Carousel -- Very Good**
- `role="region"` with `aria-roledescription="carousel"` and `aria-label`
- Arrow buttons with i18n'd `aria-label`
- `hidden` attribute properly hides arrows when scroll boundary reached
- `prefers-reduced-motion` switches scroll behavior to `instant`
- Focus-in handler scrolls items into view
- Arrows hidden on touch devices (`@media (hover: none)`)
- `focus-visible` outlines on arrow buttons
- Minor: no `aria-roledescription` on individual items (not required by APG but nice to have)

**5. TagsInput -- Good, With Gaps**
- Remove buttons have `aria-label="Remove tag {tag}"` (but hardcoded English)
- Focus returns to input after tag removal
- Container has `:focus-within` outline
- Missing: `aria-label` or `aria-labelledby` on the container (the `Tags` label is a plain `<span>`, not a `<label>`)
- Missing: `role="list"` on tag container, `role="listitem"` on tag pills
- Missing: screen reader announcement when tags are added/removed (no `aria-live` region)

### Areas for Improvement

1. **SearchBar combobox** needs keyboard navigation for dropdown items (WCAG 2.1 SC 2.1.1 -- Keyboard). This is the most significant accessibility gap found.

2. **Hardcoded English aria-labels** in 5 core UI components:
   - `DialogContent.svelte` line 24: `aria-label="Close"`
   - `Toaster.svelte` line 27: `aria-label="Close"`
   - `NavigationProgress.svelte` line 25: `aria-label="Page loading"`
   - `Spinner.svelte` line 10: `Loading...` (sr-only text)
   - `Input.svelte` line 52: `Hide password` / `Show password`

3. **TagsInput** should use `<label>` for its "Tags" text, add `role="list"`, and add an `aria-live` region.

4. **MemberTable avatar** uses hardcoded `32px` width/height instead of `var(--space-8)`.

---

## 11. Route Structure

### SPA Mode (`ssr = false`)

Correctly applied to:
- `_org/[slug]/studio/+layout.ts` -- entire org studio tree
- `_creators/studio/+layout.ts` -- entire creator studio tree

This is appropriate -- studio routes are behind auth, not SEO-significant, and benefit from instant client navigation.

### Error Pages

**Coverage: Comprehensive for org and studio routes, gaps in platform and auth.**

Excellent coverage (30 `+error.svelte` files total):
- Root: `+error.svelte` (catch-all, uses `ErrorCard`)
- Org: 5 org `+error.svelte` files, all using `OrgErrorBoundary` (branded)
- Studio (org): 10 error pages covering dashboard, content, media, analytics, billing, settings, team, customers, content edit, content new
- Studio (creator): 5 error pages covering dashboard, content, media, settings, content edit
- Account: 3 error pages (account, notifications, payment) using `AccountErrorPage`
- Creators: 3 error pages (username, content listing, content detail)
- Creator checkout: 1 error page

**Gaps:**

| Route Group | Missing `+error.svelte` | Impact |
|-------------|-------------------------|--------|
| `(platform)/` (group level) | No group-level error page | `library/`, `discover/`, `pricing/`, `about/`, `become-creator/` fall through to root `+error.svelte` which lacks the platform header/footer |
| `(auth)/` | No error page anywhere | Auth pages fall through to root error page. Low impact since the auth layout is minimal. |
| `_org/[slug]/(space)/library/` | No page-specific error page | Falls through to `(space)/+error.svelte` which is correct |
| `_org/[slug]/studio/monetisation/` | No page-specific error page | Falls through to `studio/+error.svelte` which is correct |

**Recommendation:** Add `(platform)/+error.svelte` that renders the error inside the platform header/footer layout. The `(auth)` gap is acceptable since error pages would look similar to the minimal auth layout.

### Auth Security

**Open Redirect Prevention** -- Login server load correctly validates redirects (line 111):
```typescript
if (redirectTo.startsWith('/') && !redirectTo.startsWith('//')) {
  throw redirect(303, redirectTo);
}
```

**Password Field Naming** -- Auth forms use `name="password"` (not `name="_password"`). While the `_` prefix convention from CLAUDE.md isn't followed, the server actions correctly only return `email` (not password) in fail responses, so the actual vulnerability (password repopulation) is not present. The convention should still be adopted for defense-in-depth.

### Route Organization

No route conflicts found. The routing structure is clean:
- `(platform)/` -- standard platform routes with header/footer
- `(auth)/` -- minimal auth layout (centered card)
- `_org/[slug]/` -- org subdomain routes (rerouted by `hooks.ts`)
- `_creators/` -- creator subdomain routes (rerouted by `hooks.ts`)
- `api/` -- SvelteKit API routes (health, progress-beacon, media upload)
- `logout/` -- standalone POST-only logout handler

---

## 12. Form Handling

### Two Consistent Patterns

The codebase uses two form submission patterns, each in the correct context:

**1. SvelteKit `use:enhance` + Server Actions** -- for auth forms and purchase forms:
- `(auth)/login/+page.svelte`: `method="POST" use:enhance={handleSubmit}`
- `(auth)/register/+page.svelte`: Same pattern
- `(auth)/forgot-password/+page.svelte`: Same pattern
- `(auth)/reset-password/+page.svelte`: Same pattern
- Content purchase forms (org and creator content detail): `action="?/purchase" use:enhance={handlePurchase}`

These correctly use progressive enhancement -- forms work without JavaScript, `use:enhance` adds client-side interception for loading states and redirect handling.

**2. Remote Function `form()`** -- for studio content management:
- `ContentForm.svelte` uses `createContentForm`/`updateContentForm` from `$lib/remote/content.remote.ts`
- The form schema validates client-side via Zod
- Hidden inputs bridge rich UI components (Tiptap editor, MediaPicker, TagsInput) to the form
- `form.pending` tracked for loading states

**Verdict:** Pattern usage is consistent and appropriate. Auth forms need raw Set-Cookie handling (hence server actions). Studio forms need rich client-side UI (hence remote functions).

### Progressive Enhancement Status

- Auth forms: **Full progressive enhancement** -- native `method="POST"`, `use:enhance` upgrades to SPA behavior
- Purchase forms: **Full progressive enhancement** -- same pattern
- Studio content form: **Client-side only** -- requires JavaScript (acceptable since studio uses `ssr = false`)
- Studio settings, team, customer pages: **Client-side only** -- same justification

---

## 13. Loading States

### Navigation Loading

- **NavigationProgress**: Root layout renders `<NavigationProgress />` which shows a thin progress bar on all page transitions using `navigating` from `$app/state`. Includes `prefers-reduced-motion` fallback. `role="progressbar"` with `aria-label`.
- **Tab-level loading indicators**: `StudioSidebar.svelte` applies `.loading` class to the nav item being navigated to (line 86). `AccountLayout` applies `.loading` to tab links (line 36). Studio settings layout does the same.

### Streaming Skeletons

All streamed data uses `{#await}` blocks with skeleton loading states:
- Org landing: Continue watching section and creators section
- Content detail: Related content section and access/progress section
- Studio dashboard: Activity and stats

### Client-Side Operation Loading

- `Button.svelte`: `loading` prop disables the button and shows `aria-busy="true"`
- `ContentForm.svelte`: `formPending` derived from `form.pending` disables submit button
- Auth forms: Local `loading` state toggled in `handleSubmit`
- Purchase forms: `purchasing` state passed to `ContentDetailView`
- Studio pages: Individual loading states for delete, publish, grant access operations

### No Loading Gaps Found

Every async operation checked has a corresponding loading state. Button disabling prevents double-submission.

---

## 14. Image Handling

### Responsive Images

**Verdict: Well-implemented.**

- `$lib/utils/image.ts` provides `getThumbnailSrcset()` (generates 200w/400w/800w variants) and `DEFAULT_SIZES` responsive sizes attribute
- `ResponsiveImage.svelte`: Wrapper component with skeleton placeholder, auto-srcset generation, `loading="lazy"` default
- `ContentCard.svelte` uses `getThumbnailSrcset()` directly with proper `sizes` attribute
- `LibraryCard.svelte`, `ContinueWatchingCard.svelte`: Use `loading="lazy"` on thumbnails

### Alt Text

**Mostly good, some i18n gaps:**

- `ContentCard.svelte` (line 117): `alt={m.content_thumbnail_alt({ title })}` -- **Excellent**, uses i18n with content title
- `ContentDetailView.svelte` (lines 199, 217): `alt={m.content_thumbnail_alt({ title: content.title })}` -- **Excellent**
- `LibraryCard.svelte` (line 54): `alt={item.content.title}` -- **Good**, uses content title directly
- `ContinueWatchingCard.svelte` (line 38): `alt={item.content.title}` -- **Good**
- `MemberTable.svelte` (line 130): `alt=""` -- **Correct** for decorative avatar
- `StudioSwitcher.svelte` (lines 52, 79): `alt=""` -- **Correct** for decorative logo (org name in adjacent text)
- `OrgHeader.svelte` (line 30): `alt="{org.name} logo"` -- **Good** but hardcoded English "logo"
- `ThumbnailUpload.svelte` (line 49): `alt="Content thumbnail"` -- **Hardcoded English**
- `ProfileForm.svelte` (line 200): `alt="Avatar"` -- **Hardcoded English**
- `CheckoutSuccess.svelte` (line 106): `alt={content.title}` -- **Good**

### `DEFAULT_SIZES` Hardcoded Breakpoints

`$lib/utils/image.ts` line 47:
```typescript
export const DEFAULT_SIZES = '(max-width: 640px) 200px, (max-width: 1024px) 400px, 800px';
```
These pixel breakpoints are hardcoded in a CSS `sizes` attribute string, not in a `@media` query. The `sizes` attribute is evaluated by the browser's image selection algorithm and does not support CSS custom properties or custom media queries. This is an inherent limitation of the HTML `sizes` specification -- **not a bug**.

---

## 15. Performance

### Strengths

- **Lazy loading images:** `loading="lazy"` on thumbnails in ContentCard, MemberTable, LibraryCard, ContinueWatchingCard, ResponsiveImage (default)
- **Dynamic imports:** `media-chrome` imported dynamically in VideoPlayer's `onMount`
- **HLS.js import:** Dynamic via `createHlsPlayer` helper
- **Markdown/TipTap rendering:** Dynamic imports in `render.ts` (`import('marked')`, `import('@tiptap/html')`, `import('isomorphic-dompurify')`)
- **SPA mode for studio:** `ssr = false` for instant navigation
- **srcset for thumbnails:** `getThumbnailSrcset()` generates responsive image sets with 3 variants (200w, 400w, 800w)
- **Pre-constructed formatters:** `$lib/utils/format.ts` creates `Intl.NumberFormat` and `Intl.DateTimeFormat` once at module level, avoiding per-call construction. Local duplicates in other files create new formatters on each call -- another reason to consolidate.
- **View transitions:** Root layout uses `document.startViewTransition` with a 500ms safety valve to prevent Chrome's 4s timeout on slow server loads.
- **Cross-subdomain auth sync:** Root layout detects cookie changes on tab return (visibilitychange) and only re-runs auth load when the cookie state actually changes.

### MediaCard Polling

`MediaCard.svelte` has a well-designed polling system for transcoding progress:
- Polls every 5 seconds only for items with `status === 'transcoding'`
- Pauses when tab is hidden (`visibilitychange` listener)
- Stops after 3 consecutive errors
- Cleans up on destroy
- Uses visibility-aware immediate poll on tab return

---

## Recommendations (Prioritised)

### High Priority

1. **Fix SearchBar keyboard navigation** -- Add ArrowUp/Down/Enter handling for recent search suggestions, and `aria-activedescendant` tracking. Use the same pattern as `CommandPalette.svelte`. This is a WCAG 2.1 SC 2.1.1 (Keyboard) failure.

2. **Type the content form sub-components** -- Replace `form: any` in 5 sub-components with `typeof createContentForm | typeof updateContentForm`. Copy the 2-line `ContentForm` type from `ThumbnailUpload.svelte`.

3. **Remove `as any` casts in monetisation page** -- Type the remote function results properly.

4. **Consolidate formatting functions** -- Replace the 9 local copies of `formatPrice`/`formatCurrency`/`formatDate`/`formatRevenue` with imports from `$lib/utils/format`. Add `formatPriceCompact()` variant for the rounding cases.

### Medium Priority

5. **Add `(platform)/+error.svelte`** -- Create a platform-group error page that renders within the platform header/footer layout, so library/discover/pricing errors don't lose chrome.

6. **Replace hardcoded media query breakpoints** -- Convert 8 instances to custom media tokens.

7. **Internationalise hardcoded strings** -- Prioritise: Dialog/Toaster `aria-label="Close"` (2), Spinner/Input/Select (3), auth server action errors (14), PublishSidebar (8+), ContentTypeSelector descriptions (3), TagsInput labels (4), image alt texts (3). Total: ~37 strings.

8. **Extract shared `.sr-only` class to global CSS** -- Remove 7 duplicate definitions.

9. **Extract shared content form schema** -- Reduce duplication between create/update schemas in `content.remote.ts`.

10. **Fix TagsInput accessibility** -- Add `<label>` association, `role="list"` on container, `aria-live` region for add/remove announcements.

### Low Priority

11. **Delete root-level `ErrorBoundary.svelte`** -- Unused, confusing.

12. **Remove inline `getInitials` from UserMenu** -- Import from `$lib/utils/format`.

13. **Replace inline SVG in CustomerTable** -- Use the Icon system.

14. **Fix remaining hardcoded px values** -- `Spinner.svelte` `3px`, `MemberTable.svelte` `32px`/`48px`, `NavigationProgress.svelte` `3px`/`8px`, `letter-spacing: 0.05em` in 2 files.

15. **Rename password fields to `_password`** -- Follow the documented convention for defense-in-depth.

16. **Update CLAUDE.md** -- Fix the claim that `initProgressSync` should only be called in `(platform)/+layout.svelte` (it correctly lives in both platform and org layouts as sibling routes).

---

## Overall Assessment

The frontend codebase is in strong shape. The Svelte 5 migration is complete with zero legacy patterns remaining. The component library is well-structured with consistent prop typing, design token usage, and accessibility patterns. The shell+stream data loading pattern is correctly implemented with proper error guards. Server loads properly handle cache headers and auth downgrades. The TanStack DB collection architecture with version-based staleness detection is sophisticated and correctly wired.

**Accessibility** is generally very good -- 101 ARIA attributes across 30 components, comprehensive focus-visible coverage, proper reduced-motion support, and excellent keyboard navigation in CommandPalette and MobileNav. The one significant gap is SearchBar's incomplete combobox implementation.

**Form handling** uses two clear patterns (SvelteKit `use:enhance` for auth/purchase, remote `form()` for studio) applied consistently in the right contexts.

**Error page coverage** is comprehensive (30 `+error.svelte` files) with the exception of the `(platform)` group level.

The main areas for improvement are:
1. **Accessibility** -- SearchBar keyboard navigation gap, TagsInput label association
2. **Type safety** -- 5 `form: any` props and 6 `as any` casts in the studio
3. **Code duplication** -- 9 formatting function copies, `.sr-only` class, content form schemas
4. **i18n completeness** -- ~37 hardcoded English strings across auth actions, UI components, and aria-labels
5. **CSS token adoption** -- 8 hardcoded media query breakpoints and ~12 hardcoded pixel values

None of these are structural issues. The architecture (subdomain routing, TanStack DB collections, version-based cache invalidation, SPA studio mode, shell+stream loading) is well-documented in CLAUDE.md and correctly implemented.

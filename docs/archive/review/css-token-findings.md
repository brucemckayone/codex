# CSS Token Compliance Findings

> Systematic audit of all recently-changed frontend files for design token violations.
> Each file is reviewed against the full token vocabulary and branding cascade.

## Token System Reference

**Import chain**: `global.css` -> tokens/*.css (primitives) -> themes/light.css (semantic) -> org-brand.css (brand overrides) -> base.css -> utilities.css

**What components MUST use**:
- Semantic tokens: `--color-text-primary`, `--color-surface`, `--color-interactive`, `--color-brand-primary`
- Component tokens: `--radius-card`, `--radius-button`, `--shadow-md`
- Spacing scale: `--space-1` through `--space-24`
- Typography: `--text-sm`, `--font-medium`, `--leading-normal`

**Violations to flag**:
1. Hardcoded hex/rgb/rgba values in component `<style>` blocks
2. Primitive neutral tokens (`--color-neutral-*`) where semantic tokens exist (won't respond to org bg branding)
3. Hardcoded px/rem for spacing (should use `--space-*`)
4. Hardcoded font sizes (should use `--text-*`)
5. Hardcoded border-radius (should use `--radius-*`)
6. Hardcoded shadows (should use `--shadow-*`)
7. Hardcoded z-index (should use `--z-*`)
8. Hardcoded transitions/durations (should use `--transition-*` / `--duration-*`)

**Legitimate exceptions**:
- Token definition files themselves (tokens/*.css, themes/*.css, org-brand.css)
- OKLCH formula values inside org-brand.css
- `0` values (no token needed)
- `100%`, `auto`, `none`, `inherit` keywords
- Media query breakpoint values (CSS vars can't be used in @media)
- SVG-specific values
- `1px` for borders (has `--border-width` but `1px solid` in shorthand is common)

## Severity Scale
- **P0 Critical**: Hardcoded color that breaks org branding (visible to end users)
- **P1 Major**: Hardcoded spacing/radius/shadow that ignores density scaling
- **P2 Minor**: Primitive token where semantic exists (works but brittle)
- **P3 Nit**: Style preference (e.g., could use utility class instead)

---

## Files Reviewed

| # | File | Status | Issues |
|---|------|--------|--------|
| 1 | Alert.svelte | Clean | 0 |
| 2 | BackToTop.svelte | Clean | 0 |
| 3 | Badge.svelte | Clean | 0 |
| 4 | Breadcrumb.svelte | Clean | 0 |
| 5 | Button.svelte | Issues | 5 |
| 6 | CheckoutSuccess.svelte | Issues | 2 |
| 7 | ContentCard.svelte | Clean | 0 |
| 8 | SkeletonContentCard.svelte | Clean | 0 |
| 9 | SkeletonCreatorCard.svelte | Clean | 0 |
| 10 | DataTable.svelte | Clean | 0 |
| 11 | DropdownMenuContent.svelte | Clean | 0 |
| 12 | DropdownMenuItem.svelte | Clean | 0 |
| 13 | EmptyState.svelte | Clean | 0 |
| 14 | Spinner.svelte | Issues | 1 |
| 15 | FilterBar.svelte | Clean | 0 |
| 16 | FormField.svelte | Clean | 0 |
| 17 | PageHeader.svelte | Clean | 0 |
| 18 | PopoverContent.svelte | Clean | 0 |
| 19 | PriceBadge.svelte | Clean | 0 |
| 20 | ProgressBar.svelte | Clean | 0 |
| 21 | ResponsiveImage.svelte | Clean | 0 |
| 22 | Select.svelte | Clean | 0 |
| 23 | Skeleton.svelte | Issues | 2 |
| 24 | Switch.svelte | Clean | 0 |
| 25 | TableFooter.svelte | Clean | 0 |
| 26 | TooltipContent.svelte | Clean | 0 |
| 27 | ViewToggle.svelte | Clean | 0 |
| 28 | ContinueWatching.svelte | Issues | 1 |
| 29 | ContinueWatchingCard.svelte | Issues | 3 |
| 30 | LibraryCard.svelte | Clean | 0 |
| 31 | LibraryFilters.svelte | Issues | 1 |
| 32 | MobileNav.svelte | Issues | 1 |
| 33 | OrgHeader.svelte | Clean | 0 |
| 34 | NavBadge.svelte | Clean | 0 |
| 35 | StudioSidebar.svelte | Issues | 1 |
| 36 | StudioSwitcher.svelte | Clean | 0 |
| 37 | Carousel.svelte | Issues | 2 |
| 38 | SearchBar.svelte | Clean | 0 |
| 39 | CommandPalette.svelte | Clean | 0 |
| 40 | ContentDetailView.svelte | Issues | 6 |
| 41 | PreviewPlayer.svelte | Issues | 9 |
| 42 | OrgErrorBoundary.svelte | Clean | 0 |

**Summary**: 42 files reviewed, 28 clean, 14 with issues, 34 total violations found.

**Breakdown by severity**:
- P0 (Branding-breaking hardcoded color): 6
- P1 (Hardcoded spacing/size ignoring density): 14
- P2 (Primitive token where semantic exists): 7
- P3 (Nit / style preference): 7

---

## Findings

### Alert.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/Alert/Alert.svelte`
**Lines reviewed**: 54
**Style block**: Yes (30 lines)

No violations. All colors use semantic tokens (`--color-error-*`, `--color-success-*`, etc.), spacing uses `--space-*`, radius uses `--radius-md`, borders use `--border-width`/`--border-style`.

---

### BackToTop.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/BackToTop/BackToTop.svelte`
**Lines reviewed**: 99
**Style block**: Yes (55 lines)

No violations. Uses `--space-*`, `--radius-full`, `--color-surface`, `--color-border`, `--shadow-md`, `--transition-*`, `--duration-*`, `--z-sticky`. Keyframe values are legitimate exceptions. The `2px` outline-offset is acceptable as a focus ring adjustment.

---

### Badge.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/Badge/Badge.svelte`
**Lines reviewed**: 70
**Style block**: Yes (53 lines)

No violations. Excellent token usage across all variants.

---

### Breadcrumb.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/Breadcrumb/Breadcrumb.svelte`
**Lines reviewed**: 89
**Style block**: Yes (48 lines)

No violations. Clean token usage throughout.

---

### Button.svelte -- 5 issues

**File**: `apps/web/src/lib/components/ui/Button/Button.svelte`
**Lines reviewed**: 188
**Style block**: Yes (136 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 80 | P1 | Hardcoded height for xs button | `height: 1.75rem` | `height: var(--space-7)` |
| 86 | P1 | Hardcoded height for sm button | `height: 2rem` | `height: var(--space-8)` |
| 92 | P1 | Hardcoded height for md button | `height: 2.5rem` | `height: var(--space-10)` |
| 98 | P1 | Hardcoded height for lg button | `height: 2.75rem` | `height: var(--space-11)` |
| 103 | P1 | Hardcoded height for xl button | `height: 3rem` | `height: var(--space-12)` |

Note: The `1em` width/height on the spinner (line 173) is acceptable as it scales with font-size context. The `0.6s` animation duration (line 178) should ideally use `--duration-normal` but is a borderline nit inside `@keyframes`-adjacent context.

---

### CheckoutSuccess.svelte -- 2 issues

**File**: `apps/web/src/lib/components/ui/CheckoutSuccess/CheckoutSuccess.svelte`
**Lines reviewed**: 436
**Style block**: Yes (232 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 277 | P1 | Hardcoded spinner size | `width: 48px; height: 48px` | `width: var(--space-12); height: var(--space-12)` |
| 301 | P1 | Hardcoded max-width on description | `max-width: 360px` | Acceptable as a layout constraint but would be more consistent as a token-relative value |

The `480px` max-width on `.checkout-success__card` (line 216), `280px` on `.checkout-success__preview-card` (line 308), and `360px` on description (line 301) are layout constraints that are generally acceptable, but the `48px`/`48px` spinner dimensions should use spacing tokens.

---

### ContentCard.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/ContentCard/ContentCard.svelte`
**Lines reviewed**: 502
**Style block**: Yes (280 lines)

No violations. Excellent comprehensive token usage. The `180px` and `120px` widths in library/compact variants are layout constraints (acceptable). The `1px` in sr-only is acceptable.

---

### SkeletonContentCard.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/ContentCard/SkeletonContentCard.svelte`
**Lines reviewed**: 48
**Style block**: Yes (21 lines)

No violations.

---

### SkeletonCreatorCard.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/CreatorCard/SkeletonCreatorCard.svelte`
**Lines reviewed**: 42
**Style block**: Yes (18 lines)

No violations.

---

### DataTable.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/DataTable/DataTable.svelte`
**Lines reviewed**: 274
**Style block**: Yes (103 lines)

No violations. Clean token usage throughout.

---

### DropdownMenuContent.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/DropdownMenu/DropdownMenuContent.svelte`
**Lines reviewed**: 46
**Style block**: Yes (14 lines)

No violations.

---

### DropdownMenuItem.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/DropdownMenu/DropdownMenuItem.svelte`
**Lines reviewed**: 54
**Style block**: Yes (25 lines)

No violations.

---

### EmptyState.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/EmptyState/EmptyState.svelte`
**Lines reviewed**: 66
**Style block**: Yes (32 lines)

No violations. The `300px` max-width on `.empty-state__description` is a layout constraint (acceptable).

---

### Spinner.svelte -- 1 issue

**File**: `apps/web/src/lib/components/ui/Feedback/Spinner/Spinner.svelte`
**Lines reviewed**: 71
**Style block**: Yes (58 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 36 | P1 | Hardcoded border-width for large spinner | `border-width: 3px` | `border-width: var(--border-width-thick)` or define `--border-width-spinner-lg` |

The sr-only `1px` values are acceptable.

---

### FilterBar.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/FilterBar/FilterBar.svelte`
**Lines reviewed**: 355
**Style block**: Yes (163 lines)

No violations. Thorough token usage across pills, search, and chips.

---

### FormField.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/FormField/FormField.svelte`
**Lines reviewed**: 44
**Style block**: Yes (17 lines)

No violations.

---

### PageHeader.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/PageHeader/PageHeader.svelte`
**Lines reviewed**: 66
**Style block**: Yes (39 lines)

No violations.

---

### PopoverContent.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/Popover/PopoverContent.svelte`
**Lines reviewed**: 44
**Style block**: Yes (12 lines)

No violations.

---

### PriceBadge.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/PriceBadge/PriceBadge.svelte`
**Lines reviewed**: 87
**Style block**: Yes (31 lines)

No violations.

---

### ProgressBar.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/ProgressBar/ProgressBar.svelte`
**Lines reviewed**: 70
**Style block**: Yes (34 lines)

No violations.

---

### ResponsiveImage.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/ResponsiveImage/ResponsiveImage.svelte`
**Lines reviewed**: 116
**Style block**: Yes (43 lines)

No violations. The shimmer keyframe values are acceptable.

---

### Select.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/Select/Select.svelte`
**Lines reviewed**: 207
**Style block**: Yes (99 lines)

No violations. Excellent token usage. The sr-only block is standard.

---

### Skeleton.svelte -- 2 issues

**File**: `apps/web/src/lib/components/ui/Skeleton/Skeleton.svelte`
**Lines reviewed**: 69
**Style block**: Yes (38 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 38 | P3 | Fallback value hardcodes px | `var(--radius-sm, 4px)` | `var(--radius-sm)` (token is always defined, fallback unnecessary) |
| 42 | P3 | Fallback value hardcodes px | `var(--radius-full, 9999px)` | `var(--radius-full)` (token is always defined, fallback unnecessary) |

Note: The `color-mix(in srgb, white 60%, transparent)` shimmer gradient (line 52) is acceptable since it is a cosmetic animation effect, not a themed color.

---

### Switch.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/Switch/Switch.svelte`
**Lines reviewed**: 107
**Style block**: Yes (46 lines)

No violations.

---

### TableFooter.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/Table/TableFooter.svelte`
**Lines reviewed**: 27
**Style block**: Yes (11 lines)

No violations.

---

### TooltipContent.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/Tooltip/TooltipContent.svelte`
**Lines reviewed**: 45
**Style block**: Yes (13 lines)

No violations.

---

### ViewToggle.svelte -- Clean

**File**: `apps/web/src/lib/components/ui/ViewToggle/ViewToggle.svelte`
**Lines reviewed**: 83
**Style block**: Yes (38 lines)

No violations.

---

### ContinueWatching.svelte -- 1 issue

**File**: `apps/web/src/lib/components/library/ContinueWatching.svelte`
**Lines reviewed**: 127
**Style block**: Yes (75 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 78 | P1 | Hardcoded scrollbar height | `height: 4px` | `height: var(--space-1)` |

The `var(--radius-full, 9999px)` fallback on line 87 is the same nit as Skeleton but harmless.

---

### ContinueWatchingCard.svelte -- 3 issues

**File**: `apps/web/src/lib/components/library/ContinueWatchingCard.svelte`
**Lines reviewed**: 192
**Style block**: Yes (122 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 74 | P1 | Hardcoded min-width | `min-width: 220px` | Consider `min-width: var(--space-56)` or a component-level custom property |
| 75 | P1 | Hardcoded max-width | `max-width: 300px` | Consider `max-width: var(--space-72)` or a component-level custom property |
| 87 | P1 | Hardcoded transform value | `transform: translateY(-2px)` | `transform: translateY(calc(-1 * var(--space-0-5)))` |

The `color-mix(in srgb, white 30%, transparent)` on the progress track (line 125) is acceptable as a semi-transparent overlay effect on a video thumbnail.

---

### LibraryCard.svelte -- Clean

**File**: `apps/web/src/lib/components/library/LibraryCard.svelte`
**Lines reviewed**: 239
**Style block**: Yes (116 lines)

No violations. Excellent token usage throughout including progress states.

---

### LibraryFilters.svelte -- 1 issue

**File**: `apps/web/src/lib/components/library/LibraryFilters.svelte`
**Lines reviewed**: 235
**Style block**: Yes (88 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 232 | P1 | Hardcoded box-shadow in focus state | `box-shadow: 0 0 0 1px var(--color-interactive)` | `box-shadow: var(--shadow-focus-ring)` (or define a `--shadow-focus-input` token) |

The `var(--radius-full, 9999px)` fallback on line 179 is the same Skeleton nit.

---

### MobileNav.svelte -- 1 issue

**File**: `apps/web/src/lib/components/layout/Header/MobileNav.svelte`
**Lines reviewed**: 272
**Style block**: Yes (165 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 142-150 | P1 | Hardcoded hamburger translateY | `transform: translateY(7px)` / `translateY(-7px)` | `transform: translateY(var(--space-2))` / `translateY(calc(-1 * var(--space-2)))` |

Note: The `7px` value is used to animate hamburger lines into an X shape. It works visually but does not participate in density scaling. Should use a spacing token or a computed value from `--space-2` (8px) if close enough.

---

### OrgHeader.svelte -- Clean

**File**: `apps/web/src/lib/components/layout/Header/OrgHeader.svelte`
**Lines reviewed**: 151
**Style block**: Yes (96 lines)

No violations. Excellent comprehensive token usage.

---

### NavBadge.svelte -- Clean

**File**: `apps/web/src/lib/components/layout/StudioSidebar/NavBadge.svelte`
**Lines reviewed**: 32
**Style block**: Yes (17 lines)

No violations.

---

### StudioSidebar.svelte -- 1 issue

**File**: `apps/web/src/lib/components/layout/StudioSidebar/StudioSidebar.svelte`
**Lines reviewed**: 394
**Style block**: Yes (191 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 271 | P1 | Hardcoded section divider height | `height: 1px` | `height: var(--border-width)` |

Note: This is a visual separator rendered as a div, not a CSS border. Using `--border-width` would ensure it tracks with the border system.

---

### StudioSwitcher.svelte -- Clean

**File**: `apps/web/src/lib/components/layout/StudioSidebar/StudioSwitcher.svelte`
**Lines reviewed**: 192
**Style block**: Yes (95 lines)

No violations. The `var(--space-1-5, var(--space-1))` fallback pattern on line 101 is fine -- it gracefully degrades.

---

### Carousel.svelte -- 2 issues

**File**: `apps/web/src/lib/components/carousel/Carousel.svelte`
**Lines reviewed**: 269
**Style block**: Yes (122 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 201 | P1 | Hardcoded scrollbar height | `height: 4px` | `height: var(--space-1)` |
| 237 | P3 | Hardcoded blur value in backdrop-filter | `backdrop-filter: blur(4px)` | `backdrop-filter: var(--blur-sm)` |

The `color-mix` expressions on lines 233 and 234 are for glass-effect arrow backgrounds and are acceptable as visual effects.

---

### SearchBar.svelte -- Clean

**File**: `apps/web/src/lib/components/search/SearchBar.svelte`
**Lines reviewed**: 307
**Style block**: Yes (146 lines)

No violations. The `320px` max-width on `.search-bar` (line 165) and the `var(--z-dropdown, 50)` fallback (line 254) are acceptable.

---

### CommandPalette.svelte -- Clean

**File**: `apps/web/src/lib/components/command-palette/CommandPalette.svelte`
**Lines reviewed**: 353
**Style block**: Yes (132 lines)

No violations. Thorough token usage throughout.

---

### ContentDetailView.svelte -- 6 issues

**File**: `apps/web/src/lib/components/content/ContentDetailView.svelte`
**Lines reviewed**: 714
**Style block**: Yes (351 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 375 | P0 | Primitive neutral token for player background | `background: var(--color-neutral-900)` | `background: var(--color-surface-inverse)` or a semantic video-bg token |
| 495 | P1 | Hardcoded letter-spacing | `letter-spacing: 0.05em` | `letter-spacing: var(--tracking-wide)` |
| 527-528 | P0 | Hardcoded hex fallback on completed badge | `background: var(--color-success-100, #dcfce7); color: var(--color-success-700, #15803d)` | `background: var(--color-success-100); color: var(--color-success-700)` (remove hardcoded fallbacks) |
| 566 | P0 | Hardcoded hex fallback on error text | `color: var(--color-error-600, #dc2626)` | `color: var(--color-error-600)` (remove hardcoded fallback) |
| 569 | P0 | Hardcoded hex fallback on error background | `background: var(--color-error-50, #fef2f2)` | `background: var(--color-error-50)` (remove hardcoded fallback) |
| 960 | P3 | max-width: 960px on container | `max-width: 960px` | Acceptable as a page-level layout constraint, but could use `--layout-max-width-content` if defined |

Note: The `color-mix` values in the preview overlay gradient (lines 399-404) are acceptable -- they create a cinematic darkening effect over thumbnails/video and don't participate in theming.

---

### PreviewPlayer.svelte -- 9 issues

**File**: `apps/web/src/lib/components/player/PreviewPlayer.svelte`
**Lines reviewed**: 451
**Style block**: Yes (222 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 236 | P2 | Primitive neutral token for player background | `background-color: var(--color-neutral-900)` | `background-color: var(--color-surface-inverse)` or semantic video-bg token |
| 247 | P2 | Primitive neutral token for loading background | `background-color: var(--color-neutral-900)` | Same as above |
| 253 | P1 | Hardcoded spinner dimensions | `width: 2.5rem; height: 2.5rem` | `width: var(--space-10); height: var(--space-10)` |
| 254 | P1 | Hardcoded border-width on spinner | `border: 3px solid ...` | `border: var(--border-width-thick) solid ...` |
| 274 | P2 | Primitive neutral token for error background | `background-color: var(--color-neutral-900)` | Semantic token |
| 275 | P2 | Primitive neutral token for error text | `color: var(--color-neutral-300)` | `color: var(--color-text-muted)` or `var(--color-text-inverse)` |
| 317-318 | P1 | Hardcoded control button dimensions | `width: 2rem; height: 2rem` | `width: var(--space-8); height: var(--space-8)` |
| 346 | P1 | Hardcoded letter-spacing on badge | `letter-spacing: 0.05em` | `letter-spacing: var(--tracking-wide)` |
| 364-365 | P1 | Hardcoded transition durations | `opacity 300ms ease, background 300ms ease` | `opacity var(--duration-normal) var(--ease-default), background var(--duration-normal) var(--ease-default)` |

Additionally, line 395 uses `color-mix(in srgb, white 80%, transparent)` for CTA description text on a dark overlay -- this is a borderline case. On a video player overlay where the background is always dark, using a fixed light color is defensible, but it won't adapt to theming. Flagged as awareness only.

Note: The `400px` control width on `.cw-card--large` (line 164 in ContinueWatchingCard) and `320px` max-width on `.search-bar` are layout constraints, not violations.

---

### OrgErrorBoundary.svelte -- Clean

**File**: `apps/web/src/lib/components/org/OrgErrorBoundary.svelte`
**Lines reviewed**: 206
**Style block**: Yes (106 lines)

No violations. Thorough token usage throughout.

---

## Priority Fix List

### P0 -- Must Fix (breaks org branding / hardcoded colors)

1. **ContentDetailView.svelte:375** -- `--color-neutral-900` for player background. Components inside `[data-org-brand]` using primitive neutral tokens won't respond to org background branding.
2. **ContentDetailView.svelte:527-528** -- Hardcoded hex fallbacks `#dcfce7` / `#15803d` on completed badge. If tokens are overridden by a theme, the fallbacks will show wrong colors.
3. **ContentDetailView.svelte:566** -- Hardcoded hex fallback `#dc2626` on purchase error.
4. **ContentDetailView.svelte:569** -- Hardcoded hex fallback `#fef2f2` on purchase error background.
5. **PreviewPlayer.svelte:236,247** -- `--color-neutral-900` used 2x for player backgrounds.
6. **PreviewPlayer.svelte:274-275** -- `--color-neutral-900` and `--color-neutral-300` for error state.

### P1 -- Should Fix (ignores density scaling)

1. **Button.svelte:80-103** -- 5 hardcoded rem heights for button sizes.
2. **CheckoutSuccess.svelte:277** -- `48px` spinner dimensions.
3. **Spinner.svelte:36** -- `3px` border-width on large spinner.
4. **ContinueWatching.svelte:78** -- `4px` scrollbar height.
5. **ContinueWatchingCard.svelte:74-75** -- Hardcoded `220px`/`300px` min/max widths.
6. **ContinueWatchingCard.svelte:87** -- `translateY(-2px)` hover effect.
7. **LibraryFilters.svelte:232** -- Hardcoded `0 0 0 1px` box-shadow.
8. **MobileNav.svelte:142-150** -- `translateY(7px)` hamburger animation.
9. **StudioSidebar.svelte:271** -- `1px` div-based divider height.
10. **Carousel.svelte:201** -- `4px` scrollbar height.
11. **ContentDetailView.svelte:495** -- `0.05em` letter-spacing.
12. **PreviewPlayer.svelte:253-254** -- `2.5rem`/`3px` spinner dimensions.
13. **PreviewPlayer.svelte:317-318** -- `2rem` control button dimensions.
14. **PreviewPlayer.svelte:346** -- `0.05em` letter-spacing.

### P2 -- Minor (primitive token where semantic exists)

1. **PreviewPlayer.svelte:236** -- `--color-neutral-900` (also P0 on dark backgrounds)
2. **PreviewPlayer.svelte:247** -- `--color-neutral-900`
3. **PreviewPlayer.svelte:274** -- `--color-neutral-900`
4. **PreviewPlayer.svelte:275** -- `--color-neutral-300`
5. **ContentDetailView.svelte:375** -- `--color-neutral-900` (also P0)

### P3 -- Nits

1. **Skeleton.svelte:38** -- Unnecessary `4px` fallback on `--radius-sm`.
2. **Skeleton.svelte:42** -- Unnecessary `9999px` fallback on `--radius-full`.
3. **Carousel.svelte:237** -- Hardcoded `blur(4px)` instead of `--blur-sm`.
4. **ContentDetailView.svelte:364** -- `960px` max-width (layout constraint, but no token).
5. **ContinueWatching.svelte:87** -- `9999px` fallback on `--radius-full`.
6. **LibraryFilters.svelte:179** -- `9999px` fallback on `--radius-full`.
7. **PreviewPlayer.svelte:364-365** -- Hardcoded `300ms` instead of `--duration-normal`.

---

## Wave 2 Findings

Wave 2 covers 75 files: 17 brand editor components, 17 studio components, and 41 route pages.

### Files Reviewed (Wave 2)

| # | File | Status | Issues |
|---|------|--------|--------|
| 43 | BrandEditorFooter.svelte | Issues | 1 |
| 44 | BrandEditorHeader.svelte | Issues | 2 |
| 45 | BrandEditorPanel.svelte | Issues | 4 |
| 46 | ColorInput.svelte | Issues | 1 |
| 47 | HueSlider.svelte | Issues | 4 |
| 48 | OklchColorArea.svelte | Issues | 2 |
| 49 | OklchColorPicker.svelte | Clean | 0 |
| 50 | SwatchRow.svelte | Issues | 2 |
| 51 | BrandEditorColors.svelte | Clean | 0 |
| 52 | BrandEditorFineTuneColors.svelte | Clean | 0 |
| 53 | BrandEditorFineTuneTypography.svelte | Issues | 1 |
| 54 | BrandEditorHome.svelte | Issues | 1 |
| 55 | BrandEditorLogo.svelte | Issues | 2 |
| 56 | BrandEditorPresets.svelte | Clean | 0 |
| 57 | BrandEditorShadows.svelte | Issues | 1 |
| 58 | BrandEditorShape.svelte | Issues | 1 |
| 59 | BrandEditorTypography.svelte | Clean | 0 |
| 60 | ActivityFeed.svelte | Issues | 3 |
| 61 | PublishSidebar.svelte | Issues | 3 |
| 62 | ThumbnailUpload.svelte | Clean | 0 |
| 63 | ContentForm.svelte | Clean | 0 |
| 64 | ContentTable.svelte | Issues | 1 |
| 65 | CustomerDetailDrawer.svelte | Issues | 2 |
| 66 | CustomerTable.svelte | Clean | 0 |
| 67 | EditMediaDialog.svelte | Clean | 0 |
| 68 | GrantAccessDialog.svelte | Clean | 0 |
| 69 | InviteMemberDialog.svelte | Clean | 0 |
| 70 | LogoUpload.svelte | Issues | 2 |
| 71 | MediaCard.svelte | Clean | 0 |
| 72 | MediaGrid.svelte | Clean | 0 |
| 73 | MediaPicker.svelte | Issues | 2 |
| 74 | MediaUpload.svelte | Clean | 0 |
| 75 | MemberTable.svelte | Issues | 3 |
| 76 | TopContentTable.svelte | Issues | 2 |
| 77 | _creators/[username]/+page.svelte | Clean | 0 |
| 78 | _creators/[username]/+error.svelte | Clean | 0 |
| 79 | _creators/[username]/content/+page.svelte | Issues | 14 |
| 80 | _creators/[username]/content/+error.svelte | Clean | 0 |
| 81 | _creators/[username]/content/[contentSlug]/+page.svelte | No style | 0 |
| 82 | _creators/checkout/success/+page.svelte | No style | 0 |
| 83 | _creators/studio/content/+page.svelte | Clean | 0 |
| 84 | _creators/studio/media/+page.svelte | Issues | 1 |
| 85 | _creators/studio/settings/+page.svelte | Clean | 0 |
| 86 | _org/[slug]/(space)/+page.svelte | Issues | 1 |
| 87 | _org/[slug]/(space)/checkout/success/+page.svelte | No style | 0 |
| 88 | _org/[slug]/(space)/content/[contentSlug]/+page.svelte | No style | 0 |
| 89 | _org/[slug]/(space)/creators/+page.svelte | Issues | 7 |
| 90 | _org/[slug]/(space)/explore/+page.svelte | Clean | 0 |
| 91 | _org/[slug]/(space)/library/+page.svelte | No style | 0 |
| 92 | _org/[slug]/+layout.svelte | No style | 0 |
| 93 | _org/[slug]/studio/+layout.svelte | No style | 0 |
| 94 | _org/[slug]/studio/+page.svelte | Clean | 0 |
| 95 | _org/[slug]/studio/content/+page.svelte | No style | 0 |
| 96 | _org/[slug]/studio/content/[contentId]/edit/+page.svelte | No style | 0 |
| 97 | _org/[slug]/studio/content/new/+page.svelte | No style | 0 |
| 98 | _org/[slug]/studio/customers/+page.svelte | No style | 0 |
| 99 | _org/[slug]/studio/analytics/+page.svelte | Issues | 1 |
| 100 | _org/[slug]/studio/billing/+page.svelte | No style | 0 |
| 101 | _org/[slug]/studio/media/+page.svelte | No style | 0 |
| 102 | _org/[slug]/studio/team/+page.svelte | No style | 0 |
| 103 | _org/[slug]/studio/settings/+page.svelte | No style | 0 |
| 104 | _org/[slug]/studio/settings/branding/+page.svelte | Issues | 1 |
| 105 | (platform)/+page.svelte | No style | 0 |
| 106 | (platform)/library/+page.svelte | No style | 0 |
| 107 | (platform)/discover/+page.svelte | No style | 0 |
| 108 | (platform)/account/+layout.svelte | No style | 0 |
| 109 | (platform)/account/+page.svelte | Clean | 0 |
| 110 | (platform)/account/notifications/+page.svelte | No style | 0 |
| 111 | (platform)/account/payment/+page.svelte | No style | 0 |
| 112 | (platform)/become-creator/+page.svelte | Clean | 0 |
| 113 | (platform)/pricing/+page.svelte | Clean | 0 |
| 114 | +layout.svelte (root) | No style | 0 |
| 115 | +error.svelte (root) | No style | 0 |
| 116 | (auth)/+layout.svelte | No style | 0 |
| 117 | _org/[slug]/studio/settings/+layout.svelte | Issues | 1 |

**Wave 2 Summary**: 75 files reviewed, 22 no style block, 31 clean, 22 with issues, 60 total violations found.

**Wave 2 Breakdown by severity**:
- P0 (Branding-breaking hardcoded color): 0
- P1 (Hardcoded spacing/size ignoring density): 34
- P2 (Primitive token where semantic exists): 1
- P3 (Nit / style preference): 25

---

### BrandEditorFooter.svelte -- 1 issue

**File**: `apps/web/src/lib/components/brand-editor/BrandEditorFooter.svelte`
**Lines reviewed**: 65
**Style block**: Yes (24 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 55-56 | P1 | Hardcoded dot indicator dimensions | `width: 6px; height: 6px` | `width: var(--space-1-5); height: var(--space-1-5)` |

---

### BrandEditorHeader.svelte -- 2 issues

**File**: `apps/web/src/lib/components/brand-editor/BrandEditorHeader.svelte`
**Lines reviewed**: 157
**Style block**: Yes (104 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 72-73 | P1 | Hardcoded back button dimensions | `width: 24px; height: 24px` | `width: var(--space-6); height: var(--space-6)` |
| 109-110 | P1 | Hardcoded action button dimensions | `width: 28px; height: 28px` | `width: var(--space-7); height: var(--space-7)` |

---

### BrandEditorPanel.svelte -- 4 issues

**File**: `apps/web/src/lib/components/brand-editor/BrandEditorPanel.svelte`
**Lines reviewed**: 196
**Style block**: Yes (112 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 101 | P1 | Hardcoded border on glass panel | `border: 1px solid var(--material-glass-border)` | `border: var(--border-width) solid var(--material-glass-border)` |
| 111 | P1 | Hardcoded header border | `border-bottom: 1px solid var(--color-border-subtle)` | `border-bottom: var(--border-width) var(--border-style) var(--color-border-subtle)` |
| 129 | P1 | Hardcoded footer border | `border-top: 1px solid var(--color-border-subtle)` | `border-top: var(--border-width) var(--border-style) var(--color-border-subtle)` |
| 142 | P1 | Hardcoded minimized bar height | `height: 48px` | `height: var(--space-12)` |

Note: The `360px` panel width (line 91) and `1px solid` on the minimized bar (line 148) border are also hardcoded but acceptable as fixed UI chrome. The `85vh` / `70vh` max-heights are viewport-relative (acceptable).

---

### ColorInput.svelte -- 1 issue

**File**: `apps/web/src/lib/components/brand-editor/color-picker/ColorInput.svelte`
**Lines reviewed**: 131
**Style block**: Yes (43 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 113-114 | P1 | Hardcoded swatch dimensions | `width: 20px; height: 20px` | `width: var(--space-5); height: var(--space-5)` |

---

### HueSlider.svelte -- 4 issues

**File**: `apps/web/src/lib/components/brand-editor/color-picker/HueSlider.svelte`
**Lines reviewed**: 103
**Style block**: Yes (68 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 45 | P1 | Hardcoded slider track height | `height: 12px` | `height: var(--space-3)` |
| 65-66 | P1 | Hardcoded thumb dimensions | `width: 16px; height: 16px` | `width: var(--space-4); height: var(--space-4)` |
| 68 | P1 | Hardcoded thumb border width | `border: 2px solid white` | `border: var(--border-width-thick) solid white` |
| 80-81 | P1 | Hardcoded Firefox thumb dimensions | `width: 16px; height: 16px` | Same as above |

Note: The OKLCH gradient colors on the track (lines 49-58) are legitimate -- this is a hue spectrum visualization, not a themed surface. The `white` border on the thumb is also acceptable as it must always be white against the spectrum.

---

### OklchColorArea.svelte -- 2 issues

**File**: `apps/web/src/lib/components/brand-editor/color-picker/OklchColorArea.svelte`
**Lines reviewed**: 164
**Style block**: Yes (22 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 156-157 | P1 | Hardcoded thumb dimensions | `width: 12px; height: 12px` | `width: var(--space-3); height: var(--space-3)` |
| 159 | P1 | Hardcoded thumb border | `border: 2px solid white` | `border: var(--border-width-thick) solid white` |

Note: The `box-shadow` with `color-mix(in srgb, black 30%, transparent)` on the thumb (line 160) is acceptable as an overlay contrast ring. The canvas pixel-level rendering (JavaScript `rgba` values) is all legitimate color-picker rendering, not themed content.

---

### OklchColorPicker.svelte -- Clean

**File**: `apps/web/src/lib/components/brand-editor/color-picker/OklchColorPicker.svelte`
**Lines reviewed**: 132
**Style block**: Yes (18 lines)

No violations. Clean token usage.

---

### SwatchRow.svelte -- 2 issues

**File**: `apps/web/src/lib/components/brand-editor/color-picker/SwatchRow.svelte`
**Lines reviewed**: 61
**Style block**: Yes (30 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 37-38 | P1 | Hardcoded swatch dimensions | `width: 24px; height: 24px` | `width: var(--space-6); height: var(--space-6)` |
| 53 | P1 | Hardcoded active ring box-shadow | `box-shadow: 0 0 0 2px var(--color-interactive)` | `box-shadow: 0 0 0 var(--border-width-thick) var(--color-interactive)` |

---

### BrandEditorColors.svelte -- Clean

**File**: `apps/web/src/lib/components/brand-editor/levels/BrandEditorColors.svelte`
**Lines reviewed**: 173
**Style block**: Yes (99 lines)

No violations. Excellent token usage throughout.

---

### BrandEditorFineTuneColors.svelte -- Clean

**File**: `apps/web/src/lib/components/brand-editor/levels/BrandEditorFineTuneColors.svelte`
**Lines reviewed**: 201
**Style block**: Yes (74 lines)

No violations. Clean token usage.

---

### BrandEditorFineTuneTypography.svelte -- 1 issue

**File**: `apps/web/src/lib/components/brand-editor/levels/BrandEditorFineTuneTypography.svelte`
**Lines reviewed**: 181
**Style block**: Yes (72 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 147 | P1 | Hardcoded hint label width | `width: 48px` | `width: var(--space-12)` |

---

### BrandEditorHome.svelte -- 1 issue

**File**: `apps/web/src/lib/components/brand-editor/levels/BrandEditorHome.svelte`
**Lines reviewed**: 373
**Style block**: Yes (252 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 317 | P1 | Hardcoded icon column width | `width: 28px` | `width: var(--space-7)` |

Note: The `40px` height on `.home__palette-bars` (line 259) is a fixed preview bar height -- acceptable as a layout constraint.

---

### BrandEditorLogo.svelte -- 2 issues

**File**: `apps/web/src/lib/components/brand-editor/levels/BrandEditorLogo.svelte`
**Lines reviewed**: 123
**Style block**: Yes (46 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 88 | P1 | Hardcoded preview min-height | `min-height: 120px` | `min-height: var(--space-32)` or define a component-level custom property |
| 96 | P1 | Hardcoded logo max-height | `max-height: 80px` | `max-height: var(--space-20)` |

---

### BrandEditorPresets.svelte -- Clean

**File**: `apps/web/src/lib/components/brand-editor/levels/BrandEditorPresets.svelte`
**Lines reviewed**: 118
**Style block**: Yes (73 lines)

No violations. Excellent token usage.

---

### BrandEditorShadows.svelte -- 1 issue

**File**: `apps/web/src/lib/components/brand-editor/levels/BrandEditorShadows.svelte`
**Lines reviewed**: 197
**Style block**: Yes (89 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 152 | P1 | Hardcoded range hint width | `width: 42px` | `width: var(--space-11)` or `width: var(--space-10)` |

---

### BrandEditorShape.svelte -- 1 issue

**File**: `apps/web/src/lib/components/brand-editor/levels/BrandEditorShape.svelte`
**Lines reviewed**: 173
**Style block**: Yes (91 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 119 | P1 | Hardcoded range label width | `width: 52px` | `width: var(--space-14)` or `width: var(--space-12)` |

---

### BrandEditorTypography.svelte -- Clean

**File**: `apps/web/src/lib/components/brand-editor/levels/BrandEditorTypography.svelte`
**Lines reviewed**: 119
**Style block**: Yes (42 lines)

No violations. Clean token usage.

---

### ActivityFeed.svelte -- 3 issues

**File**: `apps/web/src/lib/components/studio/ActivityFeed.svelte`
**Lines reviewed**: 172
**Style block**: Yes (77 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 111-112 | P1 | Hardcoded icon dimensions | `width: 2rem; height: 2rem` | `width: var(--space-8); height: var(--space-8)` |
| 124 | P3 | HSL fallback on interactive token | `background-color: var(--color-interactive-subtle, hsl(210, 100%, 95%))` | `background-color: var(--color-interactive-subtle)` (remove hardcoded fallback) |
| 136 | P3 | Hardcoded px fallback on spacing token | `gap: var(--space-0-5, 2px)` | `gap: var(--space-0-5)` (token is always defined, fallback unnecessary) |

Note: The `color-mix` expressions in the dark mode overrides (lines 163-170) are acceptable as theme-specific adjustments.

---

### PublishSidebar.svelte -- 3 issues

**File**: `apps/web/src/lib/components/studio/content-form/PublishSidebar.svelte`
**Lines reviewed**: 451
**Style block**: Yes (173 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 317 | P3 | Unnecessary fallback on radius-full | `border-radius: var(--radius-full, 9999px)` | `border-radius: var(--radius-full)` |
| 319 | P1 | Hardcoded letter-spacing | `letter-spacing: 0.05em` | `letter-spacing: var(--tracking-wide)` |
| 323-324 | P3 | Token fallbacks where tokens are defined | `background-color: var(--color-warning-100, var(--color-warning-50))` | Acceptable as graceful degradation but the two-token fallback pattern is unnecessary if both are defined |

---

### ThumbnailUpload.svelte -- Clean

**File**: `apps/web/src/lib/components/studio/content-form/ThumbnailUpload.svelte`
**Lines reviewed**: 206
**Style block**: Yes (120 lines)

No violations. The `color-mix` expressions on the overlay buttons (lines 141-151) are acceptable as overlay visual effects on images. Clean token usage throughout.

---

### ContentForm.svelte -- Clean

**File**: `apps/web/src/lib/components/studio/ContentForm.svelte`
**Lines reviewed**: 377
**Style block**: Yes (63 lines)

No violations. The `280px` sidebar column width (line 358) is an acceptable layout constraint. Clean token usage.

---

### ContentTable.svelte -- 1 issue

**File**: `apps/web/src/lib/components/studio/ContentTable.svelte`
**Lines reviewed**: 332
**Style block**: Yes (190 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 173 | P3 | Hardcoded fallback on tracking token | `letter-spacing: var(--tracking-wide, 0.05em)` | `letter-spacing: var(--tracking-wide)` (remove fallback) |

Note: The file is otherwise exemplary in token usage, including computed column widths from tokens.

---

### CustomerDetailDrawer.svelte -- 2 issues

**File**: `apps/web/src/lib/components/studio/CustomerDetailDrawer.svelte`
**Lines reviewed**: 402
**Style block**: Yes (193 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 281 | P3 | Unnecessary fallback on radius-full | `border-radius: var(--radius-full, 9999px)` | `border-radius: var(--radius-full)` |
| 347 | P1 | Hardcoded letter-spacing | `letter-spacing: 0.05em` | `letter-spacing: var(--tracking-wide)` |

---

### CustomerTable.svelte -- Clean

**File**: `apps/web/src/lib/components/studio/CustomerTable.svelte`
**Lines reviewed**: 123
**Style block**: Yes (38 lines)

No violations. Clean token usage via `:global` cell styles.

---

### EditMediaDialog.svelte -- Clean

**File**: `apps/web/src/lib/components/studio/EditMediaDialog.svelte`
**Lines reviewed**: 191
**Style block**: Yes (48 lines)

No violations. Clean token usage.

---

### GrantAccessDialog.svelte -- Clean

**File**: `apps/web/src/lib/components/studio/GrantAccessDialog.svelte`
**Lines reviewed**: 160
**Style block**: Yes (12 lines)

No violations.

---

### InviteMemberDialog.svelte -- Clean

**File**: `apps/web/src/lib/components/studio/InviteMemberDialog.svelte`
**Lines reviewed**: 174
**Style block**: Yes (42 lines)

No violations. Clean token usage.

---

### LogoUpload.svelte -- 2 issues

**File**: `apps/web/src/lib/components/studio/LogoUpload.svelte`
**Lines reviewed**: 323
**Style block**: Yes (117 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 216-217 | P1 | Hardcoded preview dimensions | `width: 160px; height: 160px` | `width: var(--space-40); height: var(--space-40)` or a component-level custom property |
| 244 | P1 | Hardcoded dashed border width | `border: 2px dashed var(--color-border)` | `border: var(--border-width-thick) dashed var(--color-border)` |

Note: The `320px` max-width on the drop zone (line 248) is an acceptable layout constraint.

---

### MediaCard.svelte -- Clean

**File**: `apps/web/src/lib/components/studio/MediaCard.svelte`
**Lines reviewed**: 357
**Style block**: Yes (122 lines)

No violations. Excellent token usage including progress bar, action buttons, and transcoding state indicators.

---

### MediaGrid.svelte -- Clean

**File**: `apps/web/src/lib/components/studio/MediaGrid.svelte`
**Lines reviewed**: 49
**Style block**: Yes (7 lines)

No violations.

---

### MediaPicker.svelte -- 2 issues

**File**: `apps/web/src/lib/components/studio/MediaPicker.svelte`
**Lines reviewed**: 672
**Style block**: Yes (308 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 556 | P3 | Unnecessary fallback on radius-sm | `border-radius: var(--radius-sm, 4px)` | `border-radius: var(--radius-sm)` |
| 571 | P1 | Hardcoded highlight outline | `outline: 2px solid var(--color-brand-primary-subtle)` | `outline: var(--border-width-thick) solid var(--color-brand-primary-subtle)` |

Note: The `260px` max-height on `.dropdown-list` (line 542) is an acceptable dropdown constraint.

---

### MediaUpload.svelte -- Clean

**File**: `apps/web/src/lib/components/studio/MediaUpload.svelte`
**Lines reviewed**: 515
**Style block**: Yes (172 lines)

No violations. Excellent token usage throughout including progress bars and queue items.

---

### MemberTable.svelte -- 3 issues

**File**: `apps/web/src/lib/components/studio/MemberTable.svelte`
**Lines reviewed**: 285
**Style block**: Yes (107 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 190-191 | P1 | Hardcoded avatar dimensions | `width: 32px; height: 32px` | `width: var(--space-8); height: var(--space-8)` |
| 245 | P1 | Hardcoded focus outline | `outline: 2px solid var(--color-error-500)` | `outline: var(--border-width-thick) solid var(--color-error-500)` |
| 257 | P1 | Hardcoded skeleton row height | `height: 48px` | `height: var(--space-12)` |

Note: The `@keyframes pulse` animation values (lines 263-270) are acceptable as keyframe effects.

---

### TopContentTable.svelte -- 2 issues

**File**: `apps/web/src/lib/components/studio/TopContentTable.svelte`
**Lines reviewed**: 149
**Style block**: Yes (62 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 99 | P1 | Hardcoded skeleton row height | `height: 40px` | `height: var(--space-10)` |
| 118 | P1 | Hardcoded rank column width | `width: 48px` | `width: var(--space-12)` |

---

### _creators/[username]/+page.svelte -- Clean

**File**: `apps/web/src/routes/_creators/[username]/+page.svelte`
**Lines reviewed**: 524
**Style block**: Yes (304 lines)

No violations. Excellent, thorough token usage including responsive breakpoints, avatar sizing, social links, org cards, and content grid. The `560px` max-width on bio (line 271) and `1200px` max-width on layout (line 222) are acceptable layout constraints.

---

### _creators/[username]/+error.svelte -- Clean

**File**: `apps/web/src/routes/_creators/[username]/+error.svelte`
**Lines reviewed**: 177
**Style block**: Yes (105 lines)

No violations. Clean token usage throughout.

---

### _creators/[username]/content/+page.svelte -- 14 issues

**File**: `apps/web/src/routes/_creators/[username]/content/+page.svelte`
**Lines reviewed**: 335
**Style block**: Yes (168 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 173 | P3 | Unnecessary fallback on space-8 | `padding: var(--space-8, 2rem)` | `padding: var(--space-8)` |
| 175 | P3 | Unnecessary fallback on space-6 | `gap: var(--space-6, 1.5rem)` | `gap: var(--space-6)` |
| 182 | P3 | Unnecessary fallback on space-2 | `gap: var(--space-2, 0.5rem)` | `gap: var(--space-2)` |
| 195 | P3 | Unnecessary fallback on text-2xl | `font-size: var(--text-2xl, 1.5rem)` | `font-size: var(--text-2xl)` |
| 196 | P3 | Unnecessary fallback on font-bold | `font-weight: var(--font-bold, 700)` | `font-weight: var(--font-bold)` |
| 204 | P3 | Unnecessary fallback on space-1 | `gap: var(--space-1, 0.25rem)` | `gap: var(--space-1)` |
| 205 | P3 | Unnecessary fallback on text-sm | `font-size: var(--text-sm, 0.875rem)` | `font-size: var(--text-sm)` |
| 238 | P3 | Unnecessary fallback on space-2 | `padding: var(--space-2, 0.5rem)` | `padding: var(--space-2)` |
| 240 | P3 | Unnecessary fallback on border-width | `border: var(--border-width, 1px) var(--border-style, solid)` | `border: var(--border-width) var(--border-style)` |
| 241 | P3 | Unnecessary fallback on radius-md | `border-radius: var(--radius-md, 0.375rem)` | `border-radius: var(--radius-md)` |
| 263 | P3 | Unnecessary fallback on space-1-5 | `padding: var(--space-1-5, 0.375rem)` | `padding: var(--space-1-5)` |
| 265 | P3 | Unnecessary fallback on font-medium | `font-weight: var(--font-medium, 500)` | `font-weight: var(--font-medium)` |
| 289 | P3 | Unnecessary fallback on space-6 | `gap: var(--space-6, 1.5rem)` | `gap: var(--space-6)` |
| 308 | P3 | Unnecessary fallback on space-4 | `padding-top: var(--space-4, 1rem)` | `padding-top: var(--space-4)` |

This file has a systematic pattern of unnecessary hardcoded fallback values on every token usage. All tokens are guaranteed to be defined in the token system, so these fallbacks add visual noise and could mask token loading failures. Every instance should simply use the token without the fallback.

---

### _creators/[username]/content/+error.svelte -- Clean

**File**: `apps/web/src/routes/_creators/[username]/content/+error.svelte`
**Lines reviewed**: 176
**Style block**: Yes (104 lines)

No violations. Clean token usage (identical pattern to `[username]/+error.svelte`).

---

### _creators/studio/content/+page.svelte -- Clean

**File**: `apps/web/src/routes/_creators/studio/content/+page.svelte`
**Lines reviewed**: 124
**Style block**: Yes (60 lines)

No violations. Clean token usage.

---

### _creators/studio/media/+page.svelte -- 1 issue

**File**: `apps/web/src/routes/_creators/studio/media/+page.svelte`
**Lines reviewed**: 305
**Style block**: Yes (93 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 249 | P3 | Unnecessary fallback on radius-full | `border-radius: var(--radius-full, 9999px)` | `border-radius: var(--radius-full)` |

---

### _creators/studio/settings/+page.svelte -- Clean

**File**: `apps/web/src/routes/_creators/studio/settings/+page.svelte`
**Lines reviewed**: 410
**Style block**: Yes (61 lines)

No violations. Clean token usage.

---

### _org/[slug]/(space)/+page.svelte -- 1 issue

**File**: `apps/web/src/routes/_org/[slug]/(space)/+page.svelte`
**Lines reviewed**: 429
**Style block**: Yes (245 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 224 | P1 | Hardcoded hero logo border | `border: 3px solid color-mix(...)` | `border: var(--border-width-thick) solid color-mix(...)` or define a `--border-width-hero` |

Note: The `color-mix` expressions throughout the hero section (lines 205, 224, 260, 268, 270, 280, 281, 285) are all acceptable as they create translucent white/transparent overlays on a gradient background that is always brand-colored. These don't participate in semantic theming. The `720px`, `640px`, `1200px`, `180px`, `240px` widths are all acceptable layout constraints.

---

### _org/[slug]/(space)/creators/+page.svelte -- 7 issues

**File**: `apps/web/src/routes/_org/[slug]/(space)/creators/+page.svelte`
**Lines reviewed**: 151
**Style block**: Yes (70 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 86 | P3 | Unnecessary fallback on space-8 | `padding: var(--space-8, 2rem) var(--space-6, 1.5rem)` | `padding: var(--space-8) var(--space-6)` |
| 88 | P3 | Unnecessary fallback on space-8 | `gap: var(--space-8, 2rem)` | `gap: var(--space-8)` |
| 95 | P3 | Unnecessary fallback on space-2 | `gap: var(--space-2, 0.5rem)` | `gap: var(--space-2)` |
| 100 | P3 | Unnecessary fallback on text-3xl | `font-size: var(--text-3xl, 1.875rem)` | `font-size: var(--text-3xl)` |
| 101 | P3 | Unnecessary fallback on font-bold | `font-weight: var(--font-bold, 700)` | `font-weight: var(--font-bold)` |
| 108 | P3 | Unnecessary fallback on text-base | `font-size: var(--text-base, 1rem)` | `font-size: var(--text-base)` |
| 118 | P3 | Unnecessary fallback on space-6 | `gap: var(--space-6, 1.5rem)` | `gap: var(--space-6)` |

Same systematic pattern as the content catalog page -- every token has an unnecessary hardcoded fallback.

---

### _org/[slug]/(space)/explore/+page.svelte -- Clean

**File**: `apps/web/src/routes/_org/[slug]/(space)/explore/+page.svelte`
**Lines reviewed**: 658
**Style block**: Yes (334 lines)

No violations. This is the most comprehensive style block in the review and uses tokens correctly throughout, including search, filters, category pills, chips, grid layouts, and responsive breakpoints. Excellent work.

---

### _org/[slug]/studio/+page.svelte -- Clean

**File**: `apps/web/src/routes/_org/[slug]/studio/+page.svelte`
**Lines reviewed**: 293
**Style block**: Yes (131 lines)

No violations. Clean token usage throughout the dashboard layout. The `var(--space-0-5, 2px)` fallback on line 218 is acceptable as graceful degradation.

---

### _org/[slug]/studio/analytics/+page.svelte -- 1 issue

**File**: `apps/web/src/routes/_org/[slug]/studio/analytics/+page.svelte`
**Lines reviewed**: 249
**Style block**: Yes (75 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 239 | P1 | Hardcoded letter-spacing | `letter-spacing: 0.05em` | `letter-spacing: var(--tracking-wide)` |

---

### _org/[slug]/studio/settings/branding/+page.svelte -- 1 issue

**File**: `apps/web/src/routes/_org/[slug]/studio/settings/branding/+page.svelte`
**Lines reviewed**: 168
**Style block**: Yes (44 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 157-158 | P1 | Hardcoded swatch dimensions | `width: 32px; height: 32px` | `width: var(--space-8); height: var(--space-8)` |

---

### (platform)/account/+page.svelte -- Clean

**File**: `apps/web/src/routes/(platform)/account/+page.svelte`
**Lines reviewed**: 490
**Style block**: Yes (97 lines)

No violations. Clean token usage throughout.

---

### (platform)/become-creator/+page.svelte -- Clean

**File**: `apps/web/src/routes/(platform)/become-creator/+page.svelte`
**Lines reviewed**: 183
**Style block**: Yes (74 lines)

No violations. The `40rem` max-width (line 110) is an acceptable layout constraint. Clean token usage.

---

### (platform)/pricing/+page.svelte -- Clean

**File**: `apps/web/src/routes/(platform)/pricing/+page.svelte`
**Lines reviewed**: 213
**Style block**: Yes (128 lines)

No violations. Clean token usage throughout. The `64rem` max-width (line 114) is an acceptable layout constraint.

---

### _org/[slug]/studio/settings/+layout.svelte -- 1 issue

**File**: `apps/web/src/routes/_org/[slug]/studio/settings/+layout.svelte`
**Lines reviewed**: 178
**Style block**: Yes (94 lines)

| Line | Severity | Issue | Current | Should Be |
|------|----------|-------|---------|-----------|
| 122-124 | P2 | Missing token references in transition | `transition: color var(--transition-duration) var(--transition-timing), border-color var(--transition-duration) var(--transition-timing)` | `transition: color var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default)` -- `--transition-duration` and `--transition-timing` are not defined tokens |

Note: The `2px` border-bottom on `.tab-trigger` (line 122) is acceptable as a decorative tab indicator and does not need to follow border token scaling.

---

## Wave 2 Priority Fix List

### P1 -- Should Fix (ignores density scaling) -- 36 instances

**Brand editor components:**
1. **BrandEditorFooter.svelte:55** -- `6px` dot dimensions
2. **BrandEditorHeader.svelte:72** -- `24px` back button dimensions
3. **BrandEditorHeader.svelte:109** -- `28px` action button dimensions
4. **BrandEditorPanel.svelte:101** -- `1px` hardcoded border
5. **BrandEditorPanel.svelte:111** -- `1px` hardcoded header border
6. **BrandEditorPanel.svelte:129** -- `1px` hardcoded footer border
7. **BrandEditorPanel.svelte:142** -- `48px` minimized bar height
8. **ColorInput.svelte:113** -- `20px` swatch dimensions
9. **HueSlider.svelte:45** -- `12px` track height
10. **HueSlider.svelte:65** -- `16px` thumb dimensions (Webkit)
11. **HueSlider.svelte:68** -- `2px` thumb border
12. **HueSlider.svelte:80** -- `16px` thumb dimensions (Firefox)
13. **OklchColorArea.svelte:156** -- `12px` thumb dimensions
14. **OklchColorArea.svelte:159** -- `2px` thumb border
15. **SwatchRow.svelte:37** -- `24px` swatch dimensions
16. **SwatchRow.svelte:53** -- `2px` active ring
17. **BrandEditorFineTuneTypography.svelte:147** -- `48px` hint width
18. **BrandEditorHome.svelte:317** -- `28px` icon column width
19. **BrandEditorLogo.svelte:88** -- `120px` preview min-height
20. **BrandEditorLogo.svelte:96** -- `80px` logo max-height
21. **BrandEditorShadows.svelte:152** -- `42px` range hint width
22. **BrandEditorShape.svelte:119** -- `52px` range label width

**Studio components:**
23. **ActivityFeed.svelte:111** -- `2rem` icon dimensions
24. **PublishSidebar.svelte:319** -- `0.05em` letter-spacing
25. **CustomerDetailDrawer.svelte:347** -- `0.05em` letter-spacing
26. **LogoUpload.svelte:216** -- `160px` preview dimensions
27. **LogoUpload.svelte:244** -- `2px` dashed border
28. **MediaPicker.svelte:571** -- `2px` highlight outline
29. **MemberTable.svelte:190** -- `32px` avatar dimensions
30. **MemberTable.svelte:245** -- `2px` focus outline
31. **MemberTable.svelte:257** -- `48px` skeleton row height
32. **TopContentTable.svelte:99** -- `40px` skeleton row height
33. **TopContentTable.svelte:118** -- `48px` rank column width

**Route pages:**
34. **_org/(space)/+page.svelte:224** -- `3px` hero logo border
35. **analytics/+page.svelte:239** -- `0.05em` letter-spacing
36. **branding/+page.svelte:157** -- `32px` swatch dimensions

### P2 -- Minor (primitive token where semantic exists) -- 1 instance

1. **settings/+layout.svelte:122** -- `--transition-duration` / `--transition-timing` (undefined tokens)

### P3 -- Nits -- 25 instances

**Unnecessary fallbacks (systematic pattern):**
1-14. **_creators/[username]/content/+page.svelte** -- 14 instances of `var(--token, hardcoded-value)` where the token is always defined
15-21. **_org/(space)/creators/+page.svelte** -- 7 instances of the same pattern

**Unnecessary fallbacks (individual):**
22. **ActivityFeed.svelte:124** -- HSL fallback on `--color-interactive-subtle`
23. **ActivityFeed.svelte:136** -- `2px` fallback on `--space-0-5`
24. **PublishSidebar.svelte:317** -- `9999px` fallback on `--radius-full`
25. **ContentTable.svelte:173** -- `0.05em` fallback on `--tracking-wide`
26. **CustomerDetailDrawer.svelte:281** -- `9999px` fallback on `--radius-full`
27. **MediaPicker.svelte:556** -- `4px` fallback on `--radius-sm`
28. **_creators/studio/media/+page.svelte:249** -- `9999px` fallback on `--radius-full`

---

## Combined Summary (Wave 1 + Wave 2)

| Metric | Wave 1 | Wave 2 | Total |
|--------|--------|--------|-------|
| Files reviewed | 42 | 75 | 117 |
| Clean files | 28 | 53 (incl. 22 no style) | 81 |
| Files with issues | 14 | 22 | 36 |
| Total violations | 34 | 60 | 94 |
| P0 (branding-breaking) | 6 | 0 | 6 |
| P1 (density scaling) | 14 | 36 | 50 |
| P2 (primitive vs semantic) | 7 | 1 | 8 |
| P3 (nit) | 7 | 25 | 32 |

**Key patterns identified in Wave 2:**
1. **Systematic unnecessary fallbacks** -- Two route files (`_creators/content/+page.svelte` and `_org/creators/+page.svelte`) add hardcoded fallback values to every single token reference. These 21 P3 nits could be cleaned up in a single pass.
2. **Color picker hardcoded dimensions** -- The OKLCH color picker subcomponents (HueSlider, OklchColorArea, SwatchRow, ColorInput) consistently use hardcoded `px` for interactive controls. These are functional but should use spacing tokens for density scaling.
3. **Letter-spacing `0.05em`** -- Appears in 3 components (PublishSidebar, CustomerDetailDrawer, analytics). All should use `var(--tracking-wide)`.
4. **`2px` for focus/highlight outlines** -- Multiple components hardcode `2px` for outline width where `var(--border-width-thick)` should be used.
5. **No P0 violations** -- Wave 2 components do not use primitive `--color-neutral-*` tokens or hardcoded hex colors. Brand editor components correctly avoid theming themselves (as documented in the component header).


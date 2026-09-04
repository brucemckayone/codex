# Content Card Audit Report

**Date:** 2026-04-12
**Scope:** All card components in `apps/web/src/lib/components/`, their usage across the platform, design system token coverage, API data availability, and modern UX benchmarks.

---

## Executive Summary

The platform has **9 card-like components** that evolved independently, resulting in inconsistent hover behaviour, padding, shadows, aspect ratios, progress bars, and accessibility patterns. This audit recommends consolidating the three content-displaying cards (ContentCard, LibraryCard, ContinueWatchingCard) into **one unified ContentCard** with 5 layout variants while keeping domain-specific cards (CreatorCard, StatCard, MediaCard, ErrorCard) separate.

---

## 1. Current State

### Card Inventory

| Component | Purpose | Location |
|---|---|---|
| **ContentCard** | Browse/explore content (4 variants) | `ui/ContentCard/` |
| **LibraryCard** | Owned content with progress + access badge | `library/LibraryCard.svelte` |
| **ContinueWatchingCard** | Resume carousel item | `library/ContinueWatchingCard.svelte` |
| **CreatorCard** | Creator profiles (3 variants) | `ui/CreatorCard/` |
| **StatCard** | Dashboard metrics | `studio/StatCard.svelte` |
| **MediaCard** | Upload/transcode status | `studio/MediaCard.svelte` |
| **ErrorCard** | Full-page error display | `ui/ErrorCard/` |
| **Base Card** | Composable primitives (Header/Content/Footer) | `ui/Card/` |
| **Discover inline** | Custom inline card markup (not a component) | `discover/+page.svelte` |

### Critical Issues Found

#### 1. Inconsistent Hover Behaviour

| Component | Shadow | Transform | Approach |
|---|---|---|---|
| ContentCard | `--shadow-lg` | `scale(1.02)` | Scale up |
| LibraryCard | `--shadow-md` | `translateY(-2px)` | Lift |
| ContinueWatchingCard | `--shadow-md` | `translateY(-2px)` | Lift |
| CreatorCard (default) | `--shadow-md` | None | Shadow only |
| CreatorCard (showcase) | `--shadow-lg` | `translateY(-0.5)` | Lift |
| MediaCard | None | None | No hover |

Three different shadow levels, three different transform approaches, and some cards with no hover at all.

#### 2. Undefined CSS Tokens in Active Use

- **`--color-border-hover`** -- used in ContentCard, CreatorCard, MediaCard, LibraryFilters, explore page, BackToTop. **NOT defined in any token file.**
- **`--color-surface-variant`** -- used in CreatorCard social links. **NOT defined.**

#### 3. Progress Bar Inconsistency

| Component | Track Background | Fill Radius | Completed Color |
|---|---|---|---|
| ContentCard | `--color-overlay-light` | `border-radius: 0 var(--radius-sm)` | N/A |
| LibraryCard | `--color-overlay-light` | None | `--color-success` (green) |
| ContinueWatchingCard | `color-mix(in srgb, white 30%, transparent)` | `border-radius: 0 var(--radius-xs)` | N/A |

ContinueWatchingCard uses raw `color-mix()` instead of design tokens.

#### 4. Padding Inconsistency

Body padding varies from `--space-3` to `--space-6` with no clear rationale:
- ContentCard: `--space-3`
- LibraryCard: `--space-3 --space-4` (asymmetric)
- ContinueWatchingCard: `--space-3`
- CreatorCard: `--space-4`
- StatCard: `--space-6` (inherited from base Card)

#### 5. Aspect Ratio Fragmentation

ContentCard `featured` uses 4:3 while everything else uses 16:9. No clear motivation for the deviation.

#### 6. Information Hierarchy Issues

- `explore` variant shows description (2-line clamp) -- Netflix, YouTube, Spotify, MasterClass all omit description on browse cards
- No metadata density row (type + duration in one muted line)
- Progress text ("65% complete") is redundant with the visual progress bar

---

## 2. Design System Token Coverage

### Available but Underused

| Token System | Available | Used by Cards |
|---|---|---|
| Glass materials (`--material-glass`, `--blur-md`) | Yes | No |
| Density scaling (`--brand-density-scale`) | Yes | Partially (spacing tokens inherit it) |
| Motion easings (`--ease-bounce`, etc.) | Yes | No (cards use `--ease-default` only) |
| OKLCH brand derivation | Yes | No (badges use hardcoded semantic colors) |
| Opacity tokens (`--opacity-*`) | Yes | No (cards use raw rgba) |

### Missing Tokens (Must Add)

| Token | Recommended Value (Light) | Recommended Value (Dark) |
|---|---|---|
| `--color-border-hover` | `var(--color-neutral-300)` | `var(--color-neutral-600)` |
| `--color-surface-variant` | `var(--color-neutral-150, #eef0f2)` | `var(--color-neutral-750, #333)` |

---

## 3. API Data Available but Not Surfaced

The backend returns rich data that cards currently ignore:

- **viewCount / purchaseCount** -- could show social proof ("1.2K views")
- **publishedAt** -- could show recency ("3 days ago", "New" badge)
- **tags[]** -- could show up to 2 topic pills
- **minimumTierId** -- could show tier requirement badge
- **mediaItem.width / height** -- could adapt thumbnail aspect ratio per content
- **waveformKey** -- audio content could show waveform instead of static thumbnail

---

## 4. Modern UX Benchmarks

### What Premium Platforms Do

**Hover (Netflix gold standard):**
- 300-500ms hover dwell before expansion
- Card lifts with `translateY` + subtle `scale(1.03)` + `box-shadow` elevation
- Inner image zooms independently at slower rate (creates depth)
- Asymmetric timing: fast ease-out on expand, slow ease-in on collapse

**Information Hierarchy (YouTube/Netflix):**
- Thumbnail dominant (70% of card)
- Title (bold, 2-line max) immediately below
- Single metadata row: type + duration + separator (muted, small)
- NO description on browse cards (only in detail/expanded views)
- Creator shown only when multi-creator context exists

**Progress (Netflix/YouTube):**
- Thin bar (3-4px) flush to thumbnail bottom
- No border-radius on fill (reads as data, not decoration)
- No text percentage label on card (bar IS the indicator)

**Badges:**
- Always overlaid on thumbnail, never in body
- Glass backdrop-filter for legibility on any thumbnail color
- "New" badge for recent content (< 7 days)

**Accessibility:**
- `<article>` root with `aria-labelledby` pointing to title
- `:focus-visible` (not `:focus-within`) for keyboard-only focus rings
- Full-card click via invisible overlay link with `tabindex="-1"`
- Progress bars with `aria-label="Watch progress"`

---

## 5. Recommendations (Implemented)

### Unify Three Cards Into One

**Before:** ContentCard + LibraryCard + ContinueWatchingCard = 3 components, ~950 lines of CSS

**After:** ContentCard with 5 variants:

| Variant | Replaces | Layout | Key Features |
|---|---|---|---|
| `grid` | ContentCard `explore` | Vertical column | Thumbnail, title, metadata, creator |
| `list` | LibraryCard | Horizontal row | Progress, access badge, time remaining |
| `featured` | ContentCard `featured` | Vertical, larger | Title + description, 16:9 (was 4:3) |
| `compact` | ContentCard `compact` | Small horizontal | Title only, 160px thumb (was 120px) |
| `resume` | ContinueWatchingCard | Vertical, carousel | Progress bar, resume time, resume CTA |

### Standardise Hover

All content cards: `translateY(calc(-1 * var(--space-0-5))) scale(1.02)` + inner image `scale(1.05)` at slower timing. Shadow elevation from `--shadow-sm` (rest) to `--shadow-lg` (hover). Consistent `cubic-bezier(0.2, 0, 0, 1)` easing.

### Fix Progress Bars

- Unified track background: `var(--color-overlay-light)` (no `color-mix`)
- No border-radius on fill (flat end = data indicator)
- Completed state: fill turns `--color-success` (green)
- `aria-label="Watch progress"` for screen readers

### Improve Information Density

- Remove description from `grid` variant (matches Netflix/YouTube pattern)
- Add metadata row: content type icon + formatted duration in one muted `--text-xs` line
- Remove redundant progress percentage text (bar suffices)

### Glass PriceBadge

Add `backdrop-filter: blur(var(--blur-sm))` to PriceBadge for legibility over any thumbnail.

### Accessibility Fixes

- Add `aria-labelledby` to `<article>` element
- Switch from `:focus-within` to `:focus-visible` for keyboard-only rings
- Add `aria-label` to progress track elements

---

## 6. Files Changed

### Modified
- `apps/web/src/lib/styles/themes/light.css` -- add missing tokens
- `apps/web/src/lib/styles/themes/dark.css` -- add missing tokens
- `apps/web/src/lib/components/ui/ContentCard/ContentCard.svelte` -- full redesign
- `apps/web/src/lib/components/ui/ContentCard/SkeletonContentCard.svelte` -- match new card
- `apps/web/src/lib/components/ui/PriceBadge/PriceBadge.svelte` -- glass effect
- `apps/web/src/lib/components/library/LibraryPageView.svelte` -- use ContentCard
- `apps/web/src/lib/components/library/ContinueWatching.svelte` -- use ContentCard
- All route pages importing ContentCard -- update variant names

### Deprecated (can be removed after migration verified)
- `apps/web/src/lib/components/library/LibraryCard.svelte`
- `apps/web/src/lib/components/library/ContinueWatchingCard.svelte`

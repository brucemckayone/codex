# 09 — Platform Library

## Scope

The user's purchased/free content, rendered fully client-side from the localStorage `libraryCollection`.

| File | Lines | Role |
|---|---:|---|
| `apps/web/src/routes/(platform)/library/+page.svelte` | 241 | Auth guard, live-query, filter/sort/paginate logic, delegates rendering to `LibraryPageView` |
| `apps/web/src/lib/components/library/LibraryPageView.svelte` | 313 | **Shared** template used by platform + org library pages |
| `apps/web/src/lib/components/library/LibraryFilters.svelte` | 240 | Pill-style filters + debounced search |
| `apps/web/src/lib/components/library/ContinueWatching.svelte` | 80 | Carousel of in-progress items |
| `apps/web/src/lib/components/library/LibraryCard.svelte` | **283** | **Dead** — replaced by `ContentCard` list variant, never deleted |

No `+page.server.ts`. Auth is verified via parent layout data with a client-side redirect. Data flows through `libraryCollection` (localStorage) with `useLiveQuery`. Filtering/sorting/pagination are pure `$derived.by` computations — zero server round-trips after the initial load.

## CSS modernity

### In use — good

- **Custom media queries** — `@media (--breakpoint-sm)` switches the filter row from column to horizontal (`LibraryFilters.svelte:167-172`).
- **`[data-view]` attribute hook** — `<div class="content-grid content-grid--compact" data-view={viewMode}>` (line 198) lets the global `.content-grid[data-view='list']` selector in `styles/utilities.css:40-43` re-shape the grid for list view. Idiomatic attribute selectors over class manipulation.
- **`:focus-visible`** on every interactive surface — `browse-btn`, `clear-filters-btn`, `.filter-btn`. Consistent with the modern pattern discussed in Section 02.
- **Client-side `$derived.by`** composition for filter→sort→paginate (`+page.svelte:93-172`) — uses Svelte 5 runes cleanly; no effects, no subscriptions, no stale-closure traps.
- **`hideCollection` guard** via `browser` check happens inside `libraryCollection` itself (Section B responsibility); the page correctly consumes via `useLiveQuery`.

### Gaps

- **`.library { max-width: 1200px }`** (LibraryPageView.svelte:231) — hardcoded pixel width. `--container-max: 80rem` (1280px) and `--container-xl: 80rem` exist; pick one. If 1200px is genuinely the spec, add `--container-library: 75rem`.
- **`.sort-bar { max-width: 480px }`** (LibraryPageView.svelte:301) — another hardcoded width.
- **`itemMinWidth = '280px'` / `'240px'`** in `ContinueWatching.svelte:42` — string literals with px units. Should reference `--space-*` or a `--carousel-card-min-width` token.
- **`box-shadow: 0 0 0 1px var(--color-interactive)`** in `LibraryFilters.svelte:237` — hardcoded spread width. Diverges from the global focus paradigm documented in Section 02 (outline on `:focus-visible`).

## Inheritance & reuse

### Architectural win: LibraryPageView

`LibraryPageView.svelte` is the audit's first genuine **route-level template**. Its doc comment says *"Shared library page template used by both the platform and org library routes"*. It orchestrates:

| Primitive | Source |
|---|---|
| `ContentCard` | `ui/ContentCard/` |
| `SkeletonContentCard` | `ui/ContentCard/` |
| `ErrorBanner` | `ui/Feedback/` |
| `EmptyState` | `ui/EmptyState/` |
| `Pagination` | `ui/Pagination/` |
| `Select` | `ui/Select/` |
| `ViewToggle` | `ui/ViewToggle/` |
| `BackToTop` | `ui/BackToTop/` |
| `LibraryFilters` | sibling |
| `ContinueWatching` | sibling |

This is exactly the composition pattern Section 07 and 08 were missing. The route files (`+page.svelte`) become thin data-wiring adapters; the template owns the visual concerns.

### …but the template still inlines two button primitives

| Inline CSS | Lines | Existing primitive |
|---|---:|---|
| `.browse-btn` | 251-270 (20 lines) | `Button variant="primary"` |
| `.clear-filters-btn` | 272-293 (21 lines) | `Button variant="secondary"` (outline) |

Both sit inside the empty-state `action` snippets. Same pattern as Sections 7 and 8. Together: ~41 lines of re-implementation.

### Content-type rename appears twice

```svelte
contentType={(item.content.contentType === 'written' ? 'article' : item.content.contentType) as 'video' | 'audio' | 'article'}
```

- `LibraryPageView.svelte:204`
- `ContinueWatching.svelte:51`

The same DB-to-UI mapping inline on two components. Same smell flagged in 8.5. A `toCardContentType(dbValue)` helper in `$lib/utils/content-type.ts` (or closer to the collection definition) would collapse both.

### `.search-input` in LibraryFilters mirrors the discover/landing patterns

`LibraryFilters.svelte:219-238` hand-rolls a search input with nearly identical CSS to the one in `(platform)/discover/+page.svelte`. Both re-implement the `Input` primitive. This is now a three-point pattern.

### Hardcoded "- Codex" title suffix

`+page.svelte:218` — `<title>{m.library_title()} - Codex</title>`. The "- Codex" is hardcoded English. Every page in the app has this pattern (`07-platform-home.md` noted *"Codex - Transform Your Content Journey"*, `08-platform-discover.md` noted *"Discover Content - Codex"*). Candidate for a `formatPageTitle(m.library_title())` helper that appends the brand consistently and from `paraglide` so the suffix can be localised too.

### Small magic numbers

- `ITEMS_PER_PAGE = 12` (`+page.svelte:83`) — fine as a page-local constant.
- `.slice(0, 4)` in ContinueWatching (line 39) — "top 4 in-progress items". Could be a prop with a default or a `CONTINUE_WATCHING_LIMIT` constant.
- `#each Array(6)` skeleton loaders (LibraryPageView:149) — 6 hardcoded skeletons. Minor.
- Debounce `300ms` (LibraryFilters:76) — standard, acceptable magic number.

### `state_referenced_locally` suppression ×5

`LibraryFilters.svelte:39-48` has five consecutive `svelte-ignore state_referenced_locally` comments, one before each `$state(initial…)` initialisation. The warning triggers because Svelte sees a `$state` seeded from a prop and wants you to acknowledge that subsequent prop changes won't update the state.

The intent here is correct — filters are user-owned after mount, URL sync happens via `onFilterChange` upstream — but repeating the suppression five times is noisy. Could be factored so the state block sits behind a single suppression, or the prop-shape refactored into a single `filters` object passed once.

## Wasted code

### `LibraryCard.svelte` — 283 lines, unreferenced

Verified:
- `grep "LibraryCard"` across `apps/web/src` returns **zero importers**.
- The only reference outside the file itself is a comment in `ContentCard.svelte:639` reading *"VARIANT: LIST (replaces LibraryCard)"* — explicit confirmation that `ContentCard`'s list variant is the successor.

The file is the largest single piece of dead code the audit has found so far. **283 lines, safe to delete.**

### No other dead code found in this section

All other library components have grep-verifiable consumers. The dead code concern is 100% concentrated in `LibraryCard.svelte`.

## Simplification opportunities

Ranked by impact/effort:

1. **Delete `LibraryCard.svelte`** — 283 lines, zero callers, confirmed superseded. Single-commit, largest win.
2. **Swap `.browse-btn` + `.clear-filters-btn` for `<Button>` variants** — kills ~41 lines of inline CSS in LibraryPageView. Matches fixes from Sections 7 and 8.
3. **Swap `.search-input` in LibraryFilters for `<Input>` primitive** — repeats the Section 8 fix. Three places now share this pattern; worth calling out in the rollup.
4. **Extract the `written → article` content-type rename** to a shared helper; reference from both `LibraryPageView` and `ContinueWatching`.
5. **Token-ify hardcoded widths**:
   - `max-width: 1200px` on `.library` → `var(--container-max)` or introduce a library-specific token.
   - `max-width: 480px` on `.sort-bar` → introduce `--sort-bar-max-width` or use existing `--container-sm`.
   - `itemMinWidth = '280px'` / `'240px'` on ContinueWatching → `var(--card-carousel-min-width-prominent)` / `var(--card-carousel-min-width)`.
6. **Centralise page title construction** — a `formatPageTitle(pageName)` helper that prepends "Codex" (or reads from `m.app_name()`), used everywhere. Fixes the "- Codex" pattern repeating across routes.
7. **Consolidate `state_referenced_locally` suppressions** — single suppression with a short comment explaining the pattern, or refactor LibraryFilters' prop surface.
8. **Normalise the filter input's focus paradigm** — remove `box-shadow: 0 0 0 1px …` on line 237, rely on the global `:focus-visible` outline (Section 2.5 tracks the system-wide version of this).

## Findings

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| 9.1 | High | `LibraryCard.svelte` (283 lines) is unreferenced; confirmed replaced by `ContentCard` list variant | Delete the file |
| 9.2 | Medium | `.browse-btn` (20 lines) and `.clear-filters-btn` (21 lines) in LibraryPageView re-implement `Button` variants | Swap for `<Button variant="primary">` / `<Button variant="secondary">` |
| 9.3 | Medium | LibraryFilters `.search-input` (20 lines CSS) re-implements `Input` primitive — same gap in landing & discover | Swap for `<Input type="search">` |
| 9.4 | Medium | `written → article` content-type rename inlined in both LibraryPageView:204 and ContinueWatching:51 | Extract to `$lib/utils/content-type.ts` helper |
| 9.5 | Low | `max-width: 1200px` on `.library` is hardcoded pixel value | Use `var(--container-max)` or introduce `--container-library` |
| 9.6 | Low | `max-width: 480px` on `.sort-bar` is hardcoded | Introduce a layout token |
| 9.7 | Low | `itemMinWidth = '280px'` / `'240px'` in ContinueWatching are string-literal px values | Token-ify or derive from spacing scale |
| 9.8 | Low | `.search-input:focus` uses `box-shadow: 0 0 0 1px ...` — diverges from the global `:focus-visible` outline paradigm (2.5) | Remove inline focus ring; rely on outline |
| 9.9 | Low | Every page title hardcodes "- Codex" suffix; "Codex" isn't i18n-ised | Add `formatPageTitle(pageName)` helper |
| 9.10 | Low | LibraryFilters.svelte has 5 consecutive `svelte-ignore state_referenced_locally` comments | Consolidate or refactor prop surface |
| 9.11 | Low | `CONTINUE_WATCHING_LIMIT` and skeleton count (6) are magic numbers | Extract to named constants (or props) |

## Quantitative summary

- **Live files**: 4 components + 1 route page = 874 lines of TS+CSS.
- **Dead code**: `LibraryCard.svelte` at 283 lines = **24% of the section's total surface area**. By far the biggest single dead-code find in the audit so far.
- **Token compliance**: ~90%. Four hardcoded px widths (1200, 480, 280, 240) plus the box-shadow spread.
- **Primitive reuse**: strong in `LibraryPageView` (orchestrates 10+ primitives), but still re-implements Button×2 and Input — matches the cross-cutting pattern the rollup will surface.
- **Architecture win**: fully client-side with localStorage-backed instant render on return visits, zero-round-trip filter/sort/paginate, shared template between platform and org — textbook execution of the pattern described in `CLAUDE.md` and the project memory.

## Next section

10 — Platform account (`(platform)/account/`) — profile, notifications, purchases.

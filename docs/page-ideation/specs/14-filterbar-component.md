# Reusable FilterBar Component --- Implementation Spec

## Summary

Extract the filter/sort/search pattern duplicated across 7+ pages into a single, config-driven `FilterBar` component. Every page that shows a list of items with filters follows the same structural pattern today --- pill button groups, a sort dropdown, and/or a search input --- but each implements it from scratch with its own inline state management, URL sync logic, and 50-100 lines of duplicated CSS. The FilterBar replaces all of this with a declarative config array.

Pages affected: Org Explore, Platform Library, Org Library, Studio Media, Creator Content Catalog, Studio Content (needs filters), Studio Customers (needs filters), and Creator Studio Media.

---

## Feasibility

### Pros

- **The pattern is already proven and consistent.** Every existing filter implementation follows the same lifecycle: read URL params on load, render filter controls, write URL params on change via `goto()`, reset page to 1 on filter change. The variance is only in which filters exist and what options they have --- the plumbing is identical.
- **Zero API changes required.** All filtering is already server-side, driven by URL search params parsed in `+page.server.ts` load functions. The FilterBar just standardizes the client-side control layer.
- **Massive CSS deduplication.** The `.filter-btn`, `.filter-btn--active`, `.filter-group`, `.search-input`, and `.sort-wrapper` styles are copy-pasted across at least 5 files with minor variations (some use `border-radius: var(--radius-full)`, others `var(--radius-md)`; some use class toggling, others use `data-` attributes). A single component owns these styles once.
- **All building blocks already exist.** The `Select` component (Melt UI-based) handles dropdowns. Button styling patterns are established. The search input pattern (debounce, submit-on-enter) is proven in LibraryFilters and Explore.
- **Makes adding filters to unfiltered pages trivial.** Studio Content and Studio Customers currently have no filters. With FilterBar, adding search + status + type filtering is a ~15 line config declaration.

### Gotchas & Risks

- **LibraryFilters uses a callback pattern (`onFilterChange`) instead of direct URL writes.** The platform library and org library pages use `LibraryFilters` which fires a callback and lets the parent build the URL. This is slightly different from the explore page pattern where the component owns the `goto()` call directly. The FilterBar must support both models: default to direct URL sync, but accept an optional `onFilterChange` callback for pages that need custom URL building (e.g., the library pages that include non-filter params like `sort` in their URL construction).
- **"All" value semantics differ.** Explore uses empty string (`''`) for "all types", while Library and Media use the string `'all'`. The FilterBar must normalize this: internally use `null`/`undefined` for "no filter applied", and accept a configurable `allValue` or `emptyValue` per filter that controls what gets written to (or omitted from) the URL.
- **Pill button visual variants.** Explore uses a connected button group with shared border (`overflow: hidden`, no gap between buttons). Library and Media use separated pill buttons with individual rounded borders and a `var(--space-2)` gap. Both are valid visual patterns. The FilterBar should support a `variant` on pill groups: `'connected'` (explore style) and `'separated'` (library/media style).
- **Search debounce timing.** LibraryFilters debounces at 300ms. Explore requires explicit form submission (Enter key). Both patterns should be supported: `SearchFilter` accepts `mode: 'debounce' | 'submit'` with configurable delay.
- **Active filter chip display.** No page currently shows removable filter chips (the "active filters as tags" pattern). This is a new addition. It must be optional --- pages can opt in via a `showActiveChips` prop.
- **The component must not break the pagination `baseUrl` pattern.** Every page builds a `paginationBaseUrl` by taking the current URL, removing the `page` param, and preserving filters. The FilterBar should expose a `$derived` `activeParams` readable that the parent can use for pagination URL building.
- **i18n labels.** Every filter option label currently uses paraglide message functions (`m.explore_filter_all()`, `m.media_type_video()`, etc.). The FilterBar config must accept pre-resolved strings, not message keys --- the parent page resolves i18n before passing config.
- **Responsive behavior on mobile.** Currently, explore stacks everything vertically below `--breakpoint-sm`. Media pages stack filter groups vertically. Library wraps filter groups. The FilterBar should follow the same pattern: horizontal on desktop, vertical stack on mobile, with pill groups scrollable horizontally when they overflow.

---

## Current State

### Page-by-Page Analysis

#### Org Explore (`_org/[slug]/(space)/explore/+page.svelte`)
**Most complete filter UI.** Has all three filter types:
- **Search**: Text input with icon, form submission (Enter key), no debounce.
- **Type pills**: Connected button group (`All | Video | Audio | Article`). Uses empty string for "all", writes `type` URL param.
- **Sort dropdown**: `Select` component with `newest | oldest | title` options. Writes `sort` URL param.
- **Clear all**: Button in EmptyState that removes `q`, `type`, `sort`, `page` params.
- **URL sync**: `updateFilter(key, value)` helper reads `page.url`, sets/deletes param, calls `goto()` with `replaceState: true, noScroll: true`.
- **Page reset**: Automatically deletes `page` param when any filter changes.

#### Platform Library (`(platform)/library/+page.svelte`)
**Uses child component for filters, parent for sort.**
- **Sort dropdown**: `Select` component, separate from LibraryFilters, positioned above filters. Options: `recent | watched | az | za`.
- **Filters**: Delegated to `LibraryFilters.svelte` child component.
- **LibraryFilters** manages 3 pill groups (content type, progress status, access type) + search input with 300ms debounce.
- **URL sync**: LibraryFilters fires `onFilterChange` callback. Parent builds URL params and calls `goto()` with `replaceState: true`.
- **Clear all**: Exposed via `filtersRef?.clearAll()` imperative call + `goto('/library')`.
- **Mounted guard**: LibraryFilters skips the first `$effect` run to avoid a navigation on mount.

#### Org Library (`_org/[slug]/(space)/library/+page.svelte`)
**Near-identical to Platform Library.** Same `LibraryFilters` component, same sort dropdown, same URL sync pattern. Adds an `accessType` filter and a "View full library" cross-domain link. Copy-paste of 90% of the Platform Library code.

#### Studio Media (`_org/[slug]/studio/media/+page.svelte`)
**Two pill groups, no search, no sort.**
- **Media type pills**: Separated pill buttons (`All | Video | Audio`). Writes `mediaType` URL param.
- **Status pills**: Separated pill buttons (`All | Ready | Processing | Failed`). Writes `status` URL param.
- **URL sync**: `setFilter(key, value)` reads `page.url.searchParams`, sets/deletes, rebuilds path, calls `goto()` with `invalidateAll: true`.
- **"All" value**: Uses string `'all'` --- deletes param from URL when selected.
- **No search or sort.**

#### Creator Content Catalog (`_creators/[username]/content/+page.svelte`)
**Search + type pills, no sort dropdown.**
- **Search**: Plain text input, form submission.
- **Type pills**: Separated pill buttons (`All | Video | Audio | Article`). Uses `'all'` as empty value.
- **URL sync**: `buildFilterUrl(overrides)` constructs full path with params. `goto()` without `replaceState`.
- **Page reset**: Implicit --- `buildFilterUrl` only includes `page` param if explicitly passed in overrides.

#### Creator Studio Media (`_creators/studio/media/+page.svelte`)
**Identical to Org Studio Media.** Same two pill groups (media type + status), same `setFilter()` helper, same URL param names. Direct copy.

#### Studio Content (`_org/[slug]/studio/content/+page.svelte`)
**No filters at all.** Just a content table with pagination. Needs: status filter (draft/published/archived), content type filter, search by title.

#### Studio Customers (`_org/[slug]/studio/customers/+page.svelte`)
**No filters at all.** Just a customer table with pagination. Needs: search by name/email, date range or join period filter.

### Summary of Duplicated Code

| Concern | Files duplicating it | Lines per file |
|---|---|---|
| `updateFilter` / `setFilter` / `buildFilterUrl` helper | 6 | 8-15 |
| Pill button group markup + active state toggling | 6 | 10-20 |
| `.filter-btn` / `.filter-btn--active` CSS | 5 | 25-40 |
| `.search-input` CSS | 4 | 15-20 |
| `paginationBaseUrl` with filter preservation | 7 | 5-10 |
| `clearFilters` / `clearAll` | 4 | 5-10 |
| `hasActiveFilters` derived | 4 | 3-5 |

**Total estimated duplication**: ~400-500 lines of nearly identical code across 7 files.

---

## Design Spec

### Props Interface

```typescript
interface FilterBarProps {
  /** Array of filter definitions. Order determines render order. */
  filters: FilterConfig[];

  /**
   * Strategy for URL synchronization.
   * - 'direct': FilterBar calls goto() itself (default).
   * - 'callback': FilterBar fires onFilterChange, parent handles navigation.
   */
  mode?: 'direct' | 'callback';

  /**
   * Callback fired when any filter value changes.
   * Only used when mode='callback'. Receives a record of
   * all current filter values keyed by their URL param name.
   */
  onFilterChange?: (values: Record<string, string | null>) => void;

  /**
   * Whether to show removable chips for active filters above the bar.
   * Default: false.
   */
  showActiveChips?: boolean;

  /**
   * goto() options passed when mode='direct'.
   * Default: { replaceState: true, noScroll: true }.
   */
  gotoOptions?: { replaceState?: boolean; noScroll?: boolean; invalidateAll?: boolean };

  /**
   * Optional CSS class for the root element.
   */
  class?: string;
}
```

### FilterConfig Type

```typescript
type FilterConfig = PillFilterConfig | DropdownFilterConfig | SearchFilterConfig;

interface BaseFilterConfig {
  /** URL search param name (e.g., 'type', 'status', 'sort', 'q'). */
  param: string;

  /** Human-readable label, used for chip display and ARIA labels. */
  label: string;
}

interface PillFilterConfig extends BaseFilterConfig {
  type: 'pills';

  /** Available options. First option is treated as the "all/reset" value. */
  options: Array<{ value: string; label: string }>;

  /**
   * Visual variant for the button group.
   * - 'connected': Shared border, no gap (Explore style).
   * - 'separated': Individual pill buttons with gap (Library/Media style).
   * Default: 'separated'.
   */
  variant?: 'connected' | 'separated';
}

interface DropdownFilterConfig extends BaseFilterConfig {
  type: 'dropdown';

  /** Available options. */
  options: Array<{ value: string; label: string }>;

  /** Placeholder text when no value is selected. */
  placeholder?: string;

  /** Minimum width for the dropdown wrapper. Default: '160px'. */
  minWidth?: string;
}

interface SearchFilterConfig extends BaseFilterConfig {
  type: 'search';

  /** Placeholder text for the input. */
  placeholder?: string;

  /**
   * Input behavior.
   * - 'submit': Requires Enter key / form submit (Explore style).
   * - 'debounce': Auto-fires after delay (Library style).
   * Default: 'submit'.
   */
  mode?: 'submit' | 'debounce';

  /** Debounce delay in ms when mode='debounce'. Default: 300. */
  debounceMs?: number;

  /** Whether to show the search icon inside the input. Default: true. */
  showIcon?: boolean;
}
```

### Filter Types

#### PillFilter (subcomponent)

Renders a horizontal button group where exactly one option is selected at a time. The first option in the array is always the "reset" / "show all" option.

**Connected variant** (Explore page style):
- Buttons share a parent border with `overflow: hidden`.
- No gap between buttons.
- Active button gets `background: var(--color-interactive); color: var(--color-text-on-brand)`.

**Separated variant** (Library/Media style):
- Each button has its own border and `border-radius: var(--radius-full)`.
- `gap: var(--space-2)` between buttons.
- Active button same styling as connected.

Both variants:
- `aria-pressed` on each button.
- Keyboard navigable (native button focus).
- Clicking the first option removes the param from URL (equivalent to "all").

#### DropdownFilter (subcomponent)

Wraps the existing `Select` component with FilterBar integration:
- Reads current value from URL param.
- On change, writes the new value (or removes param for the first/default option).
- Accepts the same `options` shape as `Select`.

#### SearchFilter (subcomponent)

A text input with optional search icon:

**Submit mode:**
- Wrapped in a `<form>` element.
- `type="search"` input with clear button (native browser).
- Fires filter change on form submit (Enter key).
- `SearchIcon` positioned absolutely inside the input (left padding).

**Debounce mode:**
- No form wrapper.
- `$effect` watches input value, fires after configurable delay.
- Cancels pending debounce on new input.

Both modes:
- Syncs input value from URL param on data changes (back/forward nav) via `$effect`.
- `aria-label` from the filter's `label` config.

#### ChipDisplay (subcomponent)

Renders a horizontal row of removable chips showing active (non-default) filters:
- Each chip shows `{filterLabel}: {optionLabel}` and a close (X) button.
- Clicking X removes that filter (sets it back to default/first option).
- "Clear all" button appears when 2+ filters are active.
- Search terms show as `Search: "{term}"`.
- Only renders when at least one non-default filter is active.
- Chips use `var(--radius-full)` border-radius and `var(--color-surface-secondary)` background.

### URL Sync

The FilterBar reads initial state from and writes changes to URL search params. This is the core pattern that every page already follows.

**Reading state:**
```typescript
// Inside FilterBar, using $app/state
import { page } from '$app/state';

// Derive current values from URL for each filter
const values = $derived(
  Object.fromEntries(
    props.filters.map(f => [
      f.param,
      page.url.searchParams.get(f.param) ?? getDefaultValue(f)
    ])
  )
);
```

**Writing state (direct mode):**
```typescript
function updateParam(param: string, value: string | null) {
  const url = new URL(page.url);

  if (value === null || value === getDefaultValue(filterByParam(param))) {
    url.searchParams.delete(param);
  } else {
    url.searchParams.set(param, value);
  }

  // Always reset pagination on filter change
  url.searchParams.delete('page');

  goto(url.toString(), gotoOptions);
}
```

**Writing state (callback mode):**
```typescript
function updateParam(param: string, value: string | null) {
  // Build full values record with the updated param
  const newValues = { ...getCurrentValues(), [param]: value };
  onFilterChange?.(newValues);
}
```

**Exposed derived state for parent:**
The FilterBar exposes reactive properties that parents can use for pagination URL building and empty state logic:

```typescript
// Expose to parent via $bindable or component methods
export const activeParams: Record<string, string> = $derived(/* non-default params */);
export const hasActiveFilters: boolean = $derived(/* at least one non-default */);
export function clearAll(): void { /* reset all to defaults */ }
```

### Responsive Behavior

**Desktop (above `--breakpoint-sm`):**
- Single horizontal row with `flex-wrap: wrap`.
- Search input uses `flex: 1 1 280px` to fill available space.
- Pill groups and dropdowns are inline, wrapping naturally.
- Chip display (if enabled) renders as a second row above or below the controls.

**Mobile (below `--breakpoint-sm`):**
- Controls stack vertically (`flex-direction: column`).
- Search input takes full width.
- Pill groups scroll horizontally with `overflow-x: auto` to prevent wrapping on small screens.
- Dropdown takes full width.
- Chip display wraps naturally.

This matches the existing responsive behavior in the explore and media pages, so no new patterns are introduced.

---

## Implementation Plan

### Files to Create

All new files go in `apps/web/src/lib/components/ui/FilterBar/`:

| File | Purpose | ~Size |
|---|---|---|
| `FilterBar.svelte` | Root component. Reads config, renders subcomponents, manages URL sync. | 80-100 lines |
| `FilterPills.svelte` | Pill button group subcomponent. Handles connected/separated variants. | 60-80 lines |
| `FilterDropdown.svelte` | Thin wrapper around existing `Select`. | 25-35 lines |
| `FilterSearch.svelte` | Search input with submit/debounce modes. | 60-80 lines |
| `FilterChips.svelte` | Active filter chips display with remove and clear all. | 50-60 lines |
| `types.ts` | TypeScript types (`FilterConfig`, `PillFilterConfig`, etc.). | 40-50 lines |
| `index.ts` | Barrel export. | 5 lines |

**Total new code**: ~320-410 lines (component + types), replacing ~400-500 lines of duplication.

### Files to Modify

Each migrated page replaces its inline filter UI with a `<FilterBar>` declaration:

| File | Change | Complexity |
|---|---|---|
| `_org/[slug]/(space)/explore/+page.svelte` | Replace `explore__controls` section + `updateFilter` + filter CSS with `<FilterBar>` | Medium |
| `(platform)/library/+page.svelte` | Replace `LibraryFilters` usage + `sort-bar` + `handleFilterChange` with `<FilterBar>` | Medium |
| `_org/[slug]/(space)/library/+page.svelte` | Same as platform library | Medium |
| `_org/[slug]/studio/media/+page.svelte` | Replace `filters-section` + `setFilter` + filter CSS with `<FilterBar>` | Low |
| `_creators/[username]/content/+page.svelte` | Replace `catalog-filters` + `buildFilterUrl` + filter CSS with `<FilterBar>` | Low |
| `_creators/studio/media/+page.svelte` | Same as org studio media | Low |
| `_org/[slug]/studio/content/+page.svelte` | Add `<FilterBar>` with status + type + search filters (new functionality) | Low |
| `_org/[slug]/studio/customers/+page.svelte` | Add `<FilterBar>` with search filter (new functionality) | Low |

### File to Remove

| File | Reason |
|---|---|
| `$lib/components/library/LibraryFilters.svelte` | Fully replaced by `<FilterBar>`. All functionality absorbed into the generic component. |

### Migration Plan

Migrations should be done **incrementally**, one page at a time, verified before moving to the next. Order is chosen to start with the most straightforward cases and build confidence before tackling the library pages (which have the callback pattern).

**Phase 1 --- Build the Component**

1. Create `types.ts` with all FilterConfig types.
2. Build `FilterPills.svelte` with both variants.
3. Build `FilterSearch.svelte` with both modes.
4. Build `FilterDropdown.svelte`.
5. Build `FilterChips.svelte`.
6. Assemble `FilterBar.svelte` orchestrating the subcomponents.
7. Create barrel export `index.ts`.

**Phase 2 --- Migrate Direct-Mode Pages (simplest first)**

1. **Studio Media** (org + creator) --- Two pill groups, no search, no sort. Simplest case. Validates pill rendering and URL sync.
2. **Creator Content Catalog** --- Adds search (submit mode) + pills. Validates search integration.
3. **Org Explore** --- All three filter types (search + pills + dropdown). Most complete direct-mode page. Validates the connected pill variant and dropdown integration.

**Phase 3 --- Migrate Callback-Mode Pages**

4. **Platform Library** --- Uses callback mode for URL sync. Validates `mode='callback'` + `onFilterChange`. After migration, the parent page's `handleFilterChange` function reduces from a 10-line URL builder to a 3-line pass-through.
5. **Org Library** --- Same pattern as platform library. Should be a near-copy of the platform library migration.

**Phase 4 --- Add Filters to Unfiltered Pages**

6. **Studio Content** --- Add `FilterBar` with:
   - `pills` for status (`All | Draft | Published | Archived`)
   - `pills` for content type (`All | Video | Audio | Written`)
   - `search` for title search
   - Requires `+page.server.ts` update to read and pass URL params to the API.

7. **Studio Customers** --- Add `FilterBar` with:
   - `search` for name/email search
   - Requires `+page.server.ts` update to read and pass URL params to the API.

**Phase 5 --- Cleanup**

8. Delete `LibraryFilters.svelte`.
9. Remove orphaned CSS from all migrated pages.
10. Verify no remaining imports of `LibraryFilters`.

### Usage Examples

**Org Explore (all three filter types, direct mode):**

```svelte
<script lang="ts">
  import { FilterBar } from '$lib/components/ui/FilterBar';
  import * as m from '$paraglide/messages';
  import type { FilterConfig } from '$lib/components/ui/FilterBar/types';

  const filters: FilterConfig[] = [
    {
      type: 'search',
      param: 'q',
      label: 'Search',
      placeholder: m.explore_search_placeholder(),
      mode: 'submit',
      showIcon: true,
    },
    {
      type: 'pills',
      param: 'type',
      label: 'Content type',
      variant: 'connected',
      options: [
        { value: '', label: m.explore_filter_all() },
        { value: 'video', label: m.explore_filter_video() },
        { value: 'audio', label: m.explore_filter_audio() },
        { value: 'written', label: m.explore_filter_article() },
      ],
    },
    {
      type: 'dropdown',
      param: 'sort',
      label: 'Sort',
      options: [
        { value: 'newest', label: m.explore_sort_newest() },
        { value: 'oldest', label: m.explore_sort_oldest() },
        { value: 'title', label: m.explore_sort_title() },
      ],
    },
  ];
</script>

<FilterBar {filters} />
```

**Studio Media (pills only, direct mode with invalidateAll):**

```svelte
<script lang="ts">
  import { FilterBar } from '$lib/components/ui/FilterBar';
  import * as m from '$paraglide/messages';
  import type { FilterConfig } from '$lib/components/ui/FilterBar/types';

  const filters: FilterConfig[] = [
    {
      type: 'pills',
      param: 'mediaType',
      label: 'Media type',
      options: [
        { value: 'all', label: m.media_filter_all_types() },
        { value: 'video', label: m.media_type_video() },
        { value: 'audio', label: m.media_type_audio() },
      ],
    },
    {
      type: 'pills',
      param: 'status',
      label: 'Status',
      options: [
        { value: 'all', label: m.media_filter_all_status() },
        { value: 'ready', label: m.media_status_ready() },
        { value: 'transcoding', label: m.media_status_processing() },
        { value: 'failed', label: m.media_status_failed() },
      ],
    },
  ];
</script>

<FilterBar {filters} gotoOptions={{ invalidateAll: true }} />
```

**Platform Library (callback mode for custom URL building):**

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { FilterBar } from '$lib/components/ui/FilterBar';
  import type { FilterConfig } from '$lib/components/ui/FilterBar/types';

  const filters: FilterConfig[] = [
    { type: 'dropdown', param: 'sort', label: 'Sort', options: sortOptions },
    { type: 'pills', param: 'type', label: 'Type', options: typeOptions },
    { type: 'pills', param: 'progress', label: 'Progress', options: progressOptions },
    { type: 'search', param: 'q', label: 'Search', mode: 'debounce', debounceMs: 300 },
  ];

  function handleFilterChange(values: Record<string, string | null>) {
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(values)) {
      if (val) params.set(key, val);
    }
    const qs = params.toString();
    void goto(`/library${qs ? `?${qs}` : ''}`, { replaceState: true });
  }
</script>

<FilterBar {filters} mode="callback" onFilterChange={handleFilterChange} />
```

**Studio Content (adding filters to an unfiltered page):**

```svelte
<FilterBar
  filters={[
    {
      type: 'pills',
      param: 'status',
      label: 'Status',
      options: [
        { value: 'all', label: 'All' },
        { value: 'draft', label: 'Draft' },
        { value: 'published', label: 'Published' },
        { value: 'archived', label: 'Archived' },
      ],
    },
    {
      type: 'pills',
      param: 'type',
      label: 'Type',
      options: [
        { value: 'all', label: 'All' },
        { value: 'video', label: 'Video' },
        { value: 'audio', label: 'Audio' },
        { value: 'written', label: 'Written' },
      ],
    },
    {
      type: 'search',
      param: 'q',
      label: 'Search',
      placeholder: 'Search content...',
      mode: 'debounce',
    },
  ]}
  showActiveChips
/>
```

---

## Testing Notes

### Unit / Component Tests

- **PillFilter**: Renders all options. Clicking non-active option fires update. First option removes param. `aria-pressed` reflects active state. Both `connected` and `separated` variants render correct CSS classes.
- **SearchFilter (submit mode)**: Does not fire on each keystroke. Fires on Enter / form submit. Trims whitespace. Empty submit removes param.
- **SearchFilter (debounce mode)**: Fires after delay. Cancels pending on new input. Syncs from URL on external navigation.
- **DropdownFilter**: Renders Select with correct options. Fires update on selection change.
- **FilterChips**: Renders chip for each non-default filter. X button removes that filter. "Clear all" removes all. Does not render when no active filters.
- **FilterBar (direct mode)**: Calls `goto()` with correct URL on filter change. Resets `page` param. Preserves unrelated params.
- **FilterBar (callback mode)**: Does not call `goto()`. Fires `onFilterChange` with full values record. Parent receives correct values.
- **URL sync**: Back/forward browser navigation updates displayed filter state correctly.

### Integration / Visual Tests

- **Explore page**: Confirm search + type pills + sort dropdown render. Filter by type, verify URL changes and results update. Clear filters returns to unfiltered state.
- **Studio Media page**: Confirm both pill groups render. Active state toggles correctly. Pagination preserves filters.
- **Library page**: Confirm callback mode works. Sort + filter combination produces correct URL. Clear all resets everything.
- **Studio Content page**: Confirm new filters appear. Status filtering works end-to-end (requires server-side param parsing).
- **Mobile responsive**: Below `--breakpoint-sm`, controls stack vertically. Pill groups remain scrollable, not wrapping to multiple lines.

### Edge Cases

- Page with no filters configured: FilterBar renders nothing (early return).
- All filters at default values: `hasActiveFilters` is false. Chips section hidden.
- URL has params not managed by FilterBar: They are preserved, not stripped.
- Rapid clicking between pill options: Only one `goto()` in flight (debounce or let SvelteKit coalesce).
- Very long option labels: Text truncates with ellipsis, does not break layout.

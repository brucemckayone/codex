# Explore Filtering UX — Implementation Spec

## Summary

Three improvements to the org explore page (`_org/[slug]/(space)/explore/`) filtering experience:

1. **Category navigation strip** — Horizontal scrollable row of category pills derived client-side from loaded content items. Clicking a category filters the visible grid without a server round-trip (public API does not support category filter).
2. **Sort dropdown enhancement** — Visual refresh with icons per sort option, plus additional sort options (`viewCount`, `purchaseCount`) available only to authenticated users (the authenticated `contentQuerySchema` endpoint supports these via `sortBy`).
3. **Active filter chips** — Removable chip badges above the content grid showing active search query, content type, category, and sort. Includes a "Clear All" button.

---

## Feasibility

### Pros

- All three features are additive — they layer onto the existing URL-driven filter state without changing the data loading architecture.
- Category filtering is purely client-side (no API changes needed). The `ContentWithRelations` shape already includes `category: string | null` on every item.
- The authenticated `contentQuerySchema` already supports `sortBy: 'viewCount' | 'purchaseCount'` — no backend work required for auth'd sort options.
- Filter chips are a presentation concern — they read the same `filters` derived state that already exists.
- The existing `clearFilters()` function already resets all URL params, so "Clear All" has a ready-made handler.

### Gotchas & Risks

- **Public endpoint lacks category filter.** The `publicContentQuerySchema` does not accept a `category` param, so category filtering must happen client-side by filtering the already-loaded `items` array. This means the category strip only reflects categories present in the current page of results (e.g., 12 items), not all categories across the entire content catalogue. If content spans many pages, some categories may not appear until the user paginates. This is an acceptable limitation for now — a future enhancement could add `category` to the public endpoint.
- **Auth'd sort options require a different API call path.** The current `+page.server.ts` calls `getPublicContent()` which uses `publicContentQuerySchema` (sort values: `newest`, `oldest`, `title`). To support `viewCount`/`purchaseCount` sorting for logged-in users, the loader must conditionally call the authenticated `api.content.list()` endpoint instead, which uses `contentQuerySchema`. This means the loader needs a fork based on `locals.user`.
- **Category filtering is post-load.** Because filtering happens after items are fetched, the `total` count and pagination will reflect the unfiltered result set. We must show a secondary count or adjust the displayed count when a category filter is active. Pagination remains server-driven (unfiltered).
- **Scroll shadows on category strip.** Horizontal scroll containers need visual affordance (fade/shadow) to indicate overflow. This requires a small scroll-position listener.

---

## Current State

### Existing Filter UI

The explore page currently has three filter controls in a horizontal row:

| Control | URL Param | Implementation |
|---------|-----------|----------------|
| **Search** | `?q=term` | Text input with `SearchIcon`, form submit updates URL |
| **Type filter** | `?type=video\|audio\|written` | Row of toggle buttons (`explore__filter-btn`), mutually exclusive, "All" resets |
| **Sort** | `?sort=newest\|oldest\|title` | Melt UI `Select` component with 3 options |
| **Pagination** | `?page=N` | `Pagination` component at bottom of grid |

### State Management

- All state lives in URL query params — `updateFilter(key, value)` calls `goto()` with `replaceState: true`.
- Changing any filter (except page) resets `?page` to 1.
- `clearFilters()` removes `q`, `type`, `sort`, and `page` params.
- `hasActiveFilters` derived from `!!filters.q || !!filters.type` (does not currently account for non-default sort).

### Data Flow

```
+page.server.ts
  ├── parent() → { org }
  ├── Extract URL params (q, type, sort, page)
  ├── Validate against VALID_TYPES / VALID_SORTS
  ├── Call getPublicContent({ orgId, search, contentType, sort, page, limit: 12 })
  └── Return { content: { items, total }, filters, limit }
```

### Auth Context

`data.user` is available from the parent org layout (`_org/[slug]/+layout.server.ts` returns `user: locals.user`). The explore page does not currently reference it but can access it via `data.user` since SvelteKit merges parent layout data.

---

## Design Spec

### 1. Category Navigation Strip

A horizontally scrollable row of pill buttons positioned between the controls bar and the content grid. Each pill represents a distinct `category` value extracted from the loaded content items.

#### Category Extraction

```typescript
// Derive distinct categories from loaded items (client-side only)
const categories = $derived(
  [...new Set(items.map((item) => item.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
);
```

This produces a sorted array of non-null category strings from the current page's items.

#### URL State

- **Param**: `?category=CategoryName` (URL-encoded)
- Added to `updateFilter()` — resets page to 1.
- `clearFilters()` must also delete `category` param.

#### Client-Side Filtering

Because the public API does not support category filtering, when a category is selected the page filters the `items` array locally:

```typescript
// Active category from URL
const activeCategory = $derived(filters.category ?? '');

// Client-filtered items when category is active
const displayItems = $derived(
  activeCategory
    ? items.filter((item) => item.category === activeCategory)
    : items
);
```

The grid renders `displayItems` instead of `items`. Pagination and `total` still reflect the server result (unfiltered). When category is active, the results count shows e.g. "Showing 4 of 12 results" to communicate the local filter.

#### Visual Design

- **Container**: Full-width horizontal scroll, no visible scrollbar, fade masks on overflow edges.
- **"All" pill**: Always first, selected when no category is active.
- **Category pills**: One per distinct category value. Same visual style as existing type filter buttons but with `--radius-full` (fully rounded) for a pill/chip appearance.
- **Active state**: Uses `--color-interactive` background with `--color-text-on-brand` text (matching existing type filter active style).
- **Inactive state**: `--color-surface-secondary` background, `--color-text-secondary` text.
- **Hide when useless**: The entire strip is hidden if fewer than 2 distinct categories exist (nothing to filter).

#### Responsive Behavior

- **Desktop**: Pills wrap if there is space, or scroll horizontally if they overflow.
- **Mobile**: Horizontal scroll only, fade shadows on left/right edges to indicate scrollability.
- **Touch**: Momentum scrolling via `-webkit-overflow-scrolling: touch` (implicit on modern browsers).

#### CSS Structure

```css
.explore__categories {
  display: flex;
  gap: var(--space-2);
  overflow-x: auto;
  scrollbar-width: none; /* Firefox */
  -webkit-overflow-scrolling: touch;
  padding: var(--space-1) 0;
  mask-image: linear-gradient(
    to right,
    transparent 0,
    black var(--space-4),
    black calc(100% - var(--space-4)),
    transparent 100%
  );
}

.explore__categories::-webkit-scrollbar {
  display: none; /* Chrome/Safari */
}

.explore__category-pill {
  flex-shrink: 0;
  padding: var(--space-1-5) var(--space-3);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--color-text-secondary);
  background: var(--color-surface-secondary);
  border: var(--border-width) var(--border-style) var(--color-border);
  border-radius: var(--radius-full);
  cursor: pointer;
  white-space: nowrap;
  transition: background-color var(--duration-fast) var(--ease-default),
              color var(--duration-fast) var(--ease-default),
              border-color var(--duration-fast) var(--ease-default);
}

.explore__category-pill:hover {
  background: var(--color-surface-tertiary, var(--color-surface-secondary));
  border-color: var(--color-border-strong);
}

.explore__category-pill--active {
  background: var(--color-interactive);
  color: var(--color-text-on-brand);
  border-color: var(--color-interactive);
}

.explore__category-pill--active:hover {
  background: var(--color-interactive-hover);
  border-color: var(--color-interactive-hover);
}
```

#### Markup

```svelte
{#if categories.length >= 2}
  <nav class="explore__categories" aria-label="Filter by category">
    <button
      class="explore__category-pill"
      class:explore__category-pill--active={!activeCategory}
      onclick={() => updateFilter('category', null)}
      aria-pressed={!activeCategory}
    >
      {m.explore_filter_all()}
    </button>
    {#each categories as cat (cat)}
      <button
        class="explore__category-pill"
        class:explore__category-pill--active={activeCategory === cat}
        onclick={() => updateFilter('category', cat)}
        aria-pressed={activeCategory === cat}
      >
        {cat}
      </button>
    {/each}
  </nav>
{/if}
```

---

### 2. Sort Dropdown Enhancement

#### Additional Sort Options for Authenticated Users

The authenticated `contentQuerySchema` supports `sortBy: 'viewCount' | 'purchaseCount'` which the public endpoint does not. When `data.user` is present, the sort dropdown should offer two additional options:

| Value | Label | Icon | Auth Required |
|-------|-------|------|---------------|
| `newest` | Newest First | `ClockIcon` | No |
| `oldest` | Oldest First | `CalendarIcon` | No |
| `title` | Title A-Z | `FileTextIcon` | No |
| `popular` | Most Popular | `TrendingUpIcon` | Yes |
| `top-selling` | Top Selling | `ShoppingBagIcon` | Yes |

The `popular` and `top-selling` values are UI-friendly labels that map to `sortBy: 'viewCount'` and `sortBy: 'purchaseCount'` respectively in the server loader.

#### Sort Options Construction

```typescript
const isAuthenticated = $derived(!!data.user);

const sortOptions = $derived([
  { value: 'newest',      label: m.explore_sort_newest(),      icon: ClockIcon },
  { value: 'oldest',      label: m.explore_sort_oldest(),      icon: CalendarIcon },
  { value: 'title',       label: m.explore_sort_title(),       icon: FileTextIcon },
  ...(isAuthenticated ? [
    { value: 'popular',     label: m.explore_sort_popular(),     icon: TrendingUpIcon },
    { value: 'top-selling', label: m.explore_sort_top_selling(), icon: ShoppingBagIcon },
  ] : []),
]);
```

#### Server Loader Changes

`+page.server.ts` needs two changes:

1. **Expand `VALID_SORTS`** to include the auth'd options.
2. **Fork the API call** — use `api.content.list()` (authenticated) for `popular`/`top-selling`, use `getPublicContent()` otherwise.

```typescript
const VALID_SORTS = ['newest', 'oldest', 'title', 'popular', 'top-selling'] as const;
const AUTH_ONLY_SORTS = ['popular', 'top-selling'] as const;

// Map UI sort values to authenticated API params
const AUTH_SORT_MAP: Record<string, { sortBy: string; sortOrder: string }> = {
  'popular':     { sortBy: 'viewCount',     sortOrder: 'desc' },
  'top-selling': { sortBy: 'purchaseCount', sortOrder: 'desc' },
};
```

When `sort` is in `AUTH_ONLY_SORTS` and `locals.user` is present, use the authenticated endpoint. If `locals.user` is absent but an auth-only sort is in the URL (user logged out, stale bookmark), fall back to `'newest'`.

#### Visual Enhancement: Icon Per Option

The current `Select` component does not render icons in options. Two approaches:

**Option A (recommended)**: Build a lightweight custom sort dropdown specific to explore, using the same Melt UI `createSelect` primitive but with icon rendering in the option slot. This avoids modifying the shared `Select` component.

**Option B**: Extend the shared `Select` to accept an optional `icon` field on options. This is a larger change that affects all Select consumers.

Recommendation: **Option A** — create the sort UI inline in `+page.svelte` using Melt UI `createSelect` directly, styled consistently with the existing Select component but with icons. This keeps the change isolated.

#### Sort Dropdown CSS Additions

```css
.explore__sort-option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.explore__sort-option-icon {
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.explore__sort-trigger {
  /* Inherits existing Select styles, but shows icon + label in trigger */
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
```

---

### 3. Active Filter Chips

A horizontal row of removable chips showing all active filters. Appears between the controls bar (and category strip, if visible) and the content grid, only when at least one filter is active.

#### What Triggers a Chip

| Filter | Chip appears when | Chip label | Remove action |
|--------|-------------------|------------|---------------|
| Search | `filters.q` is non-empty | `Search: "{query}"` | `updateFilter('q', null)` + reset `searchInput` |
| Type | `filters.type` is non-empty | `Type: Video` / `Audio` / `Article` | `updateFilter('type', null)` |
| Category | `filters.category` is non-empty | `Category: {name}` | `updateFilter('category', null)` |
| Sort | `filters.sort` is not `'newest'` (the default) | `Sort: {label}` | `updateFilter('sort', null)` |

#### Updated Active Filter Detection

```typescript
const hasActiveFilters = $derived(
  !!filters.q ||
  !!filters.type ||
  !!filters.category ||
  (filters.sort !== 'newest')
);

// Build chip list for rendering
const activeFilterChips = $derived.by(() => {
  const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];

  if (filters.q) {
    chips.push({
      key: 'q',
      label: `Search: "${filters.q}"`,
      onRemove: () => { searchInput = ''; updateFilter('q', null); },
    });
  }

  if (filters.type) {
    const typeLabel = typeOptions.find((o) => o.value === filters.type)?.label ?? filters.type;
    chips.push({
      key: 'type',
      label: `Type: ${typeLabel}`,
      onRemove: () => updateFilter('type', null),
    });
  }

  if (filters.category) {
    chips.push({
      key: 'category',
      label: `Category: ${filters.category}`,
      onRemove: () => updateFilter('category', null),
    });
  }

  if (filters.sort && filters.sort !== 'newest') {
    const sortLabel = sortOptions.find((o) => o.value === filters.sort)?.label ?? filters.sort;
    chips.push({
      key: 'sort',
      label: `Sort: ${sortLabel}`,
      onRemove: () => updateFilter('sort', null),
    });
  }

  return chips;
});
```

#### Chip Visual Design

Each chip follows the existing `Badge` component aesthetic (`--radius-full`, inline-flex) but adds a dismiss button:

```css
.explore__chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.explore__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  padding: var(--space-1-5) var(--space-3);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--color-interactive);
  background: var(--color-interactive-subtle, var(--color-surface-secondary));
  border: var(--border-width) var(--border-style) var(--color-interactive);
  border-radius: var(--radius-full);
  white-space: nowrap;
  transition: background-color var(--duration-fast) var(--ease-default);
}

.explore__chip:hover {
  background: var(--color-interactive);
  color: var(--color-text-on-brand);
}

.explore__chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  width: var(--space-4);
  height: var(--space-4);
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  border-radius: var(--radius-full);
  transition: background-color var(--duration-fast) var(--ease-default);
}

.explore__chip-remove:hover {
  background: color-mix(in oklch, currentColor 15%, transparent);
}

.explore__clear-all {
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--color-text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: var(--space-1) var(--space-2);
  text-decoration: underline;
  text-underline-offset: var(--space-0-5, 2px);
  transition: color var(--duration-fast) var(--ease-default);
}

.explore__clear-all:hover {
  color: var(--color-text);
}
```

#### Chip Markup

```svelte
{#if hasActiveFilters}
  <div class="explore__chips" aria-label="Active filters">
    {#each activeFilterChips as chip (chip.key)}
      <span class="explore__chip">
        {chip.label}
        <button
          class="explore__chip-remove"
          onclick={chip.onRemove}
          aria-label="Remove {chip.label} filter"
        >
          <XIcon size={12} />
        </button>
      </span>
    {/each}
    {#if activeFilterChips.length > 1}
      <button class="explore__clear-all" onclick={clearFilters}>
        {m.explore_clear_filters()}
      </button>
    {/if}
  </div>
{/if}
```

The "Clear All" button only appears when 2+ chips are active (no point showing it for a single chip that already has its own remove button).

#### Animation

Chips should animate in/out smoothly. Use Svelte transitions on each chip:

```svelte
{#each activeFilterChips as chip (chip.key)}
  <span class="explore__chip" transition:fly={{ x: -8, duration: 150 }}>
    ...
  </span>
{/each}
```

---

## Implementation Plan

### Files to Create

None. All changes fit within the existing explore page file and the server loader. No new component files are needed — the category strip and filter chips are small enough to be inline in `+page.svelte` (under 20 lines of markup each). If the sort dropdown with icons grows complex, it could be extracted, but start inline.

### Files to Modify

#### `apps/web/src/routes/_org/[slug]/(space)/explore/+page.server.ts`

1. **Expand `VALID_SORTS`** to include `'popular'` and `'top-selling'`.
2. **Add `VALID_CATEGORIES`** — not needed (categories are client-side).
3. **Parse `category` URL param** and pass it through in the `filters` return object (for URL state persistence, even though server does not filter by it).
4. **Access `locals.user`** from the load function arguments (add to destructured params).
5. **Fork API call** based on sort type and auth status:
   - If `sort` is `'popular'` or `'top-selling'` AND `locals.user` is present: call `api.content.list()` with appropriate `sortBy`/`sortOrder` params, scoped to the org's published content.
   - Otherwise: call `getPublicContent()` as before.
   - If `sort` is auth-only but user is not logged in: fall back to `'newest'`.
6. **Return `user: locals.user` flag** (or just a boolean `isAuthenticated`) so the client knows whether to show auth-only sort options. Actually, `data.user` is already available from the parent layout, so this is not needed.

Changes summary:
```typescript
// Add to VALID_SORTS
const VALID_SORTS = ['newest', 'oldest', 'title', 'popular', 'top-selling'] as const;
const AUTH_ONLY_SORTS = new Set(['popular', 'top-selling']);

// Add locals to load destructuring
export const load: PageServerLoad = async ({ url, setHeaders, parent, locals }) => {
  // ... existing code ...

  // Parse category from URL (client-side filter, persisted in URL)
  const category = url.searchParams.get('category') ?? undefined;

  // Downgrade auth-only sorts for unauthenticated users
  let effectiveSort = sort;
  if (AUTH_ONLY_SORTS.has(sort) && !locals.user) {
    effectiveSort = 'newest';
  }

  // Fork API call based on sort type
  let contentResult;
  if (AUTH_ONLY_SORTS.has(effectiveSort) && locals.user) {
    const AUTH_SORT_MAP = {
      'popular':     { sortBy: 'viewCount',     sortOrder: 'desc' },
      'top-selling': { sortBy: 'purchaseCount', sortOrder: 'desc' },
    };
    const sortConfig = AUTH_SORT_MAP[effectiveSort];
    contentResult = await listContentAuthenticated({
      organizationId: org.id,
      status: 'published',
      contentType,
      search: q,
      sortBy: sortConfig.sortBy,
      sortOrder: sortConfig.sortOrder,
      page,
      limit: PAGE_LIMIT,
    });
  } else {
    contentResult = await getPublicContent({ /* existing call */ });
  }

  return {
    content: { items, total },
    filters: { q, type, sort: effectiveSort, category: category ?? '', page },
    limit: PAGE_LIMIT,
  };
};
```

The authenticated content list call uses `api.content.list()` with `organizationId` + `status: 'published'` to replicate the scoping of the public endpoint. Cache headers should switch to `CACHE_HEADERS.PRIVATE` when the auth'd path is taken (user-specific sort order).

#### `apps/web/src/routes/_org/[slug]/(space)/explore/+page.svelte`

1. **Imports**: Add `XIcon`, `ClockIcon`, `CalendarIcon`, `FileTextIcon`, `TrendingUpIcon`, `ShoppingBagIcon` from Icon components. Add `fly` from `svelte/transition`.

2. **Derived state additions**:
   - `categories` — extracted from `items`.
   - `activeCategory` — from `filters.category`.
   - `displayItems` — filtered by active category.
   - `isAuthenticated` — from `data.user`.
   - `sortOptions` — conditional on auth state, with `icon` field.
   - `activeFilterChips` — array of chip objects.
   - `hasActiveFilters` — expanded to include category and non-default sort.

3. **Update `clearFilters()`** — also delete `category` param.

4. **Template changes** (in order within the `.explore` container):
   - After `explore__controls`: Add category strip markup (wrapped in `{#if categories.length >= 2}`).
   - After category strip: Add filter chips markup (wrapped in `{#if hasActiveFilters}`).
   - Content grid: Change `items` to `displayItems`.
   - When category is active, show a secondary count: "Showing {displayItems.length} of {total}".

5. **Style additions**: All CSS classes documented in the Design Spec sections above, added to the `<style>` block.

6. **Sort dropdown**: Replace the existing `Select` usage with an inline Melt UI `createSelect` that renders icons alongside labels, or keep the existing `Select` and just expand `sortOptions` (icons can be a Phase 2 enhancement if modifying the Select API is too invasive). Start with expanding the options and adding icons as a fast-follow.

### i18n Messages to Add

The following message keys need to be added to the paraglide message files:

| Key | English Value |
|-----|---------------|
| `explore_sort_popular` | `"Most Popular"` |
| `explore_sort_top_selling` | `"Top Selling"` |
| `explore_showing_filtered` | `"Showing {count} of {total} results"` |

Existing keys that are reused:
- `explore_filter_all` (for category "All" pill)
- `explore_clear_filters` (for "Clear All" chip button)

---

## Testing Notes

### Manual Testing

1. **Category strip visibility**: Load an org explore page where content has at least 2 distinct categories. Verify the strip appears. Load a page with 0 or 1 categories — verify the strip is hidden.
2. **Category filtering**: Click a category pill. Verify URL updates with `?category=X`. Verify grid shows only items matching that category. Verify count text updates to "Showing N of M results". Click "All" — verify grid restores.
3. **Sort options (unauthenticated)**: Open sort dropdown while logged out. Verify only 3 options appear (Newest, Oldest, Title).
4. **Sort options (authenticated)**: Log in, open sort dropdown. Verify 5 options appear including "Most Popular" and "Top Selling".
5. **Auth-only sort fallback**: While logged in, select "Most Popular". Log out in another tab. Return to explore page — verify sort falls back to "Newest" gracefully (no error).
6. **Filter chips**: Apply search + type + category. Verify 3 chips appear. Click X on one chip — verify it removes that filter and the chip disappears. Verify "Clear All" appears when 2+ chips exist.
7. **Chip + clear interaction**: Click "Clear All". Verify all chips disappear, all URL params reset, grid shows unfiltered content.
8. **Pagination preservation**: Apply a category filter, then paginate. Verify `?category` persists across pages. Note: category is client-side, so the same server results load — the grid filters locally.
9. **Mobile**: Test category strip horizontal scrolling on narrow viewport. Verify fade masks appear on overflow. Verify touch scrolling works.
10. **Keyboard accessibility**: Tab through category pills — verify focus ring. Tab through filter chips — verify remove buttons are focusable. Verify Enter/Space activates them.

### Edge Cases

- Content with all null categories: strip hidden, no errors.
- Single item on page with one category: strip hidden (need >= 2 distinct).
- Very long category names: pill truncates with ellipsis (add `max-width` and `text-overflow: ellipsis` as a safeguard).
- Auth-only sort in URL but user not logged in: server gracefully downgrades to `newest`, returned `filters.sort` reflects the effective sort.
- Empty search string submitted: `q` param removed (existing behavior preserved).

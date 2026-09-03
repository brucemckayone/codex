# DataTable Enhancement --- Implementation Spec

## Summary

Enhance the existing Table compound components into a full-featured DataTable system for studio pages. The current Table primitives (Table, TableHeader, TableBody, TableRow, TableHead, TableCell) are thin styling wrappers with no interactive behaviour --- no sorting, no selection, no bulk actions, no loading states. Every studio table (ContentTable, CustomerTable, MemberTable, TopContentTable) reimplements its own table markup, loading skeletons, and empty states from scratch. The DataTable adds a behaviour layer on top of these primitives without replacing them: sortable column headers, row selection with checkboxes, a bulk action bar, column visibility toggles, sticky headers, skeleton loading rows, and responsive collapse.

Pages affected: Studio Content (`ContentTable`), Studio Customers (`CustomerTable`), Studio Team (`MemberTable`), Studio Media (`MediaGrid` --- optional table view toggle), Analytics top content (`TopContentTable`).

---

## Feasibility

### Pros

- **Existing primitives are clean and extensible.** The Table compound components are pure presentational wrappers that forward `class` and `...restProps`. They impose no state management, no data binding, no opinion on how rows are rendered. This means a DataTable wrapper can compose them without forking or modifying their internals.
- **Checkbox component already exists with indeterminate support.** The `Checkbox` component (`ui/Checkbox/Checkbox.svelte`) uses Melt UI's `createCheckbox`, already supports `checked: boolean | 'indeterminate'`, and exposes `onCheckedChange`. This is exactly what "select all" header checkbox needs.
- **DropdownMenu component exists for column visibility.** The `DropdownMenu` compound component (`ui/DropdownMenu/`) provides trigger, content, and item primitives --- perfect for a column visibility toggle without building a new popover.
- **Dialog component exists for confirmation flows.** Bulk destructive actions (archive, delete) need confirmation dialogs. The `Dialog` compound component (`ui/Dialog/`) is already built and tested.
- **Skeleton component exists.** The `Skeleton` component (`ui/Skeleton/Skeleton.svelte`) with shimmer animation can generate loading rows directly, replacing the ad-hoc `.skeleton-row` implementations in MemberTable and TopContentTable.
- **Design tokens cover all z-index needs.** The z-index scale includes `--z-sticky: 1020` for the sticky header and `--z-dropdown: 1000` for the column visibility dropdown, already correctly ordered.
- **TableRow already supports `data-state="selected"`.** The existing `TableRow.svelte` has a `.table-row[data-state="selected"]` style rule with `background-color: var(--color-surface-secondary)`. Selection highlighting is already wired at the primitive level.
- **All studio tables are self-contained.** Each table component owns its own rendering and has no shared state. Migration can happen one table at a time without cross-component coordination.

### Gotchas & Risks

- **ContentTable does NOT use the Table compound components.** ContentTable renders raw `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<td>` elements with fully custom styling (including `<colgroup>` for explicit column widths, custom header text-transform, and inline publish toggle logic). It is the most complex table and the one that benefits most from DataTable features, but it requires the most migration work. CustomerTable, MemberTable, and TopContentTable already use the Table compound components.
- **Sort state must sync with URL params for server-side sorting.** Studio pages use server-side pagination (the API returns paginated results). Sorting must follow the same pattern: write `sort` and `order` URL params, let the `+page.server.ts` load function pass them to the API, and have the DataTable read initial sort state from the URL. This means the DataTable does NOT sort client-side --- it triggers navigation. The sort direction toggle must also reset `page` to 1 (same as FilterBar spec #14).
- **Bulk actions hit real API endpoints and need error handling.** "Publish Selected" calls `publishContent` for each item. "Delete Selected" calls a delete endpoint. These are not instant --- they need loading state on the action bar, success/error toasts, and handling of partial failures (3 of 5 items deleted successfully). The bulk action bar must show progress and not allow double-submission.
- **Destructive bulk actions need confirmation dialogs.** "Delete 7 items" is irreversible (soft-delete, but still). The UX must require an explicit confirmation step via the Dialog component. Non-destructive actions like "Publish" can proceed without confirmation.
- **Column visibility persistence scope.** localStorage persistence of hidden columns must be keyed per-table (e.g., `codex-datatable-columns:content`, `codex-datatable-columns:customers`). If a user hides "Created Date" in the content table, it should not affect the customer table. The key must also be stable across page navigations.
- **Sticky header z-index conflicts.** The sticky header sits at `--z-sticky: 1020`. The studio sidebar and the platform header are both sticky/fixed elements. The table header must only be sticky within its scroll container (the `.table-container` div inside `Table.svelte`), not the viewport. This means using `position: sticky` on `<thead>` with `top: 0` relative to the scroll container --- NOT `position: fixed`.
- **Responsive card collapse is complex.** Transforming a table into a card layout on mobile requires either: (a) CSS-only display changes (hiding `<thead>`, making `<tr>` into cards with data-labels), or (b) a Svelte `{#if}` conditional that renders entirely different markup. Option (a) is fragile with custom cell content (checkboxes, badges, action buttons). Option (b) doubles the rendering code. Recommendation: Phase 1 uses horizontal scroll only (already working in ContentTable and CustomerTable). Phase 2 can add card collapse as an opt-in feature.
- **Select-all semantics with pagination.** "Select all" checkbox in the header selects all *visible* rows on the current page. It does NOT select all items across all pages. The bulk action bar must clearly state "3 of 47 items selected" to avoid confusion. If "select all across pages" is needed later, it requires a separate "Select all 47 items" banner (like Gmail) --- out of scope for Phase 1.
- **ContentTable's inline publish toggle must coexist with bulk publish.** The per-row publish/unpublish button is a useful single-item action. It should remain alongside the new bulk action bar. When items are selected, both the per-row action and the bulk bar are visible --- this is fine and standard (Gmail, GitHub, etc.).

---

## Current State

### Table Primitives (`ui/Table/`)

Seven thin compound components, all following the same pattern:
- Accept `children: Snippet` and `class: className` via `$props()`
- Spread `...restProps` onto the native HTML element
- Apply minimal scoped CSS (borders, padding, font-size, transitions)
- Export both full names and short aliases (`Table.Root`, `Table.Row`, etc.)

Key observations:
- `Table.svelte` wraps the `<table>` in a `div.table-container` with `overflow: auto` --- this is the scroll container for horizontal overflow and sticky header scope.
- `TableRow.svelte` already has `data-state="selected"` styling (background highlight on hover and selected).
- `TableHead.svelte` has `color: var(--color-text-secondary)` and `font-weight: var(--font-medium)` --- the sort indicator will need to integrate with this styling.
- `TableCell.svelte` uses `padding: var(--space-4)` and `vertical-align: middle`.
- No component carries any state or behaviour.

### Studio Tables

| Component | Uses Table primitives? | Has sort? | Has selection? | Has bulk actions? | Has loading state? | Custom features |
|---|---|---|---|---|---|---|
| **ContentTable** | No (raw HTML) | No | No | No | No | Inline publish toggle, status dot, type badge, colgroup widths |
| **CustomerTable** | Yes | No | No | No | No | GBP price formatting, `:global()` cell styles |
| **MemberTable** | Yes | No | No | No | Yes (ad-hoc skeleton divs) | Avatar + initials, role badge, role change Select, remove button with confirm |
| **TopContentTable** | Yes | No | No | No | Yes (ad-hoc skeleton divs) | Rank column, GBP revenue formatting |
| **MediaGrid** | N/A (grid, not table) | No | No | No | No | Card-based layout, edit/delete callbacks |

### What Does Not Exist Yet

- No sort state management or sort URL sync
- No row selection state management
- No bulk action bar component
- No column visibility toggle component
- No skeleton row generator (each table hand-rolls its own)
- No sticky header behaviour
- No shared responsive strategy beyond `overflow-x: auto`

---

## Design Spec

### Architecture Decision

**Recommendation: Create a new DataTable wrapper component that composes the existing Table primitives internally. Do NOT modify the existing Table primitives.**

Rationale:

1. **Backward compatibility.** Pages that use Table primitives directly (or might in the future) should continue to work unchanged. Adding sort/select state into `TableHead.svelte` would break the pure-presentational contract.

2. **Single responsibility.** The Table primitives own layout and styling. The DataTable owns behaviour (sort, select, bulk actions, column visibility). These are separate concerns.

3. **Configuration-driven.** The DataTable accepts a typed column definition array and a data array. It renders the Table primitives internally based on the column config. This eliminates the manual `<Table.Header><Table.Row><Table.Head>Title</Table.Head>...` boilerplate that every studio table currently writes.

4. **Snippet-based cell rendering.** Each column definition accepts an optional `cell` snippet for custom rendering (badges, links, action buttons). This preserves the flexibility that ContentTable needs for its publish toggle and MemberTable needs for its avatar + role dropdown.

5. **Opt-in features.** Sort, select, bulk actions, column visibility, and sticky header are all independently toggleable via props. A simple read-only table can use DataTable with none of these enabled and get the same output as using Table primitives directly, plus free loading skeletons and empty state.

The alternative (enhancing Table primitives with optional props) was rejected because it would turn simple presentational components into complex stateful ones, and every consumer would pay the cognitive cost of understanding optional interactive features even when they just want a styled table.

### Component Hierarchy

```
DataTable                        (orchestrator: config, state, feature toggles)
  DataTableToolbar               (column visibility toggle, future: density toggle)
  Table.Root                     (existing primitive)
    Table.Header                 (existing primitive, gets position: sticky)
      Table.Row                  (existing primitive)
        DataTableSelectAll       (checkbox in header, select/deselect all visible rows)
        DataTableSortHead        (sortable th: click to toggle, arrow indicator)
        Table.Head               (existing primitive, for non-sortable columns)
    Table.Body                   (existing primitive)
      DataTableSkeletonRows      (loading state: N skeleton rows matching column count)
      Table.Row                  (existing primitive, gets data-state="selected")
        DataTableSelectRow       (checkbox cell for row selection)
        Table.Cell               (existing primitive, renders column cell snippet or default)
  DataTableBulkBar               (sticky bar above table when items selected)
  EmptyState                     (existing primitive, when items array is empty)
```

### Column Definition Type

```typescript
interface DataTableColumn<T> {
  /** Unique key for this column, used for sort params and visibility persistence */
  id: string;
  /** Display header text */
  header: string;
  /** Accessor function to extract the cell value from a row item */
  accessor?: (row: T) => string | number | null;
  /** Custom cell renderer snippet. Receives the row item. */
  cell?: Snippet<[T]>;
  /** Whether this column is sortable. Default: false */
  sortable?: boolean;
  /** The URL param value to use for sorting (defaults to id) */
  sortKey?: string;
  /** Whether this column is visible by default. Default: true */
  defaultVisible?: boolean;
  /** Whether this column can be hidden via the visibility toggle. Default: true */
  hideable?: boolean;
  /** CSS text-align for header and cells. Default: 'left' */
  align?: 'left' | 'center' | 'right';
  /** Optional fixed width (CSS value). Uses design tokens. */
  width?: string;
  /** Optional CSS class to apply to all cells in this column */
  class?: string;
}
```

### DataTable Props

```typescript
interface DataTableProps<T> {
  /** Column definitions */
  columns: DataTableColumn<T>[];
  /** Data rows */
  items: T[];
  /** Unique key extractor for each row (used for selection tracking and {#each} keying) */
  getRowKey: (row: T) => string;

  // --- Feature toggles ---
  /** Enable row selection checkboxes. Default: false */
  selectable?: boolean;
  /** Enable the column visibility toggle in the toolbar. Default: false */
  columnToggle?: boolean;
  /** Enable sticky header within the scroll container. Default: true */
  stickyHeader?: boolean;
  /** Show skeleton loading rows. Default: false */
  loading?: boolean;
  /** Number of skeleton rows to show when loading. Default: 5 */
  skeletonRows?: number;

  // --- Sort ---
  /** Current sort column id (read from URL param, typically) */
  sortBy?: string;
  /** Current sort direction */
  sortOrder?: 'asc' | 'desc';
  /** Callback when a sortable header is clicked. Receives column id and new direction. */
  onSort?: (columnId: string, order: 'asc' | 'desc') => void;

  // --- Selection ---
  /** Callback when selection changes. Receives array of selected row keys. */
  onSelectionChange?: (selectedKeys: string[]) => void;

  // --- Bulk actions ---
  /** Snippet for rendering bulk action buttons. Receives selected keys and a clear function. */
  bulkActions?: Snippet<[{ selectedKeys: string[]; clearSelection: () => void }]>;

  // --- Empty state ---
  /** Title for the empty state when items is empty */
  emptyTitle?: string;
  /** Icon component for the empty state */
  emptyIcon?: Component;

  // --- Table-level persistence key ---
  /** Unique key for localStorage persistence (column visibility). e.g., 'content', 'customers' */
  persistKey?: string;

  // --- Styling ---
  /** Additional class on the outer wrapper */
  class?: string;
}
```

### Sortable Headers

**Behaviour:**
1. Click a sortable column header to sort ascending by that column.
2. Click the same header again to toggle to descending.
3. Click a third time to remove sort (return to default order) --- OR stay in asc/desc toggle. Recommendation: two-state toggle (asc/desc) is simpler and matches user expectation from spreadsheets. Three-state (asc/desc/none) is confusing.
4. Only one column can be sorted at a time (single-column sort).

**URL param sync:**
- The DataTable does NOT call `goto()` directly. It calls the `onSort(columnId, order)` callback.
- The parent page's `onSort` handler writes URL params and calls `goto()`, following the same pattern as FilterBar (spec #14).
- This keeps the DataTable decoupled from SvelteKit routing.
- The parent passes `sortBy` and `sortOrder` props (read from `page.url.searchParams` in the page component).

**Visual indicator:**
- Sortable headers show a subtle chevron icon (up for asc, down for desc) next to the header text.
- Inactive sortable headers show a faded up/down combined icon to indicate they are interactive.
- The header text gets `cursor: pointer` and a hover highlight.
- Active sort header text gets `color: var(--color-text)` (promoted from the default `--color-text-secondary`).

**`DataTableSortHead` component:**
```svelte
<!-- Internal component, not exported publicly -->
<Table.Head
  class="sortable-head {active ? 'sort-active' : ''}"
  onclick={handleClick}
  aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
  role="columnheader"
  style="cursor: pointer;"
>
  <span class="sort-header-content">
    {header}
    <span class="sort-indicator" aria-hidden="true">
      {#if active && order === 'asc'}
        <ChevronUpIcon />
      {:else if active && order === 'desc'}
        <ChevronDownIcon />
      {:else}
        <ChevronsUpDownIcon />
      {/if}
    </span>
  </span>
</Table.Head>
```

### Row Selection

**State management:**
- DataTable maintains a `Set<string>` of selected row keys internally via `$state`.
- The `getRowKey(row)` function extracts the unique identifier (e.g., `item.id`, `member.userId`).
- Selection state is ephemeral --- it does not persist to localStorage or URL params. Navigating away clears selection.

**Select-all checkbox (header):**
- Unchecked when no rows are selected.
- Checked when ALL visible rows on the current page are selected.
- Indeterminate when SOME visible rows are selected.
- Clicking when unchecked or indeterminate selects all visible rows.
- Clicking when checked deselects all rows.

**Row checkbox (body):**
- Standard checkbox toggle per row.
- Clicking the checkbox toggles that single row's selection.
- Shift+click for range select is a Phase 2 enhancement (not in scope for initial implementation).

**Selected row highlighting:**
- Selected rows get `data-state="selected"` on the `<Table.Row>`, which already applies `background-color: var(--color-surface-secondary)`.

**Accessibility:**
- Checkbox column header has `aria-label="Select all rows"`.
- Each row checkbox has `aria-label="Select row {title or key}"`.

### Bulk Action Bar

**Layout:**
- A sticky bar that appears above the table (between toolbar and table) when 1+ rows are selected.
- Uses `position: sticky` with `top: 0` and `z-index: var(--z-sticky)`.
- Background: `var(--color-surface-raised)` with `border: var(--border-width) var(--border-style) var(--color-border)` and `border-radius: var(--radius-lg)`.
- Left side: selected count text ("3 items selected").
- Right side: action buttons rendered via the `bulkActions` snippet prop.

**Snippet-based actions:**
- The DataTable does NOT define what actions are available. Each page provides its own `bulkActions` snippet.
- The snippet receives `{ selectedKeys: string[], clearSelection: () => void }`.
- This allows ContentTable to show "Publish / Unpublish / Archive / Delete", while MemberTable could show "Change Role / Remove".

**Example usage in a page:**
```svelte
<DataTable
  {columns}
  {items}
  getRowKey={(item) => item.id}
  selectable
>
  {#snippet bulkActions({ selectedKeys, clearSelection })}
    <Button
      variant="primary"
      size="sm"
      onclick={() => handleBulkPublish(selectedKeys, clearSelection)}
    >
      Publish ({selectedKeys.length})
    </Button>
    <Button
      variant="destructive"
      size="sm"
      onclick={() => handleBulkDelete(selectedKeys, clearSelection)}
    >
      Delete ({selectedKeys.length})
    </Button>
  {/snippet}
</DataTable>
```

**Destructive action confirmation:**
- Pages are responsible for showing confirmation dialogs before executing destructive bulk actions.
- The recommended pattern: the page's `handleBulkDelete` function opens a Dialog, waits for confirmation, then executes the API calls, then calls `clearSelection()`.
- DataTable itself has no opinion on confirmation --- it just provides the selection state and clear function.

**Error handling for bulk operations:**
- The page handler should iterate over selected keys, call the API for each, collect successes and failures, show a summary toast ("Published 5 items. 2 failed."), and only clear selection for successful items.
- This is page-level logic, not DataTable logic.

### Column Visibility

**Toggle UI:**
- A button in the DataTable toolbar (above the table, right-aligned) that opens a DropdownMenu.
- Trigger button: icon-only button with a columns/sliders icon, tooltip "Toggle columns".
- Dropdown content: one `DropdownMenuItem` per hideable column, each with a Checkbox showing the column's header text.
- Clicking a menu item toggles that column's visibility without closing the dropdown.
- Columns with `hideable: false` do not appear in the dropdown (e.g., the selection checkbox column, the actions column).

**State management:**
- Visibility state is a `Map<string, boolean>` or `Record<string, boolean>` stored in `$state`.
- Initial state comes from column definitions (`defaultVisible`).
- If `persistKey` is provided, visibility state is persisted to localStorage under the key `codex-datatable-columns:{persistKey}`.
- On mount, the component reads localStorage and merges with column defaults (new columns default to visible even if not in localStorage).

**Column hiding mechanics:**
- Hidden columns are excluded from rendering in both `<thead>` and `<tbody>`.
- The skeleton loading rows also respect column visibility (hidden columns get no skeleton cell).

### Sticky Header

**Approach:**
- Apply `position: sticky; top: 0; z-index: var(--z-sticky)` to the `<thead>` element.
- The sticky context is the `.table-container` div in `Table.svelte` (which has `overflow: auto`).
- The header sticks to the top of the scroll container, NOT the viewport. This means it only sticks when the table itself is scrollable vertically within its container.
- Background colour on `<thead>` must be opaque (`var(--color-surface)`) to prevent body rows from showing through.

**Implementation:**
- The DataTable passes a `sticky` class to `Table.Header` via the `class` prop.
- The sticky CSS is defined in DataTable's scoped styles using `:global(.sticky)` to target the `<thead>`.

**Gotcha:**
- `position: sticky` on `<thead>` is well-supported in modern browsers (Chrome 91+, Firefox 59+, Safari 15+). Older Safari versions require it on individual `<th>` elements. Since the platform targets modern browsers (Cloudflare Workers consumers), `<thead>` sticky is acceptable.

### Loading State

**Skeleton rows:**
- When `loading` is true, the DataTable renders `skeletonRows` count (default 5) of skeleton rows instead of data rows.
- Each skeleton row renders one `Skeleton` component per visible column.
- The skeleton width varies by column to look realistic: text columns get `width: 60-80%`, number columns get `width: 40%`, badge columns get `width: var(--space-16)`, date columns get `width: var(--space-20)`.
- The checkbox column (if `selectable`) renders a disabled Skeleton square matching checkbox dimensions.

**`DataTableSkeletonRows` component:**
```svelte
<!-- Internal component -->
{#each Array(count) as _, i}
  <Table.Row>
    {#if selectable}
      <Table.Cell>
        <Skeleton width="var(--space-5)" height="var(--space-5)" />
      </Table.Cell>
    {/if}
    {#each visibleColumns as column}
      <Table.Cell>
        <Skeleton
          width={column.align === 'right' ? '40%' : '70%'}
          height="var(--text-sm)"
        />
      </Table.Cell>
    {/each}
  </Table.Row>
{/each}
```

**Interaction during loading:**
- Sort headers are non-interactive (no click handler, no pointer cursor).
- Select-all checkbox is hidden or disabled.
- Bulk action bar is hidden.
- Column visibility toggle remains functional (so users can configure columns while data loads).

### Responsive Behaviour

**Phase 1: Horizontal scroll (default).**
- The existing `Table.svelte` already wraps the table in `div.table-container` with `overflow: auto`. This provides horizontal scroll on narrow viewports.
- The DataTable adds `min-width` to the table to prevent columns from being crushed below usable width. The min-width is calculated as the sum of column widths (or a sensible default like `min-width: 600px`).
- On mobile, the bulk action bar becomes full-width and vertically stacks the count text and action buttons.

**Phase 2 (future): Card collapse mode.**
- An opt-in `responsiveMode: 'scroll' | 'cards'` prop.
- In card mode, below `--breakpoint-sm`, each row renders as a card with label-value pairs instead of table cells.
- This requires a secondary render path and is intentionally deferred.

**The toolbar and bulk action bar are always full-width and do not scroll with the table.**

---

## Implementation Plan

### Files to Create

| File | Purpose |
|---|---|
| `apps/web/src/lib/components/ui/DataTable/DataTable.svelte` | Main orchestrator component |
| `apps/web/src/lib/components/ui/DataTable/DataTableSortHead.svelte` | Sortable header cell with arrow indicator |
| `apps/web/src/lib/components/ui/DataTable/DataTableToolbar.svelte` | Toolbar with column visibility toggle |
| `apps/web/src/lib/components/ui/DataTable/DataTableBulkBar.svelte` | Sticky selection action bar |
| `apps/web/src/lib/components/ui/DataTable/DataTableSkeletonRows.svelte` | Loading skeleton row generator |
| `apps/web/src/lib/components/ui/DataTable/types.ts` | `DataTableColumn<T>` and `DataTableProps<T>` type definitions |
| `apps/web/src/lib/components/ui/DataTable/column-visibility.ts` | localStorage read/write for column visibility state |
| `apps/web/src/lib/components/ui/DataTable/index.ts` | Barrel export |
| `apps/web/src/lib/components/ui/DataTable/DataTable.stories.svelte` | Storybook stories |

### Files to Modify

| File | Changes |
|---|---|
| `apps/web/src/lib/components/ui/Table/Table.svelte` | No changes needed. DataTable composes it as-is. |
| `apps/web/src/lib/components/ui/Table/TableHeader.svelte` | No changes needed. Sticky class applied via `class` prop from DataTable. |
| `apps/web/src/lib/components/studio/ContentTable.svelte` | Rewrite to use DataTable. Move publish toggle into a `cell` snippet. Remove all custom table markup and styling. |
| `apps/web/src/lib/components/studio/CustomerTable.svelte` | Rewrite to use DataTable. Move cell formatting into `cell` snippets or `accessor` functions. Remove `:global()` styles. |
| `apps/web/src/lib/components/studio/MemberTable.svelte` | Rewrite to use DataTable. Move avatar/role/actions into `cell` snippets. Remove ad-hoc skeleton. |
| `apps/web/src/lib/components/studio/TopContentTable.svelte` | Rewrite to use DataTable. Move rank/revenue formatting into `cell` snippets or `accessor` functions. Remove ad-hoc skeleton. |
| `apps/web/src/routes/_org/[slug]/studio/content/+page.svelte` | Add `onSort` handler with URL param sync. Add bulk action handlers (publish, archive, delete). Pass `sortBy`/`sortOrder` from URL params. |
| `apps/web/src/routes/_org/[slug]/studio/content/+page.server.ts` | Read `sort` and `order` URL params. Pass to content API call. |
| `apps/web/src/routes/_org/[slug]/studio/customers/+page.svelte` | Add `onSort` handler for customer table. |
| `apps/web/src/routes/_org/[slug]/studio/customers/+page.server.ts` | Read `sort` and `order` URL params. Pass to API. |
| `apps/web/src/lib/components/ui/Icon/index.ts` | Export `ChevronUpIcon`, `ChevronDownIcon`, `ChevronsUpDownIcon`, and a columns/settings icon if not already exported. |

### Migration Strategy

The migration happens in four phases. Each phase is independently deployable and does not break existing functionality.

**Phase 1: Core DataTable component (no migration)**

Build the DataTable component, its sub-components, types, and Storybook stories. At this point, no studio table uses it yet. The DataTable is validated purely through Storybook with mock data.

Deliverables:
- `DataTable.svelte` with column config, data rendering, loading skeletons, empty state
- `DataTableSortHead.svelte` with sort toggle and visual indicator
- `DataTableToolbar.svelte` with column visibility dropdown
- `DataTableBulkBar.svelte` with selected count and snippet slot
- `DataTableSkeletonRows.svelte`
- `types.ts`, `column-visibility.ts`, `index.ts`
- Storybook stories covering: basic table, sortable headers, selectable rows, bulk actions, loading state, column toggle, empty state

**Phase 2: Migrate read-only tables (low risk)**

Migrate TopContentTable and CustomerTable to use DataTable. These are the simplest --- no inline mutations, no complex cell rendering.

- TopContentTable: 4 columns (rank, title, revenue, purchases), loading prop, no sort/select.
- CustomerTable: 5 columns (name, email, purchases, spent, joined), no interactions.
- Both tables keep their existing props interface. The internal implementation switches from manual Table primitives to DataTable config.
- Test: verify visual parity with current rendering.

**Phase 3: Migrate interactive tables (medium risk)**

Migrate MemberTable and ContentTable. These have inline interactions that must be preserved.

- MemberTable: avatar cell snippet, role badge cell, role change Select cell, remove button cell. The `onChangeRole` and `onRemove` callbacks thread through cell snippets.
- ContentTable: publish toggle cell snippet (using existing `publish-toggle.ts`), status dot cell, title link cell. The `statusOverrides` and `togglingId` state remain in the page component or ContentTable wrapper.

For ContentTable specifically:
1. Replace raw `<table>` markup with DataTable.
2. Define columns: title (sortable), type, status (sortable), created (sortable), actions.
3. Move publish toggle into the actions column `cell` snippet.
4. Add `selectable` and `bulkActions` snippet with publish/archive/delete buttons.
5. Wire `onSort` to URL param sync in the studio content page.
6. Wire `+page.server.ts` to read sort params and pass to content API.

**Phase 4: Enable advanced features**

Turn on features incrementally across migrated tables:
1. Enable `selectable` + `bulkActions` on ContentTable (publish/archive/delete selected).
2. Enable `sortable` columns on ContentTable (title, status, created, type).
3. Enable `sortable` columns on CustomerTable (name, purchases, spent, joined).
4. Enable `columnToggle` on ContentTable and CustomerTable.
5. Add `stickyHeader` to all tables (enabled by default).

**Optional Phase 5: MediaGrid table view toggle**

Add a view toggle (grid/table) to the Studio Media page. When table view is selected, render media items in a DataTable with columns: thumbnail, filename, type, status, duration, created. The grid view remains the default.

---

## Testing Notes

### Storybook Coverage (Phase 1)

- **Basic rendering**: Verify columns render in correct order, cell content matches accessor output, custom cell snippets render correctly.
- **Sort interaction**: Click sortable header, verify `onSort` callback fires with correct column id and direction. Verify visual indicator changes. Verify non-sortable headers are not clickable.
- **Selection**: Check/uncheck individual rows, verify `onSelectionChange` fires with correct keys. Check select-all, verify all visible rows selected. Verify indeterminate state when partial selection. Verify `data-state="selected"` attribute on selected rows.
- **Bulk action bar**: Verify bar appears when 1+ rows selected. Verify selected count text. Verify `clearSelection` callback clears all selections and hides bar.
- **Column visibility**: Toggle column off, verify header and cells for that column disappear. Toggle back on, verify they reappear. Verify non-hideable columns are not in the dropdown.
- **Loading state**: Set `loading={true}`, verify skeleton rows render with correct column count. Verify sort/select are disabled during loading.
- **Empty state**: Pass empty `items` array, verify EmptyState renders with provided title and icon.
- **Sticky header**: Scroll a tall table, verify header stays visible at top of scroll container.

### Integration Testing (Phases 2-4)

- **Visual parity**: After migration, each table must look identical to its pre-migration rendering (same column widths, same cell formatting, same badges/dots/links).
- **URL param sync**: Navigate to studio content page with `?sort=title&order=desc`, verify DataTable shows correct sort indicator. Click a different column header, verify URL updates and page re-renders with new sort.
- **Bulk publish**: Select 3 content items, click "Publish", verify all 3 items update status, verify toast shows success, verify selection clears.
- **Bulk delete**: Select 2 items, click "Delete", verify confirmation dialog appears, confirm, verify items are soft-deleted, verify toast.
- **Partial failure**: Simulate one API call failing in a bulk operation, verify toast shows "Published 2 items. 1 failed.", verify failed item remains selected.
- **Column persistence**: Hide a column, navigate away, return to page, verify column is still hidden. Verify different tables have independent persistence.
- **Keyboard accessibility**: Tab through sortable headers, verify Enter/Space triggers sort. Tab through checkboxes, verify Space toggles selection. Verify `aria-sort` attribute updates correctly.

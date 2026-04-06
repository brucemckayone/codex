<!--
  @component DataTable

  Enhanced data table with sortable columns, row selection, and bulk actions.
  Wraps the existing Table compound components with added functionality.

  @prop {ColumnDef[]} columns - Column definitions with sort, visibility, width
  @prop {T[]} data - Array of row data
  @prop {string} sortKey - Current sort column key
  @prop {'asc' | 'desc'} sortOrder - Current sort direction
  @prop {(key: string, order: 'asc' | 'desc') => void} onSort - Sort change handler
  @prop {boolean} selectable - Enable row selection with checkboxes
  @prop {Snippet<[Set<string>]>} bulkActions - Snippet rendering bulk action buttons
-->
<script lang="ts" generics="T extends Record<string, unknown>">
  import type { Snippet } from 'svelte';
  import { ChevronDownIcon, ChevronUpIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';

  interface ColumnDef {
    key: string;
    label: string;
    sortable?: boolean;
    width?: string;
    align?: 'left' | 'center' | 'right';
    hidden?: boolean;
  }

  interface Props {
    columns: ColumnDef[];
    data: T[];
    sortKey?: string;
    sortOrder?: 'asc' | 'desc';
    onSort?: (key: string, order: 'asc' | 'desc') => void;
    selectable?: boolean;
    getRowId?: (row: T) => string;
    renderCell: Snippet<[T, ColumnDef]>;
    bulkActions?: Snippet<[Set<string>]>;
    class?: string;
  }

  const {
    columns,
    data,
    sortKey,
    sortOrder = 'asc',
    onSort,
    selectable = false,
    getRowId = (row) => String(row.id ?? ''),
    renderCell,
    bulkActions,
    class: className,
  }: Props = $props();

  let selectedIds = $state(new Set<string>());

  const visibleColumns = $derived(columns.filter(c => !c.hidden));
  const allRowIds = $derived(new Set(data.map(getRowId)));
  const allSelected = $derived(
    data.length > 0 && allRowIds.size === selectedIds.size && [...allRowIds].every(id => selectedIds.has(id))
  );
  const someSelected = $derived(selectedIds.size > 0 && !allSelected);

  function toggleAll() {
    if (allSelected) {
      selectedIds = new Set();
    } else {
      selectedIds = new Set(allRowIds);
    }
  }

  function toggleRow(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selectedIds = next;
  }

  function handleSort(key: string) {
    if (!onSort) return;
    const newOrder = sortKey === key && sortOrder === 'asc' ? 'desc' : 'asc';
    onSort(key, newOrder);
  }
</script>

<div class="data-table {className ?? ''}">
  {#if selectable && selectedIds.size > 0 && bulkActions}
    <div class="data-table__bulk-bar">
      <span class="data-table__bulk-count">
        {m.table_selected_count({ selected: String(selectedIds.size), total: String(data.length) })}
      </span>
      {@render bulkActions(selectedIds)}
    </div>
  {/if}

  <div class="data-table__container">
    <table class="data-table__table">
      <thead>
        <tr>
          {#if selectable}
            <th class="data-table__th data-table__th--checkbox">
              <input
                type="checkbox"
                checked={allSelected}
                indeterminate={someSelected}
                onchange={toggleAll}
                aria-label={m.table_select_all()}
              />
            </th>
          {/if}
          {#each visibleColumns as col (col.key)}
            <th
              class="data-table__th"
              class:data-table__th--sortable={col.sortable}
              style:width={col.width}
              style:text-align={col.align ?? 'left'}
            >
              {#if col.sortable && onSort}
                <button
                  class="data-table__sort-btn"
                  onclick={() => handleSort(col.key)}
                  aria-sort={sortKey === col.key ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  {col.label}
                  {#if sortKey === col.key}
                    {#if sortOrder === 'asc'}
                      <ChevronUpIcon size={14} />
                    {:else}
                      <ChevronDownIcon size={14} />
                    {/if}
                  {/if}
                </button>
              {:else}
                {col.label}
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each data as row (getRowId(row))}
          {@const rowId = getRowId(row)}
          <tr
            class="data-table__row"
            data-state={selectedIds.has(rowId) ? 'selected' : undefined}
          >
            {#if selectable}
              <td class="data-table__td data-table__td--checkbox">
                <input
                  type="checkbox"
                  checked={selectedIds.has(rowId)}
                  onchange={() => toggleRow(rowId)}
                  aria-label={m.table_select_row()}
                />
              </td>
            {/if}
            {#each visibleColumns as col (col.key)}
              <td class="data-table__td" style:text-align={col.align ?? 'left'}>
                {@render renderCell(row, col)}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .data-table {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .data-table__container {
    overflow-x: auto;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
  }

  .data-table__table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  .data-table__th {
    padding: var(--space-3) var(--space-4);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    background: var(--color-surface-secondary);
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .data-table__th--checkbox {
    width: var(--space-10);
    text-align: center;
  }

  .data-table__sort-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .data-table__sort-btn:hover {
    color: var(--color-text);
  }

  .data-table__row {
    transition: var(--transition-colors);
  }

  .data-table__row:hover {
    background: var(--color-surface-secondary);
  }

  .data-table__row[data-state='selected'] {
    background: var(--color-interactive-subtle);
  }

  .data-table__td {
    padding: var(--space-3) var(--space-4);
    color: var(--color-text);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .data-table__td--checkbox {
    text-align: center;
  }

  /* Bulk action bar */
  .data-table__bulk-bar {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    background: var(--color-interactive-subtle);
    border: var(--border-width) var(--border-style) var(--color-interactive);
    border-radius: var(--radius-md);
  }

  .data-table__bulk-count {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
  }

  /* Checkbox styling */
  input[type='checkbox'] {
    width: var(--space-4);
    height: var(--space-4);
    accent-color: var(--color-interactive);
    cursor: pointer;
  }
</style>

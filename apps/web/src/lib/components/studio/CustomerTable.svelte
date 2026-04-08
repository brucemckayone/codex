<!--
  @component CustomerTable

  Wraps DataTable for the studio customers management page.
  Shows name (with avatar + clickable link), email, purchases, total spent, and joined date.
  Supports sortable columns, row selection, and bulk actions via DataTable.

  @prop {CustomerListItem[]} customers - Array of customer items to display
  @prop {(customerId: string) => void} [onCustomerClick] - Callback when a customer name is clicked
  @prop {string} [sortKey] - Current sort column key
  @prop {'asc' | 'desc'} [sortOrder] - Current sort direction
  @prop {(key: string, order: 'asc' | 'desc') => void} [onSort] - Sort change handler
  @prop {boolean} [selectable] - Enable row selection with checkboxes
  @prop {Snippet<[Set<string>]>} [bulkActions] - Bulk action buttons snippet
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { CustomerListItem } from '@codex/shared-types';
  import DataTable from '$lib/components/ui/DataTable/DataTable.svelte';
  import { UsersIcon, EyeIcon } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import { formatDate, formatPrice, formatRelativeTime, getInitials } from '$lib/utils/format';
  import * as m from '$paraglide/messages';

  interface Props {
    customers: CustomerListItem[];
    onCustomerClick?: (customerId: string) => void;
    onCopyEmail?: (email: string) => void;
    sortKey?: string;
    sortOrder?: 'asc' | 'desc';
    onSort?: (key: string, order: 'asc' | 'desc') => void;
    selectable?: boolean;
    bulkActions?: Snippet<[Set<string>]>;
  }

  const {
    customers,
    onCustomerClick,
    onCopyEmail,
    sortKey,
    sortOrder = 'asc',
    onSort,
    selectable = false,
    bulkActions,
  }: Props = $props();

  const isEmpty = $derived(customers.length === 0);

  const columns = [
    { key: 'name', label: m.studio_customers_col_name(), sortable: true },
    { key: 'email', label: m.studio_customers_col_email() },
    { key: 'totalPurchases', label: m.studio_customers_col_purchases(), sortable: true, align: 'right' as const },
    { key: 'totalSpentCents', label: m.studio_customers_col_spent(), sortable: true, align: 'right' as const },
    { key: 'createdAt', label: m.studio_customers_col_joined(), sortable: true },
    { key: 'actions', label: m.studio_customers_col_actions(), align: 'right' as const },
  ];
</script>

{#if isEmpty}
  <EmptyState title={m.studio_customers_empty()} icon={UsersIcon} />
{:else}
  <DataTable
    {columns}
    data={customers}
    {sortKey}
    {sortOrder}
    {onSort}
    {selectable}
    {bulkActions}
    getRowId={(row) => row.userId}
  >
    {#snippet renderCell(row: CustomerListItem, col: { key: string })}
      {#if col.key === 'name'}
        <button
          class="customer-name-btn"
          onclick={() => onCustomerClick?.(row.userId)}
          aria-label={m.studio_customers_view_details({ name: row.name ?? row.email })}
        >
          <span class="table-avatar" aria-hidden="true">{getInitials(row.name)}</span>
          <span class="customer-name-text">{row.name ?? '--'}</span>
        </button>
      {:else if col.key === 'email'}
        <span class="email-text">{row.email}</span>
      {:else if col.key === 'totalPurchases'}
        <span class="numeric-text">{row.totalPurchases}</span>
      {:else if col.key === 'totalSpentCents'}
        <span class="numeric-text numeric-text--bold">{formatPrice(row.totalSpentCents)}</span>
      {:else if col.key === 'createdAt'}
        <span class="date-text" title={formatDate(row.createdAt)}>
          {formatRelativeTime(row.createdAt)}
        </span>
      {:else if col.key === 'actions'}
        <span class="row-actions">
          <button
            class="row-action-btn"
            onclick={(e) => { e.stopPropagation(); onCopyEmail?.(row.email); }}
            aria-label={m.studio_customers_action_copy_email()}
            title={m.studio_customers_action_copy_email()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          <button
            class="row-action-btn"
            onclick={(e) => { e.stopPropagation(); onCustomerClick?.(row.userId); }}
            aria-label={m.studio_customers_action_view_details()}
            title={m.studio_customers_action_view_details()}
          >
            <EyeIcon size={14} />
          </button>
        </span>
      {/if}
    {/snippet}
  </DataTable>
{/if}

<style>
  .customer-name-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font: inherit;
    color: var(--color-text);
    font-weight: var(--font-medium);
    transition: var(--transition-colors);
  }

  .customer-name-btn:hover {
    color: var(--color-interactive);
  }

  .customer-name-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  .table-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-7);
    height: var(--space-7);
    border-radius: var(--radius-full, 9999px);
    background-color: var(--color-interactive-subtle);
    color: var(--color-interactive);
    font-weight: var(--font-bold);
    font-size: var(--text-xs);
    flex-shrink: 0;
  }

  .customer-name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .email-text {
    color: var(--color-text-secondary);
  }

  .numeric-text {
    font-variant-numeric: tabular-nums;
  }

  .numeric-text--bold {
    font-weight: var(--font-medium);
  }

  .date-text {
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .row-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .row-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-1);
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: var(--transition-colors);
  }

  .row-action-btn:hover {
    color: var(--color-interactive);
    background-color: var(--color-interactive-subtle);
  }

  .row-action-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 1px;
  }
</style>

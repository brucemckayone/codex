<!--
  @component TopContentTable

  Displays a ranked table of top-performing content by revenue.
  Columns: Rank, Title, Revenue (formatted GBP), Purchases.

  Migrated to DataTable to validate the shared component pattern.
  DataTable provides consistent table chrome (border, hover, header styles)
  while renderCell handles domain-specific formatting.

  @prop {{ contentTitle: string; revenueCents: number; purchaseCount: number }[]} items - Content items
  @prop {boolean} loading - Whether the data is loading
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import DataTable from '$lib/components/ui/DataTable/DataTable.svelte';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import { formatPrice } from '$lib/utils/format';
  import * as m from '$paraglide/messages';

  interface TopContentItem {
    contentTitle: string;
    revenueCents: number;
    purchaseCount: number;
    [key: string]: unknown;
  }

  interface Props {
    items: TopContentItem[];
    loading?: boolean;
  }

  const { items, loading = false }: Props = $props();

  const isEmpty = $derived(items.length === 0);

  const columns = $derived([
    { key: 'rank', label: m.analytics_col_rank(), width: '48px' },
    { key: 'contentTitle', label: m.analytics_col_title() },
    { key: 'revenueCents', label: m.analytics_col_revenue(), align: 'right' as const },
    { key: 'purchaseCount', label: m.analytics_col_purchases(), align: 'right' as const },
  ]);
</script>

{#snippet renderCell(row: TopContentItem, col: { key: string })}
  {#if col.key === 'rank'}
    <span class="rank-cell">{items.indexOf(row) + 1}</span>
  {:else if col.key === 'contentTitle'}
    <span class="title-cell">{row.contentTitle}</span>
  {:else if col.key === 'revenueCents'}
    <span class="revenue-cell">{formatPrice(row.revenueCents)}</span>
  {:else if col.key === 'purchaseCount'}
    <span class="purchases-cell">{row.purchaseCount}</span>
  {/if}
{/snippet}

{#if loading}
  <div class="loading-state">
    <div class="skeleton-row"></div>
    <div class="skeleton-row"></div>
    <div class="skeleton-row"></div>
    <div class="skeleton-row"></div>
    <div class="skeleton-row"></div>
  </div>
{:else if isEmpty}
  <EmptyState title={m.analytics_empty()} />
{:else}
  <DataTable
    {columns}
    data={items}
    getRowId={(row) => row.contentTitle}
    {renderCell}
    class="top-content-table"
  />
{/if}

<style>
  .loading-state {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
  }

  .skeleton-row {
    height: 40px;
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .rank-cell {
    color: var(--color-text-secondary);
    font-weight: var(--font-semibold);
    font-variant-numeric: tabular-nums;
  }

  .title-cell {
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .revenue-cell {
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .purchases-cell {
    font-variant-numeric: tabular-nums;
    color: var(--color-text-secondary);
  }
</style>

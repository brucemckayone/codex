<!--
  @component TopContentTable

  Displays a ranked table of top-performing content by revenue.
  Columns: Rank, Title, Revenue (formatted GBP), Purchases.

  @prop {{ contentTitle: string; revenueCents: number; purchaseCount: number }[]} items - Content items
  @prop {boolean} loading - Whether the data is loading
-->
<script lang="ts">
  import * as Table from '$lib/components/ui/Table';
  import * as m from '$paraglide/messages';

  interface TopContentItem {
    contentTitle: string;
    revenueCents: number;
    purchaseCount: number;
  }

  interface Props {
    items: TopContentItem[];
    loading?: boolean;
  }

  const { items, loading = false }: Props = $props();

  const isEmpty = $derived(items.length === 0);

  /**
   * Format cents to currency string (GBP)
   */
  function formatRevenue(cents: number): string {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  }
</script>

{#if loading}
  <div class="loading-state">
    <div class="skeleton-row"></div>
    <div class="skeleton-row"></div>
    <div class="skeleton-row"></div>
    <div class="skeleton-row"></div>
    <div class="skeleton-row"></div>
  </div>
{:else if isEmpty}
  <div class="empty-state">
    <p class="empty-text">{m.analytics_empty()}</p>
  </div>
{:else}
  <div class="table-wrapper">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head class="rank-col">{m.analytics_col_rank()}</Table.Head>
          <Table.Head>{m.analytics_col_title()}</Table.Head>
          <Table.Head class="number-col">{m.analytics_col_revenue()}</Table.Head>
          <Table.Head class="number-col">{m.analytics_col_purchases()}</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each items as item, index (index)}
          <Table.Row>
            <Table.Cell class="rank-cell">
              {index + 1}
            </Table.Cell>
            <Table.Cell class="title-cell">
              {item.contentTitle}
            </Table.Cell>
            <Table.Cell class="revenue-cell">
              {formatRevenue(item.revenueCents)}
            </Table.Cell>
            <Table.Cell class="purchases-cell">
              {item.purchaseCount}
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
{/if}

<style>
  .table-wrapper {
    overflow-x: auto;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-8) var(--space-4);
  }

  .empty-text {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

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

  @keyframes pulse {
    0%,
    100% {
      opacity: var(--opacity-50);
    }
    50% {
      opacity: 1;
    }
  }

  /* Global cell styles */
  :global(.rank-col) {
    width: 48px;
  }

  :global(.number-col) {
    text-align: right;
  }

  :global(.rank-cell) {
    color: var(--color-text-secondary);
    font-weight: var(--font-semibold);
    font-variant-numeric: tabular-nums;
  }

  :global(.title-cell) {
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  :global(.revenue-cell) {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  :global(.purchases-cell) {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-secondary);
  }

</style>

<!--
  @component CustomerTable

  Displays a table of customers for the studio customers management page.
  Shows name, email, purchase count, total spent (formatted GBP), and joined date.
  Uses the Table sub-component suite.

  @prop {CustomerListItem[]} customers - Array of customer items to display
-->
<script lang="ts">
  import type { CustomerListItem } from '@codex/shared-types';
  import * as Table from '$lib/components/ui/Table';
  import * as m from '$paraglide/messages';

  interface Props {
    customers: CustomerListItem[];
  }

  const { customers }: Props = $props();

  const isEmpty = $derived(customers.length === 0);

  /**
   * Format cents to GBP currency string
   */
  function formatCurrency(cents: number): string {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 2,
    }).format(cents / 100);
  }

  /**
   * Format a date string for display
   */
  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
</script>

{#if isEmpty}
  <div class="empty-state">
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="empty-icon" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
      <circle cx="9" cy="7" r="4"></circle>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
    </svg>
    <h3 class="empty-title">{m.studio_customers_empty()}</h3>
  </div>
{:else}
  <div class="table-wrapper">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>{m.studio_customers_col_name()}</Table.Head>
          <Table.Head>{m.studio_customers_col_email()}</Table.Head>
          <Table.Head>{m.studio_customers_col_purchases()}</Table.Head>
          <Table.Head>{m.studio_customers_col_spent()}</Table.Head>
          <Table.Head>{m.studio_customers_col_joined()}</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each customers as customer (customer.userId)}
          <Table.Row>
            <Table.Cell class="name-cell">
              {customer.name ?? '--'}
            </Table.Cell>
            <Table.Cell class="email-cell">
              {customer.email}
            </Table.Cell>
            <Table.Cell class="purchases-cell">
              {customer.totalPurchases}
            </Table.Cell>
            <Table.Cell class="spent-cell">
              {formatCurrency(customer.totalSpentCents)}
            </Table.Cell>
            <Table.Cell class="date-cell">
              {formatDate(customer.createdAt)}
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
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-12) var(--space-4);
    text-align: center;
  }

  .empty-icon {
    color: var(--color-text-muted);
    margin-bottom: var(--space-2);
  }

  .empty-title {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
    max-width: 400px;
    line-height: 1.5;
  }

  /* Cell styles via :global since classes are passed as props to Table components */
  :global(.name-cell) {
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  :global(.email-cell) {
    color: var(--color-text-secondary);
  }

  :global(.purchases-cell) {
    font-variant-numeric: tabular-nums;
  }

  :global(.spent-cell) {
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-medium);
  }

  :global(.date-cell) {
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  /* Dark mode */
  :global([data-theme='dark']) .empty-icon {
    color: var(--color-text-muted-dark);
  }

  :global([data-theme='dark']) .empty-title {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark'] .name-cell) {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark'] .email-cell),
  :global([data-theme='dark'] .date-cell) {
    color: var(--color-text-secondary-dark);
  }
</style>

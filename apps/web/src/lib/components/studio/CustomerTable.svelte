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
  import { UsersIcon } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
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
  <EmptyState title={m.studio_customers_empty()} icon={UsersIcon} />
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

</style>

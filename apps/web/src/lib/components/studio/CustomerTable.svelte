<!--
  @component CustomerTable

  Displays a table of customers for the studio customers management page.
  Shows name, email, purchase count, total spent (formatted GBP), and joined date.
  Uses the Table sub-component suite.

  Rows are interactive: clicking or pressing Enter/Space on a focused row
  fires the `onCustomerClick` callback with the customer's userId.

  @prop {CustomerListItem[]} customers - Array of customer items to display
  @prop {(customerId: string) => void} [onCustomerClick] - Callback when a customer row is clicked
-->
<script lang="ts">
  import type { CustomerListItem } from '@codex/shared-types';
  import * as Table from '$lib/components/ui/Table';
  import { UsersIcon } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import { formatDate, formatPrice } from '$lib/utils/format';
  import * as m from '$paraglide/messages';

  interface Props {
    customers: CustomerListItem[];
    onCustomerClick?: (customerId: string) => void;
  }

  const { customers, onCustomerClick }: Props = $props();

  const isEmpty = $derived(customers.length === 0);

  function handleRowKeydown(event: KeyboardEvent, customerId: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onCustomerClick?.(customerId);
    }
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
          <Table.Row
            class="customer-row"
            tabindex={onCustomerClick ? 0 : undefined}
            role={onCustomerClick ? 'button' : undefined}
            onclick={() => onCustomerClick?.(customer.userId)}
            onkeydown={(e: KeyboardEvent) => handleRowKeydown(e, customer.userId)}
          >
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
              {formatPrice(customer.totalSpentCents)}
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

  :global(.customer-row) {
    cursor: pointer;
  }

  :global(.customer-row:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: -2px;
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

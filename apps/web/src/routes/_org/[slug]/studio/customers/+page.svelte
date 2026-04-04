<!--
  @component Studio Customers Page

  Lists all organization customers in a table with name, email,
  purchases, total spent, and joined date. Supports URL-based pagination.
  Clicking a row opens a customer detail drawer with profile, stats, and purchase history.
-->
<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$paraglide/messages';
  import { page } from '$app/state';
  import CustomerTable from '$lib/components/studio/CustomerTable.svelte';
  import CustomerDetailDrawer from '$lib/components/studio/CustomerDetailDrawer.svelte';
  import { Pagination } from '$lib/components/ui/Pagination';
  import { PageHeader } from '$lib/components/ui';
  import { UsersIcon } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';

  let { data }: { data: PageData } = $props();

  const orgSlug = $derived(page.params.slug);
  const currentPage = $derived(data.customers.pagination.page);
  const totalPages = $derived(
    Math.max(1, data.customers.pagination.totalPages)
  );
  const totalCustomers = $derived(data.customers.pagination.total);
  const hasCustomers = $derived(data.customers.items.length > 0 || currentPage > 1);

  let drawerOpen = $state(false);
  let selectedCustomerId = $state<string | null>(null);

  function handleCustomerClick(customerId: string) {
    selectedCustomerId = customerId;
    drawerOpen = true;
  }
</script>

<svelte:head>
  <title>{m.studio_customers_title()} | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="customers-page">
  <PageHeader title={m.studio_customers_title()}>
    {#snippet actions()}
      {#if hasCustomers && totalCustomers > 0}
        <span class="count-badge">{totalCustomers}</span>
      {/if}
    {/snippet}
  </PageHeader>

  {#if hasCustomers}
    <CustomerTable
      customers={data.customers.items}
      onCustomerClick={handleCustomerClick}
    />

    {#if totalPages > 1}
      <div class="pagination-wrapper">
        <Pagination
          {currentPage}
          {totalPages}
          baseUrl="/studio/customers"
        />
      </div>
    {/if}
  {:else}
    <EmptyState title={m.studio_customers_empty()} description={m.studio_customers_empty_description()} icon={UsersIcon} />
  {/if}
</div>

<CustomerDetailDrawer
  bind:open={drawerOpen}
  customerId={selectedCustomerId}
  orgId={data.org.id}
/>

<style>
  .customers-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }
  .count-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--space-6);
    height: var(--space-6);
    padding: 0 var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-full, 9999px);
  }

  .pagination-wrapper {
    display: flex;
    justify-content: center;
    padding-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }


</style>

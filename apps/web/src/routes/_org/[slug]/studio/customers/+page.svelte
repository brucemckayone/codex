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
  import { getCustomers } from '$lib/remote/admin.remote';

  let { data }: { data: PageData } = $props();

  const CUSTOMERS_LIMIT = 20;

  let drawerOpen = $state(false);
  let selectedCustomerId = $state<string | null>(null);

  function handleCustomerClick(customerId: string) {
    selectedCustomerId = customerId;
    drawerOpen = true;
  }

  // $derived query reacts to URL page param — fixes pagination bug
  const currentUrlPage = $derived(parseInt(page.url.searchParams.get('page') || '1', 10) || 1);

  const customersQuery = $derived(
    data.org?.id
      ? getCustomers({ organizationId: data.org.id, page: currentUrlPage, limit: CUSTOMERS_LIMIT })
      : null
  );
</script>

<svelte:head>
  <title>{m.studio_customers_title()} | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="customers-page">
  {#if customersQuery?.loading}
    <PageHeader title={m.studio_customers_title()} />
    <div class="table-skeleton">
      <div class="skeleton table-skeleton-header" style="width: 100%; height: var(--space-10);"></div>
      {#each Array(5) as _}
        <div class="table-skeleton-row">
          <div class="skeleton" style="width: 40%; height: var(--space-5);"></div>
          <div class="skeleton" style="width: 25%; height: var(--space-5);"></div>
          <div class="skeleton" style="width: 15%; height: var(--space-5);"></div>
          <div class="skeleton" style="width: 15%; height: var(--space-5);"></div>
        </div>
      {/each}
    </div>
  {:else}
    {@const customers = customersQuery?.current ?? { items: [], pagination: { page: 1, limit: CUSTOMERS_LIMIT, total: 0, totalPages: 0 } }}
    {@const currentPage = customers.pagination?.page ?? 1}
    {@const totalPages = Math.max(1, customers.pagination?.totalPages ?? 0)}
    {@const totalCustomers = customers.pagination?.total ?? 0}
    {@const hasCustomers = (customers.items?.length ?? 0) > 0 || currentPage > 1}

    <PageHeader title={m.studio_customers_title()}>
      {#snippet actions()}
        {#if hasCustomers && totalCustomers > 0}
          <span class="count-badge">{totalCustomers}</span>
        {/if}
      {/snippet}
    </PageHeader>

    {#if hasCustomers}
      <CustomerTable
        customers={customers.items ?? []}
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
  {/if}
</div>

<CustomerDetailDrawer
  bind:open={drawerOpen}
  customerId={selectedCustomerId}
  orgId={data.org?.id}
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

  /* ── Skeleton Loading States ─────────────────────────────────────────── */

  .table-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .table-skeleton-header {
    border-radius: 0;
  }

  .table-skeleton-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
  }

  .skeleton {
    background: linear-gradient(
      90deg,
      var(--color-surface-secondary) 25%,
      var(--color-surface-tertiary) 50%,
      var(--color-surface-secondary) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: var(--radius-md);
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>

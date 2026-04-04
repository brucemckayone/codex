<!--
  @component Studio Customers Page

  Lists all organization customers in a table with name, email,
  purchases, total spent, and joined date. Supports URL-based pagination.
-->
<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$paraglide/messages';
  import { page } from '$app/state';
  import CustomerTable from '$lib/components/studio/CustomerTable.svelte';
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
    <CustomerTable customers={data.customers.items} />

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

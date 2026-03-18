<!--
  @component Studio Customers Page

  Lists all organization customers in a table with name, email,
  purchases, total spent, and joined date. Supports URL-based pagination.
-->
<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$paraglide/messages';
  import { page } from '$app/stores';
  import CustomerTable from '$lib/components/studio/CustomerTable.svelte';
  import { Pagination } from '$lib/components/ui/Pagination';

  let { data }: { data: PageData } = $props();

  const orgSlug = $derived($page.params.slug);
  const currentPage = $derived(data.customers.pagination.page);
  const totalPages = $derived(
    Math.max(1, data.customers.pagination.totalPages)
  );
  const totalCustomers = $derived(data.customers.pagination.total);
  const hasCustomers = $derived(data.customers.items.length > 0 || currentPage > 1);
</script>

<svelte:head>
  <title>{m.studio_customers_title()} | {orgSlug}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="customers-page">
  <div class="page-header">
    <div class="header-text">
      <h1>
        {m.studio_customers_title()}
        {#if hasCustomers && totalCustomers > 0}
          <span class="count-badge">{totalCustomers}</span>
        {/if}
      </h1>
    </div>
  </div>

  {#if hasCustomers}
    <CustomerTable customers={data.customers.items} />

    {#if totalPages > 1}
      <div class="pagination-wrapper">
        <Pagination
          {currentPage}
          {totalPages}
          baseUrl="/{orgSlug}/studio/customers"
        />
      </div>
    {/if}
  {:else}
    <div class="empty-state">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="empty-icon" aria-hidden="true">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
      </svg>
      <h2 class="empty-title">{m.studio_customers_empty()}</h2>
    </div>
  {/if}
</div>

<style>
  .customers-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .page-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  @media (min-width: 640px) {
    .page-header {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
  }

  .page-header h1 {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
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

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-16) var(--space-4);
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

  /* Dark mode */
  :global([data-theme='dark']) .page-header h1 {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .count-badge {
    color: var(--color-text-secondary-dark);
    background: var(--color-surface-variant);
  }

  :global([data-theme='dark']) .empty-icon {
    color: var(--color-text-muted-dark);
  }

  :global([data-theme='dark']) .empty-title {
    color: var(--color-text-dark);
  }
</style>

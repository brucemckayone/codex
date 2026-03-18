<!--
  @component Studio Content Management Page

  Lists all organization content in a table with status badges,
  type indicators, and edit actions. Supports URL-based pagination.
-->
<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$paraglide/messages';
  import { page } from '$app/stores';
  import ContentTable from '$lib/components/studio/ContentTable.svelte';
  import Pagination from '$lib/components/ui/Pagination/Pagination.svelte';

  let { data }: { data: PageData } = $props();

  const orgSlug = $derived($page.params.slug);
  const currentPage = $derived(data.content.pagination.page);
  const totalPages = $derived(
    Math.max(1, data.content.pagination.totalPages)
  );
  const hasContent = $derived(data.content.items.length > 0 || currentPage > 1);
</script>

<svelte:head>
  <title>{m.studio_content_title()} | {orgSlug}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="content-page">
  <div class="page-header">
    <div class="header-text">
      <h1>{m.studio_content_title()}</h1>
    </div>
    <a href="/{orgSlug}/studio/content/new" class="create-btn">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
      {m.studio_content_create()}
    </a>
  </div>

  {#if hasContent}
    <ContentTable items={data.content.items} {orgSlug} />

    {#if totalPages > 1}
      <div class="pagination-wrapper">
        <Pagination
          {currentPage}
          {totalPages}
          baseUrl="/{orgSlug}/studio/content"
        />
      </div>
    {/if}
  {:else}
    <div class="empty-state">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="empty-icon" aria-hidden="true">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
      </svg>
      <h2 class="empty-title">{m.studio_content_empty()}</h2>
      <a href="/{orgSlug}/studio/content/new" class="empty-cta">
        {m.studio_content_create()}
      </a>
    </div>
  {/if}
</div>

<style>
  .content-page {
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
  }

  .create-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: #ffffff;
    background-color: var(--color-primary-500);
    border: none;
    border-radius: var(--radius-md);
    text-decoration: none;
    transition: var(--transition-colors);
    white-space: nowrap;
  }

  .create-btn:hover {
    background-color: var(--color-primary-600);
  }

  .create-btn:focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
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
  }

  .empty-cta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-primary-500);
    text-decoration: none;
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
  }

  .empty-cta:hover {
    background-color: var(--color-primary-50);
    color: var(--color-primary-600);
  }

  .empty-cta:focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
  }

  /* Dark mode */
  :global([data-theme='dark']) .page-header h1 {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .empty-icon {
    color: var(--color-text-muted-dark);
  }

  :global([data-theme='dark']) .empty-title {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .empty-cta:hover {
    background-color: var(--color-primary-900);
  }
</style>

<!--
  @component Creator Studio Content Management Page

  Lists personal content in a table with status badges,
  type indicators, and edit actions. Supports URL-based pagination.
-->
<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$paraglide/messages';
  import ContentTable from '$lib/components/studio/ContentTable.svelte';
  import Pagination from '$lib/components/ui/Pagination/Pagination.svelte';
  import { PlusIcon, FileIcon } from '$lib/components/ui/Icon';

  let { data }: { data: PageData } = $props();

  const currentPage = $derived(data.content.pagination.page);
  const totalPages = $derived(
    Math.max(1, data.content.pagination.totalPages)
  );
  const hasContent = $derived(data.content.items.length > 0 || currentPage > 1);
</script>

<svelte:head>
  <title>{m.studio_content_title()} | My Studio</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="content-page">
  <div class="page-header">
    <div class="header-text">
      <h1>{m.studio_content_title()}</h1>
    </div>
    <a href="/studio/content/new" class="create-btn">
      <PlusIcon size={16} />
      {m.studio_content_create()}
    </a>
  </div>

  {#if hasContent}
    <ContentTable items={data.content.items} />

    {#if totalPages > 1}
      <div class="pagination-wrapper">
        <Pagination
          {currentPage}
          {totalPages}
          baseUrl="/studio/content"
        />
      </div>
    {/if}
  {:else}
    <div class="empty-state">
      <FileIcon size={48} class="empty-icon" stroke-width="1" />
      <h2 class="empty-title">{m.studio_content_empty()}</h2>
      <a href="/studio/content/new" class="empty-cta">
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

  @media (--breakpoint-sm) {
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
    color: var(--color-text-on-brand);
    background-color: var(--color-interactive);
    border: none;
    border-radius: var(--radius-md);
    text-decoration: none;
    transition: var(--transition-colors);
    white-space: nowrap;
  }

  .create-btn:hover {
    background-color: var(--color-interactive-hover);
  }

  .create-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
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
    color: var(--color-interactive);
    text-decoration: none;
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
  }

  .empty-cta:hover {
    background-color: var(--color-interactive-subtle);
    color: var(--color-interactive-hover);
  }

  .empty-cta:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  :global([data-theme='dark']) .page-header h1 {
    color: var(--color-text);
  }

  :global([data-theme='dark']) .empty-icon {
    color: var(--color-text-muted);
  }

  :global([data-theme='dark']) .empty-title {
    color: var(--color-text);
  }

  :global([data-theme='dark']) .empty-cta:hover {
    background-color: var(--color-interactive-active);
  }
</style>

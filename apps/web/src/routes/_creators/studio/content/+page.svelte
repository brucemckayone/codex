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
  import { PageHeader } from '$lib/components/ui';
  import { PlusIcon, FileIcon } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';

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
  <PageHeader title={m.studio_content_title()}>
    {#snippet actions()}
      <a href="/studio/content/new" class="create-btn">
        <PlusIcon size={16} />
        {m.studio_content_create()}
      </a>
    {/snippet}
  </PageHeader>

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
    <EmptyState title={m.studio_content_empty()} icon={FileIcon}>
      {#snippet action()}
        <a href="/studio/content/new" class="empty-cta">
          {m.studio_content_create()}
        </a>
      {/snippet}
    </EmptyState>
  {/if}
</div>

<style>
  .content-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
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
</style>

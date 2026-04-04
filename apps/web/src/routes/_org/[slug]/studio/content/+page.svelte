<!--
  @component Studio Content Management Page

  Lists all organization content in a table with status badges,
  type indicators, and edit actions. Supports URL-based pagination.
-->
<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$paraglide/messages';
  import { page } from '$app/state';
  import ContentTable from '$lib/components/studio/ContentTable.svelte';
  import Pagination from '$lib/components/ui/Pagination/Pagination.svelte';
  import { goto } from '$app/navigation';
  import { PageHeader } from '$lib/components/ui';
  import { PlusIcon, FileIcon, SearchIcon, XIcon } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';

  let { data }: { data: PageData } = $props();

  const orgSlug = $derived(page.params.slug);
  const currentPage = $derived(data.content.pagination.page);
  const totalPages = $derived(
    Math.max(1, data.content.pagination.totalPages)
  );
  const hasContent = $derived(data.content.items.length > 0 || currentPage > 1);

  // Search state
  let searchQuery = $state(page.url.searchParams.get('search') ?? '');
  let debounceTimer: ReturnType<typeof setTimeout>;

  // Sync search input with URL on navigation
  $effect(() => {
    searchQuery = page.url.searchParams.get('search') ?? '';
  });

  function handleSearchInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    searchQuery = value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      navigateWithSearch(value);
    }, 300);
  }

  function clearSearch() {
    searchQuery = '';
    clearTimeout(debounceTimer);
    navigateWithSearch('');
  }

  function navigateWithSearch(search: string) {
    const params = new URLSearchParams(page.url.searchParams);
    if (search.trim()) {
      params.set('search', search.trim());
    } else {
      params.delete('search');
    }
    params.delete('page');
    const query = params.toString();
    goto(`/studio/content${query ? `?${query}` : ''}`, { replaceState: true, keepFocus: true });
  }
</script>

<svelte:head>
  <title>{m.studio_content_title()} | {data.org.name}</title>
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

  <!-- Search -->
  <div class="content-controls">
    <div class="search-input-wrapper">
      <SearchIcon size={16} class="search-icon" />
      <input
        type="search"
        class="search-input"
        placeholder={m.studio_content_search_placeholder()}
        value={searchQuery}
        oninput={handleSearchInput}
      />
      {#if searchQuery}
        <button class="search-clear" onclick={clearSearch} aria-label={m.studio_content_search_clear()}>
          <XIcon size={14} />
        </button>
      {/if}
    </div>
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
  {:else if searchQuery}
    <EmptyState title={m.studio_content_search_empty()} description={m.studio_content_search_empty_description()} icon={SearchIcon}>
      {#snippet action()}
        <button class="empty-cta" onclick={clearSearch}>
          {m.studio_content_search_clear_filter()}
        </button>
      {/snippet}
    </EmptyState>
  {:else}
    <EmptyState title={m.studio_content_empty()} description={m.studio_content_empty_description()} icon={FileIcon}>
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

  /* Search controls */
  .content-controls {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .search-input-wrapper {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    transition: var(--transition-colors);
    width: 100%;
    max-width: 320px;
  }

  .search-input-wrapper:focus-within {
    border-color: var(--color-interactive);
  }

  :global(.search-icon) {
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: var(--text-sm);
    color: var(--color-text);
    font-family: var(--font-sans);
  }

  .search-input::placeholder {
    color: var(--color-text-muted);
  }

  .search-input::-webkit-search-cancel-button {
    display: none;
  }

  .search-clear {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-0-5);
    border: none;
    background: none;
    color: var(--color-text-muted);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .search-clear:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
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

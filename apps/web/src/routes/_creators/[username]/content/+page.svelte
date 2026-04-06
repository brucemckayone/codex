<!--
  @component CreatorContentCatalog

  Displays a creator's full content catalog with search, type filtering,
  and SEO-friendly pagination. Uses ContentCard grid and Pagination component.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { Pagination } from '$lib/components/ui/Pagination';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { ArrowLeftIcon, SearchIcon, FileIcon } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import type { PageData } from './$types';

  const { data }: { data: PageData } = $props();

  const username = $derived(data.username ?? 'Creator');
  const displayName = $derived(data.creatorName ?? username);
  const contentItems = $derived(data.contentItems ?? []);
  const currentPage = $derived(data.pagination.page);
  const totalPages = $derived(Math.max(1, data.pagination.totalPages));
  const hasContent = $derived(contentItems.length > 0 || currentPage > 1);

  // Local state for search input, synced with server data on navigation
  let searchInput = $state('');

  // Sync search input when data changes (e.g., after navigation)
  $effect(() => {
    searchInput = data.search ?? '';
  });

  // Type filter options
  const typeOptions = [
    { value: 'all', label: m.creator_content_filter_all() },
    { value: 'video', label: m.creator_content_filter_video() },
    { value: 'audio', label: m.creator_content_filter_audio() },
    { value: 'article', label: m.creator_content_filter_article() },
  ] as const;

  const activeType = $derived(data.typeFilter ?? 'all');

  /**
   * Build URL with updated search params, resetting page to 1
   */
  function buildFilterUrl(overrides: Record<string, string>): string {
    const params = new URLSearchParams();
    const search = overrides.search ?? searchInput;
    const type = overrides.type ?? activeType;

    if (search) params.set('search', search);
    if (type && type !== 'all') params.set('type', type);
    // Reset page to 1 when filters change
    if (overrides.page) params.set('page', overrides.page);

    const qs = params.toString();
    return `/@${username}/content${qs ? `?${qs}` : ''}`;
  }

  function handleSearch(event: Event) {
    event.preventDefault();
    void goto(buildFilterUrl({ search: searchInput }));
  }

  function handleTypeChange(type: string) {
    void goto(buildFilterUrl({ type }));
  }

  // Build base URL for pagination (preserves current filters)
  const paginationBaseUrl = $derived.by(() => {
    const params = new URLSearchParams();
    if (data.search) params.set('search', data.search);
    if (data.typeFilter && data.typeFilter !== 'all') params.set('type', data.typeFilter);
    const qs = params.toString();
    return `/@${username}/content${qs ? `?${qs}` : ''}`;
  });
</script>

<svelte:head>
  <title>{m.creator_content_title({ username: displayName })}</title>
  <meta property="og:title" content="{displayName}'s Content" />
  <meta property="og:type" content="website" />
</svelte:head>

<div class="catalog">
  <!-- Header -->
  <div class="catalog-header">
    <h1 class="catalog-title">{m.creator_content_title({ username: displayName })}</h1>
    <a href="/@{username}" class="back-link">
      <ArrowLeftIcon size={16} />
      @{username}
    </a>
  </div>

  <!-- Filters -->
  <div class="catalog-filters">
    <form class="search-form" onsubmit={handleSearch}>
      <input
        type="search"
        class="search-input"
        placeholder={m.creator_content_search_placeholder()}
        bind:value={searchInput}
      />
    </form>

    <div class="type-filters" role="tablist" aria-label="Content type filter">
      {#each typeOptions as option (option.value)}
        <button
          type="button"
          role="tab"
          class="type-btn"
          class:active={activeType === option.value}
          aria-selected={activeType === option.value}
          onclick={() => handleTypeChange(option.value)}
        >
          {option.label}
        </button>
      {/each}
    </div>
  </div>

  <!-- Content Grid -->
  {#if hasContent && contentItems.length > 0}
    <div class="content-grid">
      {#each contentItems as item (item.id)}
        <ContentCard
          id={item.id}
          title={item.title}
          thumbnail={item.mediaItem?.thumbnailUrl ?? item.thumbnailUrl ?? null}
          description={item.description}
          contentType={item.contentType === 'written' ? 'article' : item.contentType}
          duration={item.mediaItem?.durationSeconds ?? null}
          href={buildContentUrl(page.url, item)}
          price={item.priceCents != null ? {
            amount: item.priceCents,
            currency: 'GBP',
          } : null}
        />
      {/each}
    </div>

    {#if totalPages > 1}
      <div class="pagination-wrapper">
        <Pagination
          {currentPage}
          {totalPages}
          baseUrl={paginationBaseUrl}
        />
      </div>
    {/if}
  {:else if data.search || (data.typeFilter && data.typeFilter !== 'all')}
    <EmptyState title={m.creator_content_no_results()} icon={SearchIcon}>
      {#snippet action()}
        <a href="/@{username}/content" class="empty-state__clear">
          {m.explore_clear_filters()}
        </a>
      {/snippet}
    </EmptyState>
  {:else}
    <EmptyState title={m.creator_content_empty()} description={m.creator_content_empty_description()} icon={FileIcon} />
  {/if}
</div>

<style>
  /* ── Layout ── */
  .catalog {
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
    padding: var(--space-8) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  /* ── Header ── */
  .catalog-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  @media (--breakpoint-sm) {
    .catalog-header {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
  }

  .catalog-title {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .back-link:hover {
    color: var(--color-interactive);
  }

  /* ── Filters ── */
  .catalog-filters {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  @media (--breakpoint-sm) {
    .catalog-filters {
      flex-direction: row;
      align-items: center;
      gap: var(--space-4);
    }
  }

  .search-form {
    flex: 1;
    min-width: 0;
  }

  .search-input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
  }

  .search-input::placeholder {
    color: var(--color-text-muted);
  }

  .search-input:focus {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: -1px;
    border-color: var(--color-border-focus);
  }

  .type-filters {
    display: flex;
    gap: var(--space-1);
    flex-shrink: 0;
  }

  .type-btn {
    padding: var(--space-1-5) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    background: transparent;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
    white-space: nowrap;
  }

  .type-btn:hover {
    background: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .type-btn.active {
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
    border-color: var(--color-interactive);
  }

  /* ── Pagination ── */
  .pagination-wrapper {
    display: flex;
    justify-content: center;
    padding-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  /* ── Empty State ── */
  .empty-state__clear {
    font-size: var(--text-sm);
    color: var(--color-interactive);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .empty-state__clear:hover {
    color: var(--color-interactive-hover);
  }

  /* ── Responsive ── */
  @media (--below-sm) {
    .catalog {
      padding: var(--space-6) var(--space-4);
    }

    .catalog-title {
      font-size: var(--text-xl);
    }
  }
</style>

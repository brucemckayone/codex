<!--
  @component OrgExplorePage

  Organization explore page with search, type filtering, sorting, content grid, and pagination.
  All filter/search/page state lives in URL query params for SEO and bookmarkability.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { Pagination } from '$lib/components/ui/Pagination';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { SearchIcon, SearchXIcon, FileIcon } from '$lib/components/ui/Icon';
  import type { PageData } from './$types';

  const { data }: { data: PageData } = $props();

  const orgName = $derived(data.org?.name ?? 'Organization');
  const orgSlug = $derived(data.org?.slug ?? '');
  const items = $derived(data.content?.items ?? []);
  const total = $derived(data.content?.total ?? 0);
  const filters = $derived(data.filters);
  const limit = $derived(data.limit ?? 12);
  const totalPages = $derived(Math.max(1, Math.ceil(total / limit)));
  const hasActiveFilters = $derived(!!filters.q || !!filters.type);

  let searchInput = $state('');

  // Sync search input with URL state when data changes (e.g. back/forward navigation)
  $effect(() => {
    searchInput = data.filters?.q ?? '';
  });

  /**
   * Update a URL search param and navigate with replaceState.
   * Resets page to 1 on filter/search changes (unless key is 'page').
   */
  function updateFilter(key: string, value: string | null) {
    const url = new URL(page.url);
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
    if (key !== 'page') {
      url.searchParams.delete('page');
    }
    goto(url.toString(), { replaceState: true, noScroll: true });
  }

  function handleSearchSubmit(e: SubmitEvent) {
    e.preventDefault();
    const trimmed = searchInput.trim();
    updateFilter('q', trimmed || null);
  }

  function clearFilters() {
    searchInput = '';
    const url = new URL(page.url);
    url.searchParams.delete('q');
    url.searchParams.delete('type');
    url.searchParams.delete('sort');
    url.searchParams.delete('page');
    goto(url.toString(), { replaceState: true });
  }

  /**
   * Build the baseUrl for Pagination links, preserving current filters
   * but without the 'page' param (Pagination adds it).
   */
  const paginationBaseUrl = $derived.by(() => {
    const url = new URL(page.url);
    url.searchParams.delete('page');
    return `${url.pathname}${url.search}`;
  });

  const typeOptions = [
    { value: '', label: m.explore_filter_all() },
    { value: 'video', label: m.explore_filter_video() },
    { value: 'audio', label: m.explore_filter_audio() },
    { value: 'written', label: m.explore_filter_article() },
  ] as const;

  const sortOptions = [
    { value: 'newest', label: m.explore_sort_newest() },
    { value: 'oldest', label: m.explore_sort_oldest() },
    { value: 'title', label: m.explore_sort_title() },
  ] as const;
</script>

<svelte:head>
  <title>{m.explore_title()} | {orgName}</title>
  <meta name="description" content="Explore content from {orgName}" />
  <meta property="og:title" content="{m.explore_title()} | {orgName}" />
  <meta property="og:description" content="Explore content from {orgName}" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="{m.explore_title()} | {orgName}" />
  <meta name="twitter:description" content="Explore content from {orgName}" />
</svelte:head>

<div class="explore">
  <!-- Header -->
  <header class="explore__header">
    <h1 class="explore__title">{m.explore_title()}</h1>
    {#if total > 0}
      <p class="explore__count">{m.explore_results_count({ count: String(total) })}</p>
    {/if}
  </header>

  <!-- Controls: Search, Type Filter, Sort -->
  <div class="explore__controls">
    <!-- Search -->
    <form class="explore__search" onsubmit={handleSearchSubmit}>
      <SearchIcon size={18} class="explore__search-icon" />
      <input
        type="search"
        class="explore__search-input"
        placeholder={m.explore_search_placeholder()}
        bind:value={searchInput}
        aria-label={m.explore_search_placeholder()}
      />
    </form>

    <!-- Type Filter -->
    <div class="explore__filter-group">
      {#each typeOptions as option (option.value)}
        <button
          class="explore__filter-btn"
          class:explore__filter-btn--active={filters.type === option.value}
          onclick={() => updateFilter('type', option.value || null)}
          aria-pressed={filters.type === option.value}
        >
          {option.label}
        </button>
      {/each}
    </div>

    <!-- Sort -->
    <select
      class="explore__sort"
      value={filters.sort}
      onchange={(e) => updateFilter('sort', e.currentTarget.value)}
      aria-label="Sort content"
    >
      {#each sortOptions as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  </div>

  <!-- Content Grid -->
  {#if items.length > 0}
    <div class="explore__grid">
      {#each items as item (item.id)}
        <ContentCard
          id={item.id}
          title={item.title}
          thumbnail={item.mediaItem?.thumbnailKey ?? item.thumbnailUrl ?? null}
          description={item.description}
          contentType={(item.contentType === 'written' ? 'article' : item.contentType) as 'video' | 'audio' | 'article'}
          duration={item.mediaItem?.durationSeconds ?? null}
          creator={item.creator ? {
            username: item.creator.name ?? undefined,
            displayName: item.creator.name ?? undefined,
          } : undefined}
          href={buildContentUrl(page.url, item)}
          price={item.priceCents != null ? {
            amount: item.priceCents,
            currency: 'GBP',
          } : null}
        />
      {/each}
    </div>

    <!-- Pagination -->
    {#if totalPages > 1}
      <div class="explore__pagination">
        <Pagination
          currentPage={filters.page}
          {totalPages}
          baseUrl={paginationBaseUrl}
        />
      </div>
    {/if}
  {:else if hasActiveFilters}
    <!-- No search results -->
    <div class="explore__empty">
      <SearchXIcon size={48} class="explore__empty-icon" stroke-width="1.5" />
      <p class="explore__empty-text">{m.explore_no_results()}</p>
      <button class="explore__clear-btn" onclick={clearFilters}>
        {m.explore_clear_filters()}
      </button>
    </div>
  {:else}
    <!-- No content at all -->
    <div class="explore__empty">
      <FileIcon size={48} class="explore__empty-icon" stroke-width="1.5" />
      <p class="explore__empty-text">{m.explore_no_content()}</p>
    </div>
  {/if}
</div>

<style>
  /* ── Layout ── */
  .explore {
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
    padding: var(--space-8, 2rem) var(--space-6, 1.5rem);
    display: flex;
    flex-direction: column;
    gap: var(--space-8, 2rem);
  }

  /* ── Header ── */
  .explore__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4, 1rem);
    flex-wrap: wrap;
  }

  .explore__title {
    margin: 0;
    font-size: var(--text-3xl, 1.875rem);
    font-weight: var(--font-bold, 700);
    color: var(--color-text-primary);
    line-height: 1.2;
  }

  .explore__count {
    margin: 0;
    font-size: var(--text-sm, 0.875rem);
    color: var(--color-text-secondary);
  }

  /* ── Controls ── */
  .explore__controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4, 1rem);
  }

  /* Search */
  .explore__search {
    position: relative;
    flex: 1 1 280px;
    min-width: 0;
  }

  .explore__search-icon {
    position: absolute;
    left: var(--space-3, 0.75rem);
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-text-muted);
    pointer-events: none;
  }

  .explore__search-input {
    width: 100%;
    padding: var(--space-2-5, 0.625rem) var(--space-3, 0.75rem);
    padding-left: var(--space-10, 2.5rem);
    font-size: var(--text-sm, 0.875rem);
    color: var(--color-text);
    background: var(--color-surface);
    border: var(--border-width, 1px) var(--border-style, solid) var(--color-border);
    border-radius: var(--radius-md, 0.375rem);
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .explore__search-input:focus {
    border-color: var(--color-border-focus);
    box-shadow: var(--shadow-focus-ring);
  }

  .explore__search-input::placeholder {
    color: var(--color-text-muted);
  }

  /* Type Filter Buttons */
  .explore__filter-group {
    display: flex;
    gap: var(--space-1, 0.25rem);
    border: var(--border-width, 1px) var(--border-style, solid) var(--color-border);
    border-radius: var(--radius-md, 0.375rem);
    overflow: hidden;
  }

  .explore__filter-btn {
    padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
    font-size: var(--text-sm, 0.875rem);
    font-weight: var(--font-medium, 500);
    color: var(--color-text-secondary);
    background: var(--color-surface);
    border: none;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
    white-space: nowrap;
  }

  .explore__filter-btn:hover {
    background: var(--color-surface-secondary);
  }

  .explore__filter-btn--active {
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  .explore__filter-btn--active:hover {
    background: var(--color-interactive-hover);
  }

  /* Sort Select */
  .explore__sort {
    padding: var(--space-2, 0.5rem) var(--space-8, 2rem) var(--space-2, 0.5rem) var(--space-3, 0.75rem);
    font-size: var(--text-sm, 0.875rem);
    color: var(--color-text);
    background: var(--color-surface);
    border: var(--border-width, 1px) var(--border-style, solid) var(--color-border);
    border-radius: var(--radius-md, 0.375rem);
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right var(--space-2, 0.5rem) center;
    outline: none;
    transition: border-color 0.15s ease;
  }

  .explore__sort:focus {
    border-color: var(--color-border-focus);
  }

  /* ── Content Grid ── */
  .explore__grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-6, 1.5rem);
  }

  @media (--breakpoint-sm) {
    .explore__grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (--breakpoint-lg) {
    .explore__grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  /* ── Pagination ── */
  .explore__pagination {
    display: flex;
    justify-content: center;
    padding-top: var(--space-4, 1rem);
  }

  /* ── Empty States ── */
  .explore__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4, 1rem);
    padding: var(--space-16, 4rem) var(--space-4, 1rem);
    text-align: center;
  }

  .explore__empty-icon {
    color: var(--color-text-muted);
    opacity: 0.6;
  }

  .explore__empty-text {
    margin: 0;
    font-size: var(--text-lg, 1.125rem);
    color: var(--color-text-muted);
  }

  .explore__clear-btn {
    padding: var(--space-2, 0.5rem) var(--space-4, 1rem);
    font-size: var(--text-sm, 0.875rem);
    font-weight: var(--font-medium, 500);
    color: var(--color-interactive);
    background: transparent;
    border: var(--border-width, 1px) var(--border-style, solid) var(--color-interactive);
    border-radius: var(--radius-md, 0.375rem);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .explore__clear-btn:hover {
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  /* ── Responsive Controls ── */
  @media (--below-sm) {
    .explore {
      padding: var(--space-6, 1.5rem) var(--space-4, 1rem);
      gap: var(--space-6, 1.5rem);
    }

    .explore__title {
      font-size: var(--text-2xl, 1.5rem);
    }

    .explore__controls {
      flex-direction: column;
      align-items: stretch;
    }

    .explore__search {
      flex: 1 1 auto;
    }

    .explore__filter-group {
      overflow-x: auto;
    }

    .explore__sort {
      width: 100%;
    }
  }

  /* ── Dark Mode ── */
  :global([data-theme='dark']) .explore__title {
    color: var(--color-text-primary-dark, #f1f5f9);
  }

  :global([data-theme='dark']) .explore__count {
    color: var(--color-text-secondary-dark, #94a3b8);
  }

  :global([data-theme='dark']) .explore__search-input {
    background: var(--color-surface-dark);
    border-color: var(--color-border-dark);
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .explore__search-input:focus {
    border-color: var(--color-interactive);
    box-shadow: var(--shadow-focus-ring);
  }

  :global([data-theme='dark']) .explore__filter-group {
    border-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .explore__filter-btn {
    background: var(--color-surface-dark);
    color: var(--color-text-secondary-dark, #94a3b8);
  }

  :global([data-theme='dark']) .explore__filter-btn:hover {
    background: var(--color-surface-variant);
  }

  :global([data-theme='dark']) .explore__filter-btn--active {
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  :global([data-theme='dark']) .explore__sort {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .explore__empty-text {
    color: var(--color-text-muted-dark, #94a3b8);
  }

  :global([data-theme='dark']) .explore__empty-icon {
    color: var(--color-text-muted-dark, #94a3b8);
  }

  :global([data-theme='dark']) .explore__clear-btn {
    color: var(--color-interactive);
    border-color: var(--color-interactive);
  }

  :global([data-theme='dark']) .explore__clear-btn:hover {
    background: var(--color-interactive);
    color: #000000;
  }
</style>

<!--
  @component OrgExplorePage

  Organization explore page with search, type filtering, category pills, sorting,
  filter chips, content grid, and pagination.
  All filter/search/page state lives in URL query params for SEO and bookmarkability.
-->
<script lang="ts">
  import { fly } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { Pagination } from '$lib/components/ui/Pagination';
  import Select from '$lib/components/ui/Select/Select.svelte';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { SearchIcon, SearchXIcon, FileIcon, XIcon } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import { ViewToggle } from '$lib/components/ui/ViewToggle';
  import { BackToTop } from '$lib/components/ui/BackToTop';
  import { browser } from '$app/environment';
  import type { PageData } from './$types';

  const { data }: { data: PageData } = $props();

  const orgName = $derived(data.org?.name ?? 'Organization');
  const items = $derived(data.content?.items ?? []);
  const total = $derived(data.content?.total ?? 0);
  const filters = $derived(data.filters);
  const limit = $derived(data.limit ?? 12);
  const totalPages = $derived(Math.max(1, Math.ceil(total / limit)));
  const isAuthenticated = $derived(!!data.user);

  // Category extraction from loaded items (client-side only)
  const categories = $derived(
    [...new Set(items.map((item: { category?: string | null }) => item.category).filter(Boolean))]
      .sort((a, b) => (a as string).localeCompare(b as string)) as string[]
  );
  const activeCategory = $derived(filters.category ?? '');

  // Client-side category filtering
  const displayItems = $derived(
    activeCategory
      ? items.filter((item: { category?: string | null }) => item.category === activeCategory)
      : items
  );

  // Auth-aware sort options
  const sortOptions = $derived([
    { value: 'newest', label: m.explore_sort_newest() },
    { value: 'oldest', label: m.explore_sort_oldest() },
    { value: 'title', label: m.explore_sort_title() },
    ...(isAuthenticated ? [
      { value: 'popular', label: m.explore_sort_popular() },
      { value: 'top-selling', label: m.explore_sort_top_selling() },
    ] : []),
  ]);

  // Filter chips
  const activeFilterChips = $derived.by(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];

    if (filters.q) {
      chips.push({
        key: 'q',
        label: `Search: "${filters.q}"`,
        onRemove: () => { searchInput = ''; updateFilter('q', null); },
      });
    }

    if (filters.type) {
      const typeLabel = typeOptions.find((o) => o.value === filters.type)?.label ?? filters.type;
      chips.push({
        key: 'type',
        label: `Type: ${typeLabel}`,
        onRemove: () => updateFilter('type', null),
      });
    }

    if (filters.category) {
      chips.push({
        key: 'category',
        label: `Category: ${filters.category}`,
        onRemove: () => updateFilter('category', null),
      });
    }

    if (filters.sort && filters.sort !== 'newest') {
      const sortLabel = sortOptions.find((o) => o.value === filters.sort)?.label ?? filters.sort;
      chips.push({
        key: 'sort',
        label: `Sort: ${sortLabel}`,
        onRemove: () => updateFilter('sort', null),
      });
    }

    return chips;
  });

  const hasActiveFilters = $derived(
    !!filters.q || !!filters.type || !!filters.category || (filters.sort !== 'newest')
  );

  let searchInput = $state('');

  $effect(() => {
    searchInput = data.filters?.q ?? '';
  });

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
    url.searchParams.delete('category');
    url.searchParams.delete('page');
    goto(url.toString(), { replaceState: true });
  }

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

  const STORAGE_KEY = 'codex-view-mode';

  let viewMode = $state<'grid' | 'list'>(
    browser ? (localStorage.getItem(STORAGE_KEY) as 'grid' | 'list') ?? 'grid' : 'grid'
  );

  function handleViewChange(mode: 'grid' | 'list') {
    viewMode = mode;
    if (browser) localStorage.setItem(STORAGE_KEY, mode);
  }
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
      <p class="explore__count">
        {#if activeCategory}
          {m.explore_showing_filtered({ count: String(displayItems.length), total: String(total) })}
        {:else}
          {m.explore_results_count({ count: String(total) })}
        {/if}
      </p>
    {/if}
  </header>

  <!-- Controls: Search, Type Filter, Sort, View Toggle -->
  <div class="explore__controls">
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

    <div class="explore__sort-wrapper">
      <Select
        options={sortOptions}
        value={filters.sort}
        onValueChange={(val) => updateFilter('sort', val ?? null)}
        placeholder="Sort content"
      />
    </div>
    <ViewToggle value={viewMode} onchange={handleViewChange} />
  </div>

  <!-- Category Strip -->
  {#if categories.length >= 2}
    <nav class="explore__categories" aria-label="Filter by category">
      <button
        class="explore__category-pill"
        class:explore__category-pill--active={!activeCategory}
        onclick={() => updateFilter('category', null)}
        aria-pressed={!activeCategory}
      >
        {m.explore_filter_all()}
      </button>
      {#each categories as cat (cat)}
        <button
          class="explore__category-pill"
          class:explore__category-pill--active={activeCategory === cat}
          onclick={() => updateFilter('category', cat)}
          aria-pressed={activeCategory === cat}
        >
          {cat}
        </button>
      {/each}
    </nav>
  {/if}

  <!-- Active Filter Chips -->
  {#if hasActiveFilters}
    <div class="explore__chips" aria-label="Active filters">
      {#each activeFilterChips as chip (chip.key)}
        <span class="explore__chip" transition:fly={{ x: -8, duration: 150 }}>
          {chip.label}
          <button
            class="explore__chip-remove"
            onclick={chip.onRemove}
            aria-label="Remove {chip.label} filter"
          >
            <XIcon size={12} />
          </button>
        </span>
      {/each}
      {#if activeFilterChips.length > 1}
        <button class="explore__clear-all" onclick={clearFilters}>
          {m.explore_clear_filters()}
        </button>
      {/if}
    </div>
  {/if}

  <!-- Content Grid -->
  {#if displayItems.length > 0}
    <div class="explore__grid" data-view={viewMode}>
      {#each displayItems as item (item.id)}
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
    <EmptyState title={m.explore_no_results()} icon={SearchXIcon}>
      {#snippet action()}
        <button class="explore__clear-btn" onclick={clearFilters}>
          {m.explore_clear_filters()}
        </button>
      {/snippet}
    </EmptyState>
  {:else}
    <EmptyState title={m.explore_no_content()} description={m.explore_no_content_description()} icon={FileIcon} />
  {/if}
</div>

<BackToTop />

<style>
  /* ── Layout ── */
  .explore {
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
    padding: var(--space-8) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  /* ── Header ── */
  .explore__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .explore__title {
    margin: 0;
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    line-height: var(--leading-tight);
  }

  .explore__count {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* ── Controls ── */
  .explore__controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
  }

  .explore__search {
    position: relative;
    flex: 1 1 280px;
    min-width: 0;
  }

  :global(.explore__search-icon) {
    position: absolute;
    left: var(--space-3);
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-text-muted);
    pointer-events: none;
  }

  .explore__search-input {
    width: 100%;
    padding: var(--space-2-5) var(--space-3);
    padding-left: var(--space-10);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    outline: none;
    transition: border-color var(--duration-fast) var(--ease-default),
      box-shadow var(--duration-fast) var(--ease-default);
  }

  .explore__search-input:focus {
    border-color: var(--color-border-focus);
    box-shadow: var(--shadow-focus-ring);
  }

  .explore__search-input::placeholder {
    color: var(--color-text-muted);
  }

  .explore__filter-group {
    display: flex;
    gap: var(--space-1);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .explore__filter-btn {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    background: var(--color-surface);
    border: none;
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default),
      color var(--duration-fast) var(--ease-default);
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

  .explore__sort-wrapper {
    min-width: 160px;
  }

  /* ── Category Strip ── */
  .explore__categories {
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    padding: var(--space-1) 0;
    mask-image: linear-gradient(
      to right,
      transparent 0,
      black var(--space-4),
      black calc(100% - var(--space-4)),
      transparent 100%
    );
  }

  .explore__categories::-webkit-scrollbar {
    display: none;
  }

  .explore__category-pill {
    flex-shrink: 0;
    padding: var(--space-1-5) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full);
    cursor: pointer;
    white-space: nowrap;
    transition: background-color var(--duration-fast) var(--ease-default),
      color var(--duration-fast) var(--ease-default),
      border-color var(--duration-fast) var(--ease-default);
  }

  .explore__category-pill:hover {
    border-color: var(--color-border-hover);
  }

  .explore__category-pill--active {
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
    border-color: var(--color-interactive);
  }

  .explore__category-pill--active:hover {
    background: var(--color-interactive-hover);
    border-color: var(--color-interactive-hover);
  }

  /* ── Filter Chips ── */
  .explore__chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .explore__chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-1-5) var(--space-3);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-interactive);
    border-radius: var(--radius-full);
    white-space: nowrap;
  }

  .explore__chip-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    width: var(--space-4);
    height: var(--space-4);
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    border-radius: var(--radius-full);
    transition: background-color var(--duration-fast) var(--ease-default);
  }

  .explore__chip-remove:hover {
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  .explore__clear-all {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: var(--space-1) var(--space-2);
    text-decoration: underline;
    transition: color var(--duration-fast) var(--ease-default);
  }

  .explore__clear-all:hover {
    color: var(--color-text);
  }

  /* ── Content Grid ── */
  .explore__grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-6);
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

  /* ── List View ── */
  .explore__grid[data-view='list'] {
    grid-template-columns: 1fr;
    gap: var(--space-3);
  }

  .explore__grid[data-view='list'] :global(.content-card) {
    flex-direction: row;
  }

  .explore__grid[data-view='list'] :global(.content-card__thumbnail) {
    aspect-ratio: 16 / 9;
    width: 200px;
    min-width: 200px;
    flex-shrink: 0;
  }

  .explore__grid[data-view='list'] :global(.content-card__body) {
    flex: 1;
    min-width: 0;
  }

  @media (--below-sm) {
    .explore__grid[data-view='list'] :global(.content-card) {
      flex-direction: column;
    }

    .explore__grid[data-view='list'] :global(.content-card__thumbnail) {
      width: 100%;
      min-width: 0;
    }
  }

  /* ── Pagination ── */
  .explore__pagination {
    display: flex;
    justify-content: center;
    padding-top: var(--space-4);
  }

  /* ── Empty States ── */
  .explore__clear-btn {
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    background: transparent;
    border: var(--border-width) var(--border-style) var(--color-interactive);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default),
      color var(--duration-fast) var(--ease-default);
  }

  .explore__clear-btn:hover {
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  /* ── Responsive ── */
  @media (--below-sm) {
    .explore {
      padding: var(--space-6) var(--space-4);
    }

    .explore__title {
      font-size: var(--text-2xl);
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

    .explore__sort-wrapper {
      width: 100%;
    }
  }
</style>

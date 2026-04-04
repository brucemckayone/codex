<script lang="ts">
  /**
   * Library Page
   *
   * Displays user's content library with SSR hydration.
   * Includes filtering (type, progress, search), sort dropdown,
   * continue watching section, and URL-based pagination.
   *
   * Hydration Flow:
   * 1. +page.server.ts fetches library data on server
   * 2. Page renders with server data (SSR)
   * 3. onMount hydrates QueryClient cache with server data
   * 4. useLiveQuery uses cached data (no refetch)
   * 5. Subsequent navigations use cached/live data
   */

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    hydrateIfNeeded,
    libraryCollection,
    useLiveQuery,
  } from '$lib/collections';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import ErrorBanner from '$lib/components/ui/Feedback/ErrorBanner.svelte';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import { SkeletonContentCard } from '$lib/components/ui/ContentCard';
  import { ShoppingBagIcon, SearchXIcon } from '$lib/components/ui/Icon';
  import LibraryFilters from '$lib/components/library/LibraryFilters.svelte';
  import ContinueWatching from '$lib/components/library/ContinueWatching.svelte';
  import LibraryCard from '$lib/components/library/LibraryCard.svelte';
  import { Pagination } from '$lib/components/ui/Pagination';
  import Select from '$lib/components/ui/Select/Select.svelte';
  import { browser } from '$app/environment';
  import { ViewToggle } from '$lib/components/ui/ViewToggle';
  import { BackToTop } from '$lib/components/ui/BackToTop';
  import * as m from '$paraglide/messages';

  let { data } = $props();

  const STORAGE_KEY = 'codex-view-mode';

  let viewMode = $state<'grid' | 'list'>(
    browser ? (localStorage.getItem(STORAGE_KEY) as 'grid' | 'list') ?? 'grid' : 'grid'
  );

  function handleViewChange(mode: 'grid' | 'list') {
    viewMode = mode;
    if (browser) localStorage.setItem(STORAGE_KEY, mode);
  }

  // Hydrate collection with server data on mount
  onMount(() => {
    if (data.library?.items) {
      hydrateIfNeeded('library', data.library.items);
    }
  });

  // Live query over library collection — used for ContinueWatching section
  const libraryQuery = useLiveQuery(
    (q) =>
      q
        .from({ item: libraryCollection })
        .orderBy(({ item }) => item.progress?.updatedAt ?? '', 'desc'),
    undefined,
    { ssrData: data.library?.items }
  );

  // Sort options
  const sortOptions = $derived([
    { value: 'recent', label: m.library_sort_recent_purchase() },
    { value: 'watched', label: m.library_sort_recent_watched() },
    { value: 'az', label: m.library_sort_az() },
    { value: 'za', label: m.library_sort_za() },
  ]);

  const currentSort = $derived(data.sort ?? 'recent');

  // Pagination
  const currentPage = $derived(data.library?.page ?? 1);
  const totalPages = $derived.by(() => {
    const lib = data.library;
    if (!lib || !('total' in lib) || !('limit' in lib)) return 1;
    const total = (lib as { total: number }).total;
    const limit = (lib as { limit: number }).limit;
    return Math.max(1, Math.ceil(total / limit));
  });

  /** Build URLSearchParams preserving current filter state */
  function buildFilterParams(overrides?: { sort?: string }) {
    const params = new URLSearchParams();
    const sort = overrides?.sort ?? currentSort;
    if (sort !== 'recent') params.set('sort', sort);
    if (filters.contentType !== 'all') params.set('type', filters.contentType);
    if (filters.progressStatus !== 'all') params.set('progress', filters.progressStatus);
    if (filters.search) params.set('q', filters.search);
    return params;
  }

  function handleSortChange(value: string | undefined) {
    if (!value) return;
    const params = buildFilterParams({ sort: value });
    const qs = params.toString();
    void goto(`/library${qs ? `?${qs}` : ''}`);
  }

  const paginationBaseUrl = $derived.by(() => {
    const params = buildFilterParams();
    const qs = params.toString();
    return `/library${qs ? `?${qs}` : ''}`;
  });

  // Filter state — driven by URL params via server load
  const filters = $derived({
    contentType: data.contentType ?? 'all',
    progressStatus: data.progressStatus ?? 'all',
    search: data.search ?? '',
  });

  let filtersRef: LibraryFilters | undefined = $state();

  function handleFilterChange(newFilters: { contentType: string; progressStatus: string; search: string }) {
    const params = new URLSearchParams();
    if (currentSort !== 'recent') params.set('sort', currentSort);
    if (newFilters.contentType !== 'all') params.set('type', newFilters.contentType);
    if (newFilters.progressStatus !== 'all') params.set('progress', newFilters.progressStatus);
    if (newFilters.search) params.set('q', newFilters.search);
    const qs = params.toString();
    void goto(`/library${qs ? `?${qs}` : ''}`, { replaceState: true });
  }

  const hasActiveFilters = $derived(
    filters.contentType !== 'all' ||
    filters.progressStatus !== 'all' ||
    filters.search !== ''
  );

  // Items from server data — already filtered by the API
  const filteredItems = $derived(data.library?.items ?? []);
</script>

<svelte:head>
  <title>{m.library_title()} - Codex</title>
</svelte:head>

<div class="library">
  <h1 class="library-title">{m.library_title()}</h1>

  {#if data.error}
    <ErrorBanner
      title={m.library_error_title()}
      description={data.errorCode === '401'
        ? m.library_error_unauthorized()
        : data.errorCode === '503'
          ? m.library_error_unavailable()
          : m.library_error_default()}
    />
  {:else if libraryQuery.isLoading && !data.library?.items?.length}
    <div class="content-grid">
      {#each Array(6) as _}
        <SkeletonContentCard />
      {/each}
    </div>
  {:else if libraryQuery.data?.length === 0}
    <EmptyState title={m.library_empty()} description={m.library_empty_description()} icon={ShoppingBagIcon}>
      {#snippet action()}
        <a href="/discover" class="browse-btn">
          {m.library_browse()}
        </a>
      {/snippet}
    </EmptyState>
  {:else}
    <ContinueWatching items={libraryQuery.data ?? []} variant="prominent" />

    <!-- Sort + View Toggle -->
    <div class="sort-bar">
      <Select
        options={sortOptions}
        value={currentSort}
        onValueChange={handleSortChange}
        label={m.library_sort_label()}
        placeholder={m.library_sort_label()}
      />
      <ViewToggle value={viewMode} onchange={handleViewChange} />
    </div>

    <LibraryFilters
      bind:this={filtersRef}
      onFilterChange={handleFilterChange}
      initialContentType={filters.contentType}
      initialProgressStatus={filters.progressStatus}
      initialSearch={filters.search}
    />

    {#if filteredItems.length === 0 && hasActiveFilters}
      <EmptyState title={m.library_no_results()} icon={SearchXIcon}>
        {#snippet action()}
          <button
            type="button"
            class="clear-filters-btn"
            onclick={() => { filtersRef?.clearAll(); void goto('/library'); }}
          >
            {m.library_clear_filters()}
          </button>
        {/snippet}
      </EmptyState>
    {:else}
      <div class="content-grid" data-view={viewMode}>
        {#each filteredItems as item (item.content.id)}
          <LibraryCard {item} href={buildContentUrl(page.url, item.content)} />
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
    {/if}
  {/if}
</div>

<BackToTop />

<style>
  .library {
    padding: var(--space-8) 0;
  }

  .library-title {
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin-bottom: var(--space-8);
  }

  .content-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }

  @media (--breakpoint-sm) {
    .content-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (--breakpoint-lg) {
    .content-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .browse-btn {
    display: inline-flex;
    align-items: center;
    padding: var(--space-2) var(--space-4);
    background-color: var(--color-interactive);
    color: var(--color-text-inverse);
    border-radius: var(--radius-lg);
    text-decoration: none;
    font-weight: var(--font-medium);
    transition: var(--transition-colors);
  }

  .browse-btn:hover {
    background-color: var(--color-interactive-hover);
  }

  .clear-filters-btn {
    display: inline-flex;
    align-items: center;
    padding: var(--space-2) var(--space-4);
    background-color: transparent;
    color: var(--color-interactive);
    border: var(--border-width) var(--border-style) var(--color-interactive);
    border-radius: var(--radius-lg);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .clear-filters-btn:hover {
    background-color: var(--color-interactive);
    color: var(--color-text-inverse);
  }

  .clear-filters-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .browse-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  /* Sort bar */
  .sort-bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
    max-width: 480px;
  }

  /* List view */
  .content-grid[data-view='list'] {
    grid-template-columns: 1fr;
    gap: var(--space-3);
  }

  /* Pagination */
  .pagination-wrapper {
    display: flex;
    justify-content: center;
    padding-top: var(--space-6);
    margin-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }
</style>

<!--
  @component OrgLibraryPage

  User's content library scoped to this organization.
  Shows only purchases from this org, with a link to the full cross-org library.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import ErrorBanner from '$lib/components/ui/Feedback/ErrorBanner.svelte';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import LibraryFilters from '$lib/components/library/LibraryFilters.svelte';
  import ContinueWatching from '$lib/components/library/ContinueWatching.svelte';
  import LibraryCard from '$lib/components/library/LibraryCard.svelte';
  import { Pagination } from '$lib/components/ui/Pagination';
  import Select from '$lib/components/ui/Select/Select.svelte';
  import { buildContentUrl, buildPlatformUrl } from '$lib/utils/subdomain';
  import { browser } from '$app/environment';
  import { ViewToggle } from '$lib/components/ui/ViewToggle';
  import { BackToTop } from '$lib/components/ui/BackToTop';
  import { ShoppingBagIcon } from '$lib/components/ui/Icon';
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

  const orgName = $derived(data.org?.name ?? 'Organization');

  // Build root domain library URL for the "view all" link
  const fullLibraryUrl = $derived(buildPlatformUrl(page.url, '/library'));

  // Sort options
  const sortOptions = $derived([
    { value: 'recent', label: m.library_sort_recent_purchase() },
    { value: 'watched', label: m.library_sort_recent_watched() },
    { value: 'az', label: m.library_sort_az() },
    { value: 'za', label: m.library_sort_za() },
  ]);

  const currentSort = $derived(data.sort ?? 'recent');

  // Pagination
  const currentPage = $derived(data.library?.pagination?.page ?? 1);
  const totalPages = $derived.by(() => {
    const pagination = data.library?.pagination;
    if (!pagination) return 1;
    return Math.max(1, pagination.totalPages ?? Math.ceil(pagination.total / pagination.limit));
  });

  /** Build URLSearchParams preserving current filter state */
  function buildFilterParams(overrides?: { sort?: string }) {
    const params = new URLSearchParams();
    const sort = overrides?.sort ?? currentSort;
    if (sort !== 'recent') params.set('sort', sort);
    if (filters.contentType !== 'all') params.set('type', filters.contentType);
    if (filters.accessType !== 'all') params.set('access', filters.accessType);
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
    accessType: data.accessType ?? 'all',
    search: data.search ?? '',
  });

  let filtersRef: LibraryFilters | undefined = $state();

  function handleFilterChange(newFilters: { contentType: string; progressStatus: string; accessType: string; search: string }) {
    const params = new URLSearchParams();
    if (currentSort !== 'recent') params.set('sort', currentSort);
    if (newFilters.contentType !== 'all') params.set('type', newFilters.contentType);
    if (newFilters.accessType !== 'all') params.set('access', newFilters.accessType);
    if (newFilters.progressStatus !== 'all') params.set('progress', newFilters.progressStatus);
    if (newFilters.search) params.set('q', newFilters.search);
    // Reset to page 1 when filters change
    const qs = params.toString();
    void goto(`/library${qs ? `?${qs}` : ''}`, { replaceState: true });
  }

  const hasActiveFilters = $derived(
    filters.contentType !== 'all' ||
    filters.progressStatus !== 'all' ||
    filters.accessType !== 'all' ||
    filters.search !== ''
  );

  // Items from server data — already filtered by the API
  const filteredItems = $derived(data.library?.items ?? []);
</script>

<svelte:head>
  <title>My {orgName} Library</title>
</svelte:head>

<div class="library">
  <div class="library-header">
    <h1 class="library-title">{orgName} Library</h1>
    <a href={fullLibraryUrl} class="full-library-link">
      View full library &rarr;
    </a>
  </div>

  {#if data.error}
    <ErrorBanner
      title="Failed to load library"
      description={data.errorCode === '401'
        ? 'Your session may have expired. Please sign in again.'
        : data.errorCode === '503'
          ? 'The service is temporarily unavailable. Please try again shortly.'
          : 'Your library could not be loaded. Please try refreshing the page.'}
    />
  {:else if filteredItems.length === 0 && !hasActiveFilters}
    <EmptyState title={m.org_library_empty()} description={m.org_library_empty_description({ orgName })} icon={ShoppingBagIcon}>
      {#snippet action()}
        <a href="/explore" class="browse-btn">
          {m.org_library_browse()}
        </a>
      {/snippet}
    </EmptyState>
  {:else}
    <ContinueWatching items={filteredItems} variant="prominent" />

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
      initialAccessType={filters.accessType}
      initialSearch={filters.search}
    />

    {#if filteredItems.length === 0 && hasActiveFilters}
      <div class="no-results">
        <p class="no-results-text">{m.library_no_results()}</p>
        <button
          type="button"
          class="clear-filters-btn"
          onclick={() => { filtersRef?.clearAll(); void goto('/library'); }}
        >
          {m.library_clear_filters()}
        </button>
      </div>
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
    padding: var(--space-8) var(--space-6);
    max-width: 1200px;
    margin: 0 auto;
  }

  .library-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-8);
    flex-wrap: wrap;
  }

  .library-title {
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
  }

  .full-library-link {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    text-decoration: none;
    white-space: nowrap;
    transition: var(--transition-colors);
  }

  .full-library-link:hover {
    color: var(--color-interactive-hover);
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

  .no-results {
    text-align: center;
    padding: var(--space-12) 0;
  }

  .no-results-text {
    color: var(--color-text-secondary);
    margin-bottom: var(--space-4);
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

  .browse-btn:focus-visible,
  .clear-filters-btn:focus-visible {
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

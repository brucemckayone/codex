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
          <a href={buildContentUrl(page.url, item.content)} class="content-card">
            {#if item.content.thumbnailUrl}
              <div class="card-thumb">
                <img
                  src={item.content.thumbnailUrl}
                  alt={item.content.title}
                  class="thumb-img"
                  onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
                {#if item.progress}
                  <div class="progress-track">
                    <div
                      class="progress-fill"
                      style="width: {item.progress.percentComplete}%"
                    ></div>
                  </div>
                {/if}
              </div>
            {:else}
              <div class="card-thumb thumb-placeholder">
                <span class="placeholder-text">No thumbnail</span>
              </div>
            {/if}

            <div class="card-body">
              <h2 class="card-title">
                {item.content.title}
              </h2>

              {#if item.content.description}
                <p class="card-desc">
                  {item.content.description}
                </p>
              {/if}

              {#if item.progress}
                <div class="card-progress">
                  {#if item.progress.completed}
                    <span class="progress-completed">Completed</span>
                  {:else}
                    {item.progress.percentComplete}% watched
                  {/if}
                </div>
              {/if}
            </div>
          </a>
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

  .content-card {
    display: block;
    background-color: var(--color-surface);
    border-radius: var(--radius-lg);
    overflow: hidden;
    text-decoration: none;
    border: var(--border-width) var(--border-style) var(--color-border);
    transition: var(--transition-transform);
  }

  .content-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }

  .card-thumb {
    aspect-ratio: 16 / 9;
    background-color: var(--color-surface-secondary);
    overflow: hidden;
    position: relative;
  }

  .thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thumb-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--color-surface-tertiary);
  }

  .placeholder-text {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .progress-track {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: var(--space-1);
    background-color: var(--color-border);
  }

  .progress-fill {
    height: 100%;
    background-color: var(--color-interactive);
  }

  .card-body {
    padding: var(--space-4);
  }

  .card-title {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    line-height: var(--leading-tight);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .content-card:hover .card-title {
    color: var(--color-interactive);
    transition: var(--transition-colors);
  }

  .card-desc {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
    margin-top: var(--space-1);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .card-progress {
    margin-top: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .progress-completed {
    color: var(--color-success);
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

  .content-card:focus-visible,
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

  .content-grid[data-view='list'] .content-card {
    display: flex;
    flex-direction: row;
  }

  .content-grid[data-view='list'] .card-thumb {
    aspect-ratio: 16 / 9;
    width: 200px;
    min-width: 200px;
    flex-shrink: 0;
  }

  .content-grid[data-view='list'] .card-body {
    flex: 1;
    min-width: 0;
  }

  @media (--below-sm) {
    .content-grid[data-view='list'] .content-card {
      flex-direction: column;
    }

    .content-grid[data-view='list'] .card-thumb {
      width: 100%;
      min-width: 0;
    }
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

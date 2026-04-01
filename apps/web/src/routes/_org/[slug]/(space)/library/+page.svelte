<!--
  @component OrgLibraryPage

  User's content library scoped to this organization.
  Shows only purchases from this org, with a link to the full cross-org library.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import ErrorBanner from '$lib/components/ui/Feedback/ErrorBanner.svelte';
  import LibraryFilters from '$lib/components/library/LibraryFilters.svelte';
  import { Pagination } from '$lib/components/ui/Pagination';
  import { buildContentUrl, buildPlatformUrl } from '$lib/utils/subdomain';
  import * as m from '$paraglide/messages';

  let { data } = $props();

  const orgName = $derived(data.org?.name ?? 'Organization');

  // Build root domain library URL for the "view all" link
  const fullLibraryUrl = $derived(buildPlatformUrl(page.url, '/library'));

  // Sort options
  const sortOptions = [
    { value: 'recent', label: m.library_sort_recent_purchase() },
    { value: 'watched', label: m.library_sort_recent_watched() },
    { value: 'az', label: m.library_sort_az() },
    { value: 'za', label: m.library_sort_za() },
  ] as const;

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

  function handleSortChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const params = new URLSearchParams();
    params.set('sort', select.value);
    void goto(`/library?${params.toString()}`);
  }

  const paginationBaseUrl = $derived.by(() => {
    const params = new URLSearchParams();
    if (currentSort && currentSort !== 'recent') {
      params.set('sort', currentSort);
    }
    const qs = params.toString();
    return `/library${qs ? `?${qs}` : ''}`;
  });

  // Filter state
  let filters = $state({
    contentType: 'all',
    progressStatus: 'all',
    accessType: 'all',
    search: '',
  });

  let filtersRef: LibraryFilters | undefined = $state();

  function handleFilterChange(newFilters: { contentType: string; progressStatus: string; accessType: string; search: string }) {
    filters = newFilters;
  }

  const hasActiveFilters = $derived(
    filters.contentType !== 'all' ||
    filters.progressStatus !== 'all' ||
    filters.accessType !== 'all' ||
    filters.search !== ''
  );

  // Items from server data (no live query needed — org library is server-driven)
  const allItems = $derived(data.library?.items ?? []);

  // Client-side filtering
  const filteredItems = $derived.by(() => {
    if (!hasActiveFilters) return allItems;

    return allItems.filter((item: { content: { contentType?: string; title?: string; description?: string }; accessType?: string; progress?: { positionSeconds: number; completed: boolean } }) => {
      if (filters.contentType !== 'all') {
        const type = item.content.contentType?.toLowerCase() ?? '';
        if (type !== filters.contentType) return false;
      }

      if (filters.accessType !== 'all') {
        if ((item.accessType ?? 'purchased') !== filters.accessType) return false;
      }

      if (filters.progressStatus !== 'all') {
        const progress = item.progress;
        switch (filters.progressStatus) {
          case 'not_started':
            if (progress && (progress.positionSeconds > 0 || progress.completed)) return false;
            break;
          case 'in_progress':
            if (!progress || progress.positionSeconds === 0 || progress.completed) return false;
            break;
          case 'completed':
            if (!progress || !progress.completed) return false;
            break;
        }
      }

      if (filters.search) {
        const search = filters.search.toLowerCase();
        const title = item.content.title?.toLowerCase() ?? '';
        const description = item.content.description?.toLowerCase() ?? '';
        if (!title.includes(search) && !description.includes(search)) return false;
      }

      return true;
    });
  });
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
  {:else if allItems.length === 0 && !hasActiveFilters}
    <div class="empty-state">
      <p class="empty-text">
        You haven't purchased any content from {orgName} yet.
      </p>
      <a href="/explore" class="browse-btn">
        Browse Content
      </a>
    </div>
  {:else}
    <!-- Sort dropdown -->
    <div class="sort-bar">
      <label for="library-sort" class="sort-label">{m.library_sort_label()}</label>
      <select
        id="library-sort"
        class="sort-select"
        value={currentSort}
        onchange={handleSortChange}
      >
        {#each sortOptions as option (option.value)}
          <option value={option.value} selected={currentSort === option.value}>
            {option.label}
          </option>
        {/each}
      </select>
    </div>

    <LibraryFilters bind:this={filtersRef} onFilterChange={handleFilterChange} />

    {#if filteredItems.length === 0 && hasActiveFilters}
      <div class="no-results">
        <p class="no-results-text">{m.library_no_results()}</p>
        <button
          type="button"
          class="clear-filters-btn"
          onclick={() => filtersRef?.clearAll()}
        >
          {m.library_clear_filters()}
        </button>
      </div>
    {:else}
      <div class="content-grid">
        {#each filteredItems as item (item.content.id)}
          <a href={buildContentUrl(page.url, item.content)} class="content-card">
            {#if item.content.thumbnailUrl}
              <div class="card-thumb">
                <img
                  src={item.content.thumbnailUrl}
                  alt={item.content.title}
                  class="thumb-img"
                  onerror={(e) => { e.currentTarget.style.display = 'none'; }}
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
    color: var(--color-primary-500);
    text-decoration: none;
    white-space: nowrap;
    transition: var(--transition-colors);
  }

  .full-library-link:hover {
    color: var(--color-primary-600);
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
    background-color: var(--color-neutral-100);
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
    background-color: var(--color-neutral-200);
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
    background-color: var(--color-neutral-300);
  }

  .progress-fill {
    height: 100%;
    background-color: var(--color-primary-500);
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
    color: var(--color-primary-500);
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

  .empty-state {
    text-align: center;
    padding: var(--space-16) 0;
  }

  .empty-text {
    color: var(--color-text-secondary);
    margin-bottom: var(--space-4);
  }

  .browse-btn {
    display: inline-flex;
    align-items: center;
    padding: var(--space-2) var(--space-4);
    background-color: var(--color-primary-500);
    color: var(--color-text-inverse);
    border-radius: var(--radius-lg);
    text-decoration: none;
    font-weight: var(--font-medium);
    transition: var(--transition-colors);
  }

  .browse-btn:hover {
    background-color: var(--color-primary-600);
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
    color: var(--color-primary-500);
    border: var(--border-width) var(--border-style) var(--color-primary-500);
    border-radius: var(--radius-lg);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .clear-filters-btn:hover {
    background-color: var(--color-primary-500);
    color: var(--color-text-inverse);
  }

  .content-card:focus-visible,
  .browse-btn:focus-visible,
  .clear-filters-btn:focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
  }

  /* Sort bar */
  .sort-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }

  .sort-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .sort-select {
    padding: var(--space-1-5) var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .sort-select:focus {
    outline: 2px solid var(--color-primary-500);
    outline-offset: -1px;
    border-color: var(--color-primary-500);
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

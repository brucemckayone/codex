<script lang="ts">
  /**
   * Organization explore page
   * Filterable content grid with search, type filters, and sorting
   */
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import * as m from '$paraglide/messages';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { Pagination } from '$lib/components/ui/Pagination';
  import { PageContainer } from '$lib/components/ui';

  const { data }: { data: PageData } = $props();

  // Local state for filters
  let searchValue = $state(data.filters.q ?? '');
  let typeValue = $state(data.filters.type ?? 'all');
  let sortValue = $state(data.filters.sort ?? 'newest');

  let searchTimeout: ReturnType<typeof setTimeout>;

  function handleSearch(value: string) {
    searchValue = value;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      updateUrl('q', value.trim());
    }, 300);
  }

  function updateFilter(key: string, value: string) {
    updateUrl(key, value);
  }

  function updateUrl(key: string, value: string) {
    const url = new URL(window.location.href);
    if (value && value !== 'all') {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
    url.searchParams.set('page', '1');
    goto(url.toString());
  }

  function goToPage(pageNum: number) {
    const url = new URL(window.location.href);
    url.searchParams.set('page', String(pageNum));
    goto(url.toString());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const hasContent = $derived(data.items.length > 0);
  const hasActiveFilters = $derived(data.filters.q || data.filters.type);
  const emptyMessage = $derived(hasActiveFilters ? m.org_explore_no_results() : m.org_explore_empty());
</script>

<svelte:head>
  <title>{m.org_explore_title()} | {data.org?.name ?? 'Organization'}</title>
  <meta name="description" content={m.org_explore_subtitle()} />
</svelte:head>

<PageContainer>
  <header class="page-header">
    <h1>{m.org_explore_title()}</h1>
    <p class="subtitle">{m.org_explore_subtitle()}</p>
  </header>

  <form class="filters" method="get" action={`/${data.org?.slug ?? 'org'}/explore`}>
    <div class="search-wrapper">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="search-icon">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      <input
        type="search"
        placeholder={m.org_explore_search_placeholder()}
        value={searchValue}
        oninput={(e) => handleSearch(e.currentTarget.value)}
        class="search-input"
        aria-label="Search content"
      />
    </div>

    <select value={typeValue} onchange={(e) => updateFilter('type', e.currentTarget.value)} class="filter-select" aria-label="Filter by content type">
      <option value="all">{m.org_explore_filter_all()}</option>
      <option value="video">{m.org_explore_filter_video()}</option>
      <option value="audio">{m.org_explore_filter_audio()}</option>
      <option value="written">{m.org_explore_filter_written()}</option>
    </select>

    <select value={sortValue} onchange={(e) => updateFilter('sort', e.currentTarget.value)} class="filter-select" aria-label="Sort content">
      <option value="newest">{m.org_explore_sort_newest()}</option>
      <option value="popular">{m.org_explore_sort_popular()}</option>
      <option value="az">{m.org_explore_sort_az()}</option>
    </select>

    {#if hasActiveFilters}
      <button type="button" onclick={() => goto(`/${data.org?.slug ?? 'org'}/explore`)} class="clear-btn" aria-label="Clear all filters">Clear filters</button>
    {/if}
  </form>

  {#if hasContent}
    <div class="content-grid">
      {#each data.items as item (item.id)}
        <ContentCard
          id={item.id}
          title={item.title}
          thumbnail={item.thumbnail}
          description={item.description}
          contentType={item.contentType ?? 'video'}
          duration={item.duration}
          creator={item.creator}
          href={`/content/${item.id}`}
        />
      {/each}
    </div>

    {#if data.totalPages > 1}
      <div class="pagination-wrapper">
        <Pagination
          currentPage={data.filters.page}
          totalPages={data.totalPages}
          onPageChange={goToPage}
        />
      </div>
    {/if}
  {:else}
    <div class="empty-state">
      <p>{emptyMessage}</p>
      {#if hasActiveFilters}
        <button onclick={() => goto(`/${data.org?.slug ?? 'org'}/explore`)} class="clear-btn">Clear filters</button>
      {/if}
    </div>
  {/if}
</PageContainer>

<style>
  .page-header {
    margin-bottom: var(--space-8);
    text-align: center;
  }

  .page-header h1 {
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    font-family: var(--font-heading);
    color: var(--color-text);
  }

  .subtitle {
    margin-top: var(--space-2);
    font-size: var(--text-base);
    color: var(--color-text-secondary);
  }

  .filters {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
    margin-bottom: var(--space-8);
    align-items: center;
  }

  .search-wrapper {
    position: relative;
    flex: 1;
    min-width: 200px;
  }

  .search-icon {
    position: absolute;
    left: var(--space-3);
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-text-secondary);
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    padding: var(--space-2) var(--space-4);
    padding-left: var(--space-9);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    font-size: var(--text-sm);
    background-color: var(--color-surface);
    color: var(--color-text);
    transition: var(--transition-colors);
  }

  .search-input:focus {
    outline: none;
    border-color: var(--color-primary-500);
    box-shadow: 0 0 0 2px var(--color-primary-100);
  }

  .filter-select {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    font-size: var(--text-sm);
    background-color: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .filter-select:focus {
    outline: none;
    border-color: var(--color-primary-500);
    box-shadow: 0 0 0 2px var(--color-primary-100);
  }

  .clear-btn {
    padding: var(--space-2) var(--space-4);
    background: transparent;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: var(--text-sm);
    color: var(--color-text);
    transition: var(--transition-colors);
  }

  .clear-btn:hover {
    background-color: var(--color-surface-secondary);
    border-color: var(--color-primary-500);
  }

  .content-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-6);
  }

  @media (min-width: 640px) {
    .content-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (min-width: 1024px) {
    .content-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .pagination-wrapper {
    display: flex;
    justify-content: center;
    margin-top: var(--space-8);
  }

  .empty-state {
    text-align: center;
    padding: var(--space-16) var(--space-4);
    color: var(--color-text-secondary);
  }

  .empty-state p {
    font-size: var(--text-lg);
    margin-bottom: var(--space-4);
  }

  /* Dark mode - semantic tokens automatically adapt via theme files */
</style>

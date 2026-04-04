<!--
  @component LibraryFilters

  Provides content type, progress status, access type, and search filtering
  for the library page. Filters trigger server-side navigation via URL params.

  @prop {(filters: FilterValues) => void} onFilterChange - Callback when filters change
  @prop {string} initialContentType - Initial content type from URL state
  @prop {string} initialProgressStatus - Initial progress status from URL state
  @prop {string} initialAccessType - Initial access type from URL state
  @prop {string} initialSearch - Initial search term from URL state
-->
<script lang="ts">
  import * as m from '$paraglide/messages';

  interface FilterValues {
    contentType: string;
    progressStatus: string;
    accessType: string;
    search: string;
  }

  interface Props {
    onFilterChange: (filters: FilterValues) => void;
    initialContentType?: string;
    initialProgressStatus?: string;
    initialAccessType?: string;
    initialSearch?: string;
  }

  const {
    onFilterChange,
    initialContentType = 'all',
    initialProgressStatus = 'all',
    initialAccessType = 'all',
    initialSearch = '',
  }: Props = $props();

  let contentType = $state(initialContentType);
  let progressStatus = $state(initialProgressStatus);
  let accessType = $state(initialAccessType);
  let searchInput = $state(initialSearch);
  let searchDebounced = $state(initialSearch);

  const contentTypeOptions = [
    { value: 'all', label: m.library_filter_all_types() },
    { value: 'video', label: m.library_filter_video() },
    { value: 'audio', label: m.library_filter_audio() },
    { value: 'article', label: m.library_filter_article() },
  ];

  const progressOptions = [
    { value: 'all', label: m.library_filter_all_progress() },
    { value: 'not_started', label: m.library_filter_not_started() },
    { value: 'in_progress', label: m.library_filter_in_progress() },
    { value: 'completed', label: m.library_filter_completed() },
  ];

  const accessTypeOptions = [
    { value: 'all', label: m.library_filter_all_access() },
    { value: 'purchased', label: m.library_filter_purchased() },
    { value: 'membership', label: m.library_filter_membership() },
  ];

  // Debounce search input by 300ms
  $effect(() => {
    const value = searchInput;
    const timeout = setTimeout(() => {
      searchDebounced = value;
    }, 300);
    return () => clearTimeout(timeout);
  });

  let mounted = $state(false);

  $effect(() => {
    // Track all filter values so Svelte subscribes to them
    const filters = { contentType, progressStatus, accessType, search: searchDebounced };
    if (!mounted) {
      mounted = true;
      return;
    }
    onFilterChange(filters);
  });

  export function clearAll() {
    contentType = 'all';
    progressStatus = 'all';
    accessType = 'all';
    searchInput = '';
    searchDebounced = '';
  }
</script>

<div class="library-filters">
  <div class="filters-row">
    <div class="filter-group">
      {#each contentTypeOptions as option (option.value)}
        <button
          class="filter-btn"
          class:filter-btn--active={contentType === option.value}
          onclick={() => (contentType = option.value)}
          type="button"
        >
          {option.label}
        </button>
      {/each}
    </div>

    <div class="filter-group">
      {#each progressOptions as option (option.value)}
        <button
          class="filter-btn"
          class:filter-btn--active={progressStatus === option.value}
          onclick={() => (progressStatus = option.value)}
          type="button"
        >
          {option.label}
        </button>
      {/each}
    </div>

    <div class="filter-group">
      {#each accessTypeOptions as option (option.value)}
        <button
          class="filter-btn"
          class:filter-btn--active={accessType === option.value}
          onclick={() => (accessType = option.value)}
          type="button"
        >
          {option.label}
        </button>
      {/each}
    </div>
  </div>

  <div class="search-row">
    <input
      type="text"
      class="search-input"
      placeholder={m.library_search_placeholder()}
      bind:value={searchInput}
    />
  </div>
</div>

<style>
  .library-filters {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin-bottom: var(--space-6);
  }

  .filters-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  @media (--breakpoint-sm) {
    .filters-row {
      flex-direction: row;
      gap: var(--space-4);
    }
  }

  .filter-group {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .filter-btn {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full, 9999px);
    background-color: var(--color-surface);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: var(--transition-colors);
    white-space: nowrap;
  }

  .filter-btn:hover {
    border-color: var(--color-border-hover);
    color: var(--color-text);
  }

  .filter-btn--active {
    background-color: var(--color-interactive);
    border-color: var(--color-interactive);
    color: var(--color-text-inverse);
  }

  .filter-btn--active:hover {
    background-color: var(--color-interactive-hover);
    border-color: var(--color-interactive-hover);
    color: var(--color-text-inverse);
  }

  .filter-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--border-width-thick);
  }

  .search-row {
    width: 100%;
  }

  .search-input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    color: var(--color-text);
    transition: var(--transition-colors);
  }

  .search-input::placeholder {
    color: var(--color-text-muted);
  }

  .search-input:focus {
    outline: none;
    border-color: var(--color-border-focus);
    box-shadow: 0 0 0 1px var(--color-interactive);
  }

</style>

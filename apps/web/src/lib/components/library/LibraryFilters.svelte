<!--
  @component LibraryFilters

  Provides content type, progress status, and search filtering for the library page.
  All filtering is client-side over TanStack DB live query results.

  @prop {(filters: { contentType: string; progressStatus: string; search: string }) => void} onFilterChange - Callback when filters change
-->
<script lang="ts">
  import * as m from '$paraglide/messages';

  interface FilterValues {
    contentType: string;
    progressStatus: string;
    search: string;
  }

  interface Props {
    onFilterChange: (filters: FilterValues) => void;
  }

  const { onFilterChange }: Props = $props();

  let contentType = $state('all');
  let progressStatus = $state('all');
  let searchInput = $state('');
  let searchDebounced = $state('');

  const contentTypeOptions = $derived([
    { value: 'all', label: m.library_filter_all_types() },
    { value: 'video', label: m.library_filter_video() },
    { value: 'audio', label: m.library_filter_audio() },
    { value: 'article', label: m.library_filter_article() },
  ]);

  const progressOptions = $derived([
    { value: 'all', label: m.library_filter_all_progress() },
    { value: 'not_started', label: m.library_filter_not_started() },
    { value: 'in_progress', label: m.library_filter_in_progress() },
    { value: 'completed', label: m.library_filter_completed() },
  ]);

  // Debounce search input by 300ms
  $effect(() => {
    const value = searchInput;
    const timeout = setTimeout(() => {
      searchDebounced = value;
    }, 300);
    return () => clearTimeout(timeout);
  });

  // Emit filter values whenever any filter changes
  $effect(() => {
    onFilterChange({
      contentType,
      progressStatus,
      search: searchDebounced,
    });
  });

  export function clearAll() {
    contentType = 'all';
    progressStatus = 'all';
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
    background-color: var(--color-primary-500);
    border-color: var(--color-primary-500);
    color: var(--color-text-inverse);
  }

  .filter-btn--active:hover {
    background-color: var(--color-primary-600);
    border-color: var(--color-primary-600);
    color: var(--color-text-inverse);
  }

  .filter-btn:focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
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
    border-color: var(--color-primary-500);
    box-shadow: 0 0 0 1px var(--color-primary-500);
  }

  /* Dark mode */
  :global([data-theme='dark']) .filter-btn {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
    color: var(--color-text-secondary-dark);
  }

  :global([data-theme='dark']) .filter-btn:hover {
    border-color: var(--color-border-hover-dark);
    color: var(--color-text);
  }

  :global([data-theme='dark']) .filter-btn--active {
    background-color: var(--color-primary-500);
    border-color: var(--color-primary-500);
    color: var(--color-text-inverse);
  }

  :global([data-theme='dark']) .search-input {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
    color: var(--color-text);
  }
</style>

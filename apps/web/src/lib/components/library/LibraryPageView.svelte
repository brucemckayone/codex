<!--
  @component LibraryPageView

  Shared library page template used by both the platform and org library routes.
  Handles: heading, error state, empty state, continue watching, sort/filter/view toggle,
  content grid, and pagination.

  @prop {string} title - Page title (e.g. "My Library" or "Org Library")
  @prop {Array} items - Library items to display
  @prop {Array} continueWatchingItems - Items for the ContinueWatching section
  @prop {boolean} error - Whether the load errored
  @prop {string | null} errorCode - Error code for message selection
  @prop {boolean} isLoading - Whether data is still loading
  @prop {object} filters - Current filter state
  @prop {string} currentSort - Current sort value
  @prop {number} currentPage - Current page number
  @prop {number} totalPages - Total pages
  @prop {string} emptyTitle - Title for empty state
  @prop {string} emptyDescription - Description for empty state
  @prop {string} browseHref - Link for the "browse" action in empty state
  @prop {string} browseLabel - Label for the browse action
  @prop {Snippet} [headerExtra] - Optional extra header content (e.g. "view full library" link)
  @prop {(value: string | undefined) => void} onSortChange - Sort change handler
  @prop {(filters: any) => void} onFilterChange - Filter change handler
  @prop {() => void} onClearFilters - Clear all filters handler
  @prop {(page: number) => void} [onPageChange] - Page change handler for client-side pagination
  @prop {(href: string) => string} buildItemHref - Build href for each library card
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import ErrorBanner from '$lib/components/ui/Feedback/ErrorBanner.svelte';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { ShoppingBagIcon, SearchXIcon } from '$lib/components/ui/Icon';
  import LibraryFilters from './LibraryFilters.svelte';
  import ContinueWatching from './ContinueWatching.svelte';
  import { Pagination } from '$lib/components/ui/Pagination';
  import Select from '$lib/components/ui/Select/Select.svelte';
  import { ViewToggle } from '$lib/components/ui/ViewToggle';
  import { BackToTop } from '$lib/components/ui/BackToTop';
  import { useViewMode } from '$lib/utils/view-mode.svelte';
  import { subscriptionCollection, useLiveQuery } from '$lib/collections';
  import type { SubscriptionItem } from '$lib/collections';
  import {
    indexSubscriptionsBySlug,
    getLibraryAccessState,
  } from '$lib/subscription/library-access';
  import * as m from '$paraglide/messages';

  interface Props {
    title: string;
    items: Array<{ content: { id: string; [key: string]: unknown }; [key: string]: unknown }>;
    continueWatchingItems: Array<{ content: { id: string; [key: string]: unknown }; [key: string]: unknown }>;
    error: boolean;
    errorCode: string | null;
    errorTitle?: string;
    errorMessages?: { unauthorized: string; unavailable: string; default: string };
    isLoading?: boolean;
    filters: {
      contentType: string;
      progressStatus: string;
      accessType?: string;
      search: string;
    };
    currentSort: string;
    currentPage: number;
    totalPages: number;
    emptyTitle: string;
    emptyDescription: string;
    browseHref: string;
    browseLabel: string;
    headerExtra?: Snippet;
    onSortChange: (value: string | undefined) => void;
    onFilterChange: (filters: { contentType: string; progressStatus: string; accessType?: string; search: string }) => void;
    onClearFilters: () => void;
    onPageChange?: (page: number) => void;
    buildItemHref: (item: { content: { id: string; [key: string]: unknown }; [key: string]: unknown }) => string;
  }

  const {
    title,
    items,
    continueWatchingItems,
    error,
    errorCode,
    errorTitle,
    errorMessages,
    isLoading = false,
    filters,
    currentSort,
    currentPage,
    totalPages,
    emptyTitle,
    emptyDescription,
    browseHref,
    browseLabel,
    headerExtra,
    onSortChange,
    onFilterChange,
    onClearFilters,
    onPageChange,
    buildItemHref,
  }: Props = $props();

  const { viewMode, handleViewChange } = useViewMode();

  const sortOptions = $derived([
    { value: 'recent', label: m.library_sort_recent_purchase() },
    { value: 'watched', label: m.library_sort_recent_watched() },
    { value: 'az', label: m.library_sort_az() },
    { value: 'za', label: m.library_sort_za() },
  ]);

  const hasActiveFilters = $derived(
    filters.contentType !== 'all' ||
    filters.progressStatus !== 'all' ||
    (filters.accessType !== undefined && filters.accessType !== 'all') ||
    filters.search !== ''
  );

  let filtersRef: LibraryFilters | undefined = $state();

  function handleClearFilters() {
    filtersRef?.clearAll();
    onClearFilters();
  }

  const defaultErrorTitle = $derived(errorTitle ?? m.library_error_title());
  const defaultErrorMessages = $derived(errorMessages ?? {
    unauthorized: m.library_error_unauthorized(),
    unavailable: m.library_error_unavailable(),
    default: m.library_error_default(),
  });

  // ── Subscription-backed access state join (Codex-k7ppt) ─────────────────
  // Live query over subscriptionCollection so cards flip to 'cancelling' /
  // 'revoked' in real time when a Stripe webhook reconciles the row. No data
  // during SSR — decoration only, so an empty fallback is safe.
  const subsQuery = useLiveQuery(
    (q) => q.from({ sub: subscriptionCollection }),
    undefined,
    { ssrData: [] as SubscriptionItem[] }
  );

  const subsBySlug = $derived(
    indexSubscriptionsBySlug((subsQuery.data ?? []) as SubscriptionItem[])
  );

  function stateForItem(item: Props['items'][number]) {
    const accessType = (item as { accessType?: string }).accessType;
    const organizationSlug =
      (item.content as { organizationSlug?: string | null }).organizationSlug ?? null;
    if (accessType !== 'purchased' && accessType !== 'membership' && accessType !== 'subscription') {
      return { kind: 'active' as const };
    }
    return getLibraryAccessState(
      { accessType, organizationSlug },
      subsBySlug
    );
  }
</script>

<div class="library">
  <div class="library-header">
    <h1 class="library-title">{title}</h1>
    {#if headerExtra}
      {@render headerExtra()}
    {/if}
  </div>

  {#if error}
    <ErrorBanner
      title={defaultErrorTitle}
      description={errorCode === '401'
        ? defaultErrorMessages.unauthorized
        : errorCode === '503'
          ? defaultErrorMessages.unavailable
          : defaultErrorMessages.default}
    />
  {:else if isLoading && items.length === 0}
    <div class="content-grid content-grid--compact">
      {#each Array(6) as _, i (i)}
        <ContentCard id="" title="" loading={true} />
      {/each}
    </div>
  {:else if items.length === 0 && !hasActiveFilters}
    <EmptyState title={emptyTitle} description={emptyDescription} icon={ShoppingBagIcon}>
      {#snippet action()}
        <a href={browseHref} class="browse-btn">
          {browseLabel}
        </a>
      {/snippet}
    </EmptyState>
  {:else}
    <ContinueWatching items={continueWatchingItems} variant="prominent" />

    <!-- Sort + View Toggle -->
    <div class="sort-bar">
      <Select
        options={sortOptions}
        value={currentSort}
        onValueChange={onSortChange}
        label={m.library_sort_label()}
        placeholder={m.library_sort_label()}
      />
      <ViewToggle value={viewMode} onchange={handleViewChange} />
    </div>

    <LibraryFilters
      bind:this={filtersRef}
      onFilterChange={onFilterChange}
      initialContentType={filters.contentType}
      initialProgressStatus={filters.progressStatus}
      initialAccessType={filters.accessType}
      initialSearch={filters.search}
    />

    {#if items.length === 0 && hasActiveFilters}
      <EmptyState title={m.library_no_results()} icon={SearchXIcon}>
        {#snippet action()}
          <button
            type="button"
            class="clear-filters-btn"
            onclick={handleClearFilters}
          >
            {m.library_clear_filters()}
          </button>
        {/snippet}
      </EmptyState>
    {:else}
      <div class="content-grid content-grid--compact" data-view={viewMode}>
        {#each items as item (item.content.id)}
          {@const access = stateForItem(item)}
          <ContentCard
            id={item.content.id}
            title={item.content.title}
            thumbnail={item.content.thumbnailUrl}
            contentType={(item.content.contentType === 'written' ? 'article' : item.content.contentType) as 'video' | 'audio' | 'article'}
            duration={item.content.durationSeconds}
            progress={item.progress}
            purchased={item.accessType === 'purchased'}
            included={item.accessType === 'subscription' || item.accessType === 'membership'}
            href={buildItemHref(item)}
            accessState={access.kind}
            accessStatePeriodEnd={access.kind === 'cancelling' ? access.periodEnd : null}
          />
        {/each}
      </div>

      {#if totalPages > 1}
        <div class="pagination-wrapper">
          <Pagination
            {currentPage}
            {totalPages}
            {onPageChange}
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

  .browse-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
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
    outline-offset: var(--space-0-5);
  }

  /* Sort bar */
  .sort-bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
    max-width: 480px;
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

<!--
  @component LibraryToolbar

  Pinned command bar for the library:
    [🔎 search]   [▦ filter trigger]   [grid|list view toggle]

  Tapping the trigger opens the responsive LibraryFilterDrawer (right-side
  panel on desktop, bottom sheet on mobile) which holds Sort + all facets.

  When any filter/sort is non-default, an active-chip strip renders below
  the sticky row. Each chip dismisses its facet on click; the trailing
  "Clear all" delegates to the parent's onClearAll (which also clears search).

  Structure note: there is intentionally NO outer wrapper around the
  sticky toolbar + chip strip. `position: sticky` only pins within the
  parent's bounding box — wrapping these in a tight column container
  would clamp the sticky element's range to ~70px and defeat the pin.
  Both fragments render as direct children of the parent (LibraryPageView's
  page container), which is the tall scroll-context the sticky needs.
-->
<script lang="ts">
  import LibraryFilterDrawer from './LibraryFilterDrawer.svelte';
  import { ViewToggle } from '$lib/components/ui/ViewToggle';
  import { StickyToolbar } from '$lib/components/ui/StickyToolbar';
  import { SearchPill } from '$lib/components/ui/SearchPill';
  import { FilterTriggerButton } from '$lib/components/ui/FilterTriggerButton';
  import {
    ActiveFiltersStrip,
    type ActiveFilterChip,
  } from '$lib/components/ui/ActiveFiltersStrip';
  import * as m from '$paraglide/messages';

  interface FilterValues {
    contentType: string;
    progressStatus: string;
    accessType: string;
    search: string;
  }
  interface SortOption {
    value: string;
    label: string;
  }

  interface Props {
    filters: FilterValues;
    sort: string;
    sortOptions: SortOption[];
    viewMode: 'grid' | 'list';
    onFilterChange: (filters: FilterValues) => void;
    onSortChange: (value: string | undefined) => void;
    onViewChange: (value: 'grid' | 'list') => void;
    onClearAll: () => void;
  }

  const {
    filters,
    sort,
    sortOptions,
    viewMode,
    onFilterChange,
    onSortChange,
    onViewChange,
    onClearAll,
  }: Props = $props();

  const ALL = 'all';
  const DEFAULT_SORT = 'recent';

  function handleSearchInput(value: string) {
    onFilterChange({ ...filters, search: value });
  }
  function clearSearch() {
    onFilterChange({ ...filters, search: '' });
  }

  // ── Drawer open state (idempotent setter to absorb Melt echoes) ─────
  let drawerOpen = $state(false);
  function setDrawerOpen(next: boolean) {
    if (drawerOpen === next) return;
    drawerOpen = next;
  }

  // ── Derived ─────────────────────────────────────────────────────────
  const facetActiveCount = $derived(
    (filters.contentType !== ALL && filters.contentType !== '' ? 1 : 0) +
      (filters.progressStatus !== ALL && filters.progressStatus !== '' ? 1 : 0) +
      (filters.accessType !== ALL && filters.accessType !== '' ? 1 : 0)
  );
  const triggerActiveCount = $derived(
    facetActiveCount + (sort !== DEFAULT_SORT ? 1 : 0)
  );

  // ── Active-chip strip derivation ────────────────────────────────────
  type FacetKey = 'contentType' | 'progressStatus' | 'accessType';
  type ChipKey = FacetKey | 'sort' | 'search';

  interface FacetMeta {
    key: FacetKey;
    options: { value: string; label: string }[];
  }
  const facetMeta: FacetMeta[] = $derived([
    {
      key: 'contentType',
      options: [
        { value: 'video', label: m.library_filter_video() },
        { value: 'audio', label: m.library_filter_audio() },
        { value: 'written', label: m.library_filter_article() },
      ],
    },
    {
      key: 'progressStatus',
      options: [
        { value: 'not_started', label: m.library_filter_not_started() },
        { value: 'in_progress', label: m.library_filter_in_progress() },
        { value: 'completed', label: m.library_filter_completed() },
      ],
    },
    {
      key: 'accessType',
      options: [
        { value: 'purchased', label: m.library_filter_purchased() },
        { value: 'subscription', label: m.library_filter_subscription() },
        { value: 'membership', label: m.library_filter_membership() },
        { value: 'free', label: m.library_filter_free() },
        { value: 'followers', label: m.library_filter_followers() },
      ],
    },
  ]);

  const activeChips = $derived.by<ActiveFilterChip[]>(() => {
    const out: ActiveFilterChip[] = [];

    if (sort !== DEFAULT_SORT) {
      const label = sortOptions.find((o) => o.value === sort)?.label;
      if (label) out.push({ key: 'sort', label: `${m.library_sort_label()}: ${label}` });
    }

    for (const f of facetMeta) {
      const v = filters[f.key];
      if (v && v !== ALL) {
        const label = f.options.find((o) => o.value === v)?.label;
        if (label) out.push({ key: f.key, label });
      }
    }

    if (filters.search) {
      out.push({ key: 'search', label: `“${filters.search}”` });
    }

    return out;
  });

  function removeChip(chip: ActiveFilterChip) {
    const key = chip.key as ChipKey;
    if (key === 'sort') {
      onSortChange(DEFAULT_SORT);
    } else if (key === 'search') {
      clearSearch();
    } else {
      onFilterChange({ ...filters, [key]: ALL });
    }
  }

  // The drawer manages facets only; it doesn't see `search`.
  function handleDrawerFilterChange(next: {
    contentType: string;
    progressStatus: string;
    accessType: string;
  }) {
    onFilterChange({ ...filters, ...next });
  }
</script>

<StickyToolbar>
  <!-- Container query host: the bar contents establish the inline-size
       container so ViewToggle can hide below 560px without media queries.
       Width 100% so the host fills the sticky row. -->
  <div class="lt-row" data-testid="library-toolbar">
    <SearchPill
      value={filters.search}
      placeholder={m.library_search_placeholder()}
      onChange={handleSearchInput}
      debounce={250}
    />

    <FilterTriggerButton
      activeCount={triggerActiveCount}
      onClick={() => setDrawerOpen(true)}
      expanded={drawerOpen}
      ariaLabel={`${m.library_filters_and_sort()}${triggerActiveCount > 0 ? ` (${triggerActiveCount} active)` : ''}`}
      title={m.library_filters_and_sort()}
    />

    <div class="lt-row__utils">
      <ViewToggle value={viewMode} onchange={onViewChange} />
    </div>
  </div>
</StickyToolbar>

<ActiveFiltersStrip
  chips={activeChips}
  onRemove={removeChip}
  onClearAll={onClearAll}
  clearAllLabel={m.library_clear_filters()}
/>

<LibraryFilterDrawer
  open={drawerOpen}
  onOpenChange={setDrawerOpen}
  filters={{
    contentType: filters.contentType,
    progressStatus: filters.progressStatus,
    accessType: filters.accessType,
  }}
  {sort}
  {sortOptions}
  onFilterChange={handleDrawerFilterChange}
  {onSortChange}
  {onClearAll}
  activeCount={triggerActiveCount}
/>

<style>
  .lt-row {
    flex: 1 1 100%;
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-4);
    container-type: inline-size;
    container-name: library-toolbar;
  }

  .lt-row__utils {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-inline-start: auto;
  }

  /* Mobile: view toggle hidden — the drawer is the all-in-one surface. */
  @container library-toolbar (max-width: 560px) {
    .lt-row__utils {
      display: none;
    }
  }
</style>

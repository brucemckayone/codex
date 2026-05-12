<!--
  FilterDrawerHarness — test harness that wires the generic FilterDrawer
  shell to a small concrete filter shape ({ type: string; featured: boolean })
  so we can exercise the staged/live commit model, badge rendering, and
  the rotation reseed effect.
-->
<script lang="ts" module>
  export interface HarnessFilters {
    type: string;
    featured: boolean;
  }
</script>

<script lang="ts">
  import FilterDrawer from './FilterDrawer.svelte';

  interface Props {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    filters?: HarnessFilters;
    sort?: string;
    defaultFilters?: HarnessFilters;
    defaultSort?: string;
    onFilterChange?: (filters: HarnessFilters) => void;
    onSortChange?: (value: string) => void;
    onClearAll?: () => void;
    activeCount?: number;
    title?: string;
    applyLabel?: string;
    doneLabel?: string;
    clearLabel?: string;
  }

  let {
    open = $bindable(false),
    onOpenChange = () => {},
    filters = { type: '', featured: false },
    sort = 'newest',
    defaultFilters = { type: '', featured: false },
    defaultSort = 'newest',
    onFilterChange = () => {},
    onSortChange = () => {},
    onClearAll = () => {},
    activeCount = 0,
    title = 'Filters & Sort',
    applyLabel = 'Apply',
    doneLabel = 'Done',
    clearLabel = 'Clear filters',
  }: Props = $props();
</script>

<FilterDrawer
  {open}
  {onOpenChange}
  {title}
  {filters}
  {sort}
  {defaultFilters}
  {defaultSort}
  {onFilterChange}
  {onSortChange}
  {onClearAll}
  {activeCount}
  {applyLabel}
  {doneLabel}
  {clearLabel}
>
  {#snippet sections({ filters: view, sort: viewSort, setFilter, setSort, isMobile })}
    <section class="filter-drawer__section" data-testid="harness-section">
      <span data-testid="view-type">{view.type}</span>
      <span data-testid="view-featured">{String(view.featured)}</span>
      <span data-testid="view-sort">{viewSort}</span>
      <span data-testid="view-is-mobile">{String(isMobile)}</span>
      <button
        type="button"
        data-testid="set-type-video"
        onclick={() => setFilter('type', 'video')}
      >
        type=video
      </button>
      <button
        type="button"
        data-testid="set-featured-true"
        onclick={() => setFilter('featured', true)}
      >
        featured=true
      </button>
      <button
        type="button"
        data-testid="set-sort-oldest"
        onclick={() => setSort('oldest')}
      >
        sort=oldest
      </button>
    </section>
  {/snippet}
</FilterDrawer>

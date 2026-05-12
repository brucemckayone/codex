<!--
  @component ExploreFilterDrawer

  Filters & Sort drawer for the org explore page. Thin config wrapper over
  the shared FilterDrawer shell — supplies Sort / Type / Featured section
  content; the shell owns the chrome, animations, responsive geometry, and
  the hybrid desktop-live / mobile-staged commit model.
-->
<script lang="ts">
  import { CheckIcon } from '$lib/components/ui/Icon';
  import { FilterDrawer } from '$lib/components/ui/FilterDrawer';
  import * as m from '$paraglide/messages';

  export interface ExploreFilterValues {
    type: string;
    featured: boolean;
  }
  interface SortOption {
    value: string;
    label: string;
  }
  interface TypeOption {
    value: string;
    label: string;
  }

  interface Props {
    open: boolean;
    filters: ExploreFilterValues;
    sort: string;
    sortOptions: readonly SortOption[];
    typeOptions: readonly TypeOption[];
    onOpenChange: (open: boolean) => void;
    onFilterChange: (filters: ExploreFilterValues) => void;
    onSortChange: (value: string | undefined) => void;
    onClearAll: () => void;
    activeCount?: number;
  }

  const {
    open,
    filters,
    sort,
    sortOptions,
    typeOptions,
    onOpenChange,
    onFilterChange,
    onSortChange,
    onClearAll,
    activeCount = 0,
  }: Props = $props();

  const DEFAULT_SORT = 'newest';

  const defaultFilters: ExploreFilterValues = {
    type: '',
    featured: false,
  };

  function handleSortChange(value: string) {
    onSortChange(value);
  }
</script>

<FilterDrawer
  {open}
  {onOpenChange}
  title={m.explore_filters_and_sort()}
  {filters}
  {sort}
  {defaultFilters}
  defaultSort={DEFAULT_SORT}
  {onFilterChange}
  onSortChange={handleSortChange}
  {onClearAll}
  {activeCount}
  applyLabel={m.explore_apply()}
  doneLabel={m.explore_done()}
  clearLabel={m.explore_clear_filters()}
>
  {#snippet sections({ filters: view, sort: viewSort, setFilter, setSort })}
    <!-- ── Sort (rows, single-select) ──────────────────────────── -->
    <section class="filter-drawer__section" aria-labelledby="efd-sort-heading">
      <h3 class="filter-drawer__heading" id="efd-sort-heading">
        {m.explore_sort_heading()}
      </h3>
      <ul class="filter-drawer__list" role="listbox" aria-label={m.explore_sort_heading()}>
        {#each sortOptions as opt (opt.value)}
          {@const active = viewSort === opt.value}
          <li>
            <button
              type="button"
              class="filter-drawer__option"
              class:is-active={active}
              role="option"
              aria-selected={active}
              onclick={() => setSort(opt.value)}
            >
              <span class="filter-drawer__option-label">{opt.label}</span>
              {#if active}
                <span class="filter-drawer__option-check" aria-hidden="true">
                  <CheckIcon size={14} />
                </span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    </section>

    <!-- ── Type (pills) ────────────────────────────────────────── -->
    <section class="filter-drawer__section" aria-labelledby="efd-type-heading">
      <h3 class="filter-drawer__heading" id="efd-type-heading">
        {m.explore_filter_type_heading()}
      </h3>
      <div class="filter-drawer__pills" role="listbox" aria-label={m.explore_filter_type_heading()}>
        {#each typeOptions as opt (opt.value)}
          {@const active = view.type === opt.value}
          <button
            type="button"
            class="filter-drawer__pill"
            class:is-active={active}
            role="option"
            aria-selected={active}
            onclick={() => setFilter('type', opt.value)}
          >
            {opt.label}
          </button>
        {/each}
      </div>
    </section>

    <!-- ── Featured (single toggle row) ────────────────────────── -->
    <section class="filter-drawer__section" aria-labelledby="efd-featured-heading">
      <h3 class="filter-drawer__heading" id="efd-featured-heading">
        {m.explore_filter_featured_heading()}
      </h3>
      <ul class="filter-drawer__list">
        <li>
          <button
            type="button"
            class="filter-drawer__option"
            class:is-active={view.featured}
            aria-pressed={view.featured}
            onclick={() => setFilter('featured', !view.featured)}
          >
            <span class="filter-drawer__option-label">
              {m.explore_filter_featured_only()}
            </span>
            {#if view.featured}
              <span class="filter-drawer__option-check" aria-hidden="true">
                <CheckIcon size={14} />
              </span>
            {/if}
          </button>
        </li>
      </ul>
    </section>
  {/snippet}
</FilterDrawer>

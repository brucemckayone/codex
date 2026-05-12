<!--
  @component DiscoverFilterDrawer

  Filters & Sort drawer for the /discover (platform-wide) page. Thin config
  wrapper over the shared FilterDrawer shell — supplies the Sort + Type
  section content; the shell owns chrome, animations, responsive geometry,
  and the hybrid desktop-live / mobile-staged commit model.
-->
<script lang="ts">
  import { CheckIcon } from '$lib/components/ui/Icon';
  import { FilterDrawer } from '$lib/components/ui/FilterDrawer';
  import * as m from '$paraglide/messages';
  import type { DiscoverContentType, DiscoverSort } from './DiscoverFilters.svelte';

  export interface DiscoverDrawerFilterValues {
    type: DiscoverContentType;
  }

  interface Props {
    open: boolean;
    filters: DiscoverDrawerFilterValues;
    sort: DiscoverSort;
    onOpenChange: (open: boolean) => void;
    onFilterChange: (filters: DiscoverDrawerFilterValues) => void;
    onSortChange: (value: DiscoverSort) => void;
    onClearAll: () => void;
    activeCount?: number;
  }

  const {
    open,
    filters,
    sort,
    onOpenChange,
    onFilterChange,
    onSortChange,
    onClearAll,
    activeCount = 0,
  }: Props = $props();

  const DEFAULT_SORT: DiscoverSort = 'newest';

  const defaultFilters: DiscoverDrawerFilterValues = {
    type: 'all',
  };

  const sortOptions: { value: DiscoverSort; label: string }[] = [
    { value: 'newest', label: m.discover_sort_newest() },
    { value: 'oldest', label: m.discover_sort_oldest() },
    { value: 'title', label: m.discover_sort_title() },
  ];

  const typeOptions: { value: DiscoverContentType; label: string }[] = [
    { value: 'all', label: m.discover_filter_all() },
    { value: 'video', label: m.discover_filter_video() },
    { value: 'audio', label: m.discover_filter_audio() },
    { value: 'written', label: m.discover_filter_article() },
  ];

  // FilterDrawer's setSort signature is (value: string) — narrow back to
  // the union when crossing the generic boundary.
  function handleSortChange(value: string) {
    const next: DiscoverSort =
      value === 'oldest' || value === 'title' ? value : 'newest';
    onSortChange(next);
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
  clearLabel={m.discover_clear_all()}
>
  {#snippet sections({ filters: view, sort: viewSort, setFilter, setSort })}
    <!-- ── Sort (rows, single-select) ──────────────────────────── -->
    <section class="filter-drawer__section" aria-labelledby="dfd-sort-heading">
      <h3 class="filter-drawer__heading" id="dfd-sort-heading">
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
    <section class="filter-drawer__section" aria-labelledby="dfd-type-heading">
      <h3 class="filter-drawer__heading" id="dfd-type-heading">
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
  {/snippet}
</FilterDrawer>

<!--
  @component LibraryFilterDrawer

  Filters & Sort drawer for the library. Thin config wrapper over the shared
  FilterDrawer shell — supplies the Sort / Type / Progress / Access section
  content; the shell owns the chrome, animations, responsive geometry, and
  the hybrid desktop-live / mobile-staged commit model.
-->
<script lang="ts">
  import { CheckIcon } from '$lib/components/ui/Icon';
  import { FilterDrawer } from '$lib/components/ui/FilterDrawer';
  import * as m from '$paraglide/messages';

  export interface LibraryFilterValues {
    contentType: string;
    progressStatus: string;
    accessType: string;
  }
  interface SortOption {
    value: string;
    label: string;
  }

  interface Props {
    open: boolean;
    filters: LibraryFilterValues;
    sort: string;
    sortOptions: SortOption[];
    onOpenChange: (open: boolean) => void;
    onFilterChange: (filters: LibraryFilterValues) => void;
    onSortChange: (value: string | undefined) => void;
    onClearAll: () => void;
    activeCount?: number;
  }

  const {
    open,
    filters,
    sort,
    sortOptions,
    onOpenChange,
    onFilterChange,
    onSortChange,
    onClearAll,
    activeCount = 0,
  }: Props = $props();

  const ALL = 'all';
  const DEFAULT_SORT = 'recent';

  // FilterDrawer is generic over the filter shape; it expects a default
  // value for every facet so the in-drawer mobile "Clear all" can reset
  // staged state without re-flushing to the parent.
  const defaultFilters: LibraryFilterValues = {
    contentType: ALL,
    progressStatus: ALL,
    accessType: ALL,
  };

  // ── Facet config ────────────────────────────────────────────────────
  interface FacetOption {
    value: string;
    label: string;
  }
  type FacetKey = keyof LibraryFilterValues;
  interface Facet {
    key: FacetKey;
    title: string;
    anyLabel: string;
    options: FacetOption[];
  }

  const facets: Facet[] = $derived([
    {
      key: 'contentType',
      title: m.library_filter_group_type(),
      anyLabel: m.library_filter_all_types(),
      options: [
        { value: 'video', label: m.library_filter_video() },
        { value: 'audio', label: m.library_filter_audio() },
        { value: 'written', label: m.library_filter_article() },
      ],
    },
    {
      key: 'progressStatus',
      title: m.library_filter_group_progress(),
      anyLabel: m.library_filter_all_progress(),
      options: [
        { value: 'not_started', label: m.library_filter_not_started() },
        { value: 'in_progress', label: m.library_filter_in_progress() },
        { value: 'completed', label: m.library_filter_completed() },
      ],
    },
    {
      key: 'accessType',
      title: m.library_filter_group_access(),
      anyLabel: m.library_filter_all_access(),
      options: [
        { value: 'purchased', label: m.library_filter_purchased() },
        { value: 'subscription', label: m.library_filter_subscription() },
        { value: 'membership', label: m.library_filter_membership() },
        { value: 'free', label: m.library_filter_free() },
        { value: 'followers', label: m.library_filter_followers() },
      ],
    },
  ]);

  // Adapter: FilterDrawer's onSortChange is non-nullable; the parent
  // accepts string | undefined for legacy reasons.
  function handleSortChange(value: string) {
    onSortChange(value);
  }
</script>

<FilterDrawer
  {open}
  {onOpenChange}
  title={m.library_filters_and_sort()}
  {filters}
  {sort}
  {defaultFilters}
  defaultSort={DEFAULT_SORT}
  {onFilterChange}
  onSortChange={handleSortChange}
  {onClearAll}
  {activeCount}
  applyLabel={m.library_apply()}
  doneLabel={m.library_done()}
  clearLabel={m.library_clear_filters()}
>
  {#snippet sections({ filters: view, sort: viewSort, setFilter, setSort })}
    <!-- ── Sort ────────────────────────────────────────────────── -->
    <section class="filter-drawer__section" aria-labelledby="lfd-sort-heading">
      <h3 class="filter-drawer__heading" id="lfd-sort-heading">
        {m.library_sort_label()}
      </h3>
      <ul class="filter-drawer__list" role="listbox" aria-label={m.library_sort_label()}>
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

    <!-- ── Facet sections (pill grids) ─────────────────────────── -->
    {#each facets as facet (facet.key)}
      {@const current = view[facet.key]}
      {@const isAny = current === ALL || current === ''}
      <section class="filter-drawer__section" aria-labelledby={`lfd-${facet.key}-heading`}>
        <h3 class="filter-drawer__heading" id={`lfd-${facet.key}-heading`}>
          {facet.title}
        </h3>
        <div class="filter-drawer__pills" role="listbox" aria-label={facet.title}>
          <button
            type="button"
            class="filter-drawer__pill"
            class:is-active={isAny}
            role="option"
            aria-selected={isAny}
            onclick={() => setFilter(facet.key, ALL)}
          >
            {facet.anyLabel}
          </button>
          {#each facet.options as opt (opt.value)}
            {@const active = current === opt.value}
            <button
              type="button"
              class="filter-drawer__pill"
              class:is-active={active}
              role="option"
              aria-selected={active}
              onclick={() => setFilter(facet.key, opt.value)}
            >
              {opt.label}
            </button>
          {/each}
        </div>
      </section>
    {/each}
  {/snippet}
</FilterDrawer>

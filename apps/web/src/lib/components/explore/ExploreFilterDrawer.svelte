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
    <!--
      A11Y — ONE name per section. Each `<section>` below is deliberately
      UNNAMED. Naming it made it a `region` LANDMARK inside a dialog (landmarks
      are a page-navigation affordance and are meaningless in a modal) AND
      produced a THIRD announcement of the same string — Chrome's a11y tree read
      `region "Sort by" → heading "Sort by" → group "Sort by" → button "Newest"`,
      so a screen-reader user heard "Sort by" three times before the first
      option. The name belongs on the `role="group"`: that is the container
      announced when Tab lands on one of its buttons — fieldset/legend
      semantics — while the `<h3>` still anchors the heading outline for
      heading-based navigation. Mirrors the reasoning already applied on the
      explore page itself, where the portals `<section>` is left unnamed so the
      Carousel's `role="region"` is the only landmark.
    -->
    <!-- ── Sort (rows, single-select) ──────────────────────────── -->
    <section class="filter-drawer__section">
      <h3 class="filter-drawer__heading">
        {m.explore_sort_heading()}
      </h3>
      <!--
        A11Y: `role="group"` + `aria-pressed` buttons — deliberately NOT
        `listbox`/`option`, which is what this was.

        Two things were wrong with `<ul role="listbox"><li><button
        role="option">`. It interposed a wrapper between a role with required
        owned elements and the elements it owns, and — worse — `listbox`
        PROMISES arrow-key navigation that was never implemented: ArrowDown,
        ArrowUp and End were all dead, and every option was its own tab stop,
        where the contract wants exactly one per group.

        `group` has no required owned elements and promises no keyboard model
        beyond what buttons already give you, so Tab + Enter/Space — which
        always worked — is now the whole contract, honestly stated. This also
        matches the Featured toggle below and the category pills on the explore
        page itself. A full APG radiogroup (roving tabindex + arrows + Home/End)
        is the richer alternative; precedents live in pricing's
        `handleBillingKey` and FilterBar's `handlePillKey` if this grows.
      -->
      <div class="filter-drawer__list" role="group" aria-label={m.explore_sort_heading()}>
        {#each sortOptions as opt (opt.value)}
          {@const active = viewSort === opt.value}
          <button
            type="button"
            class="filter-drawer__option"
            class:is-active={active}
            aria-pressed={active}
            onclick={() => setSort(opt.value)}
          >
            <span class="filter-drawer__option-label">{opt.label}</span>
            {#if active}
              <span class="filter-drawer__option-check" aria-hidden="true">
                <CheckIcon size={14} />
              </span>
            {/if}
          </button>
        {/each}
      </div>
    </section>

    <!-- ── Type (pills) ────────────────────────────────────────── -->
    <section class="filter-drawer__section">
      <h3 class="filter-drawer__heading">
        {m.explore_filter_type_heading()}
      </h3>
      <div class="filter-drawer__pills" role="group" aria-label={m.explore_filter_type_heading()}>
        {#each typeOptions as opt (opt.value)}
          {@const active = view.type === opt.value}
          <button
            type="button"
            class="filter-drawer__pill"
            class:is-active={active}
            aria-pressed={active}
            onclick={() => setFilter('type', opt.value)}
          >
            {opt.label}
          </button>
        {/each}
      </div>
    </section>

    <!-- ── Featured (single toggle row) ──────────────────────────
         One self-describing toggle ("Featured only"), so there is no group to
         name here — the `<h3>` is outline structure only. -->
    <section class="filter-drawer__section">
      <h3 class="filter-drawer__heading">
        {m.explore_filter_featured_heading()}
      </h3>
      <div class="filter-drawer__list">
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
      </div>
    </section>
  {/snippet}
</FilterDrawer>

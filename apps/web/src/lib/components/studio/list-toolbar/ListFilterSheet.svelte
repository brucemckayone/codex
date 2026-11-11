<!--
  @component ListFilterSheet

  A studio list's phone filters (Codex-a6ofh.3.1; the media library's since
  Codex-a6ofh.1.6, mockup M7a): the "Filters · N" button, shown below `sm`
  only, and the sheet it opens, one pill group per facet and then the sorts.
  The defaults, the count and Clear all are all read from `facets`, so a
  facet is added to a list in one place.

  Presentational: every change is a patch the parent writes to the URL.
-->
<script lang="ts" generics="K extends string">
  import { FilterDrawer } from '$lib/components/ui/FilterDrawer';
  import { FilterTriggerButton } from '$lib/components/ui/FilterTriggerButton';
  import * as m from '$paraglide/messages';
  import FacetSheetSections from './FacetSheetSections.svelte';
  import type { ListFacet, ListOption } from './list-option';

  interface Props {
    /** Ids are `{idPrefix}-{key}`: unique on a page with two sheets. */
    idPrefix: string;
    title: string;
    clearLabel: string;
    facets: readonly ListFacet<K>[];
    /** The view the URL describes: each facet's value by its key. */
    view: Record<K, string>;
    sort: string;
    sortFallback: string;
    sortLabel: string;
    sortOptions: readonly ListOption[];
    onChange: (patch: Partial<Record<K | 'sort', string | null>>) => void;
  }

  const {
    idPrefix,
    title,
    clearLabel,
    facets,
    view,
    sort,
    sortFallback,
    sortLabel,
    sortOptions,
    onChange,
  }: Props = $props();

  let open = $state(false);

  /** Each facet's value, by key. */
  function byKey(value: (facet: ListFacet<K>) => string): Record<K, string> {
    return Object.fromEntries(facets.map((facet) => [facet.key, value(facet)])) as Record<K, string>;
  }

  const filters = $derived(byKey((facet) => view[facet.key]));
  const defaults = $derived(byKey((facet) => facet.fallback));
  /** The sheet's facets only: a list's on-screen controls are not counted. */
  const activeCount = $derived(facets.filter((facet) => view[facet.key] !== facet.fallback).length);

  /**
   * Every write goes through here: TS cannot match a concrete object to a
   * mapped type over a generic key set, so the one cast lives in one place.
   */
  function write(patch: Record<string, string | null>) {
    onChange(patch as Partial<Record<K | 'sort', string | null>>);
  }

  function clearAll() {
    const patch: Record<string, null> = { sort: null };
    for (const facet of facets) patch[facet.key] = null;
    write(patch);
  }
</script>

<div class="sheet-trigger">
  <FilterTriggerButton
    {activeCount}
    expanded={open}
    ariaLabel={activeCount > 0
      ? m.media_filters_button_count({ count: activeCount })
      : m.media_filters_button()}
    onClick={() => (open = true)}
  />
</div>

<FilterDrawer
  {open}
  onOpenChange={(next) => (open = next)}
  {title}
  {filters}
  {sort}
  defaultFilters={defaults}
  defaultSort={sortFallback}
  onFilterChange={(next) => write(next)}
  onSortChange={(value) => write({ sort: value })}
  onClearAll={clearAll}
  {activeCount}
  applyLabel={m.library_apply()}
  doneLabel={m.library_done()}
  {clearLabel}
>
  {#snippet sections({ filters: sheet, sort: sheetSort, setFilter, setSort })}
    <FacetSheetSections
      {idPrefix}
      {facets}
      {sortLabel}
      {sortOptions}
      filters={sheet}
      sort={sheetSort}
      {setFilter}
      {setSort}
    />
  {/snippet}
</FilterDrawer>

<style>
  .sheet-trigger {
    display: none;
  }

  @media (--below-sm) {
    .sheet-trigger {
      display: inline-flex;
    }
  }
</style>

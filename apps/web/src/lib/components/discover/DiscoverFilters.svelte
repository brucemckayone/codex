<!--
  @component DiscoverFilters

  Filter command bar for /discover (platform-wide). Composition over
  primitives — StickyToolbar (full-bleed glass + scroll shadow) wraps a
  SearchPill and a FilterTriggerButton; the drawer (DiscoverFilterDrawer)
  hosts Sort + Type. Active state flows back through ActiveFiltersStrip.

  Structure note: top-level fragments (StickyToolbar / ActiveFiltersStrip /
  count / Drawer) are siblings inside the consumer's tall page container
  (.discover). Wrapping them in a tight column would clamp the sticky
  element's range and defeat the pin — see the matching note in
  LibraryToolbar.
-->
<script lang="ts">
  import { StickyToolbar } from '$lib/components/ui/StickyToolbar';
  import { SearchPill } from '$lib/components/ui/SearchPill';
  import { FilterTriggerButton } from '$lib/components/ui/FilterTriggerButton';
  import {
    ActiveFiltersStrip,
    type ActiveFilterChip,
  } from '$lib/components/ui/ActiveFiltersStrip';
  import DiscoverFilterDrawer from './DiscoverFilterDrawer.svelte';
  import * as m from '$paraglide/messages';

  export type DiscoverContentType = 'all' | 'video' | 'audio' | 'written';
  export type DiscoverSort = 'newest' | 'oldest' | 'title';

  export interface DiscoverFilterValues {
    q: string;
    type: DiscoverContentType;
    sort: DiscoverSort;
  }

  interface Props {
    values: DiscoverFilterValues;
    resultCount: number | undefined;
    onChange: (next: DiscoverFilterValues) => void;
  }

  const { values, resultCount, onChange }: Props = $props();

  // ── Drawer open state (idempotent — absorb Melt echoes) ─────────────
  let drawerOpen = $state(false);
  function setDrawerOpen(next: boolean) {
    if (drawerOpen === next) return;
    drawerOpen = next;
  }

  // ── Search flush (debounced live; matches old 300ms cadence) ───────
  function handleSearchChange(next: string) {
    if (next === values.q) return;
    onChange({ ...values, q: next });
  }
  function handleSearchSubmit(next: string) {
    if (next === values.q) return;
    onChange({ ...values, q: next });
  }

  // ── Active count drives the filter-trigger dot ──────────────────────
  const triggerActiveCount = $derived(
    (values.type !== 'all' ? 1 : 0) + (values.sort !== 'newest' ? 1 : 0)
  );

  // ── Chip labels — keyed by facet so removal can switch on key ──────
  const TYPE_LABELS: Record<Exclude<DiscoverContentType, 'all'>, string> = {
    video: m.discover_filter_video(),
    audio: m.discover_filter_audio(),
    written: m.discover_filter_article(),
  };
  const SORT_LABELS: Record<Exclude<DiscoverSort, 'newest'>, string> = {
    oldest: m.discover_sort_oldest(),
    title: m.discover_sort_title(),
  };

  const activeChips = $derived.by<ActiveFilterChip[]>(() => {
    const out: ActiveFilterChip[] = [];
    if (values.type !== 'all') {
      out.push({ key: 'type', label: TYPE_LABELS[values.type] });
    }
    if (values.sort !== 'newest') {
      out.push({ key: 'sort', label: SORT_LABELS[values.sort] });
    }
    if (values.q !== '') {
      out.push({ key: 'q', label: `“${values.q}”` });
    }
    return out;
  });

  function removeChip(chip: ActiveFilterChip) {
    if (chip.key === 'type') onChange({ ...values, type: 'all' });
    else if (chip.key === 'sort') onChange({ ...values, sort: 'newest' });
    else if (chip.key === 'q') onChange({ ...values, q: '' });
  }

  function clearAll() {
    onChange({ q: '', type: 'all', sort: 'newest' });
  }

  // ── Drawer write-back paths ─────────────────────────────────────────
  function handleDrawerFilterChange(next: { type: DiscoverContentType }) {
    if (next.type === values.type) return;
    onChange({ ...values, type: next.type });
  }
  function handleDrawerSortChange(next: DiscoverSort) {
    if (next === values.sort) return;
    onChange({ ...values, sort: next });
  }
</script>

<StickyToolbar>
  <SearchPill
    value={values.q}
    placeholder={m.explore_search_placeholder()}
    onChange={handleSearchChange}
    onSubmit={handleSearchSubmit}
    debounce={300}
  />

  <FilterTriggerButton
    activeCount={triggerActiveCount}
    onClick={() => setDrawerOpen(true)}
    expanded={drawerOpen}
    ariaLabel={`${m.explore_filters_and_sort()}${triggerActiveCount > 0 ? ` (${triggerActiveCount} active)` : ''}`}
    title={m.explore_filters_and_sort()}
  />
</StickyToolbar>

<ActiveFiltersStrip
  chips={activeChips}
  onRemove={removeChip}
  onClearAll={clearAll}
  clearAllLabel={m.discover_clear_all()}
/>

{#if resultCount !== undefined}
  <p class="discover-filters__count">
    {resultCount === 1
      ? m.discover_result_count_one()
      : m.discover_result_count_other({ count: resultCount })}
  </p>
{/if}

<DiscoverFilterDrawer
  open={drawerOpen}
  onOpenChange={setDrawerOpen}
  filters={{ type: values.type }}
  sort={values.sort}
  onFilterChange={handleDrawerFilterChange}
  onSortChange={handleDrawerSortChange}
  onClearAll={clearAll}
  activeCount={triggerActiveCount}
/>

<style>
  .discover-filters__count {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }
</style>

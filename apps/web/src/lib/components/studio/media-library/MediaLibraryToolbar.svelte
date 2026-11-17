<!--
  @component MediaLibraryToolbar

  Find anything in the media library (Codex-a6ofh.1.6, mockup M1/M2): search
  over titles and descriptions (`/` focuses it), the type segment, the Status,
  Usage and Sort menus, and the grid/list toggle. Below `sm` the facets move
  into one sheet behind "Filters · N" (M7a), and the view is always the row
  list, so the toggle goes.

  Presentational: the state comes from the URL (`library-url.ts`) and every
  change is a patch the parent writes back, so a link reproduces the view.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import FacetMenu from '../list-toolbar/FacetMenu.svelte';
  import type { ListFacet } from '../list-toolbar/list-option';
  import ListFilterSheet from '../list-toolbar/ListFilterSheet.svelte';
  import ListSearchBox from '../list-toolbar/ListSearchBox.svelte';
  import ListSegment from '../list-toolbar/ListSegment.svelte';
  import { LIBRARY_DEFAULTS, type LibraryState } from './library-url';
  import {
    SORT_OPTIONS,
    STATUS_OPTIONS,
    TYPE_OPTIONS,
    USAGE_OPTIONS,
    VIEW_OPTIONS,
  } from './library-options';

  /** A URL write: the view's params, null for the default. */
  type LibraryPatch = Partial<Record<keyof LibraryState, string | null>>;

  interface Props {
    /** The view the URL describes. */
    library: LibraryState;
    /** The search box as typed (the parent debounces it into the URL). */
    searchValue: string;
    onSearchInput: (value: string) => void;
    onSearchClear: () => void;
    onChange: (patch: LibraryPatch) => void;
  }

  const { library, searchValue, onSearchInput, onSearchClear, onChange }: Props = $props();

  /** Every facet moves into the sheet on a phone (M7a). */
  const SHEET_FACETS: readonly ListFacet<'mediaType' | 'status' | 'usage'>[] = [
    {
      key: 'mediaType',
      title: () => m.media_filter_type_label(),
      options: TYPE_OPTIONS,
      fallback: LIBRARY_DEFAULTS.mediaType,
    },
    {
      key: 'status',
      title: () => m.media_filter_status_label(),
      options: STATUS_OPTIONS,
      fallback: LIBRARY_DEFAULTS.status,
    },
    {
      key: 'usage',
      title: () => m.media_filter_usage_label(),
      options: USAGE_OPTIONS,
      fallback: LIBRARY_DEFAULTS.usage,
    },
  ];
</script>

<div class="toolbar">
  <ListSearchBox
    id="media-library-search"
    name="q"
    value={searchValue}
    placeholder={m.media_search_placeholder()}
    label={m.media_search_label()}
    clearLabel={m.media_search_clear()}
    onInput={onSearchInput}
    onClear={onSearchClear}
  />

  <div class="toolbar-facets">
    <ListSegment
      label={m.media_filter_type_label()}
      value={library.mediaType}
      options={TYPE_OPTIONS}
      onSelect={(mediaType) => onChange({ mediaType })}
    />

    <FacetMenu
      label={m.media_filter_status_label()}
      value={library.status}
      options={STATUS_OPTIONS}
      fallback={LIBRARY_DEFAULTS.status}
      onSelect={(status) => onChange({ status })}
    />
    <FacetMenu
      label={m.media_filter_usage_label()}
      value={library.usage}
      options={USAGE_OPTIONS}
      fallback={LIBRARY_DEFAULTS.usage}
      onSelect={(usage) => onChange({ usage })}
    />
    <FacetMenu
      label={m.media_sort_label()}
      value={library.sort}
      options={SORT_OPTIONS}
      fallback={LIBRARY_DEFAULTS.sort}
      onSelect={(sort) => onChange({ sort })}
    />

    <span class="toolbar-sep" aria-hidden="true"></span>

    <ListSegment
      label={m.media_view_label()}
      value={library.view}
      options={VIEW_OPTIONS}
      iconsOnly
      onSelect={(view) => onChange({ view })}
    />
  </div>

  <ListFilterSheet
    idPrefix="mlt"
    title={m.media_filters_title()}
    clearLabel={m.media_clear_filters()}
    facets={SHEET_FACETS}
    view={library}
    sort={library.sort}
    sortFallback={LIBRARY_DEFAULTS.sort}
    sortLabel={m.media_sort_label()}
    sortOptions={SORT_OPTIONS}
    {onChange}
  />
</div>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  /* ── Facets ─────────────────────────────────────────────── */
  .toolbar-facets {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .toolbar-sep {
    width: var(--border-width);
    height: var(--space-6);
    background: var(--color-border);
  }

  /* ── Phone (M7a): search + one Filters button ───────────── */
  @media (--below-sm) {
    .toolbar {
      flex-wrap: nowrap;
    }

    .toolbar-facets {
      display: none;
    }
  }
</style>

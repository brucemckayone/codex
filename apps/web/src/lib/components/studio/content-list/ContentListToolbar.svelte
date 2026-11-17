<!--
  @component ContentListToolbar

  Find anything in the content list (Codex-a6ofh.3.1, mockup L1 notes 2-5):
  row one is search over titles and descriptions (`/` focuses it) and the
  status; row two the facet menus (`contentListFacets`: the personal
  studio's Where first, mockup L4b; the org studio's Category last, mockup
  L1 pin 4), the Sort and the table/cards toggle. Below `sm` the menus move
  into one sheet behind "Filters · N", as the media library's do, and the
  view stays beside it: List is rows there, Grid the cards (owner
  2026-11-15).

  Presentational: the state comes from the URL (`list-url.ts`) and every
  change is a patch the parent writes back, so a link reproduces the view.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import FacetMenu from '../list-toolbar/FacetMenu.svelte';
  import type { ListFacet } from '../list-toolbar/list-option';
  import ListFilterSheet from '../list-toolbar/ListFilterSheet.svelte';
  import ListSearchBox from '../list-toolbar/ListSearchBox.svelte';
  import ListSegment from '../list-toolbar/ListSegment.svelte';
  import {
    type ContentListFacetKey,
    SORT_OPTIONS,
    STATUS_OPTIONS,
    VIEW_OPTIONS,
  } from './list-options';
  import { CONTENT_LIST_DEFAULTS, type ContentListState } from './list-url';

  /** A URL write: the view's params, null for the default. */
  type ContentListPatch = Partial<Record<keyof ContentListState, string | null>>;

  interface Props {
    /** The view the URL describes. */
    view: ContentListState;
    /** The search box as typed (the parent debounces it into the URL). */
    searchValue: string;
    onSearchInput: (value: string) => void;
    onSearchClear: () => void;
    onChange: (patch: ContentListPatch) => void;
    /**
     * The facet menus (`contentListFacets`): the desktop row draws them
     * before the Sort, and a phone's sheet holds them.
     */
    facets: readonly ListFacet<ContentListFacetKey>[];
  }

  const { view, searchValue, onSearchInput, onSearchClear, onChange, facets }: Props = $props();
</script>

<div class="toolbar">
  <div class="toolbar-row">
    <ListSearchBox
      id="content-list-search"
      name="search"
      value={searchValue}
      placeholder={m.media_search_placeholder()}
      label={m.studio_content_list_search_label()}
      clearLabel={m.studio_content_search_clear()}
      onInput={onSearchInput}
      onClear={onSearchClear}
    />

    <ListSegment
      label={m.studio_content_filter_label()}
      value={view.status}
      options={STATUS_OPTIONS}
      onSelect={(status) => onChange({ status })}
    />
  </div>

  <div class="toolbar-row toolbar-facets">
    <!-- Its trigger shows below `sm` only, where the menus hide. -->
    <ListFilterSheet
      idPrefix="clt"
      title={m.studio_content_list_filters_title()}
      clearLabel={m.media_clear_filters()}
      {facets}
      {view}
      sort={view.sort}
      sortFallback={CONTENT_LIST_DEFAULTS.sort}
      sortLabel={m.media_sort_label()}
      sortOptions={SORT_OPTIONS}
      {onChange}
    />
    <span class="toolbar-menus">
      {#each facets as facet (facet.key)}
        <FacetMenu
          label={facet.title()}
          value={view[facet.key]}
          options={facet.options}
          fallback={facet.fallback}
          unread={facet.unread}
          onSelect={(value) => onChange({ [facet.key]: value })}
        />
      {/each}
      <FacetMenu
        label={m.media_sort_label()}
        value={view.sort}
        options={SORT_OPTIONS}
        fallback={CONTENT_LIST_DEFAULTS.sort}
        onSelect={(sort) => onChange({ sort })}
      />

      <span class="toolbar-sep" aria-hidden="true"></span>
    </span>

    <ListSegment
      label={m.media_view_label()}
      value={view.view}
      options={VIEW_OPTIONS}
      iconsOnly
      onSelect={(next) => onChange({ view: next })}
    />
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .toolbar-row {
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

  /* The menus sit in the row as if unwrapped; the wrapper is only so a
     phone can hide them in one go. */
  .toolbar-menus {
    display: contents;
  }

  /* ── Phone: search + status, then Filters and the view ─────── */
  @media (--below-sm) {
    .toolbar-menus {
      display: none;
    }

    .toolbar-facets {
      justify-content: space-between;
    }
  }
</style>

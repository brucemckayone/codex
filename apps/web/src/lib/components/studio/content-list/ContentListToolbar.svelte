<!--
  @component ContentListToolbar

  Find anything in the content list (Codex-a6ofh.3.1, mockup L1 notes 2-5):
  row one is search over titles and descriptions (`/` focuses it) and the
  status; row two the Type, Access and Sort menus and the table/cards
  toggle, led in the personal studio by its Where (mockup L4b). Below `sm` the menus move into one sheet behind "Filters · N", as
  the media library's do, and the view is always the cards.

  Presentational: the state comes from the URL (`list-url.ts`) and every
  change is a patch the parent writes back, so a link reproduces the view.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import FacetMenu from '../list-toolbar/FacetMenu.svelte';
  import type { ListFacet, ListOption } from '../list-toolbar/list-option';
  import ListFilterSheet from '../list-toolbar/ListFilterSheet.svelte';
  import ListSearchBox from '../list-toolbar/ListSearchBox.svelte';
  import ListSegment from '../list-toolbar/ListSegment.svelte';
  import {
    ACCESS_OPTIONS,
    SORT_OPTIONS,
    STATUS_OPTIONS,
    TYPE_OPTIONS,
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
     * The personal studio's "Where" (Codex-a6ofh.3.2, mockup L4b):
     * Everywhere, Personal, then each org, with counts when read. Left out
     * in the org studio, whose list is its org.
     */
    whereOptions?: readonly ListOption[];
  }

  const { view, searchValue, onSearchInput, onSearchClear, onChange, whereOptions }: Props =
    $props();

  /** The menus' facets: the status stays on screen on every width. */
  const FILTER_FACETS: readonly ListFacet<'type' | 'access'>[] = [
    {
      key: 'type',
      title: () => m.media_filter_type_label(),
      options: TYPE_OPTIONS,
      fallback: CONTENT_LIST_DEFAULTS.type,
    },
    {
      key: 'access',
      title: () => m.studio_content_form_access_label(),
      options: ACCESS_OPTIONS,
      fallback: CONTENT_LIST_DEFAULTS.access,
    },
  ];

  /** The Where, stated once: the desktop menu and the phone sheet read it. */
  const whereFacet = $derived<ListFacet<'where'> | undefined>(
    whereOptions && {
      key: 'where',
      title: () => m.studio_content_where_label(),
      options: whereOptions,
      fallback: CONTENT_LIST_DEFAULTS.where,
    }
  );

  /** On a phone the Where joins the sheet, first, as it leads on desktop. */
  const sheetFacets = $derived<readonly ListFacet<'where' | 'type' | 'access'>[]>(
    whereFacet ? [whereFacet, ...FILTER_FACETS] : FILTER_FACETS
  );
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
    {#if whereFacet}
      <FacetMenu
        label={whereFacet.title()}
        value={view.where}
        options={whereFacet.options}
        fallback={whereFacet.fallback}
        onSelect={(where) => onChange({ where })}
      />
    {/if}
    <FacetMenu
      label={m.media_filter_type_label()}
      value={view.type}
      options={TYPE_OPTIONS}
      fallback={CONTENT_LIST_DEFAULTS.type}
      onSelect={(type) => onChange({ type })}
    />
    <FacetMenu
      label={m.studio_content_form_access_label()}
      value={view.access}
      options={ACCESS_OPTIONS}
      fallback={CONTENT_LIST_DEFAULTS.access}
      onSelect={(access) => onChange({ access })}
    />
    <FacetMenu
      label={m.media_sort_label()}
      value={view.sort}
      options={SORT_OPTIONS}
      fallback={CONTENT_LIST_DEFAULTS.sort}
      onSelect={(sort) => onChange({ sort })}
    />

    <span class="toolbar-sep" aria-hidden="true"></span>

    <ListSegment
      label={m.media_view_label()}
      value={view.view}
      options={VIEW_OPTIONS}
      iconsOnly
      onSelect={(next) => onChange({ view: next })}
    />
  </div>

  <ListFilterSheet
    idPrefix="clt"
    title={m.studio_content_list_filters_title()}
    clearLabel={m.media_clear_filters()}
    facets={sheetFacets}
    {view}
    sort={view.sort}
    sortFallback={CONTENT_LIST_DEFAULTS.sort}
    sortLabel={m.media_sort_label()}
    sortOptions={SORT_OPTIONS}
    {onChange}
  />
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

  /* ── Phone: search + status, then one Filters button ───────── */
  @media (--below-sm) {
    .toolbar-facets {
      display: none;
    }
  }
</style>

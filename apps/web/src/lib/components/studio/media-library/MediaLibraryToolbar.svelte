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
  import * as DropdownMenu from '$lib/components/ui/DropdownMenu';
  import { FilterDrawer } from '$lib/components/ui/FilterDrawer';
  import { FilterTriggerButton } from '$lib/components/ui/FilterTriggerButton';
  import {
    CheckIcon,
    ChevronDownIcon,
    LayoutGridIcon,
    LayoutListIcon,
    SearchIcon,
    XIcon,
  } from '$lib/components/ui/Icon';
  import { SEARCH_MAX_QUERY_LENGTH } from '@codex/validation';
  import * as m from '$paraglide/messages';
  import {
    activeFilterCount,
    LIBRARY_DEFAULTS,
    type LibraryState,
    type LibraryView,
  } from './library-url';
  import {
    SORT_OPTIONS,
    STATUS_OPTIONS,
    TYPE_OPTIONS,
    USAGE_OPTIONS,
    type LibraryOption,
  } from './library-options';

  /** A URL write: the view's params, and the drawer's `item` (not a facet). */
  export type LibraryPatch = Partial<Record<keyof LibraryState | 'item', string | null>>;

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

  let searchInput = $state<HTMLInputElement | null>(null);
  let drawerOpen = $state(false);

  const filterCount = $derived(activeFilterCount(library));

  const VIEW_OPTIONS: { value: LibraryView; label: () => string; icon: typeof LayoutGridIcon }[] = [
    { value: 'grid', label: () => m.media_view_grid(), icon: LayoutGridIcon },
    { value: 'list', label: () => m.media_view_list(), icon: LayoutListIcon },
  ];

  /** `/` focuses search (M1), unless the creator is already typing somewhere. */
  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]'))
    ) {
      return;
    }
    event.preventDefault();
    searchInput?.focus();
  }

  type DrawerKey = 'mediaType' | 'status' | 'usage';
  const drawerFilters: Record<DrawerKey, string> = $derived({
    mediaType: library.mediaType,
    status: library.status,
    usage: library.usage,
  });
  const DRAWER_FACETS: { key: DrawerKey; title: () => string; options: readonly LibraryOption[] }[] = [
    { key: 'mediaType', title: () => m.media_filter_type_label(), options: TYPE_OPTIONS },
    { key: 'status', title: () => m.media_filter_status_label(), options: STATUS_OPTIONS },
    { key: 'usage', title: () => m.media_filter_usage_label(), options: USAGE_OPTIONS },
  ];
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#snippet menu(label: string, value: string, options: readonly LibraryOption[], fallback: string, key: keyof LibraryState)}
  {@const current = options.find((option) => option.value === value)}
  <DropdownMenu.Root positioning={{ placement: 'bottom-start' }}>
    <DropdownMenu.Trigger
      class="toolbar-menu {value !== fallback ? 'is-set' : ''}"
      aria-label={m.media_filter_menu_named({ label, value: current?.label() ?? value })}
    >
      <span class="toolbar-menu-key">{label}</span>
      <span class="toolbar-menu-value">{current?.label() ?? value}</span>
      <ChevronDownIcon size={14} />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content class="toolbar-menu-list">
      {#each options as option (option.value)}
        <DropdownMenu.Item
          role="menuitemradio"
          aria-checked={option.value === value}
          onclick={() => onChange({ [key]: option.value })}
        >
          <span class="toolbar-menu-check" aria-hidden="true">
            {#if option.value === value}<CheckIcon size={14} />{/if}
          </span>
          {option.label()}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/snippet}

<div class="toolbar">
  <div class="toolbar-search">
    <span class="search-icon" aria-hidden="true"><SearchIcon size={16} /></span>
    <input
      bind:this={searchInput}
      type="search"
      id="media-library-search"
      name="q"
      autocomplete="off"
      maxlength={SEARCH_MAX_QUERY_LENGTH}
      class="search-input"
      placeholder={m.media_search_placeholder()}
      aria-label={m.media_search_label()}
      value={searchValue}
      oninput={(event) => onSearchInput(event.currentTarget.value)}
    />
    {#if searchValue}
      <button type="button" class="search-clear" onclick={onSearchClear} aria-label={m.media_search_clear()}>
        <XIcon size={14} />
      </button>
    {:else}
      <kbd class="search-kbd" aria-hidden="true">/</kbd>
    {/if}
  </div>

  <div class="toolbar-facets">
    <div class="segment" role="radiogroup" aria-label={m.media_filter_type_label()}>
      {#each TYPE_OPTIONS as option (option.value)}
        <button
          type="button"
          role="radio"
          aria-checked={library.mediaType === option.value}
          class="segment-option"
          onclick={() => onChange({ mediaType: option.value })}
        >
          {option.label()}
        </button>
      {/each}
    </div>

    {@render menu(m.media_filter_status_label(), library.status, STATUS_OPTIONS, LIBRARY_DEFAULTS.status, 'status')}
    {@render menu(m.media_filter_usage_label(), library.usage, USAGE_OPTIONS, LIBRARY_DEFAULTS.usage, 'usage')}
    {@render menu(m.media_sort_label(), library.sort, SORT_OPTIONS, LIBRARY_DEFAULTS.sort, 'sort')}

    <span class="toolbar-sep" aria-hidden="true"></span>

    <div class="segment segment--icons" role="radiogroup" aria-label={m.media_view_label()}>
      {#each VIEW_OPTIONS as option (option.value)}
        <button
          type="button"
          role="radio"
          aria-checked={library.view === option.value}
          aria-label={option.label()}
          title={option.label()}
          class="segment-option"
          onclick={() => onChange({ view: option.value })}
        >
          <option.icon size={16} />
        </button>
      {/each}
    </div>
  </div>

  <div class="toolbar-phone">
    <FilterTriggerButton
      activeCount={filterCount}
      expanded={drawerOpen}
      ariaLabel={filterCount > 0
        ? m.media_filters_button_count({ count: filterCount })
        : m.media_filters_button()}
      onClick={() => (drawerOpen = true)}
    />
  </div>
</div>

<FilterDrawer
  open={drawerOpen}
  onOpenChange={(next) => (drawerOpen = next)}
  title={m.media_filters_title()}
  filters={drawerFilters}
  sort={library.sort}
  defaultFilters={{
    mediaType: LIBRARY_DEFAULTS.mediaType,
    status: LIBRARY_DEFAULTS.status,
    usage: LIBRARY_DEFAULTS.usage,
  }}
  defaultSort={LIBRARY_DEFAULTS.sort}
  onFilterChange={(filters) => onChange(filters)}
  onSortChange={(value) => onChange({ sort: value })}
  onClearAll={() =>
    onChange({ mediaType: null, status: null, usage: null, sort: null })}
  activeCount={filterCount}
  applyLabel={m.library_apply()}
  doneLabel={m.library_done()}
  clearLabel={m.media_clear_filters()}
>
  {#snippet sections({ filters: view, sort: viewSort, setFilter, setSort })}
    {#each DRAWER_FACETS as facet (facet.key)}
      <section class="filter-drawer__section" aria-labelledby="mlt-{facet.key}">
        <h3 class="filter-drawer__heading" id="mlt-{facet.key}">{facet.title()}</h3>
        <div class="filter-drawer__pills" role="listbox" aria-label={facet.title()}>
          {#each facet.options as option (option.value)}
            {@const active = view[facet.key] === option.value}
            <button
              type="button"
              class="filter-drawer__pill"
              class:is-active={active}
              role="option"
              aria-selected={active}
              onclick={() => setFilter(facet.key, option.value)}
            >
              {option.label()}
            </button>
          {/each}
        </div>
      </section>
    {/each}

    <section class="filter-drawer__section" aria-labelledby="mlt-sort">
      <h3 class="filter-drawer__heading" id="mlt-sort">{m.media_sort_label()}</h3>
      <ul class="filter-drawer__list" role="listbox" aria-label={m.media_sort_label()}>
        {#each SORT_OPTIONS as option (option.value)}
          {@const active = viewSort === option.value}
          <li>
            <button
              type="button"
              class="filter-drawer__option"
              class:is-active={active}
              role="option"
              aria-selected={active}
              onclick={() => setSort(option.value)}
            >
              <span class="filter-drawer__option-label">{option.label()}</span>
              {#if active}
                <span class="filter-drawer__option-check" aria-hidden="true"><CheckIcon size={14} /></span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/snippet}
</FilterDrawer>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  /* ── Search ─────────────────────────────────────────────── */
  .toolbar-search {
    position: relative;
    display: flex;
    align-items: center;
    flex: 1 1 18rem;
    min-width: 0;
    height: var(--space-10);
    padding: 0 var(--space-3);
    gap: var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    transition: var(--transition-colors);
  }

  .toolbar-search:focus-within {
    border-color: var(--color-interactive);
    box-shadow: 0 0 0 var(--border-width-thick) var(--color-focus-ring, var(--color-focus));
  }

  .search-icon {
    display: inline-flex;
    color: var(--color-text-muted);
  }

  .search-input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: none;
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
  }

  .search-input:focus {
    outline: none;
  }

  .search-input::placeholder {
    color: var(--color-text-muted);
  }

  .search-input::-webkit-search-cancel-button {
    display: none;
  }

  .search-clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
  }

  .search-clear:hover {
    background: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .search-clear:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
  }

  .search-kbd {
    padding: 0 var(--space-1-5);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* ── Facets ─────────────────────────────────────────────── */
  .toolbar-facets {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .segment {
    display: inline-flex;
    padding: var(--space-0-5);
    gap: var(--space-0-5);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-secondary);
  }

  .segment-option {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: var(--space-8);
    padding: 0 var(--space-3);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .segment--icons .segment-option {
    padding: 0 var(--space-2);
  }

  .segment-option:hover {
    color: var(--color-text);
  }

  .segment-option[aria-checked='true'] {
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow: var(--shadow-sm);
  }

  .segment-option:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* The menus' triggers and lists are component elements: :global(). */
  :global(.toolbar-menu) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    height: var(--space-10);
    padding: 0 var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  :global(.toolbar-menu:hover),
  :global(.toolbar-menu[data-state='open']) {
    background: var(--color-surface-secondary);
  }

  :global(.toolbar-menu.is-set) {
    border-color: var(--color-interactive);
    background: var(--color-interactive-subtle);
  }

  :global(.toolbar-menu:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  :global(.toolbar-menu .toolbar-menu-key) {
    color: var(--color-text-secondary);
  }

  :global(.toolbar-menu .toolbar-menu-value) {
    font-weight: var(--font-semibold);
  }

  :global(.toolbar-menu-list .dropdown-item) {
    gap: var(--space-2);
  }

  :global(.toolbar-menu-list .toolbar-menu-check) {
    display: inline-flex;
    width: var(--space-4);
    color: var(--color-interactive);
  }

  .toolbar-sep {
    width: var(--border-width);
    height: var(--space-6);
    background: var(--color-border);
  }

  .toolbar-phone {
    display: none;
  }

  /* ── Phone (M7a): search + one Filters button ───────────── */
  @media (--below-sm) {
    .toolbar {
      flex-wrap: nowrap;
    }

    .toolbar-facets {
      display: none;
    }

    .toolbar-phone {
      display: inline-flex;
    }

    .search-kbd {
      display: none;
    }
  }
</style>

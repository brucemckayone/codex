<!--
  @component ContentListCommandBar

  Sticky editorial command bar for the Studio content list. Mirrors
  DashboardCommandBar's vocabulary: backdrop-blur,
  breadcrumb eyebrow, mono ordinal ratio, narrative lede, status segmented
  control, search field, the page's actions.

  Left   — breadcrumb (Studio · Content) + total ordinal
  Mid    — status filter (ContentStatusTabs, shared with the personal list)
  Right  — search field + the page's actions (the New menu, Codex-a6ofh.2.6)

  All state lives in URL query params in the parent — this component is
  purely presentational plus a search debounce (owned by parent).

  @prop total          Total matching items (for the ordinal meter); null when never read
  @prop selectedStatus Active status filter ("all" | draft | published | archived)
  @prop searchValue    Bound-ish search field value (controlled by parent)
  @prop onSearchInput  Input handler — parent owns the debounce timer
  @prop onSearchClear  Clear button handler
  @prop onStatusChange Segmented control click handler (parent navigates)
  @prop actions        The page's actions, at the right (its New menu)
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as m from '$paraglide/messages';
  import { SearchIcon, XIcon } from '$lib/components/ui/Icon';
  import ContentStatusTabs from './ContentStatusTabs.svelte';
  import type { ContentStatusFilter } from './content-status';

  interface Props {
    /** Null when the list was never read: no count, rather than "000". */
    total: number | null;
    loading: boolean;
    selectedStatus: ContentStatusFilter;
    searchValue: string;
    onSearchInput: (e: Event) => void;
    onSearchClear: () => void;
    onStatusChange: (status: ContentStatusFilter) => void;
    actions: Snippet;
  }

  const {
    total,
    loading,
    selectedStatus,
    searchValue,
    onSearchInput,
    onSearchClear,
    onStatusChange,
    actions,
  }: Props = $props();

  // TODO i18n — "studio_content_list_eyebrow" = "Studio · Library"
  const eyebrow = 'Studio';
  const leaf = m.studio_content_title();

  const ordinalText = $derived(total?.toString().padStart(3, '0') ?? '');
</script>

<div class="command-bar" role="toolbar" aria-label="Content library actions">
  <div class="bar-identity">
    <a href="/studio" class="breadcrumb">
      <span class="breadcrumb-root">{eyebrow}</span>
      <span class="breadcrumb-sep" aria-hidden="true">/</span>
      <span class="breadcrumb-leaf">{leaf}</span>
    </a>
    {#if total !== null}
      <span
        class="count-chip"
        data-loading={loading || undefined}
        aria-label="{total} items total"
      >
        <span class="count-num">{ordinalText}</span>
        <span class="count-label">items</span>
      </span>
    {/if}
  </div>

  <div class="bar-filters">
    <ContentStatusTabs selected={selectedStatus} onChange={onStatusChange} />
  </div>

  <div class="bar-search">
    <div class="search-input-wrapper">
      <span class="search-icon-slot" aria-hidden="true">
        <SearchIcon size={16} />
      </span>
      <input
        type="search"
        id="content-list-search"
        name="q"
        autocomplete="off"
        class="search-input"
        placeholder={m.studio_content_search_placeholder()}
        value={searchValue}
        oninput={onSearchInput}
        aria-label={m.studio_content_search_placeholder()}
      />
      {#if searchValue}
        <button
          type="button"
          class="search-clear"
          onclick={onSearchClear}
          aria-label={m.studio_content_search_clear()}
        >
          <XIcon size={14} />
        </button>
      {/if}
    </div>
  </div>

  <div class="bar-actions">
    {@render actions()}
  </div>
</div>

<style>
  .command-bar {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr) minmax(0, auto) auto;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-5);
    background-color: color-mix(in srgb, var(--color-surface) 88%, transparent);
    backdrop-filter: blur(var(--blur-2xl, 24px));
    -webkit-backdrop-filter: blur(var(--blur-2xl, 24px));
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    box-shadow: 0 var(--space-1) var(--space-4)
      color-mix(in srgb, var(--color-text) 6%, transparent);
  }

  @media (--below-lg) {
    .command-bar {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'identity actions'
        'search   search'
        'filters  filters';
      row-gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
    }
    .bar-identity { grid-area: identity; }
    /* max-width is what actually constrains this row. The element is a
       scroll container, so its automatic minimum size is already 0 and
       `min-width: 0` is a no-op here — measured at 390px, computed
       min-width was already 0px while the box sat at 631px. Without an
       UPPER bound the row sizes to its content, grows past the bar, and
       an ancestor clips it: the filters are cut off and unreachable
       rather than scrollable, which is the reported mobile header bug.
       With max-width the row clamps to the bar (326px) and scrolls
       inside itself, which is what overflow-x: auto was written to do. */
    .bar-filters  { grid-area: filters; overflow-x: auto; flex-wrap: nowrap; max-width: 100%; }
    .bar-search   { grid-area: search; }
    .bar-actions  { grid-area: actions; }
  }

  /* ── Identity (breadcrumb + count) ──────────────────────── */
  .bar-identity {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .breadcrumb {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    text-decoration: none;
    color: var(--color-text);
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    min-width: 0;
    transition: var(--transition-colors);
  }

  .breadcrumb:hover { color: var(--color-link); }

  .breadcrumb:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .breadcrumb-root {
    font-weight: var(--font-normal);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  .breadcrumb-sep {
    color: var(--color-text-muted);
    font-weight: var(--font-normal);
  }

  .breadcrumb-leaf {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .count-chip {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full, 9999px);
    background: var(--color-surface);
    transition:
      color var(--duration-normal) var(--ease-out),
      opacity var(--duration-normal) var(--ease-out);
  }

  .count-chip[data-loading] { opacity: var(--opacity-60, 0.6); }

  .count-num { font-weight: var(--font-semibold); color: var(--color-text-secondary); }
  .count-label {
    margin-left: var(--space-1);
    font-family: var(--font-sans);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  /* ── Segmented filter ───────────────────────────────────── */
  .bar-filters {
    display: flex;
    justify-self: center;
  }

  @media (--below-lg) {
    .bar-filters { justify-self: start; }
  }

  /* ── Search ─────────────────────────────────────────────── */
  .bar-search {
    display: flex;
    justify-content: flex-end;
    min-width: 0;
  }

  .search-input-wrapper {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full, 9999px);
    background-color: var(--color-surface);
    transition:
      border-color var(--duration-fast) var(--ease-out),
      box-shadow var(--duration-fast) var(--ease-out);
    width: 100%;
    max-width: 18rem;
  }

  .search-input-wrapper:focus-within {
    border-color: var(--color-interactive);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-interactive) 15%, transparent);
  }

  .search-icon-slot {
    display: inline-flex;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: var(--text-sm);
    color: var(--color-text);
    font-family: var(--font-sans);
  }

  .search-input::placeholder { color: var(--color-text-muted); }
  .search-input::-webkit-search-cancel-button { display: none; }

  .search-clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-0-5);
    border: none;
    background: none;
    color: var(--color-text-muted);
    border-radius: var(--radius-full, 9999px);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .search-clear:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .search-clear:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  /* ── Actions ────────────────────────────────────────────── */
  .bar-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    justify-content: flex-end;
  }
</style>

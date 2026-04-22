<!--
  @component ContentListCommandBar

  Sticky editorial command bar for the Studio content list. Mirrors
  ContentFormCommandBar / DashboardCommandBar vocabulary: backdrop-blur,
  breadcrumb eyebrow, mono ordinal ratio, narrative lede, status segmented
  control, search field, primary Create CTA.

  Left   — breadcrumb (Studio · Content) + total ordinal
  Mid    — status segmented filter (All / Draft / Published / Archived)
  Right  — search field + Create action

  All state lives in URL query params in the parent — this component is
  purely presentational plus a search debounce (owned by parent).

  @prop total          Total matching items (for the ordinal meter)
  @prop selectedStatus Active status filter ("all" | draft | published | archived)
  @prop searchValue    Bound-ish search field value (controlled by parent)
  @prop onSearchInput  Input handler — parent owns the debounce timer
  @prop onSearchClear  Clear button handler
  @prop onStatusChange Segmented control click handler (parent navigates)
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { PlusIcon, SearchIcon, XIcon } from '$lib/components/ui/Icon';

  type StatusFilter = 'all' | 'draft' | 'published' | 'archived';

  interface Props {
    total: number;
    loading: boolean;
    selectedStatus: StatusFilter;
    searchValue: string;
    createHref: string;
    onSearchInput: (e: Event) => void;
    onSearchClear: () => void;
    onStatusChange: (status: StatusFilter) => void;
  }

  const {
    total,
    loading,
    selectedStatus,
    searchValue,
    createHref,
    onSearchInput,
    onSearchClear,
    onStatusChange,
  }: Props = $props();

  // TODO i18n — "studio_content_list_eyebrow" = "Studio · Library"
  const eyebrow = 'Studio';
  const leaf = m.studio_content_title();

  // TODO i18n — filter labels
  //   studio_content_filter_all      = "All"
  //   studio_content_filter_draft    = "Drafts"
  //   studio_content_filter_published= "Published"
  //   studio_content_filter_archived = "Archived"
  const filters: Array<{ value: StatusFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'draft', label: 'Drafts' },
    { value: 'published', label: 'Published' },
    { value: 'archived', label: 'Archived' },
  ];

  const ordinalText = $derived(total.toString().padStart(3, '0'));
</script>

<div class="command-bar" role="toolbar" aria-label="Content library actions">
  <div class="bar-identity">
    <a href="/studio" class="breadcrumb">
      <span class="breadcrumb-root">{eyebrow}</span>
      <span class="breadcrumb-sep" aria-hidden="true">/</span>
      <span class="breadcrumb-leaf">{leaf}</span>
    </a>
    <span
      class="count-chip"
      data-loading={loading || undefined}
      aria-label="{total} items total"
    >
      <span class="count-num">{ordinalText}</span>
      <span class="count-label">items</span>
    </span>
  </div>

  <div class="bar-filters" role="tablist" aria-label="Filter by status">
    {#each filters as f (f.value)}
      <button
        type="button"
        role="tab"
        aria-selected={selectedStatus === f.value}
        class="filter-tab"
        data-active={selectedStatus === f.value || undefined}
        data-status={f.value}
        onclick={() => onStatusChange(f.value)}
      >
        {f.label}
      </button>
    {/each}
  </div>

  <div class="bar-search">
    <div class="search-input-wrapper">
      <span class="search-icon-slot" aria-hidden="true">
        <SearchIcon size={16} />
      </span>
      <input
        type="search"
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
    <a href={createHref} class="create-btn">
      <PlusIcon size={16} />
      <span class="create-btn-label">{m.studio_content_create()}</span>
    </a>
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
    .bar-filters  { grid-area: filters; overflow-x: auto; flex-wrap: nowrap; }
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

  .breadcrumb:hover { color: var(--color-interactive); }

  .breadcrumb:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
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
    display: inline-flex;
    align-items: center;
    gap: var(--space-0-5);
    padding: var(--space-0-5);
    border-radius: var(--radius-full, 9999px);
    border: var(--border-width) var(--border-style) var(--color-border);
    background: color-mix(in srgb, var(--color-surface-secondary) 60%, var(--color-surface));
    justify-self: center;
  }

  @media (--below-lg) {
    .bar-filters { justify-self: start; }
  }

  .filter-tab {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--color-text-muted);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    padding: var(--space-1-5) var(--space-3);
    border-radius: var(--radius-full, 9999px);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .filter-tab:hover { color: var(--color-text-secondary); }

  .filter-tab[data-active] {
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow:
      0 1px 0 color-mix(in srgb, var(--color-text) 6%, transparent),
      0 1px 2px color-mix(in srgb, var(--color-text) 8%, transparent);
  }

  .filter-tab:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
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
    outline-offset: 1px;
  }

  /* ── Actions ────────────────────────────────────────────── */
  .bar-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    justify-content: flex-end;
  }

  .create-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--space-10);
    padding: 0 var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text-on-brand, var(--color-background));
    background-color: var(--color-interactive);
    border: none;
    border-radius: var(--radius-full, 9999px);
    text-decoration: none;
    white-space: nowrap;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      transform var(--duration-fast) var(--ease-out);
  }

  .create-btn:hover {
    background-color: var(--color-interactive-hover);
  }

  .create-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: no-preference) {
    .create-btn:hover { transform: translateY(-1px); }
  }

  @media (--below-sm) {
    .create-btn-label { display: none; }
    .create-btn { padding: 0 var(--space-3); }
  }
</style>

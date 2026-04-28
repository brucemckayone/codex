<!--
  @component MediaLibraryCommandBar

  Sticky editorial command bar for the Studio media library. Mirrors
  ContentListCommandBar vocabulary: backdrop-blur, breadcrumb eyebrow,
  mono ordinal meter, dual segmented filter (type + status), search field,
  primary upload CTA that triggers the parent's hidden file input.

  Layout (desktop):
    Left   — breadcrumb (Studio / Media) + 3-digit count chip
    Mid    — type segment (All / Video / Audio)
    Mid-R  — status segment (All / Ready / Processing / Failed)
    Right  — search + Upload action

  Stacked on below-lg: identity + actions row, then filters row, then search.

  All state lives in URL query params in the parent — this is purely
  presentational plus parent-owned search debounce.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { UploadIcon, SearchIcon, XIcon } from '$lib/components/ui/Icon';

  type MediaTypeFilter = 'all' | 'video' | 'audio';
  type StatusFilter = 'all' | 'ready' | 'transcoding' | 'failed';

  interface Props {
    /** Total items matching current server filter (for the ordinal meter) */
    total: number;
    /** Whether the list is currently loading (dims the count) */
    loading?: boolean;
    /** Active media-type filter */
    mediaType: MediaTypeFilter;
    /** Active status filter */
    status: StatusFilter;
    /** Current search input value (parent-controlled) */
    searchValue: string;
    /** Upload button click — parent should trigger hidden file input */
    onUploadClick: () => void;
    /** Search input handler — parent owns debounce */
    onSearchInput: (e: Event) => void;
    /** Search clear handler */
    onSearchClear: () => void;
    /** Media-type segmented control handler */
    onMediaTypeChange: (value: MediaTypeFilter) => void;
    /** Status segmented control handler */
    onStatusChange: (value: StatusFilter) => void;
  }

  const {
    total,
    loading = false,
    mediaType,
    status,
    searchValue,
    onUploadClick,
    onSearchInput,
    onSearchClear,
    onMediaTypeChange,
    onStatusChange,
  }: Props = $props();

  // TODO i18n — "studio_media_eyebrow" = "Studio"
  const eyebrow = 'Studio';
  const leaf = m.media_title();

  // TODO i18n — segmented labels
  //   studio_media_filter_all_types, studio_media_filter_video, studio_media_filter_audio
  //   studio_media_filter_all_status, studio_media_filter_ready, studio_media_filter_processing, studio_media_filter_failed
  const mediaTypeOptions: Array<{ value: MediaTypeFilter; label: string }> = [
    { value: 'all', label: m.media_filter_all_types() },
    { value: 'video', label: m.media_type_video() },
    { value: 'audio', label: m.media_type_audio() },
  ];

  const statusOptions: Array<{ value: StatusFilter; label: string }> = [
    { value: 'all', label: m.media_filter_all_status() },
    { value: 'ready', label: m.media_status_ready() },
    { value: 'transcoding', label: m.media_status_processing() },
    { value: 'failed', label: m.media_status_failed() },
  ];

  const ordinalText = $derived(
    Math.max(0, Math.min(total, 999)).toString().padStart(3, '0')
  );
  // TODO i18n — studio_media_count_label = "items"
  const countLabel = 'items';
  // TODO i18n — studio_media_search_placeholder = "Search library..."
  const searchPlaceholder = 'Search library...';
  // TODO i18n — studio_media_search_clear = "Clear search"
  const searchClearLabel = 'Clear search';
</script>

<div class="command-bar" role="toolbar" aria-label="Media library actions">
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
      <span class="count-label">{countLabel}</span>
    </span>
  </div>

  <div class="bar-filters" aria-label="Filter media">
    <div class="filter-segment" role="tablist" aria-label="Filter by type">
      {#each mediaTypeOptions as opt (opt.value)}
        <button
          type="button"
          role="tab"
          aria-selected={mediaType === opt.value}
          class="filter-tab"
          data-active={mediaType === opt.value || undefined}
          data-kind="type"
          onclick={() => onMediaTypeChange(opt.value)}
        >
          {opt.label}
        </button>
      {/each}
    </div>

    <div class="filter-segment" role="tablist" aria-label="Filter by status">
      {#each statusOptions as opt (opt.value)}
        <button
          type="button"
          role="tab"
          aria-selected={status === opt.value}
          class="filter-tab"
          data-active={status === opt.value || undefined}
          data-kind="status"
          data-status={opt.value}
          onclick={() => onStatusChange(opt.value)}
        >
          {opt.label}
        </button>
      {/each}
    </div>
  </div>

  <div class="bar-search">
    <div class="search-input-wrapper">
      <span class="search-icon-slot" aria-hidden="true">
        <SearchIcon size={16} />
      </span>
      <input
        type="search"
        class="search-input"
        placeholder={searchPlaceholder}
        value={searchValue}
        oninput={onSearchInput}
        aria-label={searchPlaceholder}
      />
      {#if searchValue}
        <button
          type="button"
          class="search-clear"
          onclick={onSearchClear}
          aria-label={searchClearLabel}
        >
          <XIcon size={14} />
        </button>
      {/if}
    </div>
  </div>

  <div class="bar-actions">
    <button type="button" class="upload-btn" onclick={onUploadClick}>
      <UploadIcon size={16} />
      <span class="upload-btn-label">{m.media_upload_title()}</span>
    </button>
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
        'filters  filters'
        'search   search';
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

  /* ── Dual segmented filters ─────────────────────────────── */
  .bar-filters {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    justify-self: center;
    min-width: 0;
  }

  @media (--below-lg) {
    .bar-filters { justify-self: start; }
  }

  .filter-segment {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-full, 9999px);
    border: var(--border-width) var(--border-style) var(--color-border);
    background: color-mix(in srgb, var(--color-surface-secondary) 60%, var(--color-surface));
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
    padding: var(--space-1) var(--space-3);
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

  /* Status-segment active colour hints — keep subtle, inherit text mostly */
  .filter-tab[data-kind='status'][data-active][data-status='ready'] {
    color: var(--color-success-700);
  }
  .filter-tab[data-kind='status'][data-active][data-status='transcoding'] {
    color: var(--color-warning-700);
  }
  .filter-tab[data-kind='status'][data-active][data-status='failed'] {
    color: var(--color-error-700);
  }

  .filter-tab:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
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
    max-width: 16rem;
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
    padding: 2px;
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

  .upload-btn {
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
    cursor: pointer;
    white-space: nowrap;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      transform var(--duration-fast) var(--ease-out);
  }

  .upload-btn:hover {
    background-color: var(--color-interactive-hover);
  }

  .upload-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  @media (prefers-reduced-motion: no-preference) {
    .upload-btn:hover { transform: translateY(-1px); }
  }

  @media (--below-sm) {
    .upload-btn-label { display: none; }
    .upload-btn { padding: 0 var(--space-3); }
  }
</style>

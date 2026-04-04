<!--
  @component MediaPicker

  Rich dropdown selector for attaching a media item to content.
  Shows media items with type icons, title, duration, and file size.
  Includes search/filter, clear selection, and empty state with upload CTA.

  @prop {MediaItemOption[]} mediaItems - Available media items (status = 'ready')
  @prop {string | null} [value] - Currently selected media item ID
  @prop {(mediaItemId: string | null) => void} [onchange] - Selection callback
  @prop {string} [name='mediaItemId'] - Hidden input name for form submission
  @prop {boolean} [showLibraryLink] - Whether to show "Go to Media library" links
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { formatDuration, formatFileSize } from '$lib/utils/format';
  import {
    CheckIcon,
    ChevronDownIcon,
    FilmIcon,
    MinusCircleIcon,
    MusicIcon,
    PlayIcon,
    SearchIcon,
    UploadIcon,
    XIcon,
  } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';

  interface MediaItemOption {
    id: string;
    title: string;
    mediaType: string;
    durationSeconds?: number | null;
    fileSizeBytes?: number | null;
  }

  interface Props {
    mediaItems: MediaItemOption[];
    value?: string | null;
    onchange?: (mediaItemId: string | null) => void;
    name?: string;
    showLibraryLink?: boolean;
  }

  const {
    mediaItems = [],
    value = null,
    onchange,
    name = 'mediaItemId',
    showLibraryLink = false,
  }: Props = $props();

  // ── State ───────────────────────────────────────────────────────────
  let open = $state(false);
  let searchQuery = $state('');
  let highlightedIndex = $state(-1);
  let searchInputEl: HTMLInputElement | undefined = $state();
  let containerEl: HTMLDivElement | undefined = $state();
  let listboxEl: HTMLDivElement | undefined = $state();

  const selectedItem = $derived(mediaItems.find((item) => item.id === value) ?? null);
  const showSearch = $derived(mediaItems.length > 5);
  const filteredItems = $derived.by(() => {
    if (!searchQuery) return mediaItems;
    const query = searchQuery.toLowerCase();
    return mediaItems.filter((item) => item.title.toLowerCase().includes(query));
  });

  // Flat list of selectable option IDs (null = "No media" option)
  const selectableOptions = $derived.by(() => {
    if (mediaItems.length === 0 || filteredItems.length === 0) return [];
    return [null, ...filteredItems.map((item) => item.id)] as (string | null)[];
  });

  // ID of the currently keyboard-highlighted option (for aria-activedescendant)
  const highlightedOptionId = $derived.by(() => {
    if (highlightedIndex < 0 || highlightedIndex >= selectableOptions.length) return undefined;
    const optionValue = selectableOptions[highlightedIndex];
    return optionValue === null ? 'media-picker-option-none' : `media-picker-option-${optionValue}`;
  });

  // Reset highlight when search changes the filtered list
  $effect(() => {
    searchQuery;
    highlightedIndex = -1;
  });

  // ── Open / Close ────────────────────────────────────────────────────
  function toggle() {
    open = !open;
    if (open) {
      searchQuery = '';
      highlightedIndex = -1;
      requestAnimationFrame(() => searchInputEl?.focus());
    }
  }

  function close() {
    open = false;
    searchQuery = '';
    highlightedIndex = -1;
  }

  function selectItem(id: string | null) {
    onchange?.(id);
    close();
  }

  function handleClear(e: MouseEvent) {
    e.stopPropagation();
    onchange?.(null);
  }

  // ── Click outside ───────────────────────────────────────────────────
  function handleClickOutside(e: MouseEvent) {
    if (open && containerEl && !containerEl.contains(e.target as Node)) {
      close();
    }
  }

  // ── Keyboard ────────────────────────────────────────────────────────
  function scrollHighlightedIntoView() {
    requestAnimationFrame(() => {
      if (!highlightedOptionId || !listboxEl) return;
      const el = listboxEl.querySelector(`#${highlightedOptionId}`);
      el?.scrollIntoView({ block: 'nearest' });
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        toggle();
      }
      return;
    }

    const count = selectableOptions.length;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        close();
        containerEl?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
        break;

      case 'ArrowDown':
        e.preventDefault();
        highlightedIndex = count === 0 ? -1 : (highlightedIndex + 1) % count;
        scrollHighlightedIntoView();
        break;

      case 'ArrowUp':
        e.preventDefault();
        highlightedIndex = count === 0 ? -1 : (highlightedIndex - 1 + count) % count;
        scrollHighlightedIntoView();
        break;

      case 'Home':
        e.preventDefault();
        highlightedIndex = count > 0 ? 0 : -1;
        scrollHighlightedIntoView();
        break;

      case 'End':
        e.preventDefault();
        highlightedIndex = count > 0 ? count - 1 : -1;
        scrollHighlightedIntoView();
        break;

      case 'Enter':
        if (highlightedIndex >= 0 && highlightedIndex < count) {
          e.preventDefault();
          selectItem(selectableOptions[highlightedIndex]);
        }
        break;

      case ' ':
        // Don't intercept Space when typing in the search input
        if (e.target instanceof HTMLInputElement) break;
        if (highlightedIndex >= 0 && highlightedIndex < count) {
          e.preventDefault();
          selectItem(selectableOptions[highlightedIndex]);
        }
        break;

      case 'Tab':
        close();
        break;
    }
  }

  $effect(() => {
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  });
</script>

<input type="hidden" {name} value={value ?? ''} />

<div
  class="media-picker"
  bind:this={containerEl}
  role="group"
  onkeydown={handleKeydown}
>
  {#if selectedItem}
    <div class="picker-trigger has-value">
      <div class="trigger-preview" onclick={toggle} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }} tabindex="0" role="button" aria-haspopup="listbox" aria-expanded={open}>
        <span class="trigger-icon" aria-hidden="true">
          {#if selectedItem.mediaType === 'video'}
            <PlayIcon size={16} />
          {:else}
            <MusicIcon size={16} />
          {/if}
        </span>
        <span class="trigger-details">
          <span class="trigger-title">{selectedItem.title}</span>
          <span class="trigger-meta">
            <span class="type-badge" data-type={selectedItem.mediaType}>
              {selectedItem.mediaType === 'video' ? m.studio_content_form_type_video() : m.studio_content_form_type_audio()}
            </span>
            {#if selectedItem.durationSeconds}
              <span class="meta-sep" aria-hidden="true">&middot;</span>
              <span>{formatDuration(selectedItem.durationSeconds)}</span>
            {/if}
            {#if selectedItem.fileSizeBytes}
              <span class="meta-sep" aria-hidden="true">&middot;</span>
              <span>{formatFileSize(selectedItem.fileSizeBytes)}</span>
            {/if}
          </span>
        </span>
      </div>
      <button
        type="button"
        class="clear-btn"
        aria-label={m.media_picker_clear()}
        onclick={handleClear}
      >
        <XIcon size={14} />
      </button>
    </div>
  {:else}
    <button type="button" class="picker-trigger" onclick={toggle} aria-haspopup="listbox" aria-expanded={open}>
      <span class="trigger-placeholder">{m.media_picker_placeholder()}</span>
      <ChevronDownIcon size={16} class="trigger-chevron {open ? 'rotated' : ''}" />
    </button>
  {/if}

  {#if open}
    <div
      class="picker-dropdown"
      role="listbox"
      id="media-picker-listbox"
      aria-label={m.media_picker_placeholder()}
      aria-activedescendant={highlightedOptionId}
      bind:this={listboxEl}
    >
      {#if showSearch}
        <div class="dropdown-search">
          <SearchIcon size={14} class="search-icon" />
          <input
            bind:this={searchInputEl}
            type="text"
            class="search-input"
            placeholder={m.media_picker_search()}
            bind:value={searchQuery}
          />
        </div>
      {/if}

      <div class="dropdown-list">
        {#if mediaItems.length === 0}
          <EmptyState title={m.media_picker_empty_title()} description={m.media_picker_empty_desc()} icon={FilmIcon}>
            {#snippet action()}
              {#if showLibraryLink}
                <a href="/studio/media" class="empty-link">{m.media_picker_go_to_library()}</a>
              {/if}
            {/snippet}
          </EmptyState>
        {:else if filteredItems.length === 0}
          <EmptyState title={m.media_picker_no_results()} />
        {:else}
          <button
            type="button"
            class="option option--clear"
            class:selected={!value}
            class:highlighted={highlightedIndex === 0}
            role="option"
            id="media-picker-option-none"
            aria-selected={!value}
            onclick={() => selectItem(null)}
            onpointerenter={() => { highlightedIndex = 0; }}
          >
            <span class="option-icon option-icon--clear" aria-hidden="true">
              <MinusCircleIcon size={16} />
            </span>
            <span class="option-label">{m.media_picker_no_media()}</span>
            {#if !value}
              <CheckIcon size={14} class="check-icon" stroke-width="2.5" />
            {/if}
          </button>

          {#each filteredItems as item, i (item.id)}
            <button
              type="button"
              class="option"
              class:selected={item.id === value}
              class:highlighted={highlightedIndex === i + 1}
              role="option"
              id="media-picker-option-{item.id}"
              aria-selected={item.id === value}
              onclick={() => selectItem(item.id)}
              onpointerenter={() => { highlightedIndex = i + 1; }}
            >
              <span class="option-icon" data-type={item.mediaType} aria-hidden="true">
                {#if item.mediaType === 'video'}
                  <PlayIcon size={16} />
                {:else}
                  <MusicIcon size={16} />
                {/if}
              </span>
              <span class="option-details">
                <span class="option-title">{item.title}</span>
                <span class="option-meta">
                  <span class="type-badge" data-type={item.mediaType}>
                    {item.mediaType === 'video' ? m.studio_content_form_type_video() : m.studio_content_form_type_audio()}
                  </span>
                  {#if item.durationSeconds}
                    <span class="meta-sep" aria-hidden="true">&middot;</span>
                    <span>{formatDuration(item.durationSeconds)}</span>
                  {/if}
                  {#if item.fileSizeBytes}
                    <span class="meta-sep" aria-hidden="true">&middot;</span>
                    <span>{formatFileSize(item.fileSizeBytes)}</span>
                  {/if}
                </span>
              </span>
              {#if item.id === value}
                <CheckIcon size={14} class="check-icon" stroke-width="2.5" />
              {/if}
            </button>
          {/each}
        {/if}
      </div>

      {#if mediaItems.length > 0 && showLibraryLink}
        <div class="dropdown-footer">
          <a href="/studio/media" class="library-link">
            <UploadIcon size={14} />
            {m.media_picker_go_to_library()}
          </a>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .media-picker {
    position: relative;
    width: 100%;
  }

  /* ── Trigger ─────────────────────────────────────────────────────── */
  .picker-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background-color: var(--color-background);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
    font-size: var(--text-sm);
    color: var(--color-text);
    text-align: left;
    font-family: inherit;
    min-height: var(--space-10);
  }

  .picker-trigger:hover {
    border-color: var(--color-border-strong);
  }

  .picker-trigger:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: -1px;
    border-color: var(--color-border-focus);
  }

  /* ── Trigger: placeholder state ──────────────────────────────────── */
  .trigger-placeholder {
    color: var(--color-text-muted);
  }

  .trigger-chevron {
    color: var(--color-text-muted);
    transition: transform var(--duration-fast) var(--ease-default);
    flex-shrink: 0;
  }

  .trigger-chevron.rotated {
    transform: rotate(180deg);
  }

  /* ── Trigger: selected preview ───────────────────────────────────── */
  .trigger-preview {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-width: 0;
  }

  .trigger-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    min-width: var(--space-8);
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
  }

  .trigger-details {
    display: flex;
    flex-direction: column;
    gap: 0;
    min-width: 0;
    flex: 1;
  }

  .trigger-title {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .trigger-meta {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .clear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    border: none;
    background: none;
    color: var(--color-text-muted);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: var(--transition-colors);
    flex-shrink: 0;
    padding: 0;
  }

  .clear-btn:hover {
    background-color: var(--color-error-50);
    color: var(--color-error-600);
  }

  /* ── Type badge ──────────────────────────────────────────────────── */
  .type-badge {
    display: inline-block;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    text-transform: capitalize;
    color: var(--color-interactive-active);
  }

  .type-badge[data-type='audio'] {
    color: var(--color-info-700, var(--color-interactive-active));
  }

  .meta-sep {
    color: var(--color-text-muted);
  }

  /* ── Dropdown ────────────────────────────────────────────────────── */
  .picker-dropdown {
    position: absolute;
    top: calc(100% + var(--space-1));
    left: 0;
    right: 0;
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    z-index: var(--z-dropdown);
    overflow: hidden;
  }

  /* ── Search ──────────────────────────────────────────────────────── */
  .dropdown-search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .search-icon {
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    border: none;
    background: none;
    font-size: var(--text-sm);
    color: var(--color-text);
    outline: none;
    font-family: inherit;
    padding: 0;
  }

  .search-input::placeholder {
    color: var(--color-text-muted);
  }

  /* ── Option list ─────────────────────────────────────────────────── */
  .dropdown-list {
    max-height: 260px;
    overflow-y: auto;
    padding: var(--space-1);
  }

  /* ── Option ──────────────────────────────────────────────────────── */
  .option {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: none;
    background: transparent;
    border-radius: var(--radius-sm, 4px);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
    text-align: left;
    font-family: inherit;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .option:hover,
  .option.highlighted {
    background-color: var(--color-surface-secondary);
  }

  .option.highlighted {
    outline: 2px solid var(--color-brand-primary-subtle);
    outline-offset: -2px;
  }

  .option.selected {
    background-color: var(--color-interactive-subtle);
  }

  .option-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    min-width: var(--space-8);
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
  }

  .option-icon[data-type='video'] {
    color: var(--color-interactive-hover);
  }

  .option-icon[data-type='audio'] {
    color: var(--color-info-600, var(--color-interactive-hover));
  }

  .option-icon--clear {
    background-color: transparent;
    color: var(--color-text-muted);
  }

  .option-details {
    display: flex;
    flex-direction: column;
    gap: 0;
    min-width: 0;
    flex: 1;
  }

  .option-title {
    font-weight: var(--font-medium);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .option-label {
    color: var(--color-text-secondary);
  }

  .option-meta {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .check-icon {
    color: var(--color-interactive);
    flex-shrink: 0;
  }

  /* ── Empty state link ────────────────────────────────────────────── */
  .empty-link {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .empty-link:hover {
    color: var(--color-interactive-hover);
    text-decoration: underline;
  }

  /* ── Dropdown footer ─────────────────────────────────────────────── */
  .dropdown-footer {
    padding: var(--space-2) var(--space-3);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .library-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .library-link:hover {
    color: var(--color-interactive);
  }

</style>

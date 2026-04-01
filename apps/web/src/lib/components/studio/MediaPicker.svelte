<!--
  @component MediaPicker

  Rich dropdown selector for attaching a media item to content.
  Shows media items with type icons, title, duration, and file size.
  Includes search/filter, clear selection, and empty state with upload CTA.

  @prop {MediaItemOption[]} mediaItems - Available media items (status = 'ready')
  @prop {string | null} [value] - Currently selected media item ID
  @prop {(mediaItemId: string | null) => void} [onchange] - Selection callback
  @prop {string} [name='mediaItemId'] - Hidden input name for form submission
  @prop {string} [orgSlug] - Org slug for Media library link
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { formatDuration, formatFileSize } from '$lib/utils/format';

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
    orgSlug?: string;
  }

  const {
    mediaItems = [],
    value = null,
    onchange,
    name = 'mediaItemId',
    orgSlug,
  }: Props = $props();

  // ── State ───────────────────────────────────────────────────────────
  let open = $state(false);
  let searchQuery = $state('');
  let searchInputEl: HTMLInputElement | undefined = $state();
  let containerEl: HTMLDivElement | undefined = $state();

  const selectedItem = $derived(mediaItems.find((item) => item.id === value) ?? null);
  const showSearch = $derived(mediaItems.length > 5);
  const filteredItems = $derived.by(() => {
    if (!searchQuery) return mediaItems;
    const query = searchQuery.toLowerCase();
    return mediaItems.filter((item) => item.title.toLowerCase().includes(query));
  });

  // ── Open / Close ────────────────────────────────────────────────────
  function toggle() {
    open = !open;
    if (open) {
      searchQuery = '';
      requestAnimationFrame(() => searchInputEl?.focus());
    }
  }

  function close() {
    open = false;
    searchQuery = '';
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
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      close();
    }
  }

  $effect(() => {
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  });
</script>

<!-- Hidden input for native form submission -->
<input type="hidden" {name} value={value ?? ''} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="media-picker" bind:this={containerEl} onkeydown={handleKeydown}>
  <!-- Trigger -->
  {#if selectedItem}
    <!-- Selected state: preview card with clear button beside it -->
    <div class="picker-trigger has-value">
      <div class="trigger-preview" onclick={toggle} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }} tabindex="0" role="button" aria-haspopup="listbox" aria-expanded={open}>
        <span class="trigger-icon" aria-hidden="true">
          {#if selectedItem.mediaType === 'video'}
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
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
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
  {:else}
    <!-- Empty state: placeholder trigger button -->
    <button type="button" class="picker-trigger" onclick={toggle} aria-haspopup="listbox" aria-expanded={open}>
      <span class="trigger-placeholder">{m.media_picker_placeholder()}</span>
      <svg class="trigger-chevron" class:rotated={open} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
  {/if}

  <!-- Dropdown -->
  {#if open}
    <div class="picker-dropdown" role="listbox" aria-label={m.media_picker_placeholder()}>
      <!-- Search -->
      {#if showSearch}
        <div class="dropdown-search">
          <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
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
          <!-- Empty state: no media at all -->
          <div class="empty-state">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line><line x1="17" y1="17" x2="22" y2="17"></line></svg>
            <span class="empty-title">{m.media_picker_empty_title()}</span>
            <span class="empty-desc">{m.media_picker_empty_desc()}</span>
            {#if orgSlug}
              <a href="/studio/media" class="empty-link">{m.media_picker_go_to_library()}</a>
            {/if}
          </div>
        {:else if filteredItems.length === 0}
          <!-- No search results -->
          <div class="empty-state">
            <span class="empty-desc">{m.media_picker_no_results()}</span>
          </div>
        {:else}
          <!-- Clear selection option -->
          <button
            type="button"
            class="option option--clear"
            class:selected={!value}
            role="option"
            aria-selected={!value}
            onclick={() => selectItem(null)}
          >
            <span class="option-icon option-icon--clear" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>
            </span>
            <span class="option-label">{m.media_picker_no_media()}</span>
            {#if !value}
              <svg class="check-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            {/if}
          </button>

          <!-- Media items -->
          {#each filteredItems as item (item.id)}
            <button
              type="button"
              class="option"
              class:selected={item.id === value}
              role="option"
              aria-selected={item.id === value}
              onclick={() => selectItem(item.id)}
            >
              <span class="option-icon" data-type={item.mediaType} aria-hidden="true">
                {#if item.mediaType === 'video'}
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                {:else}
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
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
                <svg class="check-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              {/if}
            </button>
          {/each}
        {/if}
      </div>

      <!-- Media library link (when items exist) -->
      {#if mediaItems.length > 0 && orgSlug}
        <div class="dropdown-footer">
          <a href="/studio/media" class="library-link">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
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
    border-color: var(--color-neutral-400);
  }

  .picker-trigger:focus-visible {
    outline: var(--border-width-thick) solid var(--color-primary-500);
    outline-offset: -1px;
    border-color: var(--color-primary-500);
  }

  /* ── Trigger: placeholder state ──────────────────────────────────── */
  .trigger-placeholder {
    color: var(--color-text-muted);
  }

  .trigger-chevron {
    color: var(--color-text-muted);
    transition: transform 150ms ease;
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
    color: var(--color-primary-700);
  }

  .type-badge[data-type='audio'] {
    color: var(--color-info-700, var(--color-primary-700));
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
    transition: background-color 100ms ease;
    text-align: left;
    font-family: inherit;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .option:hover {
    background-color: var(--color-neutral-100);
  }

  .option.selected {
    background-color: var(--color-primary-50);
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
    color: var(--color-primary-600);
  }

  .option-icon[data-type='audio'] {
    color: var(--color-info-600, var(--color-primary-600));
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
    color: var(--color-primary-500);
    flex-shrink: 0;
  }

  /* ── Empty state ─────────────────────────────────────────────────── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-6) var(--space-4);
    text-align: center;
    color: var(--color-text-muted);
  }

  .empty-title {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
  }

  .empty-desc {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    max-width: 240px;
  }

  .empty-link {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-primary-500);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .empty-link:hover {
    color: var(--color-primary-600);
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
    color: var(--color-primary-500);
  }

  /* ── Dark mode ───────────────────────────────────────────────────── */
  :global([data-theme='dark']) .picker-trigger {
    background-color: var(--color-background-dark);
    border-color: var(--color-border-dark);
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .picker-trigger:hover {
    border-color: var(--color-neutral-500);
  }

  :global([data-theme='dark']) .trigger-icon {
    background-color: var(--color-surface-variant);
    color: var(--color-text-muted-dark);
  }

  :global([data-theme='dark']) .trigger-title {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .trigger-meta {
    color: var(--color-text-secondary-dark);
  }

  :global([data-theme='dark']) .clear-btn:hover {
    background-color: var(--color-error-900);
    color: var(--color-error-300);
  }

  :global([data-theme='dark']) .picker-dropdown {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .dropdown-search {
    border-bottom-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .search-input {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .option {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .option:hover {
    background-color: var(--color-surface-variant);
  }

  :global([data-theme='dark']) .option.selected {
    background-color: var(--color-primary-900);
  }

  :global([data-theme='dark']) .option-icon {
    background-color: var(--color-surface-variant);
  }

  :global([data-theme='dark']) .option-meta {
    color: var(--color-text-secondary-dark);
  }

  :global([data-theme='dark']) .empty-title {
    color: var(--color-text-secondary-dark);
  }

  :global([data-theme='dark']) .dropdown-footer {
    border-top-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .library-link {
    color: var(--color-text-secondary-dark);
  }

  :global([data-theme='dark']) .type-badge {
    color: var(--color-primary-300);
  }
</style>

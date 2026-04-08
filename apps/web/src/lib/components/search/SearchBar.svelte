<!--
  @component SearchBar

  Global search bar with debounced input, recent searches in localStorage,
  "/" shortcut, and scope-aware navigation.

  @prop {'org' | 'platform' | 'studio'} scope - Search context
  @prop {string} orgSlug - Current org slug (required for org/studio scope)
  @prop {string} placeholder - Custom placeholder text
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { SearchIcon, XIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';

  interface Props {
    scope?: 'org' | 'platform' | 'studio';
    orgSlug?: string;
    placeholder?: string;
    class?: string;
  }

  const {
    scope = 'platform',
    orgSlug,
    placeholder,
    class: className,
  }: Props = $props();

  const RECENT_KEY = 'codex-recent-searches';
  const MAX_RECENT = 5;

  let query = $state('');
  let isOpen = $state(false);
  let inputEl: HTMLInputElement | undefined = $state();
  let activeIndex = $state(-1);

  // Recent searches from localStorage
  let recentSearches = $state<string[]>(
    browser ? JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') : []
  );

  const defaultPlaceholder = $derived(
    placeholder ?? m.search_placeholder()
  );

  const searchUrl = $derived.by(() => {
    switch (scope) {
      case 'org':
        return '/explore';
      case 'studio':
        return '/studio/content';
      case 'platform':
      default:
        return '/discover';
    }
  });

  function saveRecent(term: string) {
    if (!browser || !term.trim()) return;
    const trimmed = term.trim();
    recentSearches = [trimmed, ...recentSearches.filter(s => s !== trimmed)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentSearches));
  }

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    saveRecent(trimmed);
    isOpen = false;
    const paramKey = scope === 'studio' ? 'search' : 'q';
    goto(`${searchUrl}?${paramKey}=${encodeURIComponent(trimmed)}`);
  }

  function selectRecent(term: string) {
    query = term;
    isOpen = false;
    saveRecent(term);
    const paramKey = scope === 'studio' ? 'search' : 'q';
    goto(`${searchUrl}?${paramKey}=${encodeURIComponent(term)}`);
  }

  function clearRecent() {
    recentSearches = [];
    if (browser) localStorage.removeItem(RECENT_KEY);
  }

  function handleKeydown(e: KeyboardEvent) {
    const items = isOpen && !query ? recentSearches : [];
    const len = items.length;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!isOpen && len > 0) { isOpen = true; }
        activeIndex = len > 0 ? (activeIndex + 1) % len : -1;
        break;
      case 'ArrowUp':
        e.preventDefault();
        activeIndex = len > 0 ? (activeIndex - 1 + len) % len : -1;
        break;
      case 'Enter':
        if (activeIndex >= 0 && activeIndex < len) {
          e.preventDefault();
          selectRecent(items[activeIndex]);
        }
        break;
      case 'Escape':
        isOpen = false;
        activeIndex = -1;
        inputEl?.blur();
        break;
    }
  }

  // "/" global shortcut (standard search convention)
  function handleGlobalKeydown(e: KeyboardEvent) {
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Don't capture "/" when typing in an input, textarea, or contentEditable
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      inputEl?.focus();
      isOpen = true;
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="search-bar {className ?? ''}" role="search">
  <form class="search-bar__form" onsubmit={handleSubmit}>
    <SearchIcon size={16} class="search-bar__icon" />
    <input
      bind:this={inputEl}
      type="search"
      class="search-bar__input"
      placeholder={defaultPlaceholder}
      bind:value={query}
      onfocus={() => { isOpen = true; activeIndex = -1; }}
      onkeydown={handleKeydown}
      aria-label={defaultPlaceholder}
      role="combobox"
      aria-controls="search-results"
      aria-expanded={isOpen && recentSearches.length > 0}
      aria-autocomplete="list"
      aria-activedescendant={activeIndex >= 0 ? `search-option-${activeIndex}` : undefined}
      autocomplete="off"
    />
    {#if query}
      <button
        type="button"
        class="search-bar__clear"
        onclick={() => { query = ''; inputEl?.focus(); }}
        aria-label={m.search_clear()}
      >
        <XIcon size={14} />
      </button>
    {:else}
      <kbd class="search-bar__shortcut">
        <span>/</span>
      </kbd>
    {/if}
  </form>

  {#if isOpen && recentSearches.length > 0 && !query}
    <div class="search-bar__dropdown" id="search-results" role="listbox">
      <div class="search-bar__dropdown-header">
        <span class="search-bar__dropdown-title">{m.search_recent()}</span>
        <button class="search-bar__dropdown-clear" onclick={clearRecent}>{m.search_clear_button()}</button>
      </div>
      {#each recentSearches as term, i (term)}
        <button
          class="search-bar__suggestion"
          class:active={i === activeIndex}
          role="option"
          id="search-option-{i}"
          aria-selected={i === activeIndex}
          onclick={() => selectRecent(term)}
        >
          <SearchIcon size={14} />
          {term}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .search-bar {
    position: relative;
    width: 100%;
    max-width: 320px;
  }

  .search-bar__form {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    transition: var(--transition-colors);
  }

  .search-bar__form:focus-within {
    border-color: var(--color-interactive);
  }

  :global(.search-bar__icon) {
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .search-bar__input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: var(--text-sm);
    color: var(--color-text);
    font-family: var(--font-sans);
    min-width: 0;
  }

  .search-bar__input::placeholder {
    color: var(--color-text-muted);
  }

  .search-bar__input::-webkit-search-cancel-button {
    display: none;
  }

  .search-bar__clear {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-0-5);
    border: none;
    background: none;
    color: var(--color-text-muted);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .search-bar__clear:hover {
    color: var(--color-text);
  }

  .search-bar__shortcut {
    display: none;
    align-items: center;
    padding: var(--space-0-5) var(--space-1);
    font-size: var(--text-xs);
    font-family: var(--font-sans);
    color: var(--color-text-muted);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-sm);
    line-height: var(--leading-none);
  }

  @media (--breakpoint-md) {
    .search-bar__shortcut {
      display: inline-flex;
    }
  }

  /* Dropdown */
  .search-bar__dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: var(--space-1);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    z-index: var(--z-dropdown, 50);
    overflow: hidden;
  }

  .search-bar__dropdown-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .search-bar__dropdown-title {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }

  .search-bar__dropdown-clear {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    background: none;
    border: none;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .search-bar__dropdown-clear:hover {
    color: var(--color-text);
  }

  .search-bar__suggestion {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    transition: var(--transition-colors);
  }

  .search-bar__suggestion:hover,
  .search-bar__suggestion.active {
    background: var(--color-surface-secondary);
    color: var(--color-text);
  }
</style>

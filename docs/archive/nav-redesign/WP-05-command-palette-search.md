# WP-05: CommandPaletteSearch Component

## Purpose

A unified search overlay combining the existing SearchBar's scope-aware logic and recent searches with the CommandPalette's keyboard navigation and grouped results. Triggered by clicking the search icon in the sidebar rail, `Cmd/Ctrl+K`, or the `/` shortcut.

## Dependencies

- **WP-01** — `SearchIcon`, `CommandIcon` icons, i18n keys

## Reference Files

- `apps/web/src/lib/components/search/SearchBar.svelte` — Recent searches (localStorage), scope-aware URLs, "/" shortcut, ARIA combobox pattern
- `apps/web/src/lib/components/command-palette/CommandPalette.svelte` — Cmd+K global trigger, keyboard nav (ArrowUp/Down/Enter/Esc), grouped items, overlay positioning
- `apps/web/src/lib/server/api.ts` — `createServerApi` for search endpoints

## Files to Create

### `apps/web/src/lib/components/search/CommandPaletteSearch.svelte`

### Props Interface

```typescript
interface Props {
  scope: 'platform' | 'org';
  orgSlug?: string;
  open?: boolean;  // $bindable — controlled by parent or keyboard shortcut
}
```

### State

```typescript
import { goto } from '$app/navigation';
import { browser } from '$app/environment';
import { SearchIcon, XIcon, CommandIcon } from '$lib/components/ui/Icon';
import * as m from '$paraglide/messages';

const RECENT_KEY = 'codex-recent-searches';
const MAX_RECENT = 5;
const DEBOUNCE_MS = 300;

let query = $state('');
let open = $state(false);  // $bindable
let inputEl: HTMLInputElement | undefined = $state();
let activeIndex = $state(-1);
let results = $state<{ content: SearchResult[]; creators: CreatorResult[] }>({ content: [], creators: [] });
let loading = $state(false);
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

let recentSearches = $state<string[]>(
  browser ? JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') : []
);
```

### Types

```typescript
interface SearchResult {
  id: string;
  title: string;
  slug: string | null;
  contentType: 'video' | 'audio' | 'article';
  thumbnailUrl: string | null;
  organizationSlug?: string | null;
}

interface CreatorResult {
  id: string;
  name: string;
  username: string;
  image: string | null;
}
```

### Search Logic

```typescript
const searchUrl = $derived(scope === 'org' ? '/explore' : '/discover');

// Debounced search
function handleInput() {
  if (debounceTimer) clearTimeout(debounceTimer);
  activeIndex = -1;

  if (!query.trim()) {
    results = { content: [], creators: [] };
    loading = false;
    return;
  }

  loading = true;
  debounceTimer = setTimeout(async () => {
    try {
      // Fetch via server endpoint to keep API calls server-side
      const params = new URLSearchParams({ q: query.trim(), limit: '5' });
      if (scope === 'org' && orgSlug) params.set('scope', orgSlug);

      const res = await fetch(`/api/search?${params}`);
      if (res.ok) {
        results = await res.json();
      }
    } catch {
      results = { content: [], creators: [] };
    } finally {
      loading = false;
    }
  }, DEBOUNCE_MS);
}
```

**Note:** The search fetch goes to a lightweight SvelteKit API route (`/api/search/+server.ts`) that proxies to the content and creator APIs. This avoids CORS issues and keeps API keys server-side. This API route will need to be created as part of this WP.

### API Route

**File:** `apps/web/src/routes/api/search/+server.ts`

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServerApi } from '$lib/server/api';

export const GET: RequestHandler = async ({ url, platform, cookies }) => {
  const q = url.searchParams.get('q')?.slice(0, 200) ?? '';
  const scope = url.searchParams.get('scope');  // org slug or undefined
  const limit = 5;

  if (!q) return json({ content: [], creators: [] });

  const api = createServerApi(platform, cookies);

  try {
    const [contentRes, creatorsRes] = await Promise.allSettled([
      scope
        ? api.content.getPublicContent({ orgSlug: scope, search: q, limit })
        : api.content.getDiscoverContent({ search: q, limit }),
      scope
        ? api.org.getPublicCreators(scope, { search: q, limit })
        : Promise.resolve({ items: [] }),  // No cross-org creator search yet
    ]);

    const content = contentRes.status === 'fulfilled' ? (contentRes.value?.items ?? []) : [];
    const creators = creatorsRes.status === 'fulfilled' ? (creatorsRes.value?.items ?? []) : [];

    return json({ content, creators });
  } catch {
    return json({ content: [], creators: [] });
  }
};
```

### Keyboard Navigation

```typescript
// Flatten all items for arrow key cycling
const allItems = $derived([
  ...(!query.trim() ? recentSearches.map((term, i) => ({ type: 'recent' as const, term, index: i })) : []),
  ...(query.trim() ? results.content.map((item, i) => ({ type: 'content' as const, item, index: i })) : []),
  ...(query.trim() ? results.creators.map((item, i) => ({ type: 'creator' as const, item, index: i })) : []),
]);

function handleKeydown(e: KeyboardEvent) {
  const len = allItems.length;
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      activeIndex = len > 0 ? (activeIndex + 1) % len : -1;
      break;
    case 'ArrowUp':
      e.preventDefault();
      activeIndex = len > 0 ? (activeIndex - 1 + len) % len : -1;
      break;
    case 'Enter':
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < len) {
        selectItem(allItems[activeIndex]);
      } else if (query.trim()) {
        saveRecent(query.trim());
        open = false;
        goto(`${searchUrl}?q=${encodeURIComponent(query.trim())}`);
      }
      break;
    case 'Escape':
      open = false;
      break;
  }
}

function selectItem(item: typeof allItems[number]) {
  if (item.type === 'recent') {
    query = item.term;
    saveRecent(item.term);
    open = false;
    goto(`${searchUrl}?q=${encodeURIComponent(item.term)}`);
  } else if (item.type === 'content') {
    saveRecent(query.trim());
    open = false;
    const slug = item.item.slug ?? item.item.id;
    goto(`/content/${slug}`);
  } else if (item.type === 'creator') {
    saveRecent(query.trim());
    open = false;
    goto(`/creators/${item.item.username}`);
  }
}
```

### Global Shortcut

```typescript
function handleGlobalKeydown(e: KeyboardEvent) {
  // Cmd/Ctrl+K
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    open = !open;
    return;
  }
  // "/" when not in an input
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !open) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
    e.preventDefault();
    open = true;
  }
}
```

### Focus Management

```typescript
$effect(() => {
  if (open) {
    requestAnimationFrame(() => inputEl?.focus());
    query = '';
    activeIndex = -1;
    results = { content: [], creators: [] };
  }
});
```

### Recent Searches (reused from SearchBar.svelte)

```typescript
function saveRecent(term: string) {
  if (!browser || !term.trim()) return;
  const trimmed = term.trim();
  recentSearches = [trimmed, ...recentSearches.filter(s => s !== trimmed)].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recentSearches));
}

function clearRecent() {
  recentSearches = [];
  if (browser) localStorage.removeItem(RECENT_KEY);
}
```

### Template Structure

```svelte
<svelte:window onkeydown={handleGlobalKeydown} />

{#if open}
  <!-- Backdrop -->
  <div
    class="palette-backdrop"
    role="presentation"
    onclick={() => { open = false; }}
    transition:fade={{ duration: 150 }}
  ></div>

  <!-- Panel -->
  <div
    class="palette"
    role="dialog"
    aria-label="Search"
    transition:fly={{ y: -20, duration: 200, opacity: 0 }}
  >
    <!-- Input -->
    <div class="palette__input-wrapper">
      <SearchIcon size={20} class="palette__search-icon" />
      <input
        bind:this={inputEl}
        type="search"
        class="palette__input"
        placeholder={m.command_palette_placeholder()}
        bind:value={query}
        oninput={handleInput}
        onkeydown={handleKeydown}
        role="combobox"
        aria-controls="palette-results"
        aria-expanded={allItems.length > 0}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `palette-item-${activeIndex}` : undefined}
        autocomplete="off"
      />
      {#if query}
        <button class="palette__clear" onclick={() => { query = ''; inputEl?.focus(); results = { content: [], creators: [] }; }}>
          <XIcon size={16} />
        </button>
      {/if}
      <kbd class="palette__esc">Esc</kbd>
    </div>

    <!-- Results -->
    <div class="palette__results" id="palette-results" role="listbox">
      {#if !query.trim() && recentSearches.length > 0}
        <!-- Recent searches group -->
        <div class="palette__group">
          <div class="palette__group-header">
            <span>{m.command_palette_recent()}</span>
            <button class="palette__group-clear" onclick={clearRecent}>{m.search_clear_button()}</button>
          </div>
          {#each recentSearches as term, i (term)}
            <button
              class="palette__item"
              class:palette__item--active={activeIndex === i}
              role="option"
              id="palette-item-{i}"
              aria-selected={activeIndex === i}
              onclick={() => selectItem({ type: 'recent', term, index: i })}
            >
              <SearchIcon size={14} />
              <span>{term}</span>
            </button>
          {/each}
        </div>
      {/if}

      {#if loading}
        <div class="palette__loading">
          <Spinner size="sm" />
        </div>
      {/if}

      {#if query.trim() && !loading}
        {#if results.content.length > 0}
          <div class="palette__group">
            <div class="palette__group-header">
              <span>{m.command_palette_content()}</span>
            </div>
            {#each results.content as item, i (item.id)}
              {@const flatIndex = recentSearches.length + i}  <!-- Offset for recent items -->
              <button
                class="palette__item palette__item--content"
                class:palette__item--active={activeIndex === flatIndex}
                role="option"
                id="palette-item-{flatIndex}"
                aria-selected={activeIndex === flatIndex}
                onclick={() => selectItem({ type: 'content', item, index: i })}
              >
                {#if item.thumbnailUrl}
                  <img src={item.thumbnailUrl} alt="" class="palette__thumb" />
                {:else}
                  <div class="palette__thumb palette__thumb--empty">
                    <!-- Type icon fallback -->
                  </div>
                {/if}
                <div class="palette__item-info">
                  <span class="palette__item-title">{item.title}</span>
                  <span class="palette__item-type">{item.contentType}</span>
                </div>
              </button>
            {/each}
          </div>
        {/if}

        {#if results.creators.length > 0}
          <div class="palette__group">
            <div class="palette__group-header">
              <span>{m.command_palette_creators()}</span>
            </div>
            {#each results.creators as creator, i (creator.id)}
              {@const flatIndex = recentSearches.length + results.content.length + i}
              <button
                class="palette__item palette__item--creator"
                class:palette__item--active={activeIndex === flatIndex}
                role="option"
                id="palette-item-{flatIndex}"
                aria-selected={activeIndex === flatIndex}
                onclick={() => selectItem({ type: 'creator', item: creator, index: i })}
              >
                <!-- Creator avatar -->
                <span class="palette__item-title">{creator.name}</span>
                <span class="palette__item-meta">@{creator.username}</span>
              </button>
            {/each}
          </div>
        {/if}

        {#if results.content.length === 0 && results.creators.length === 0}
          <div class="palette__empty">{m.command_palette_no_results()}</div>
        {/if}
      {/if}
    </div>

    <!-- Footer -->
    <div class="palette__footer">
      <span class="palette__hint"><kbd>↑↓</kbd> Navigate</span>
      <span class="palette__hint"><kbd>↵</kbd> Select</span>
      <span class="palette__hint"><kbd>Esc</kbd> Close</span>
    </div>
  </div>
{/if}
```

### CSS — Full Specification

```css
/* Backdrop */
.palette-backdrop {
  position: fixed;
  inset: 0;
  background: color-mix(in oklch, var(--color-overlay) 50%, transparent);
  z-index: var(--z-modal-backdrop);
}

/* Panel */
.palette {
  position: fixed;
  top: 15vh;
  left: 50%;
  transform: translateX(-50%);
  width: min(640px, calc(100vw - var(--space-8)));
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  border: var(--border-width) var(--border-style) var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  z-index: var(--z-modal);
  overflow: hidden;
}

/* Input wrapper */
.palette__input-wrapper {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  border-bottom: var(--border-width) var(--border-style) var(--color-border);
}

:global(.palette__search-icon) {
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.palette__input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--text-lg);
  color: var(--color-text);
  font-family: var(--font-sans);
  min-width: 0;
}

.palette__input::placeholder {
  color: var(--color-text-tertiary);
}

.palette__input::-webkit-search-cancel-button {
  display: none;
}

.palette__clear {
  display: flex;
  padding: var(--space-1);
  border: none;
  background: none;
  color: var(--color-text-tertiary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: var(--transition-colors);
}

.palette__clear:hover {
  color: var(--color-text);
}

.palette__esc {
  padding: var(--space-0-5) var(--space-1-5);
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
  background: var(--color-surface-secondary);
  border: var(--border-width) var(--border-style) var(--color-border);
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
}

/* Results area */
.palette__results {
  overflow-y: auto;
  max-height: 50vh;
}

.palette__group {
  padding: var(--space-2) 0;
}

.palette__group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-1) var(--space-4);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide);
}

.palette__group-clear {
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
  background: none;
  border: none;
  cursor: pointer;
  transition: var(--transition-colors);
}

.palette__group-clear:hover {
  color: var(--color-text);
}

/* Result items */
.palette__item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: var(--transition-colors);
}

.palette__item:hover,
.palette__item--active {
  background: var(--color-surface-secondary);
  color: var(--color-text);
}

/* Content result — thumbnail */
.palette__thumb {
  width: var(--space-12);
  height: var(--space-8);
  object-fit: cover;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
  background: var(--color-surface-secondary);
}

.palette__item-info {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
  min-width: 0;
}

.palette__item-title {
  font-weight: var(--font-medium);
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.palette__item-type,
.palette__item-meta {
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
  text-transform: capitalize;
}

/* Loading */
.palette__loading {
  display: flex;
  justify-content: center;
  padding: var(--space-6);
}

/* Empty state */
.palette__empty {
  padding: var(--space-8);
  text-align: center;
  color: var(--color-text-tertiary);
  font-size: var(--text-sm);
}

/* Footer */
.palette__footer {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-4);
  border-top: var(--border-width) var(--border-style) var(--color-border);
  background: var(--color-surface-secondary);
}

.palette__hint {
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.palette__hint kbd {
  padding: var(--space-0-5) var(--space-1);
  background: var(--color-surface);
  border: var(--border-width) var(--border-style) var(--color-border);
  border-radius: var(--radius-xs);
  font-size: var(--text-xs);
  font-family: var(--font-sans);
}
```

## Acceptance Criteria

- [ ] Opens via `Cmd/Ctrl+K`, `/` key, or `onSearchClick` from sidebar
- [ ] Shows recent searches when input is empty (from localStorage)
- [ ] Debounced live search (300ms) hitting `/api/search` endpoint
- [ ] Results grouped by type: Content (with thumbnails) and Creators (with avatars)
- [ ] Arrow key navigation through all items, Enter to select, Esc to close
- [ ] Navigates to content/creator page on result selection
- [ ] Navigates to search results page on Enter with no selection
- [ ] Recent searches saved to localStorage (max 5, deduped)
- [ ] Focus moves to input when opened, returns to trigger when closed
- [ ] ARIA combobox pattern: `role="combobox"`, `aria-controls`, `aria-activedescendant`
- [ ] Backdrop click closes palette
- [ ] Scope-aware: platform searches all, org searches within org
- [ ] All CSS uses design tokens
- [ ] `/api/search` server route created and working

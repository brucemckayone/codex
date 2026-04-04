<!--
  @component CommandPalette

  Studio-only command palette triggered by Cmd/Ctrl+K.
  Provides fast access to pages, content, and actions.
  Positioned in top-third of viewport as an overlay.

  @prop {Array<{ label: string; href: string; icon?: string; group: string }>} pages - Static page links
  @prop {string} orgSlug - Current org slug for content search
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import {
    SearchIcon,
    LayoutDashboardIcon,
    FileIcon,
    VideoIcon,
    TrendingUpIcon,
    UsersIcon,
    SettingsIcon,
    PlusIcon,
  } from '$lib/components/ui/Icon';

  interface CommandItem {
    id: string;
    label: string;
    href?: string;
    group: string;
    action?: () => void;
  }

  interface Props {
    orgSlug?: string;
  }

  const { orgSlug }: Props = $props();

  let isOpen = $state(false);
  let query = $state('');
  let activeIndex = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();

  // Static page items
  const pageItems: CommandItem[] = [
    { id: 'dashboard', label: 'Dashboard', href: '/studio', group: 'Pages' },
    { id: 'content', label: 'Content', href: '/studio/content', group: 'Pages' },
    { id: 'media', label: 'Media', href: '/studio/media', group: 'Pages' },
    { id: 'analytics', label: 'Analytics', href: '/studio/analytics', group: 'Pages' },
    { id: 'team', label: 'Team', href: '/studio/team', group: 'Pages' },
    { id: 'customers', label: 'Customers', href: '/studio/customers', group: 'Pages' },
    { id: 'settings', label: 'Settings', href: '/studio/settings', group: 'Pages' },
    { id: 'billing', label: 'Billing', href: '/studio/billing', group: 'Pages' },
  ];

  const actionItems: CommandItem[] = [
    { id: 'new-content', label: 'Create new content', href: '/studio/content/new', group: 'Actions' },
    { id: 'view-site', label: 'View public site', href: '/', group: 'Actions' },
  ];

  const allStaticItems = [...pageItems, ...actionItems];

  const filteredItems = $derived.by(() => {
    if (!query.trim()) return allStaticItems;
    const q = query.toLowerCase().trim();
    return allStaticItems.filter((item) =>
      item.label.toLowerCase().includes(q)
    );
  });

  // Group items for display
  const groupedItems = $derived.by(() => {
    const groups = new Map<string, CommandItem[]>();
    for (const item of filteredItems) {
      const existing = groups.get(item.group) ?? [];
      existing.push(item);
      groups.set(item.group, existing);
    }
    return groups;
  });

  const flatItems = $derived(filteredItems);

  function open() {
    isOpen = true;
    query = '';
    activeIndex = 0;
    requestAnimationFrame(() => inputEl?.focus());
  }

  function close() {
    isOpen = false;
    query = '';
  }

  function selectItem(item: CommandItem) {
    close();
    if (item.action) {
      item.action();
    } else if (item.href) {
      goto(item.href);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        activeIndex = (activeIndex + 1) % flatItems.length;
        break;
      case 'ArrowUp':
        e.preventDefault();
        activeIndex = (activeIndex - 1 + flatItems.length) % flatItems.length;
        break;
      case 'Enter':
        e.preventDefault();
        if (flatItems[activeIndex]) {
          selectItem(flatItems[activeIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
      case 'Tab':
        e.preventDefault(); // Trap focus in palette
        break;
    }
  }

  // Global Cmd/Ctrl+K handler
  function handleGlobalKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      // Don't hijack TipTap editor's Cmd+K (link shortcut)
      if (document.activeElement?.isContentEditable) return;
      e.preventDefault();
      if (isOpen) {
        close();
      } else {
        open();
      }
    }
  }

  // Reset active index when query changes
  $effect(() => {
    query; // dependency
    activeIndex = 0;
  });
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

{#if isOpen}
  <!-- Backdrop -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="palette-backdrop" onclick={close} aria-hidden="true"></div>

  <!-- Palette -->
  <div
    class="palette"
    role="dialog"
    aria-label="Command palette"
    onkeydown={handleKeydown}
  >
    <div class="palette__input-wrapper">
      <SearchIcon size={18} class="palette__search-icon" />
      <input
        bind:this={inputEl}
        type="text"
        class="palette__input"
        placeholder="Search pages, content, actions..."
        bind:value={query}
        aria-label="Command palette search"
        role="combobox"
        aria-expanded={flatItems.length > 0}
        aria-activedescendant={flatItems[activeIndex] ? `cmd-${flatItems[activeIndex].id}` : undefined}
        autocomplete="off"
      />
    </div>

    <div class="palette__results" role="listbox">
      {#if flatItems.length === 0}
        <div class="palette__empty">No results found</div>
      {:else}
        {#each [...groupedItems] as [group, items] (group)}
          <div class="palette__group">
            <div class="palette__group-label">{group}</div>
            {#each items as item (item.id)}
              {@const globalIndex = flatItems.indexOf(item)}
              <button
                id="cmd-{item.id}"
                class="palette__item"
                class:palette__item--active={globalIndex === activeIndex}
                role="option"
                aria-selected={globalIndex === activeIndex}
                onclick={() => selectItem(item)}
                onmouseenter={() => (activeIndex = globalIndex)}
              >
                <span class="palette__item-label">{item.label}</span>
                {#if item.group === 'Actions'}
                  <span class="palette__item-badge">Action</span>
                {/if}
              </button>
            {/each}
          </div>
        {/each}
      {/if}
    </div>

    <div class="palette__footer">
      <span class="palette__hint"><kbd>&uarr;&darr;</kbd> Navigate</span>
      <span class="palette__hint"><kbd>Enter</kbd> Select</span>
      <span class="palette__hint"><kbd>Esc</kbd> Close</span>
    </div>
  </div>
{/if}

<style>
  .palette-backdrop {
    position: fixed;
    inset: 0;
    background: var(--color-overlay);
    z-index: var(--z-modal-backdrop);
  }

  .palette {
    position: fixed;
    top: 15%;
    left: 50%;
    transform: translateX(-50%);
    width: min(560px, 90vw);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-xl);
    z-index: var(--z-modal);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    max-height: 60vh;
  }

  .palette__input-wrapper {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  :global(.palette__search-icon) {
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .palette__input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: var(--text-base);
    color: var(--color-text);
    font-family: var(--font-sans);
  }

  .palette__input::placeholder {
    color: var(--color-text-muted);
  }

  .palette__results {
    overflow-y: auto;
    flex: 1;
  }

  .palette__empty {
    padding: var(--space-8) var(--space-4);
    text-align: center;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .palette__group {
    padding: var(--space-1) 0;
  }

  .palette__group-label {
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }

  .palette__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--space-2-5) var(--space-4);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    transition: background-color var(--duration-fast) var(--ease-default);
  }

  .palette__item:hover,
  .palette__item--active {
    background: var(--color-surface-secondary);
  }

  .palette__item-badge {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    padding: var(--space-0-5) var(--space-2);
    background: var(--color-surface-tertiary);
    border-radius: var(--radius-sm);
  }

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
    color: var(--color-text-muted);
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .palette__hint kbd {
    padding: var(--space-0-5) var(--space-1);
    font-size: var(--text-xs);
    font-family: var(--font-sans);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-sm);
    line-height: var(--leading-none);
  }
</style>

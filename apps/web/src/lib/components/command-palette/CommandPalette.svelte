<!--
  @component CommandPalette

  Studio-only command palette triggered by Cmd/Ctrl+K.
  Provides fast access to pages, content, and actions.
  A shared Dialog placed in the top third: it traps Tab, holds the page
  still, closes on Escape or a press outside, and gives focus back.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
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
  import * as Dialog from '$lib/components/ui/Dialog';
  import * as m from '$paraglide/messages';

  interface CommandItem {
    id: string;
    label: string;
    href?: string;
    group: string;
    action?: () => void;
  }

  let isOpen = $state(false);
  let query = $state('');
  let activeIndex = $state(0);
  // What held focus when Cmd+K opened the palette; it gets focus back.
  let opener: HTMLElement | null = null;

  // Static page items — use $derived so paraglide messages resolve at render time
  const pageItems: CommandItem[] = $derived([
    { id: 'dashboard', label: m.command_palette_page_dashboard(), href: '/studio', group: m.command_palette_group_pages() },
    { id: 'content', label: m.command_palette_page_content(), href: '/studio/content', group: m.command_palette_group_pages() },
    { id: 'media', label: m.command_palette_page_media(), href: '/studio/media', group: m.command_palette_group_pages() },
    { id: 'analytics', label: m.command_palette_page_analytics(), href: '/studio/analytics', group: m.command_palette_group_pages() },
    { id: 'team', label: m.command_palette_page_team(), href: '/studio/team', group: m.command_palette_group_pages() },
    { id: 'customers', label: m.command_palette_page_customers(), href: '/studio/customers', group: m.command_palette_group_pages() },
    { id: 'settings', label: m.command_palette_page_settings(), href: '/studio/settings', group: m.command_palette_group_pages() },
    { id: 'billing', label: m.command_palette_page_billing(), href: '/studio/billing', group: m.command_palette_group_pages() },
  ]);

  const actionItems: CommandItem[] = $derived([
    { id: 'new-content', label: m.command_palette_action_create_content(), href: '/studio/content/new', group: m.command_palette_group_actions() },
    { id: 'view-site', label: m.command_palette_action_view_site(), href: '/', group: m.command_palette_group_actions() },
  ]);

  const allStaticItems = $derived([...pageItems, ...actionItems]);

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

  // The dialog moves focus to the box, its first tabbable.
  function open() {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    isOpen = true;
    query = '';
    activeIndex = 0;
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

  // The arrows bring the row they highlight into view: focus stays in the
  // box, so the browser never scrolls the list for it. Not an effect on
  // activeIndex, which a hover moves too, and a hover must not scroll.
  function highlight(index: number) {
    activeIndex = index;
    const item = flatItems[index];
    if (item) document.getElementById(`cmd-${item.id}`)?.scrollIntoView({ block: 'nearest' });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        highlight((activeIndex + 1) % flatItems.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        highlight((activeIndex - 1 + flatItems.length) % flatItems.length);
        break;
      case 'Enter':
        e.preventDefault();
        if (flatItems[activeIndex]) {
          selectItem(flatItems[activeIndex]);
        }
        break;
    }
  }

  // Global Cmd/Ctrl+K handler
  function handleGlobalKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      // Don't hijack TipTap editor's Cmd+K (link shortcut)
      const at = document.activeElement;
      if (at instanceof HTMLElement && at.isContentEditable) return;
      e.preventDefault();
      // A held Cmd+K repeats: one press, one toggle.
      if (e.repeat) return;
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

<Dialog.Root bind:open={isOpen} closeFocus={() => opener}>
  <Dialog.Content
    placement="top"
    maxWidth="min(35rem, 90vw)"
    maxHeight="60vh"
    radius="lg"
    surface="base"
    overlay="dark"
    motion="none"
    flush
    closeButton={false}
    aria-label={m.command_palette_label()}
    onkeydown={handleKeydown}
  >
    <Dialog.Toolbar>
      <div class="palette__input-wrapper">
        <SearchIcon size={18} class="palette__search-icon" />
        <input
          type="text"
          id="command-palette-input"
          name="command-palette-query"
          class="palette__input"
          placeholder={m.command_palette_search_placeholder()}
          bind:value={query}
          aria-label={m.command_palette_search_label()}
          role="combobox"
          aria-controls="palette-results"
          aria-expanded={flatItems.length > 0}
          aria-activedescendant={flatItems[activeIndex] ? `cmd-${flatItems[activeIndex].id}` : undefined}
          autocomplete="off"
        />
      </div>
    </Dialog.Toolbar>

    <Dialog.Body id="palette-results" role="listbox">
      {#if flatItems.length === 0}
        <div class="palette__empty">{m.command_palette_no_results()}</div>
      {:else}
        {#each [...groupedItems] as [group, items] (group)}
          <div class="palette__group">
            <div class="palette__group-label">{group}</div>
            {#each items as item (item.id)}
              {@const globalIndex = flatItems.indexOf(item)}
              <!-- Not a Tab stop: focus stays in the box and the arrows move
                   the highlight, so Enter opens the row that is highlighted. -->
              <button
                id="cmd-{item.id}"
                tabindex="-1"
                class="palette__item"
                class:palette__item--active={globalIndex === activeIndex}
                role="option"
                aria-selected={globalIndex === activeIndex}
                onclick={() => selectItem(item)}
                onmouseenter={() => (activeIndex = globalIndex)}
              >
                <span class="palette__item-label">{item.label}</span>
                {#if item.group === m.command_palette_group_actions()}
                  <span class="palette__item-badge">{m.command_palette_action_badge()}</span>
                {/if}
              </button>
            {/each}
          </div>
        {/each}
      {/if}
    </Dialog.Body>

    <Dialog.Footer>
      <div class="palette__footer">
        <span class="palette__hint"><kbd>&uarr;&darr;</kbd> {m.command_palette_hint_navigate()}</span>
        <span class="palette__hint"><kbd>Enter</kbd> {m.command_palette_hint_select()}</span>
        <span class="palette__hint"><kbd>Esc</kbd> {m.command_palette_hint_close()}</span>
      </div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
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
    text-transform: var(--text-transform-label, uppercase);
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

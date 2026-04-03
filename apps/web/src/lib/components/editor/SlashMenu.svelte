<!--
  @component SlashMenu

  Floating command palette that appears when the user types "/".
  Supports keyboard navigation (arrow keys, Enter, Escape).

  @prop {SlashCommandItem[]} items - Filtered command items
  @prop {(item: SlashCommandItem) => void} onselect - Called when an item is selected
-->
<script lang="ts">
  import type { SlashCommandItem } from '$lib/editor/slash-commands';

  interface Props {
    items: SlashCommandItem[];
    onselect: (item: SlashCommandItem) => void;
  }

  const { items, onselect }: Props = $props();

  let selectedIndex = $state(0);

  // Reset selection when items change
  $effect(() => {
    if (items) selectedIndex = 0;
  });

  /** Handle keyboard navigation — called by the suggestion plugin via onKeyDown */
  export function handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'ArrowUp') {
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      return true;
    }
    if (event.key === 'ArrowDown') {
      selectedIndex = (selectedIndex + 1) % items.length;
      return true;
    }
    if (event.key === 'Enter') {
      const item = items[selectedIndex];
      if (item) onselect(item);
      return true;
    }
    return false;
  }

  function iconForItem(icon: string): string {
    switch (icon) {
      case 'H1': return 'H1';
      case 'H2': return 'H2';
      case 'H3': return 'H3';
      default: return '';
    }
  }
</script>

{#if items.length > 0}
  <div class="slash-menu" role="listbox" aria-label="Insert block">
    {#each items as item, i}
      <button
        type="button"
        class="slash-menu__item"
        role="option"
        aria-selected={i === selectedIndex}
        data-selected={i === selectedIndex || undefined}
        onmouseenter={() => (selectedIndex = i)}
        onclick={() => onselect(item)}
      >
        <span class="slash-menu__icon" aria-hidden="true">
          {#if item.icon === 'H1' || item.icon === 'H2' || item.icon === 'H3'}
            <span class="slash-menu__icon-text">{item.icon}</span>
          {:else if item.icon === 'list'}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          {:else if item.icon === 'list-ordered'}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="10" y1="6" x2="21" y2="6" /><line x1="10" y1="12" x2="21" y2="12" /><line x1="10" y1="18" x2="21" y2="18" />
              <path d="M4 6h1v4" /><path d="M4 10h2" /><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
            </svg>
          {:else if item.icon === 'quote'}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" />
              <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z" />
            </svg>
          {:else if item.icon === 'code'}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
            </svg>
          {:else if item.icon === 'divider'}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="2" y1="12" x2="22" y2="12" />
            </svg>
          {/if}
        </span>
        <span class="slash-menu__content">
          <span class="slash-menu__title">{item.title}</span>
          <span class="slash-menu__description">{item.description}</span>
        </span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .slash-menu {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    min-width: 240px;
    max-height: 320px;
    overflow-y: auto;
    z-index: var(--z-dropdown, 10);
  }

  .slash-menu__item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: var(--transition-colors);
  }

  .slash-menu__item[data-selected] {
    background-color: var(--color-interactive-subtle, var(--color-surface-secondary));
  }

  .slash-menu__item:hover {
    background-color: var(--color-interactive-subtle, var(--color-surface-secondary));
  }

  .slash-menu__icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    flex-shrink: 0;
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary, var(--color-neutral-100));
    color: var(--color-text-secondary);
  }

  .slash-menu__icon-text {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-bold);
    line-height: 1;
  }

  .slash-menu__content {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .slash-menu__title {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    line-height: 1.3;
  }

  .slash-menu__description {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: 1.3;
  }

  /* Dark mode */
  :global([data-theme='dark']) .slash-menu {
    background-color: var(--color-surface);
    border-color: var(--color-border);
  }

  :global([data-theme='dark']) .slash-menu__item[data-selected],
  :global([data-theme='dark']) .slash-menu__item:hover {
    background-color: var(--color-neutral-800);
  }

  :global([data-theme='dark']) .slash-menu__icon {
    background-color: var(--color-neutral-800);
    color: var(--color-text-secondary);
  }

  :global([data-theme='dark']) .slash-menu__title {
    color: var(--color-text);
  }
</style>

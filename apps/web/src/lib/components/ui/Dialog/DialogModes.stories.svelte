<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { writable } from 'svelte/store';
  import Button from '../Button/Button.svelte';
  import * as Dialog from './index';

  /**
   * Dialog.Content's placement, size, surface, overlay and motion props
   * (Codex-vlphc.1), one story per panel they were measured from: the
   * site's search palette, the studio's command palette and the phone
   * nav's bottom sheet. Each puts its own rows inside flush parts, as those
   * components will. Every story is taller than a short screen and its last
   * item carries `data-testid="scroll-target"`, so the scroll proof drives
   * these too. No autodocs: a docs page would open every dialog at once.
   */
  const { Story } = defineMeta({
    title: 'UI/Dialog/Modes',
  });

  const items = Array.from({ length: 18 }, (_, i) => i + 1);

  const searchOpen = writable(false);
  const studioOpen = writable(false);
  const sheetOpen = writable(false);
</script>

{#snippet results(label: string)}
  {#each ['Pages', 'Content'] as group, g (group)}
    <div class="group" data-row="group-{g}">
      <div class="group-label">{group}</div>
      {#each items as item (item)}
        <button
          type="button"
          class="item"
          data-testid={g === 1 && item === items.length ? 'scroll-target' : undefined}
        >
          {label} {group.toLowerCase()} {item}
        </button>
      {/each}
    </div>
  {/each}
{/snippet}

{#snippet searchRow(placeholder: string)}
  <div class="search-row" data-row="search">
    <input class="search-input" name="q" {placeholder} autocomplete="off" />
    <kbd class="key">Esc</kbd>
  </div>
{/snippet}

{#snippet hints()}
  <div class="hints" data-row="hints">
    <span class="hint"><kbd class="key">↑↓</kbd> Navigate</span>
    <span class="hint"><kbd class="key">↵</kbd> Select</span>
    <span class="hint"><kbd class="key">Esc</kbd> Close</span>
  </div>
{/snippet}

<!-- CommandPaletteSearch: results capped at 50vh inside a 70vh panel. -->
<Story name="Search Palette">
  <Button onclick={() => ($searchOpen = true)}>Open search palette</Button>
  <Dialog.Root bind:open={$searchOpen}>
    <Dialog.Content
      placement="top"
      maxWidth="var(--container-sm)"
      surface="base"
      overlay="dim"
      motion="drop"
      flush
      closeButton={false}
      aria-label="Search"
    >
      <Dialog.Toolbar>{@render searchRow('Search content and creators')}</Dialog.Toolbar>
      <Dialog.Body>
        <div class="capped-results" data-row="results">{@render results('Result')}</div>
      </Dialog.Body>
      <Dialog.Footer>{@render hints()}</Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<!-- The studio CommandPalette: Body is the results list. -->
<Story name="Studio Palette">
  <Button onclick={() => ($studioOpen = true)}>Open studio palette</Button>
  <Dialog.Root bind:open={$studioOpen}>
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
      aria-label="Command palette"
    >
      <Dialog.Toolbar>{@render searchRow('Go to a page or run an action')}</Dialog.Toolbar>
      <Dialog.Body data-row="results">{@render results('Open')}</Dialog.Body>
      <Dialog.Footer>{@render hints()}</Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<!-- MobileBottomSheet: one padded column that scrolls as a whole. -->
<Story name="Bottom Sheet">
  <Button onclick={() => ($sheetOpen = true)}>Open bottom sheet</Button>
  <Dialog.Root bind:open={$sheetOpen}>
    <Dialog.Content
      placement="bottom"
      surface="glass"
      overlay="dim"
      motion="rise"
      flush
      closeButton={false}
      aria-label="More options"
    >
      <Dialog.Body>
        <div class="sheet">
          <div class="handle-area" data-row="handle"><div class="handle"></div></div>
          {#each items as item (item)}
            <a
              href="#link-{item}"
              class="sheet-link"
              data-testid={item === items.length ? 'scroll-target' : undefined}
            >
              Link {item}
            </a>
          {/each}
        </div>
      </Dialog.Body>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<style>
  .search-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .search-input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-lg);
  }

  .search-input:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .key {
    padding: var(--space-0-5) var(--space-1);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-sm);
  }

  .capped-results {
    max-height: 50vh;
    overflow-y: auto;
  }

  .group {
    padding: var(--space-2) 0;
  }

  .group-label {
    padding: var(--space-1) var(--space-4);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
  }

  .item {
    display: block;
    width: 100%;
    padding: var(--space-2) var(--space-4);
    border: none;
    background: none;
    color: var(--color-text);
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }

  .item:hover,
  .item:focus-visible {
    background: var(--color-surface-secondary);
    outline: none;
  }

  .hints {
    display: flex;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
    background: var(--color-surface-secondary);
  }

  .hint {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }

  .sheet {
    padding: 0 var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom));
    touch-action: pan-y;
  }

  .handle-area {
    padding: var(--space-3) 0;
  }

  .handle {
    width: var(--space-12);
    height: var(--space-1);
    margin-inline: auto;
    border-radius: var(--radius-full);
    background: var(--color-border-subtle);
  }

  .sheet-link {
    display: block;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    color: var(--color-text);
    font-size: var(--text-sm);
    text-decoration: none;
  }

  .sheet-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }
</style>

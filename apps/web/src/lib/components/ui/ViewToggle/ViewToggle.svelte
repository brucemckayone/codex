<!--
  @component ViewToggle

  Segmented control for switching between grid and list view modes.
  Persists selection in localStorage under 'codex-view-mode'.

  @prop {'grid' | 'list'} value - Current view mode
  @prop {(value: 'grid' | 'list') => void} onchange - Called when view mode changes
-->
<script lang="ts">
  import { LayoutGridIcon, LayoutListIcon } from '$lib/components/ui/Icon';

  interface Props {
    value?: 'grid' | 'list';
    onchange?: (value: 'grid' | 'list') => void;
    class?: string;
  }

  const { value = 'grid', onchange, class: className }: Props = $props();
</script>

<div class="view-toggle {className ?? ''}" role="radiogroup" aria-label="View mode">
  <button
    class="view-toggle__btn"
    class:active={value === 'grid'}
    onclick={() => onchange?.('grid')}
    aria-checked={value === 'grid'}
    role="radio"
    aria-label="Grid view"
  >
    <LayoutGridIcon size={18} />
  </button>
  <button
    class="view-toggle__btn"
    class:active={value === 'list'}
    onclick={() => onchange?.('list')}
    aria-checked={value === 'list'}
    role="radio"
    aria-label="List view"
  >
    <LayoutListIcon size={18} />
  </button>
</div>

<style>
  .view-toggle {
    display: inline-flex;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .view-toggle__btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    border: none;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .view-toggle__btn:hover {
    background: var(--color-surface-secondary);
  }

  .view-toggle__btn.active {
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  .view-toggle__btn.active:hover {
    background: var(--color-interactive-hover);
  }

  .view-toggle__btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: -2px;
  }
</style>

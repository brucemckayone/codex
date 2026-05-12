<!--
  @component ActiveFiltersStrip

  Renders a flex-wrap row of dismissible chip pills representing the
  currently-active filters, plus a trailing "Clear all" button. Each
  chip dismisses its own filter on click; the clear-all delegates to
  the parent.

  Single canonical implementation — replaces both Library's `.lt__chips`
  and Explore's `.explore__chips` strips.
-->
<script lang="ts">
  import { XIcon } from '$lib/components/ui/Icon';
  import type { ActiveFilterChip } from './types';

  interface Props {
    chips: ActiveFilterChip[];
    onRemove: (chip: ActiveFilterChip) => void;
    onClearAll: () => void;
    clearAllLabel: string;
    /** When true, the trailing Clear-all only appears with 2+ chips. */
    requireMultipleForClear?: boolean;
  }

  const {
    chips,
    onRemove,
    onClearAll,
    clearAllLabel,
    requireMultipleForClear = false,
  }: Props = $props();

  const showClearAll = $derived(
    requireMultipleForClear ? chips.length > 1 : chips.length > 0
  );
</script>

{#if chips.length > 0}
  <div class="active-filters" data-testid="active-filters-strip" aria-live="polite">
    {#each chips as chip (chip.key)}
      <button
        type="button"
        class="active-filters__chip"
        onclick={() => onRemove(chip)}
        aria-label={`Remove filter: ${chip.label}`}
      >
        <span>{chip.label}</span>
        <XIcon size={11} aria-hidden="true" />
      </button>
    {/each}
    {#if showClearAll}
      <button type="button" class="active-filters__clear" onclick={onClearAll}>
        {clearAllLabel}
      </button>
    {/if}
  </div>
{/if}

<style>
  .active-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .active-filters__chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .active-filters__chip:hover {
    border-color: var(--color-border-strong);
    background: var(--color-surface);
  }

  .active-filters__chip:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset, 1px);
  }

  .active-filters__clear {
    padding: var(--space-1) var(--space-2);
    background: transparent;
    border: 0;
    color: var(--color-interactive);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  .active-filters__clear:hover {
    color: var(--color-interactive-hover);
  }

  .active-filters__clear:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset, 1px);
  }
</style>

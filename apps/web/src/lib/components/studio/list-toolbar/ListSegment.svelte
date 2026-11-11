<!--
  @component ListSegment

  A studio list's segmented choice (Codex-a6ofh.3.1): the media library's
  type and view toggles, the content list's status and view. One radio per
  option; `iconsOnly` shows each option's icon, its label as the name and
  tooltip (the grid/list toggle).
-->
<script lang="ts" generics="T extends string">
  import type { SegmentOption } from './list-option';

  interface Props {
    /** The group's name: "Type", "View". */
    label: string;
    value: T;
    options: readonly SegmentOption<T>[];
    /** Each option as its icon, named by its label. */
    iconsOnly?: boolean;
    onSelect: (value: T) => void;
    /** Optional class forwarded to the root for layout composition (R13). */
    class?: string;
  }

  const { label, value, options, iconsOnly = false, onSelect, class: className }: Props = $props();
</script>

<div
  class="segment {className ?? ''}"
  data-variant={iconsOnly ? 'icons' : undefined}
  role="radiogroup"
  aria-label={label}
>
  {#each options as option (option.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === option.value}
      aria-label={iconsOnly ? option.label() : undefined}
      title={iconsOnly ? option.label() : undefined}
      class="segment-option"
      onclick={() => onSelect(option.value)}
    >
      {#if iconsOnly && option.icon}
        <option.icon size={16} />
      {:else}
        {option.label()}
      {/if}
    </button>
  {/each}
</div>

<style>
  .segment {
    display: inline-flex;
    padding: var(--space-0-5);
    gap: var(--space-0-5);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-secondary);
  }

  .segment-option {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: var(--space-8);
    padding: 0 var(--space-3);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    white-space: nowrap;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .segment[data-variant='icons'] .segment-option {
    padding: 0 var(--space-2);
  }

  .segment-option:hover {
    color: var(--color-text);
  }

  .segment-option[aria-checked='true'] {
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow: var(--shadow-sm);
  }

  .segment-option:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }
</style>

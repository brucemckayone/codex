<!--
  @component ListSegment

  A studio list's segmented choice (Codex-a6ofh.3.1): the media library's
  type and view toggles, the content list's status and view. One radio per
  option; `iconsOnly` shows each option's icon, its label as the name and
  tooltip (the grid/list toggle). `wrap` lets a long set run onto more lines
  in a narrow column (the brand editor's hero options, WP-9), each option
  still one radio of the one group.

  The keyboard is the WAI-ARIA radio group's: the group is ONE tab stop (the
  checked option, else the first), and the arrow keys move to the next or
  previous option and choose it, wrapping at either end.
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
    /** Run the options onto more lines when they do not fit on one. */
    wrap?: boolean;
    onSelect: (value: T) => void;
    /** Optional class forwarded to the root for layout composition (R13). */
    class?: string;
  }

  const {
    label,
    value,
    options,
    iconsOnly = false,
    wrap = false,
    onSelect,
    class: className,
  }: Props = $props();

  /** The one tab stop: the checked option, else the first. */
  const tabStop = $derived(
    options.some((option) => option.value === value) ? value : options[0]?.value
  );

  function onKeydown(event: KeyboardEvent): void {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0 || options.length === 0) return;
    event.preventDefault();
    const radios = [
      ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="radio"]'),
    ];
    const from = radios.indexOf(event.target as HTMLElement);
    const to = ((from === -1 ? 0 : from + step) + options.length) % options.length;
    onSelect(options[to].value);
    radios[to]?.focus();
  }
</script>

<div
  class="segment {className ?? ''}"
  data-variant={iconsOnly ? 'icons' : undefined}
  data-wrap={wrap ? '' : undefined}
  role="radiogroup"
  aria-label={label}
  tabindex="-1"
  onkeydown={onKeydown}
>
  {#each options as option (option.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === option.value}
      tabindex={option.value === tabStop ? 0 : -1}
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

  .segment[data-wrap] {
    display: flex;
    flex-wrap: wrap;
  }

  .segment[data-wrap] .segment-option {
    height: auto;
    min-height: var(--space-8);
    padding-block: var(--space-1);
    white-space: normal;
    text-align: center;
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

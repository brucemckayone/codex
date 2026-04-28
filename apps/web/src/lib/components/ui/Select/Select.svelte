<!--
  @component Select

  A dropdown select component with search-friendly option list.
  Portals to document.body for proper z-index layering.

  @prop {Array<{value: string, label: string}>} options - Available options
  @prop {string} value - Bindable selected value
  @prop {string} [placeholder='Select an option...'] - Placeholder text
  @prop {string} [label] - Optional label for the select
  @prop {function} [onValueChange] - Callback when selection changes
  @prop {string} [id] - ID for label association (auto-generated if omitted)

  @example
  <Select
    options={[{value: 'a', label: 'Option A'}]}
    bind:value={selected}
    label="Choose one"
  />
-->
<script lang="ts">
  import { createSelect } from '@melt-ui/svelte';
  import { untrack } from 'svelte';
  import { fly } from 'svelte/transition';
  import { Label } from '../Label';
  import { ChevronDownIcon, CheckIcon } from '$lib/components/ui/Icon';

  interface Option {
    value: string;
    label: string;
  }

  interface Props {
    options: Option[];
    value?: string;
    placeholder?: string;
    label?: string;
    onValueChange?: (value: string | undefined) => void;
    class?: string;
    id?: string;
  }

  let {
    options,
    value = $bindable(),
    placeholder = 'Select an option...',
    label,
    onValueChange,
    class: className,
    id
  }: Props = $props();

  const {
    elements: { trigger, menu, option },
    states: { selectedLabel, open, selected },
    helpers: { isSelected }
  } = createSelect({
    forceVisible: true,
    portal: true, // Portal to body required for Storybook iframe rendering
    defaultSelected: untrack(() => value ? { value, label: options.find(o => o.value === value)?.label ?? '' } : undefined),
    onSelectedChange: ({ next }) => {
      value = next?.value;
      onValueChange?.(next?.value);
      return next;
    }
  });

  const generatedId = $derived(id || `select-${Math.random().toString(36).substring(2, 9)}`);

  // Sync external value prop changes to Melt-UI internal state
  $effect(() => {
    const currentSelected = $selected;
    if (value !== currentSelected?.value) {
      const found = options.find(o => o.value === value);
      selected.set(found ? { value, label: found.label } : undefined);
    }
  });
</script>

<div class="select-container {className ?? ''}">
  {#if label}
    <Label for={generatedId}>{label}</Label>
  {:else}
    <Label for={generatedId} class="sr-only">{placeholder}</Label>
  {/if}

  <button {...$trigger} use:trigger id={generatedId} class="select-trigger">
    <span class="select-value">
      {$selectedLabel || placeholder}
    </span>
    <ChevronDownIcon size={16} class="select-icon" />
  </button>

  {#if $open}
    <div {...$menu} use:menu class="select-content" transition:fly={{ y: -5, duration: 150 }}>
      {#each options as opt}
        <div {...$option({ value: opt.value, label: opt.label })} use:option class="select-option">
          <span class="option-label">{opt.label}</span>
          {#if $isSelected(opt.value)}
            <CheckIcon size={16} class="check-icon" />
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .select-container {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
    position: relative;
  }

  .select-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
    font-size: var(--text-base);
    color: var(--color-text);
    text-align: left;
  }

  .select-trigger:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .select-trigger:hover {
    border-color: var(--color-border-strong);
  }

  .select-icon {
    color: var(--color-text-muted);
    transition: transform var(--duration-fast);
  }

  .select-trigger:global([data-state="open"]) .select-icon {
    transform: rotate(180deg);
  }

  .select-content {
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    padding: var(--space-1);
    z-index: var(--z-dropdown);
    max-height: 15rem;
    overflow-y: auto;
    position: absolute;
    top: calc(100% + var(--space-1));
    left: 0;
    right: 0;
  }

  .select-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--text-base);
    color: var(--color-text);
    transition: background-color var(--duration-fast);
    background: transparent;
    border: none;
    text-align: left;
  }

  .select-option:global([data-highlighted]) {
    background-color: var(--color-surface-secondary);
  }

  .select-option:global([aria-selected="true"]) {
    background-color: var(--color-interactive-subtle);
    color: var(--color-interactive-active);
  }

  .check-icon {
    color: var(--color-interactive);
  }

</style>

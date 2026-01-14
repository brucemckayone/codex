<script lang="ts">
  import { createSelect, melt } from '@melt-ui/svelte';
  import { fly } from 'svelte/transition';
  import { Label } from '../index';

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
    elements: { trigger, menu, option }, // Removing label from here as we'll use the standalone Label component
    states: { selectedLabel, open, selected },
    helpers: { isSelected }
  } = createSelect({
    forceVisible: true,
    defaultSelected: value ? { value, label: options.find(o => o.value === value)?.label ?? '' } : undefined,
    onSelectedChange: ({ next }) => {
      value = next?.value;
      onValueChange?.(next?.value);
      return next;
    }
  });

  const generatedId = $derived(id || `select-${Math.random().toString(36).substring(2, 9)}`);

  // Sync prop to melt state
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

  <button use:melt={$trigger} id={generatedId} class="select-trigger">
    <span class="select-value">
      {$selectedLabel || placeholder}
    </span>
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="select-icon"><path d="m6 9 6 6 6-6"/></svg>
  </button>

  {#if $open}
    <div use:melt={$menu} class="select-content" transition:fly={{ y: -5, duration: 150 }}>
      {#each options as opt}
        <div use:melt={$option({ value: opt.value, label: opt.label })} class="select-option">
          <span class="option-label">{opt.label}</span>
          {#if $isSelected(opt.value)}
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="check-icon"><polyline points="20 6 9 17 4 12"/></svg>
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
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
  }

  .select-trigger:hover {
    border-color: var(--color-neutral-400);
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
    background-color: var(--color-neutral-100);
  }

  .select-option:global([aria-selected="true"]) {
    background-color: var(--color-primary-50);
    color: var(--color-primary-900);
  }

  .check-icon {
    color: var(--color-primary-500);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
</style>

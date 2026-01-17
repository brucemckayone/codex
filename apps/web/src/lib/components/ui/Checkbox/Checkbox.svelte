<script lang="ts">
  import { createCheckbox } from '@melt-ui/svelte';
  import { untrack } from 'svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { Label } from '../index';

  interface Props extends Omit<HTMLInputAttributes, 'type' | 'checked'> {
    checked?: boolean | 'indeterminate';
    label?: string;
    required?: boolean;
    onCheckedChange?: (checked: boolean | 'indeterminate') => void;
  }

  let {
    checked = $bindable(false),
    label,
    required = false,
    onCheckedChange,
    class: className,
    id,
    ...restProps
  }: Props = $props();

  const {
    elements: { root, input },
    states: { checked: meltChecked }
  } = createCheckbox({
    defaultChecked: untrack(() => checked),
    onCheckedChange: ({ next }) => {
      checked = next;
      onCheckedChange?.(next);
      return next;
    }
  });

  // Sync prop to melt state
  $effect(() => {
    meltChecked.set(checked);
  });

  const generatedId = $derived(id || `checkbox-${Math.random().toString(36).substring(2, 9)}`);
</script>

<div class="checkbox-container {className ?? ''}">
  <button
    {...$root}
    use:root
    {id}
    class="checkbox-root"
  >
    <div class="checkbox-control">
      {#if checked === true}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="check-icon">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      {:else if checked === 'indeterminate'}
        <div class="indeterminate-bar"></div>
      {/if}
    </div>
    <input {...$input} use:input id={generatedId} {required} />
  </button>

  {#if label}
    <Label for={generatedId}>{label}</Label>
  {/if}
</div>

<style>
  .checkbox-container {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .checkbox-root {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-5);
    height: var(--space-5);
    background: var(--color-surface);
    border: var(--border-width-thick) var(--border-style) var(--color-border);
    border-radius: var(--radius-sm);
    transition: var(--transition-colors);
    padding: 0;
    cursor: pointer;
  }

  .checkbox-root:global([data-state="checked"]) {
    background-color: var(--color-primary-500);
    border-color: var(--color-primary-500);
  }

  .checkbox-root:focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
  }

  .checkbox-control {
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    width: 100%;
    height: 100%;
  }

  .check-icon {
    width: 80%;
    height: 80%;
  }

  .indeterminate-bar {
    width: 60%;
    height: 2px;
    background-color: white;
  }

  .checkbox-root:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
</style>

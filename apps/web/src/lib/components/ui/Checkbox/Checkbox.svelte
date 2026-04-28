<script lang="ts">
  import { createCheckbox } from '@melt-ui/svelte';
  import { untrack } from 'svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { Label } from '../Label';
  import { CheckIcon } from '$lib/components/ui/Icon';

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
        <CheckIcon class="check-icon" stroke-width="3" />
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
    background-color: var(--color-interactive);
    border-color: var(--color-interactive);
  }

  .checkbox-root:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .checkbox-control {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-on-brand);
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
    background-color: var(--color-surface);
  }

  .checkbox-root:disabled {
    cursor: not-allowed;
    opacity: var(--opacity-50);
  }
</style>

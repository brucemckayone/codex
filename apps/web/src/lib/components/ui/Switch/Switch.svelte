<script lang="ts">
  import { createSwitch, melt } from '@melt-ui/svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLButtonAttributes, 'role' | 'aria-checked'> {
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }

  let {
    checked = $bindable(false),
    disabled = false,
    onCheckedChange,
    class: className,
    ...restProps
  }: Props = $props();

  const {
    elements: { root, input },
    states: { checked: meltChecked }
  } = createSwitch({
    defaultChecked: checked,
    disabled: disabled,
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
</script>

<button
  use:melt={$root}
  class="switch {className ?? ''}"
  {...restProps}
>
  <span class="thumb"></span>
  <input use:melt={$input} />
</button>

<style>
  .switch {
    position: relative;
    display: inline-flex;
    height: var(--space-6);
    width: var(--space-11);
    flex-shrink: 0;
    cursor: pointer;
    align-items: center;
    border-radius: var(--radius-full);
    border: none;
    background-color: var(--color-neutral-200);
    transition: var(--transition-colors);
    padding: 0;
  }

  .switch:focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
  }

  .switch[data-state="checked"] {
    background-color: var(--color-primary-500);
  }

  .switch:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .thumb {
    pointer-events: none;
    display: block;
    height: var(--space-5);
    width: var(--space-5);
    border-radius: var(--radius-full);
    background-color: white;
    box-shadow: var(--shadow-sm);
    transition: transform var(--duration-normal) var(--ease-out);
    transform: translateX(var(--space-0-5));
  }

  .switch[data-state="checked"] .thumb {
    transform: translateX(var(--space-5-5));
  }
</style>

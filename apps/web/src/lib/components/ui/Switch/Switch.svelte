<script lang="ts">
  import { createSwitch, melt } from '@melt-ui/svelte';

  interface Props {
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }

  let { checked = $bindable(false), disabled = false, onCheckedChange }: Props = $props();

  const {
    elements: { root, input },
    states: { checked: isChecked }
  } = createSwitch({
    defaultChecked: checked,
    disabled,
    onCheckedChange: ({ next }) => {
      checked = next;
      onCheckedChange?.(next);
      return next;
    }
  });

  $effect(() => {
    // Sync external checked state if it changes
    // This is handled by bindable normally, but explicit sync might be needed if Melt state diverges
  });
</script>

<button
  use:melt={$root}
  class="switch"
  class:checked={$isChecked}
  class:disabled={disabled}
>
  <span class="thumb"></span>
  <!-- Visually hidden input for form submission -->
  <input use:melt={$input} class="sr-only" />
</button>

<style>
  .switch {
    display: inline-flex;
    height: 24px;
    width: 44px;
    flex-shrink: 0;
    cursor: pointer;
    align-items: center;
    border-radius: 9999px;
    border: 2px solid transparent;
    transition: var(--transition-colors);
    background-color: var(--color-neutral-200);
    position: relative;
    padding: 0;
  }

  .switch.checked {
    background-color: var(--color-primary-500);
  }

  .switch.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .switch:focus-visible {
    outline: 2px solid var(--color-border-focus);
    outline-offset: 2px;
  }

  .thumb {
    pointer-events: none;
    display: block;
    height: 20px;
    width: 20px;
    border-radius: 50%;
    background-color: white;
    box-shadow: var(--shadow-sm);
    transition: transform var(--duration-normal) var(--ease-out);

    /* Ensure thumb stays within bounds (2px border + 0px translate = 2px from edge) */
    /* Wait, the container is 44px width, thumb is 20px.
       Padding is 0.
       If we want 2px spacing:
       TranslateX(2px) for unchecked?
       Let's use absolute positioning for control or rely on flex/padding.
       Original used translateX.
    */
    /* Fix: Translate needs to account for initial offset if using flex.
       With flex align-items center, it's centered vertically.
       Let's use a wrapper or just rely on the transform.
    */
    transform: translateX(2px);
  }

  .switch.checked .thumb {
    transform: translateX(22px);
  }

  /* Ensure the input is truly hidden if global utility css isn't loaded for some reason */
  :global(.sr-only) {
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

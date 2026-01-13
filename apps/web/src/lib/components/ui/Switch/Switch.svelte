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
  <span ></span>
  <!-- Visually hidden input for form submission -->
  <input use:melt={$input}  />
</button>

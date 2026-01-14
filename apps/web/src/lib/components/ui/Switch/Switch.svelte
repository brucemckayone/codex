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
</script>

<button use:melt={$root}>
  <!-- Visually hidden input for form submission -->
  <input use:melt={$input} />
</button>

<script lang="ts">
  import { createDialog } from '@melt-ui/svelte';
  import { type Snippet, setContext } from 'svelte';

  interface Props {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: Snippet;
  }

  let { open = $bindable(false), onOpenChange, children }: Props = $props();

  const dialog = createDialog({
    // We omit the 'open' property from the initial options to avoid type errors with runes
    // and instead sync it via the states object and $effect.
    onOpenChange: ({ next }) => {
      open = next;
      onOpenChange?.(next);
      return next;
    },
    forceVisible: true
  });

  const {
    states: { open: meltOpen }
  } = dialog;

  // Sync prop to melt state
  $effect(() => {
    meltOpen.set(open);
  });

  setContext('DIALOG', dialog);
</script>

{@render children()}

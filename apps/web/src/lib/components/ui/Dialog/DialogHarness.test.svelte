<script lang="ts">
  import Dialog from './Dialog.svelte';
  import DialogContent from './DialogContent.svelte';
  import DialogDescription from './DialogDescription.svelte';
  import DialogTitle from './DialogTitle.svelte';

  interface Props {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    size?: 'sm' | 'md' | 'lg';
  }

  let { open = $bindable(false), onOpenChange, size = 'md' }: Props = $props();
</script>

<Dialog bind:open {onOpenChange}>
  <DialogContent {size}>
    <DialogTitle>Dialog Title</DialogTitle>
    <DialogDescription>Dialog description text</DialogDescription>
    <button type="button" data-testid="first-focusable">First focusable</button>
    <button type="button" data-testid="second-focusable">Second focusable</button>
  </DialogContent>
</Dialog>

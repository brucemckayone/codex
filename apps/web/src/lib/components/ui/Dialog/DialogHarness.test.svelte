<script lang="ts">
  import Dialog from './Dialog.svelte';
  import DialogBody from './DialogBody.svelte';
  import DialogContent from './DialogContent.svelte';
  import DialogDescription from './DialogDescription.svelte';
  import DialogFooter from './DialogFooter.svelte';
  import DialogFormElement from './DialogFormElement.svelte';
  import DialogHeader from './DialogHeader.svelte';
  import DialogTitle from './DialogTitle.svelte';

  interface Props {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    size?: 'sm' | 'md' | 'lg';
    dismissible?: boolean;
    variant?: 'dialog' | 'drawer';
    sheet?: boolean;
    flush?: boolean;
    closeButton?: boolean;
    /** Wrap the Body in Dialog.Form. */
    withForm?: boolean;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    size = 'md',
    dismissible = true,
    variant,
    sheet,
    flush,
    closeButton,
    withForm = false,
  }: Props = $props();
</script>

{#snippet body()}
  <DialogBody>
    <button type="button" data-testid="first-focusable">First focusable</button>
    <button type="button" data-testid="second-focusable">Second focusable</button>
  </DialogBody>
{/snippet}

<Dialog bind:open {onOpenChange} {dismissible}>
  <DialogContent {size} {variant} {sheet} {flush} {closeButton}>
    <DialogHeader>
      <DialogTitle>Dialog Title</DialogTitle>
      <DialogDescription>Dialog description text</DialogDescription>
    </DialogHeader>
    {#if withForm}
      <DialogFormElement>{@render body()}</DialogFormElement>
    {:else}
      {@render body()}
    {/if}
    <DialogFooter><span>Footer</span></DialogFooter>
  </DialogContent>
</Dialog>

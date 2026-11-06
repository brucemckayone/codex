<script lang="ts">
  import Dialog from './Dialog.svelte';
  import DialogBody from './DialogBody.svelte';
  import DialogContent from './DialogContent.svelte';
  import DialogDescription from './DialogDescription.svelte';
  import DialogFooter from './DialogFooter.svelte';
  import DialogFormElement from './DialogFormElement.svelte';
  import DialogHeader from './DialogHeader.svelte';
  import DialogTitle from './DialogTitle.svelte';
  import DialogToolbar from './DialogToolbar.svelte';

  interface Props {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    size?: 'sm' | 'md' | 'lg';
    dismissible?: boolean;
    role?: 'dialog' | 'alertdialog';
    variant?: 'dialog' | 'drawer';
    sheet?: boolean;
    flush?: boolean;
    floating?: boolean;
    closeButton?: boolean;
    footerAlign?: 'end' | 'between';
    placement?: 'center' | 'top' | 'bottom';
    maxWidth?: string;
    maxHeight?: string;
    radius?: 'modal' | 'lg';
    surface?: 'elevated' | 'base' | 'glass';
    overlay?: 'blur' | 'dim' | 'dark';
    motion?: 'auto' | 'drop' | 'rise' | 'none';
    /** Wrap the Body in Dialog.Form. */
    withForm?: boolean;
    /** A Dialog.Toolbar between Header and Body. */
    withToolbar?: boolean;
    /** Attributes a page hands Content and Body, beyond their props. */
    contentProps?: Record<string, unknown>;
    bodyProps?: Record<string, unknown>;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    size = 'md',
    dismissible = true,
    role,
    variant,
    sheet,
    flush,
    floating,
    closeButton,
    footerAlign,
    placement,
    maxWidth,
    maxHeight,
    radius,
    surface,
    overlay,
    motion,
    withForm = false,
    withToolbar = false,
    contentProps = {},
    bodyProps = {},
  }: Props = $props();
</script>

{#snippet body()}
  <DialogBody {...bodyProps}>
    <button type="button" data-testid="first-focusable">First focusable</button>
    <button type="button" data-testid="second-focusable">Second focusable</button>
  </DialogBody>
{/snippet}

<Dialog bind:open {onOpenChange} {dismissible} {role}>
  <DialogContent
    {...contentProps}
    {size}
    {variant}
    {sheet}
    {flush}
    {floating}
    {closeButton}
    {placement}
    {maxWidth}
    {maxHeight}
    {radius}
    {surface}
    {overlay}
    {motion}
  >
    <DialogHeader>
      <DialogTitle>Dialog Title</DialogTitle>
      <DialogDescription>Dialog description text</DialogDescription>
    </DialogHeader>
    {#if withToolbar}
      <DialogToolbar><span>Toolbar</span></DialogToolbar>
    {/if}
    {#if withForm}
      <DialogFormElement>{@render body()}</DialogFormElement>
    {:else}
      {@render body()}
    {/if}
    <DialogFooter align={footerAlign}><span>Footer</span></DialogFooter>
  </DialogContent>
</Dialog>

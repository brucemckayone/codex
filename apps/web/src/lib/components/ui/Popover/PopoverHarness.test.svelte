<script lang="ts">
  import type { CreatePopoverProps } from '@melt-ui/svelte';
  import Popover from './Popover.svelte';
  import PopoverClose from './PopoverClose.svelte';
  import PopoverContent from './PopoverContent.svelte';
  import PopoverTrigger from './PopoverTrigger.svelte';

  interface Props {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    closeFocus?: CreatePopoverProps['closeFocus'];
    forceVisible?: boolean;
    disableFocusTrap?: boolean;
  }

  let {
    open = $bindable(false),
    // Unset unless a test sets it, as on every page that uses the popover.
    defaultOpen,
    onOpenChange,
    closeFocus,
    // Unset unless a test sets it, so the tests run at Root's own default
    // (true), as every page does.
    forceVisible,
    disableFocusTrap,
  }: Props = $props();
</script>

<Popover bind:open {defaultOpen} {onOpenChange} {closeFocus} {forceVisible} {disableFocusTrap}>
  <PopoverTrigger data-testid="popover-trigger">Open popover</PopoverTrigger>
  <PopoverContent data-testid="popover-content" aria-label="Test popover">
    <p>Popover body text</p>
    <PopoverClose data-testid="popover-close">Close</PopoverClose>
  </PopoverContent>
</Popover>

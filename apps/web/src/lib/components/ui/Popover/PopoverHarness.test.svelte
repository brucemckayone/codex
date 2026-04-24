<script lang="ts">
  import Popover from './Popover.svelte';
  import PopoverClose from './PopoverClose.svelte';
  import PopoverContent from './PopoverContent.svelte';
  import PopoverTrigger from './PopoverTrigger.svelte';

  interface Props {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
  }

  let {
    open = $bindable(false),
    defaultOpen = false,
    onOpenChange,
  }: Props = $props();
</script>

<Popover bind:open {defaultOpen} {onOpenChange} forceVisible={false}>
  <PopoverTrigger data-testid="popover-trigger">Open popover</PopoverTrigger>
  <PopoverContent data-testid="popover-content">
    <p>Popover body text</p>
    <PopoverClose data-testid="popover-close">Close</PopoverClose>
  </PopoverContent>
</Popover>

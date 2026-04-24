<script lang="ts">
  import Tooltip from './Tooltip.svelte';
  import TooltipContent from './TooltipContent.svelte';
  import TooltipTrigger from './TooltipTrigger.svelte';

  interface Props {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    openDelay?: number;
    closeDelay?: number;
    portal?: HTMLElement | string | null;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    openDelay,
    closeDelay,
    portal,
  }: Props = $props();
</script>

<Tooltip bind:open {onOpenChange} {openDelay} {closeDelay} {portal}>
  <TooltipTrigger data-testid="tooltip-trigger">Hover me</TooltipTrigger>
  <TooltipContent data-testid="tooltip-content">Tooltip label</TooltipContent>
</Tooltip>

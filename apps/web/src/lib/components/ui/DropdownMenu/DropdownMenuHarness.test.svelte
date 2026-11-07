<script lang="ts">
  import DropdownMenu from './DropdownMenu.svelte';
  import DropdownMenuContent from './DropdownMenuContent.svelte';
  import DropdownMenuItem from './DropdownMenuItem.svelte';
  import DropdownMenuSeparator from './DropdownMenuSeparator.svelte';
  import DropdownMenuTrigger from './DropdownMenuTrigger.svelte';

  interface Props {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** Attributes a page might pass to Content. */
    contentAttrs?: Record<string, string>;
  }

  let {
    open = $bindable(false),
    defaultOpen = false,
    onOpenChange,
    contentAttrs = {},
  }: Props = $props();
</script>

<DropdownMenu bind:open {defaultOpen} {onOpenChange} forceVisible={false}>
  <DropdownMenuTrigger data-testid="dropdown-trigger">Menu</DropdownMenuTrigger>
  <DropdownMenuContent data-testid="dropdown-content" {...contentAttrs}>
    <DropdownMenuItem data-testid="item-1">Item One</DropdownMenuItem>
    <DropdownMenuItem data-testid="item-2">Item Two</DropdownMenuItem>
    <DropdownMenuSeparator data-testid="separator" />
    <DropdownMenuItem data-testid="item-3" disabled>Disabled Item</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>

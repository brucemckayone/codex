<script lang="ts">
  import * as Dialog from '../Dialog/index';
  import DropdownMenu from './DropdownMenu.svelte';
  import DropdownMenuContent from './DropdownMenuContent.svelte';
  import DropdownMenuItem from './DropdownMenuItem.svelte';
  import DropdownMenuTrigger from './DropdownMenuTrigger.svelte';

  // A menu whose first item opens a dialog at once, as TopBar's Unpublish
  // opens its confirm; the second opens nothing. The dialog has no Body,
  // so its panel scrolls as a whole, as a ConfirmDialog's does.
  const { closeOnItemClick = true }: { closeOnItemClick?: boolean } = $props();
  let menuOpen = $state(true);
  let dialogOpen = $state(false);
</script>

<DropdownMenu bind:open={menuOpen} {closeOnItemClick} forceVisible={false}>
  <DropdownMenuTrigger data-testid="trigger">Actions</DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem data-testid="opens-dialog" onclick={() => (dialogOpen = true)}>
      Unpublish
    </DropdownMenuItem>
    <DropdownMenuItem data-testid="plain">Nothing</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>

<Dialog.Root bind:open={dialogOpen}>
  <Dialog.Content size="sm">
    <Dialog.Header>
      <Dialog.Title>Unpublish this page?</Dialog.Title>
    </Dialog.Header>
    <Dialog.Footer>
      <button type="button" data-testid="cancel">Cancel</button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

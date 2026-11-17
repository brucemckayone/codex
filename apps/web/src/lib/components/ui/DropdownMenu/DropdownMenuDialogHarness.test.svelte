<script lang="ts">
  import * as Dialog from '../Dialog/index';
  import DropdownMenu from './DropdownMenu.svelte';
  import DropdownMenuContent from './DropdownMenuContent.svelte';
  import DropdownMenuItem from './DropdownMenuItem.svelte';
  import DropdownMenuTrigger from './DropdownMenuTrigger.svelte';

  // A menu whose first item opens a dialog at once, as TopBar's Unpublish
  // opens its confirm; the second opens nothing. The dialog has no Body,
  // so its panel scrolls as a whole, as a ConfirmDialog's does.
  //
  // forceVisible is off unless a test asks: Melt then takes the menu down
  // (its portal and its focus trap) at the close, so a test sees the
  // closed menu at once. jsdom has no inert, so a live trap pulls focus
  // back onto a leaving item, which a browser's inert item refuses. A test
  // about the leaving menu itself passes forceVisible, as the app's menus
  // are (DropdownMenu's default): the menu then stays through its outro,
  // which the test shim never finishes.
  const {
    closeOnItemClick = true,
    forceVisible = false,
  }: { closeOnItemClick?: boolean; forceVisible?: boolean } = $props();
  let menuOpen = $state(true);
  let dialogOpen = $state(false);
</script>

<DropdownMenu bind:open={menuOpen} {closeOnItemClick} {forceVisible}>
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

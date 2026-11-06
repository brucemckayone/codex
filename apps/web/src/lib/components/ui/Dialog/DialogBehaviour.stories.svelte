<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { writable } from 'svelte/store';
  import Button from '../Button/Button.svelte';
  import ConfirmDialog from '../Feedback/ConfirmDialog.svelte';
  import * as Dialog from './index';

  /**
   * What the shared Dialog does around its panel (Codex-vlphc review c1):
   * the page's scroll lock while dialogs stack. Driven in real Chromium and
   * WebKit. No autodocs: a docs page would open every dialog at once.
   */
  const { Story } = defineMeta({
    title: 'UI/Dialog/Behaviour',
  });

  const outerOpen = writable(false);
  const confirmOpen = writable(false);
</script>

<!-- A ConfirmDialog over a Dialog: the page stays locked until both close. -->
<Story name="Nested Confirm">
  <Button onclick={() => ($outerOpen = true)}>Open dialog</Button>
  <Dialog.Root bind:open={$outerOpen}>
    <Dialog.Content size="sm">
      <Dialog.Header>
        <Dialog.Title>Media item</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        <Button variant="destructive" data-testid="open-confirm" onclick={() => ($confirmOpen = true)}>
          Delete
        </Button>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" data-testid="close-outer" onclick={() => ($outerOpen = false)}>
          Close
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
  <ConfirmDialog
    bind:open={$confirmOpen}
    title="Delete this item?"
    description="It goes from every page that uses it."
    confirmText="Delete"
    variant="destructive"
  />
</Story>

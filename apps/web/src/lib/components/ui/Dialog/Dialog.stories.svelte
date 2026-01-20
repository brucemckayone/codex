<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { writable } from 'svelte/store';
  import Button from '../Button/Button.svelte';
  import * as Dialog from './index';

  const { Story } = defineMeta({
    title: 'UI/Dialog',
    tags: ['autodocs'],
  });

  // Create stores for dialog state (each story gets its own)
  const defaultOpen = writable(false);
  const confirmOpen = writable(false);
  const formOpen = writable(false);
</script>

<Story name="Default">
  <Button onclick={() => $defaultOpen = true}>Open Dialog</Button>
  <Dialog.Root bind:open={$defaultOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>Dialog Title</Dialog.Title>
        <Dialog.Description>This is a description of the dialog content.</Dialog.Description>
      </Dialog.Header>
      <p style="color: var(--color-text);">Your dialog content goes here. This is a basic modal dialog with a title, description, and close button.</p>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => $defaultOpen = false}>Cancel</Button>
        <Button variant="primary" onclick={() => $defaultOpen = false}>Confirm</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<Story name="Confirmation Dialog">
  <Button variant="destructive" onclick={() => $confirmOpen = true}>Delete Item</Button>
  <Dialog.Root bind:open={$confirmOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>Are you sure?</Dialog.Title>
        <Dialog.Description>This action cannot be undone. This will permanently delete the item.</Dialog.Description>
      </Dialog.Header>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => $confirmOpen = false}>Cancel</Button>
        <Button variant="destructive" onclick={() => $confirmOpen = false}>Delete</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<Story name="Form Dialog">
  <Button onclick={() => $formOpen = true}>Edit Profile</Button>
  <Dialog.Root bind:open={$formOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>Edit Profile</Dialog.Title>
        <Dialog.Description>Make changes to your profile here.</Dialog.Description>
      </Dialog.Header>
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <div style="display: flex; flex-direction: column; gap: 0.25rem;">
          <label style="font-size: 0.875rem; font-weight: 500; color: var(--color-text);">Name</label>
          <input style="padding: 0.5rem; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-surface);" value="John Doe" />
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.25rem;">
          <label style="font-size: 0.875rem; font-weight: 500; color: var(--color-text);">Email</label>
          <input type="email" style="padding: 0.5rem; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-surface);" value="john@example.com" />
        </div>
      </div>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => $formOpen = false}>Cancel</Button>
        <Button variant="primary" onclick={() => $formOpen = false}>Save Changes</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>

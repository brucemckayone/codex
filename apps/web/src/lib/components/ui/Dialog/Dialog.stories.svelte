<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { expect, userEvent, within } from '@storybook/test';
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
  const interactiveOpen = writable(false);
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

<Story
  name="Interactive Test"
  play={async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Find and click the trigger button
    const trigger = canvas.getByRole('button', { name: /open dialog/i });
    await expect(trigger).toBeInTheDocument();
    await userEvent.click(trigger);

    // Dialog renders in a portal, so search the whole document
    const body = within(document.body);
    const dialog = await body.findByRole('dialog');
    await expect(dialog).toBeVisible();

    // Verify dialog title is present
    const title = within(dialog).getByText('Dialog Title');
    await expect(title).toBeVisible();

    // Click cancel to close the dialog
    const cancelButton = within(dialog).getByRole('button', { name: /cancel/i });
    await userEvent.click(cancelButton);
  }}
>
  <Button onclick={() => $interactiveOpen = true}>Open Dialog</Button>
  <Dialog.Root bind:open={$interactiveOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>Dialog Title</Dialog.Title>
        <Dialog.Description>This is a description of the dialog content.</Dialog.Description>
      </Dialog.Header>
      <p style="color: var(--color-text);">Test the dialog interactions.</p>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => $interactiveOpen = false}>Cancel</Button>
        <Button variant="primary" onclick={() => $interactiveOpen = false}>Confirm</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>

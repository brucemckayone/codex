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

  const defaultOpen = writable(false);
  const confirmOpen = writable(false);
  const formOpen = writable(false);
  const largeOpen = writable(false);
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
      <Dialog.Body>
        <p style="color: var(--color-text); margin: 0;">Your dialog content goes here. This is a basic modal dialog with a branded accent bar, proper section separation, and smooth entry animations.</p>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => $defaultOpen = false}>Cancel</Button>
        <Button variant="primary" onclick={() => $defaultOpen = false}>Confirm</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<Story name="Confirmation (Small)">
  <Button variant="destructive" onclick={() => $confirmOpen = true}>Delete Item</Button>
  <Dialog.Root bind:open={$confirmOpen}>
    <Dialog.Content size="sm">
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
      <Dialog.Body>
        <div style="display: flex; flex-direction: column; gap: var(--space-1);">
          <label style="font-size: var(--text-sm); font-weight: var(--font-medium); color: var(--color-text);">Name</label>
          <input style="padding: var(--space-2) var(--space-3); border: var(--border-width) var(--border-style) var(--color-border); border-radius: var(--radius-input); background: var(--color-background); color: var(--color-text); font-size: var(--text-sm);" value="John Doe" />
        </div>
        <div style="display: flex; flex-direction: column; gap: var(--space-1);">
          <label style="font-size: var(--text-sm); font-weight: var(--font-medium); color: var(--color-text);">Email</label>
          <input type="email" style="padding: var(--space-2) var(--space-3); border: var(--border-width) var(--border-style) var(--color-border); border-radius: var(--radius-input); background: var(--color-background); color: var(--color-text); font-size: var(--text-sm);" value="john@example.com" />
        </div>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => $formOpen = false}>Cancel</Button>
        <Button variant="primary" onclick={() => $formOpen = false}>Save Changes</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<Story name="Large Dialog">
  <Button onclick={() => $largeOpen = true}>Open Large</Button>
  <Dialog.Root bind:open={$largeOpen}>
    <Dialog.Content size="lg">
      <Dialog.Header>
        <Dialog.Title>Large Dialog</Dialog.Title>
        <Dialog.Description>This uses the large size variant for wider content.</Dialog.Description>
      </Dialog.Header>
      <Dialog.Body>
        <p style="color: var(--color-text); margin: 0;">The large dialog variant (56rem max-width) is suitable for content that needs more horizontal space, such as data tables, media previews, or side-by-side comparisons.</p>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => $largeOpen = false}>Close</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<Story
  name="Interactive Test"
  play={async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const trigger = canvas.getByRole('button', { name: /open dialog/i });
    await expect(trigger).toBeInTheDocument();
    await userEvent.click(trigger);

    const body = within(document.body);
    const dialog = await body.findByRole('dialog');
    await expect(dialog).toBeVisible();

    const title = within(dialog).getByText('Dialog Title');
    await expect(title).toBeVisible();

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
      <Dialog.Body>
        <p style="color: var(--color-text); margin: 0;">Test the dialog interactions.</p>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => $interactiveOpen = false}>Cancel</Button>
        <Button variant="primary" onclick={() => $interactiveOpen = false}>Confirm</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>

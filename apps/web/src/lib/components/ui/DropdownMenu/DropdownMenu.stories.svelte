<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { expect, userEvent, within } from '@storybook/test';
  import { writable } from 'svelte/store';
  import Button from '../Button/Button.svelte';
  import * as DropdownMenu from './index';

  const { Story } = defineMeta({
    title: 'UI/DropdownMenu',
    tags: ['autodocs'],
  });

  // State stores for each story
  const defaultOpen = writable(false);
  const actionsOpen = writable(false);
  const interactiveOpen = writable(false);
</script>

<Story name="Default">
  <div style="padding: 2rem;">
    <DropdownMenu.Root bind:open={$defaultOpen}>
      <DropdownMenu.Trigger>
        <Button variant="secondary">
          Open Menu
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item>Profile</DropdownMenu.Item>
        <DropdownMenu.Item>Settings</DropdownMenu.Item>
        <DropdownMenu.Item>Billing</DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item>Log out</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
</Story>

<Story name="Actions Menu">
  <div style="padding: 2rem;">
    <DropdownMenu.Root bind:open={$actionsOpen}>
      <DropdownMenu.Trigger>
        <button style="padding: 0.5rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 6px; cursor: pointer;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item>Edit</DropdownMenu.Item>
        <DropdownMenu.Item>Duplicate</DropdownMenu.Item>
        <DropdownMenu.Item>Archive</DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item>Delete</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
</Story>

<Story
  name="Interactive Test"
  play={async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Find the outer trigger button (has data-melt-dropdown-menu-trigger)
    const trigger = canvasElement.querySelector('[data-melt-dropdown-menu-trigger]');
    await expect(trigger).toBeTruthy();
    await userEvent.click(trigger as HTMLElement);

    // Menu renders in a portal, so search the whole document
    const body = within(document.body);
    const menu = await body.findByRole('menu');
    await expect(menu).toBeInTheDocument();

    // Verify menu items are present
    const profileItem = within(menu).getByRole('menuitem', { name: /profile/i });
    await expect(profileItem).toBeInTheDocument();

    // Press Escape to close menu
    await userEvent.keyboard('{Escape}');
  }}
>
  <div style="padding: 2rem;">
    <DropdownMenu.Root bind:open={$interactiveOpen}>
      <DropdownMenu.Trigger>
        <Button variant="secondary">
          Open Menu
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item>Profile</DropdownMenu.Item>
        <DropdownMenu.Item>Settings</DropdownMenu.Item>
        <DropdownMenu.Item>Billing</DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item>Log out</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
</Story>

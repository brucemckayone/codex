<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { writable } from 'svelte/store';
  import Button from '../Button/Button.svelte';
  import ConfirmDialog from '../Feedback/ConfirmDialog.svelte';
  import * as Dialog from './index';

  /**
   * What the shared Dialog does around its panel (Codex-vlphc review c1):
   * the page's scroll lock while dialogs stack, where focus goes back to at
   * the close, and a panel with no Body. Driven in real Chromium and WebKit.
   * No autodocs: a docs page would open every dialog at once.
   */
  const { Story } = defineMeta({
    title: 'UI/Dialog/Behaviour',
  });

  const outerOpen = writable(false);
  const confirmOpen = writable(false);
  const longConfirmOpen = writable(false);
  const longDescription = Array.from(
    { length: 9 },
    (_, i) =>
      `Point ${i + 1}: the price change reaches every subscriber at their next renewal, and nobody is charged twice for the same period.`
  ).join(' ');
  const tierOpen = writable(false);
  const tierName = writable('');
  const tiers = ['Basic', 'Pro', 'Team'];

  function openTier(name: string) {
    tierName.set(name);
    tierOpen.set(true);
  }
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

<!-- A ConfirmDialog has no Body: Header and Footer only. With a long description
     the panel scrolls as a whole, so Confirm stays reachable on a short screen. -->
<Story name="Long Confirm">
  <Button onclick={() => ($longConfirmOpen = true)}>Open long confirm</Button>
  <ConfirmDialog
    bind:open={$longConfirmOpen}
    title="Change the price?"
    description={longDescription}
    confirmText="Change price"
  />
</Story>

<!-- The studio tier dialog's wiring: one dialog, opened from several buttons,
     no closeFocus; Escape or Cancel must hand focus back to the one pressed. -->
<Story name="Tier Shape">
  <div class="tier-list">
    <Button data-testid="add-tier" onclick={() => openTier('')}>Add tier</Button>
    {#each tiers as tier (tier)}
      <Button variant="secondary" data-testid="edit-{tier}" onclick={() => openTier(tier)}>Edit {tier}</Button>
    {/each}
  </div>
  <Dialog.Root bind:open={$tierOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>{$tierName ? `Edit ${$tierName}` : 'New tier'}</Dialog.Title>
      </Dialog.Header>
      <Dialog.Form onsubmit={(e) => e.preventDefault()}>
        <Dialog.Body>
          <label class="tier-field">
            <span>Name</span>
            <input class="tier-input" name="name" value={$tierName} />
          </label>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" type="button" data-testid="tier-cancel" onclick={() => ($tierOpen = false)}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </Dialog.Footer>
      </Dialog.Form>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<style>
  .tier-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .tier-field {
    display: grid;
    row-gap: var(--space-1);
    color: var(--color-text);
    font-size: var(--text-sm);
  }

  .tier-input {
    padding-block: var(--space-2);
    padding-inline: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-input);
    background: var(--color-background);
    color: var(--color-text);
    font: inherit;
  }
</style>

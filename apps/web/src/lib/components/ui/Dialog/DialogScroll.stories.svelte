<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { writable } from 'svelte/store';
  import Button from '../Button/Button.svelte';
  import { DialogForm } from '../DialogForm';
  import { XIcon } from '../Icon';
  import * as Dialog from './index';

  /**
   * Scroll proof for the shared Dialog (Codex-vlphc.1). Every story here is
   * taller than a short screen, and its last action carries
   * `data-testid="scroll-target"`. Driven in a real browser at 1280×600 and
   * 390×700: wheel over the body, then the target must sit inside the panel
   * AND the viewport. The calibration control, the hand-written wrapper these
   * parts replace, is in DialogScrollControl.stories.svelte and must read
   * clipped. No autodocs: a docs page would open every dialog at once.
   */
  const { Story } = defineMeta({
    title: 'UI/Dialog/Scroll',
  });

  const rows = Array.from({ length: 18 }, (_, i) => i + 1);

  const bodyOpen = writable(false);
  const formOpen = writable(false);
  const dialogFormOpen = writable(false);
  const drawerOpen = writable(false);
  const sheetOpen = writable(false);
  const flushOpen = writable(false);
  const toolbarOpen = writable(false);
  const formToolbarOpen = writable(false);
  const floatingOpen = writable(false);
</script>

{#snippet tallText(label: string)}
  {#each rows as row (row)}
    <p class="row">{label} {row}: enough copy to take a line or two, so the body outgrows a short screen.</p>
  {/each}
{/snippet}

{#snippet tallFields()}
  {#each rows as row (row)}
    <label class="field">
      <span>Field {row}</span>
      <input class="input" name="field-{row}" value="Value {row}" />
    </label>
  {/each}
{/snippet}

<Story name="Tall Body">
  <Button onclick={() => ($bodyOpen = true)}>Open tall dialog</Button>
  <Dialog.Root bind:open={$bodyOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>Tall body</Dialog.Title>
        <Dialog.Description>Header, Body and Footer only.</Dialog.Description>
      </Dialog.Header>
      <Dialog.Body>
        {@render tallText('Row')}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => ($bodyOpen = false)}>Cancel</Button>
        <Button variant="primary" data-testid="scroll-target" onclick={() => ($bodyOpen = false)}>
          Confirm
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<Story name="Form Tall">
  <Button onclick={() => ($formOpen = true)}>Open tall form</Button>
  <Dialog.Root bind:open={$formOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>Tall form</Dialog.Title>
        <Dialog.Description>Dialog.Form between Content and Body.</Dialog.Description>
      </Dialog.Header>
      <Dialog.Form onsubmit={(e) => e.preventDefault()}>
        <Dialog.Body>
          {@render tallFields()}
        </Dialog.Body>
        <Dialog.Footer>
          <Button type="button" variant="secondary" onclick={() => ($formOpen = false)}>Cancel</Button>
          <Button type="submit" variant="primary" data-testid="scroll-target">Save</Button>
        </Dialog.Footer>
      </Dialog.Form>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<Story name="Shared DialogForm Tall">
  <Button onclick={() => ($dialogFormOpen = true)}>Open tall DialogForm</Button>
  <DialogForm
    bind:open={$dialogFormOpen}
    title="Tall DialogForm"
    description="The shared wrapper, built on Dialog.Form."
    submitting={false}
    error={null}
    onsubmit={(e) => e.preventDefault()}
  >
    {@render tallFields()}
  </DialogForm>
</Story>

<!-- CustomerDetailDrawer's shape: `variant="drawer"`, default size. -->
<Story name="Drawer Tall">
  <Button onclick={() => ($drawerOpen = true)}>Open tall drawer</Button>
  <Dialog.Root bind:open={$drawerOpen}>
    <Dialog.Content variant="drawer">
      <Dialog.Header>
        <Dialog.Title>Tall drawer</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        {#each [1, 2, 3, 4] as section (section)}
          <section class="section">
            <h3 class="section-heading">Section {section}</h3>
            {@render tallText(`Section ${section}, row`)}
          </section>
        {/each}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => ($drawerOpen = false)}>Cancel</Button>
        <Button variant="primary" data-testid="scroll-target">Grant access</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<!-- MediaDrawer's shape: a bottom sheet on a phone, its actions row last. -->
<Story name="Drawer Sheet Tall">
  <Button onclick={() => ($sheetOpen = true)}>Open tall sheet</Button>
  <Dialog.Root bind:open={$sheetOpen}>
    <Dialog.Content variant="drawer" sheet>
      <Dialog.Header>
        <Dialog.Title>Tall sheet</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        <div class="preview"></div>
        {@render tallText('Fact')}
        <div class="actions">
          <Button variant="primary">Create content</Button>
          <Button variant="destructive" data-testid="scroll-target">Delete</Button>
        </div>
      </Dialog.Body>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<!-- CreatorProfileDrawer's shape: edge-to-edge hero, its own sticky close. -->
<Story name="Drawer Sheet Flush Tall">
  <Button onclick={() => ($flushOpen = true)}>Open tall flush sheet</Button>
  <Dialog.Root bind:open={$flushOpen}>
    <Dialog.Content variant="drawer" size="sm" sheet flush closeButton={false}>
      <Dialog.Body>
        <div class="own-bar">
          <button type="button" class="own-close" aria-label="Close" onclick={() => ($flushOpen = false)}>
            <XIcon size={18} />
          </button>
        </div>
        <div class="hero">
          <Dialog.Title class="hero-name">Tall flush sheet</Dialog.Title>
        </div>
        <div class="flush-body">
          {@render tallText('Bio line')}
          <a class="profile-link" href="#profile" data-testid="scroll-target">View full profile</a>
        </div>
      </Dialog.Body>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<!-- The curriculum picker's shape: a stacked search + type bar that stays put. -->
<Story name="Toolbar Tall">
  <Button onclick={() => ($toolbarOpen = true)}>Open tall toolbar dialog</Button>
  <Dialog.Root bind:open={$toolbarOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>Tall toolbar</Dialog.Title>
      </Dialog.Header>
      <Dialog.Toolbar direction="column">
        <input class="input" type="search" aria-label="Search" placeholder="Search…" />
        <div class="chips">
          <Button size="sm" variant="secondary">All</Button>
          <Button size="sm" variant="secondary">Video</Button>
          <Button size="sm" variant="secondary">Audio</Button>
        </div>
      </Dialog.Toolbar>
      <Dialog.Body>
        {@render tallText('Item')}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => ($toolbarOpen = false)}>Cancel</Button>
        <Button variant="primary" data-testid="scroll-target">Add</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<!-- MediaPickerDialog's shape: a Form around a one-line toolbar, the list and the footer. -->
<Story name="Form Toolbar Tall">
  <Button onclick={() => ($formToolbarOpen = true)}>Open tall form toolbar</Button>
  <Dialog.Root bind:open={$formToolbarOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>Tall form toolbar</Dialog.Title>
      </Dialog.Header>
      <Dialog.Form onsubmit={(e) => e.preventDefault()}>
        <Dialog.Toolbar>
          <input class="input toolbar-search" type="search" aria-label="Search" placeholder="Search…" />
          <Button size="sm" variant="secondary" type="button">Newest</Button>
        </Dialog.Toolbar>
        <Dialog.Body>
          {@render tallText('Media')}
        </Dialog.Body>
        <Dialog.Footer>
          <Button type="button" variant="secondary" onclick={() => ($formToolbarOpen = false)}>Cancel</Button>
          <Button type="submit" variant="primary" data-testid="scroll-target">Attach</Button>
        </Dialog.Footer>
      </Dialog.Form>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<!-- FilterDrawer's shape: a floating glass rail; Body scrolls between a pinned Header and Footer. -->
<Story name="Drawer Floating Tall">
  <Button onclick={() => ($floatingOpen = true)}>Open tall floating drawer</Button>
  <Dialog.Root bind:open={$floatingOpen}>
    <Dialog.Content variant="drawer" floating sheet>
      <Dialog.Header>
        <Dialog.Title>Filters</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        {#each [1, 2, 3] as section (section)}
          <section class="section">
            <h3 class="section-heading">Facet {section}</h3>
            {@render tallText(`Option ${section}.`)}
          </section>
        {/each}
      </Dialog.Body>
      <Dialog.Footer align="between">
        <Button variant="ghost">Clear all</Button>
        <Button variant="primary" data-testid="scroll-target">Show results</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<style>
  .row {
    margin: 0;
    color: var(--color-text);
    font-size: var(--text-sm);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .input {
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-input);
    background: var(--color-background);
    color: var(--color-text);
    font: inherit;
  }

  .input:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .section-heading {
    margin: 0;
    font-size: var(--text-base);
    color: var(--color-text);
  }

  .chips {
    display: flex;
    gap: var(--space-1);
  }

  .toolbar-search {
    flex: 1;
    min-width: 12rem;
  }

  .preview {
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-md);
    background: var(--color-surface-secondary);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: auto;
  }

  .own-bar {
    position: sticky;
    top: 0;
    z-index: 1;
    height: 0;
    display: flex;
    justify-content: flex-end;
  }

  .own-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-11);
    height: var(--space-11);
    margin: var(--space-3);
    border: none;
    border-radius: var(--radius-full);
    color: var(--color-player-text);
    background: var(--color-player-overlay);
    cursor: pointer;
  }

  .own-close:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .hero {
    display: flex;
    align-items: flex-end;
    aspect-ratio: 1;
    padding: var(--space-6);
    background: var(--color-surface-secondary);
  }

  .flush-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-6);
  }

  .profile-link {
    color: var(--color-link);
  }

  .profile-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }
</style>

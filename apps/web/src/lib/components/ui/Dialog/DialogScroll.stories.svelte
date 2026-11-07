<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { writable } from 'svelte/store';
  import Button from '../Button/Button.svelte';
  import { DialogForm } from '../DialogForm';
  import { XIcon } from '../Icon';
  import Skeleton from '../Skeleton/Skeleton.svelte';
  import * as Dialog from './index';

  /**
   * Scroll proof for the shared Dialog (Codex-vlphc.1). Every story here is
   * taller than a short screen, and its last action carries
   * `data-testid="scroll-target"`. Driven in a real browser at 1280×600 and
   * 390×700: wheel over the body, then the target must sit inside the panel
   * AND the viewport. The calibration controls, the raw shapes these parts
   * replace, are in DialogScrollControl.stories.svelte and must read
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
  const columnToolbarOpen = writable(false);
  const rowToolbarOpen = writable(false);
  const chips = Array.from({ length: 40 }, (_, i) => i + 1);
  const formToolbarOpen = writable(false);
  const floatingOpen = writable(false);
  const squashOpen = writable(false);
  const drawerSquashOpen = writable(false);
  const innerOpen = writable(false);
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

<!-- A stacked bar full of fields beside a token Body (review G2-L7): the bar scrolls, the Footer stays. -->
<Story name="Column Toolbar Tall">
  <Button onclick={() => ($columnToolbarOpen = true)}>Open tall column toolbar</Button>
  <Dialog.Root bind:open={$columnToolbarOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>Tall column toolbar</Dialog.Title>
      </Dialog.Header>
      <Dialog.Toolbar direction="column">
        {#each [1, 2, 3, 4, 5, 6] as n (n)}
          <label class="field">
            <span>Filter {n}</span>
            <input class="input" name="filter-{n}" value="Value {n}" />
          </label>
        {/each}
      </Dialog.Toolbar>
      <Dialog.Body>
        <p class="row">One result.</p>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => ($columnToolbarOpen = false)}>Cancel</Button>
        <Button variant="primary" data-testid="scroll-target">Apply</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<!-- A row bar of 40 chips that wraps onto many lines, beside a token Body (review G3-L7). -->
<Story name="Row Toolbar Tall">
  <Button onclick={() => ($rowToolbarOpen = true)}>Open tall row toolbar</Button>
  <Dialog.Root bind:open={$rowToolbarOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>Tall row toolbar</Dialog.Title>
      </Dialog.Header>
      <Dialog.Toolbar>
        {#each chips as n (n)}
          <Button size="sm" variant="secondary">Tag {n}</Button>
        {/each}
      </Dialog.Toolbar>
      <Dialog.Body>
        <p class="row">One result.</p>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => ($rowToolbarOpen = false)}>Cancel</Button>
        <Button variant="primary" data-testid="scroll-target">Apply</Button>
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

<!-- MediaPickerDialog's list tail: a fixed-height Button and Skeleton last in a
     Body that overflows. Each must keep its own height. -->
{#snippet squashTail()}
  {@render tallText('Media')}
  <Button size="sm" variant="ghost" type="button" data-testid="squash-button">Show more</Button>
  <Skeleton height="var(--space-14)" data-testid="squash-skeleton" aria-hidden="true" />
{/snippet}

<Story name="Squash Tall">
  <Button onclick={() => ($squashOpen = true)}>Open tall squash dialog</Button>
  <Dialog.Root bind:open={$squashOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>Squash</Dialog.Title>
        <Dialog.Description>A Button and a Skeleton at the end of a tall Body.</Dialog.Description>
      </Dialog.Header>
      <Dialog.Body>
        {@render squashTail()}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => ($squashOpen = false)}>Cancel</Button>
        <Button variant="primary" data-testid="scroll-target" onclick={() => ($squashOpen = false)}>
          Attach
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<!-- The same tail in a drawer, whose panel is the flex column that overflows. -->
<Story name="Drawer Squash Tall">
  <Button onclick={() => ($drawerSquashOpen = true)}>Open tall squash drawer</Button>
  <Dialog.Root bind:open={$drawerSquashOpen}>
    <Dialog.Content variant="drawer">
      <Dialog.Header>
        <Dialog.Title>Squash drawer</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        {@render squashTail()}
        <Button variant="primary" data-testid="scroll-target">Done</Button>
      </Dialog.Body>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<!-- A Body whose child is the scroller: its own `flex: 1; min-height: 0`
     still shrinks it to the panel, and it scrolls while Body does not. -->
<Story name="Inner Scroller Tall">
  <Button onclick={() => ($innerOpen = true)}>Open inner scroller</Button>
  <Dialog.Root bind:open={$innerOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>Inner scroller</Dialog.Title>
        <Dialog.Description>The list scrolls inside a Body that does not.</Dialog.Description>
      </Dialog.Header>
      <Dialog.Body>
        <p class="row">This line stays above the list.</p>
        <div class="inner-scroller" data-testid="inner-scroller" role="region" aria-label="Rows">
          {@render tallText('Row')}
        </div>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => ($innerOpen = false)}>Cancel</Button>
        <Button variant="primary" data-testid="scroll-target" onclick={() => ($innerOpen = false)}>
          Confirm
        </Button>
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

  .inner-scroller {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: grid;
    row-gap: var(--space-2);
  }

  .profile-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }
</style>

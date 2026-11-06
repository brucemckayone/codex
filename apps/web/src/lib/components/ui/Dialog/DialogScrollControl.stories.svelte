<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { writable } from 'svelte/store';
  import Button from '../Button/Button.svelte';
  import * as Dialog from './index';

  /**
   * CALIBRATION CONTROLS, not patterns to copy. scripts/check-dialog-structure.mjs
   * flags both, so its allowlist holds this file under the reason
   * "calibration control", and nothing else may live here.
   *
   * Raw Sibling Control: a raw element between Header and a Body, the shape
   * the gate bans. It never shrinks, Dialog.Content clips at 85dvh around a
   * Body, so on a short screen its footer is cut off and nothing scrolls to
   * it. The scroll proof (DialogScroll.stories.svelte) must read it CLIPPED
   * and every shared story REACHABLE; a probe that calls both reachable is
   * broken.
   *
   * Legacy Wrapper Control: the hand-written wrapper the shared Dialog.Form
   * replaces, studio/monetisation's `.tier-form`, byte for byte in its CSS,
   * a flex column WITHOUT `flex: 1; min-height: 0`. It clipped the same way
   * until a panel with no Body where the parts put it scrolled as a whole
   * (Codex-vlphc review H3). It now reads REACHABLE, by the panel's scroll.
   */
  const { Story } = defineMeta({
    title: 'UI/Dialog/Scroll Control',
  });

  const rows = Array.from({ length: 18 }, (_, i) => i + 1);
  const controlOpen = writable(false);
  const siblingOpen = writable(false);
</script>

<Story name="Raw Sibling Control">
  <Button onclick={() => ($siblingOpen = true)}>Open raw sibling</Button>
  <Dialog.Root bind:open={$siblingOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>Raw sibling (control)</Dialog.Title>
        <Dialog.Description>A raw element between Header and Body.</Dialog.Description>
      </Dialog.Header>
      <div class="legacy-notes">
        <!-- Only the height matters here: 18 rows outgrow a short screen. -->
        {#each rows as row (row)}
          <p>Row {row}: enough copy to take a line or two, so the notes outgrow a short screen.</p>
        {/each}
      </div>
      <Dialog.Body>
        <p>One line in the Body.</p>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => ($siblingOpen = false)}>Cancel</Button>
        <Button variant="primary" data-testid="scroll-target">Save</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<Story name="Legacy Wrapper Control">
  <Button onclick={() => ($controlOpen = true)}>Open legacy wrapper</Button>
  <Dialog.Root bind:open={$controlOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>Legacy wrapper (control)</Dialog.Title>
        <Dialog.Description>A raw form between Content and Body.</Dialog.Description>
      </Dialog.Header>
      <form class="legacy-form" onsubmit={(e) => e.preventDefault()}>
        <Dialog.Body>
          <!-- Only the height matters here: 18 rows outgrow a short screen. -->
          {#each rows as row (row)}
            <p>Row {row}: enough copy to take a line or two, so the body outgrows a short screen.</p>
          {/each}
        </Dialog.Body>
        <Dialog.Footer>
          <Button type="button" variant="secondary" onclick={() => ($controlOpen = false)}>Cancel</Button>
          <Button type="submit" variant="primary" data-testid="scroll-target">Save</Button>
        </Dialog.Footer>
      </form>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<style>
  /* A page's own block: inset like Body, and no flex of its own. */
  .legacy-notes {
    padding: var(--space-4) var(--space-6);
  }

  /* studio/monetisation/+page.svelte `.tier-form`, as of dev 86d928af0. */
  .legacy-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }
</style>

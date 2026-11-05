<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { writable } from 'svelte/store';
  import Button from '../Button/Button.svelte';
  import * as Dialog from './index';

  /**
   * CALIBRATION CONTROL, not a pattern to copy. This is the hand-written
   * wrapper the shared Dialog.Form replaces: studio/monetisation's
   * `.tier-form`, byte for byte in its CSS, a flex column WITHOUT
   * `flex: 1; min-height: 0`. Dialog.Content clips at 85vh, so on a short
   * screen this form's footer is cut off and the body cannot scroll to it.
   *
   * The scroll proof (DialogScroll.stories.svelte) must read this one CLIPPED
   * and every shared story REACHABLE; a probe that calls both reachable is
   * broken. scripts/check-dialog-structure.mjs flags it, so its allowlist
   * holds this file under the reason "calibration control", and nothing else
   * may live here.
   */
  const { Story } = defineMeta({
    title: 'UI/Dialog/Scroll Control',
  });

  const rows = Array.from({ length: 18 }, (_, i) => i + 1);
  const controlOpen = writable(false);
</script>

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
  /* studio/monetisation/+page.svelte `.tier-form`, as of dev 86d928af0. */
  .legacy-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }
</style>

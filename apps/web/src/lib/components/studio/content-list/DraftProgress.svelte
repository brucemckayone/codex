<!--
  @component DraftProgress

  A draft's two steps as pips, Write and Publish (Codex-a6ofh.2.6, mockup
  W7), with the step it is at and the first thing left in the Publish
  checklist's own words. Worked out from the row (`draftProgress`): the
  words say it all, so the pips are only for the eye.

  @prop {DraftProgress} progress - The draft's progress
-->
<script lang="ts">
  import { type DraftProgress, draftStepWords } from './draft-progress';

  interface Props {
    progress: DraftProgress;
  }

  const { progress }: Props = $props();

  const publishPip = $derived(
    progress.ready ? 'done' : progress.writeDone ? 'started' : 'todo'
  );
  // Ready is nothing left, so there is no next then.
  const next = $derived(progress.left[0]);
</script>

<div class="draft-progress">
  <span class="pips" aria-hidden="true">
    <span class="pip" data-state={progress.writeDone ? 'done' : 'started'}></span>
    <span class="pip" data-state={publishPip}></span>
  </span>
  <span class="step">{draftStepWords(progress)}</span>
  {#if next}
    <span class="next" data-fix={next.fix ?? 'none'}>{next.words}</span>
  {/if}
</div>

<style>
  .draft-progress {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .pips {
    display: inline-flex;
    gap: var(--space-1);
  }

  .pip {
    inline-size: var(--space-5);
    block-size: var(--space-1);
    border-radius: var(--radius-full);
    background-color: var(--color-border);
  }

  .pip[data-state='done'] {
    background-color: var(--color-interactive);
  }

  .pip[data-state='started'] {
    background: linear-gradient(
      to right,
      var(--color-interactive) 50%,
      var(--color-border) 50%
    );
  }

  .step {
    color: var(--color-text);
    font-weight: var(--font-medium);
  }

  /* Write's to put right: the draft is not finished yet. */
  .next[data-fix='write'] {
    color: var(--color-status-warning-text);
  }
</style>

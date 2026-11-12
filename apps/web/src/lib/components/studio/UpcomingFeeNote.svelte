<!--
  @component UpcomingFeeNote

  The note about a fee rise that hasn't started (Codex-2hxff.33 F5; batch C1
  Part B page 1, N1-N12). It sits under a money page's header: Billing and
  Payouts (the owner's rows for their organisation) and the personal Studio's
  Earnings (the creator's rows everywhere; owner decision Q3).

  It is information, not a warning: `Alert variant="info"` with
  `role="note"`, and nothing on the page asks the reader to act. The words
  are `upcoming-fee-view`'s.

  - While the read runs, nothing shows (N10): almost every visit has no
    note, so a placeholder would flash for nothing.
  - No rise, or one that has started: nothing (N12).
  - The read failed: one muted line with Try again (N11), never shown as
    "no change coming". It isn't red: the page's own figures are fine.

  Read once per visit. Try again reads once more; nothing re-checks by
  itself (the cost rule). It is judged by the shared `createLoadRetry`
  (Codex-if444): kit drops a read that failed, so Try again hands the note a
  NEW query, still loading. The line, and the focused Try again in it, stay
  until that read answers; then focus goes to what the note now says: the
  line again (it failed again: read out once more), the note, or, with
  nothing coming, a hidden line that says so.

  @prop {string} [organizationId] - Billing and Payouts: the organisation
    whose owner rows to show. Earnings passes none.
-->
<script lang="ts">
  import { Alert } from '$lib/components/ui';
  import { CalendarIcon, InfoIcon } from '$lib/components/ui/Icon';
  import { getUpcomingFees } from '$lib/remote/billing.remote';
  import { queryErrorMessage } from '$lib/remote/query-result';
  import * as m from '$paraglide/messages';
  import { createLoadRetry } from './load-retry.svelte';
  import { feeNoteView, WAS_MARK } from './upcoming-fee-view';

  interface Props {
    organizationId?: string;
  }

  const { organizationId }: Props = $props();

  const feesQuery = $derived(
    getUpcomingFees(organizationId ? { organizationId } : {})
  );
  const view = $derived(
    feesQuery.current ? feeNoteView(feesQuery.current) : null
  );
  const failed = $derived(
    feesQuery.current === undefined && queryErrorMessage(feesQuery.error) !== null
  );

  // Judged on the read the note holds, not the one Try again refreshed.
  const feeRetry = createLoadRetry(() => feesQuery);
  let lineNode = $state<HTMLElement | null>(null);
  let statusNode = $state<HTMLElement | null>(null);
  let noteNode: HTMLElement | null = null;
  /** The last Try again loaded nothing to note (N12): said, as nothing shows. */
  let checkedNone = $state(false);
  /** Repeat failures read out without a focus move; keys the line's words. */
  let repeats = $state(0);

  const holdNote = (node: HTMLElement) => {
    noteNode = node;
    return () => {
      if (noteNode === node) noteNode = null;
    };
  };

  async function retry() {
    const result = await feeRetry.retry({
      from: () => lineNode,
      settled: () => {
        checkedNone = !view && !failed && feesQuery.current !== undefined;
        return () =>
          view ? noteNode : failed ? lineNode : checkedNone ? statusNode : null;
      },
    });
    // Focus moved on during it: the unchanged line is inserted again, so its
    // `role="status"` reads it out.
    if (result && !result.focusFree && failed) repeats += 1;
  }
</script>

{#if view}
  <Alert
    variant="info"
    role="note"
    class="fee-note"
    tabindex={-1}
    data-testid="upcoming-fee-note"
    {@attach holdNote}
  >
    <div class="fee-note__row">
      <CalendarIcon size={16} class="fee-note__icon" aria-hidden="true" />
      <div class="fee-note__body">
        {#if view.kind === 'single'}
          <p class="fee-note__lead"><b>{view.lead}</b></p>
          <p class="fee-note__meta">
            {#if view.meta.was}
              {@const [before, after] = view.meta.text.split(WAS_MARK)}
              {before}<span class="fee-note__was">{view.meta.was}</span>{after}
            {:else}
              {view.meta.text}
            {/if}
          </p>
        {:else}
          <ul class="fee-note__list">
            {#each view.items as item (item.changeId)}
              <li><b>{item.when}</b> {item.text}</li>
            {/each}
          </ul>
          <p class="fee-note__meta">{view.meta}</p>
        {/if}
      </div>
    </div>
  </Alert>
{:else if failed || feeRetry.retrying}
  <!-- Kept while Try again runs: the note can be handed a new read that is
       still loading, and unmounting would drop the focused button. -->
  <p
    bind:this={lineNode}
    class="fee-check-failed"
    role="status"
    tabindex="-1"
    data-testid="upcoming-fee-check-failed"
  >
    <InfoIcon size={16} aria-hidden="true" />
    {#key repeats}{m.fee_note_check_failed()}{/key}
    <button
      type="button"
      class="fee-check-failed__retry"
      aria-busy={feeRetry.busy || undefined}
      onclick={retry}
    >
      {m.fee_note_try_again()}
    </button>
  </p>
{/if}

<!-- Mounted throughout, its words swapped in: a live region that appears
     with its words already in it is often not read out. Last, so the note
     still sits straight under the page's header. -->
<p bind:this={statusNode} class="sr-only" role="status" tabindex="-1">
  {checkedNone && !view && !failed ? m.fee_note_check_none() : ''}
</p>

<style>
  .fee-note__row {
    display: flex;
    gap: var(--space-2);
    min-width: 0;
  }

  .fee-note__row :global(.fee-note__icon) {
    flex-shrink: 0;
    margin-top: var(--space-0-5);
  }

  .fee-note__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    min-width: 0;
  }

  .fee-note__lead,
  .fee-note__list li {
    margin: 0;
    text-wrap: pretty;
  }

  .fee-note__lead b,
  .fee-note__list b {
    font-weight: var(--font-semibold);
  }

  .fee-note__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .fee-note__meta {
    margin: 0;
    font-size: var(--text-xs);
    text-wrap: pretty;
  }

  /* The figure first told, replaced by a smaller rise (N7). Struck through,
     and named as "the 12% we first told you about" in the sentence, so it
     never relies on the line alone. */
  .fee-note__was {
    text-decoration: line-through;
  }

  .fee-check-failed {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .fee-check-failed__retry {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-weight: var(--font-semibold);
    color: var(--color-link);
    text-decoration: underline;
    cursor: pointer;
  }

  /* Busy, not disabled: a disabled button drops focus on press (W6), as
     PriceChangeNote guards its own. `retry` ignores a press while busy. */
  .fee-check-failed__retry[aria-busy='true'] {
    cursor: progress;
  }

  .fee-check-failed__retry:focus-visible,
  /* The line takes focus after a Try again that failed again, the note after
     one that found a change: shown for keyboard users. */
  .fee-check-failed:focus-visible,
  :global(.fee-note:focus-visible) {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }
</style>

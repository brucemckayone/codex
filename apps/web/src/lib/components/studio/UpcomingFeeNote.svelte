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
  itself (the cost rule).

  @prop {string} [organizationId] - Billing and Payouts: the organisation
    whose owner rows to show. Earnings passes none.
-->
<script lang="ts">
  import { Alert } from '$lib/components/ui';
  import { CalendarIcon, InfoIcon } from '$lib/components/ui/Icon';
  import { getUpcomingFees } from '$lib/remote/billing.remote';
  import { queryErrorMessage } from '$lib/remote/query-result';
  import * as m from '$paraglide/messages';
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

  let retrying = $state(false);

  async function retry() {
    if (retrying) return;
    retrying = true;
    try {
      await feesQuery.refresh();
    } catch {
      // The query keeps its error, so the line stays with Try again.
    } finally {
      retrying = false;
    }
  }
</script>

{#if view}
  <Alert variant="info" role="note" class="fee-note" data-testid="upcoming-fee-note">
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
{:else if failed}
  <p class="fee-check-failed" role="status" data-testid="upcoming-fee-check-failed">
    <InfoIcon size={16} aria-hidden="true" />
    {m.fee_note_check_failed()}
    <button
      type="button"
      class="fee-check-failed__retry"
      aria-busy={retrying || undefined}
      onclick={retry}
    >
      {m.fee_note_try_again()}
    </button>
  </p>
{/if}

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
    color: var(--color-interactive);
    text-decoration: underline;
    cursor: pointer;
  }

  /* Busy, not disabled: a disabled button drops focus on press (W6), as
     PriceChangeNote guards its own. `retry` ignores a press while busy. */
  .fee-check-failed__retry[aria-busy='true'] {
    cursor: progress;
  }

  .fee-check-failed__retry:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }
</style>

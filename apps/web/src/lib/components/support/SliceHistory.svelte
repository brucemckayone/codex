<!--
  @component SliceHistory

  What each refund and chargeback did to one slice (Codex-2hxff.28, mockup
  D2). The outcome is the server's reading of the ledger (data design §2's
  history rule): never `payout_reversals.status` on its own, so a
  `cancelled` + `moved_to_repay` step reads "Taken from the re-pay payout",
  not "Not taken". This component only puts each outcome into words.

  @prop {string} title - What the list is about, as a heading.
  @prop {HistoryLine[]} lines
  @prop {{ type: string; id: string } | null} [debtCause] - The cause of the
    debt being viewed, so its owed line reads "Owed · this debt".
-->
<script lang="ts">
  import type { HistoryLine } from '@codex/admin';
  import * as m from '$paraglide/messages';
  import { Badge } from '$lib/components/ui';
  import { formatPrice } from '$lib/utils/format';
  import { formatShortDay, historyOutcome, resolutionLabel } from './support-format';

  interface Props {
    title: string;
    lines: HistoryLine[];
    debtCause?: { type: string; id: string } | null;
  }

  const { title, lines, debtCause = null }: Props = $props();

  const titleId = $props.id();

  function causeText(line: HistoryLine): string {
    const amount =
      line.causeAmountCents === null ? null : formatPrice(line.causeAmountCents);
    if (line.causeType === 'dispute') {
      // Dated as drawn (D2): when it opened, and when its win was applied.
      if (line.disputeOpenedAt) {
        const opened = formatShortDay(line.disputeOpenedAt);
        return line.disputeWonAt
          ? m.support_history_cause_dispute_won({
              opened,
              won: formatShortDay(line.disputeWonAt),
            })
          : m.support_history_cause_dispute_opened({ opened });
      }
      return amount
        ? m.support_history_cause_dispute({ amount })
        : m.support_history_cause_dispute_plain();
    }
    return amount
      ? m.support_history_cause_refund({ amount })
      : m.support_history_cause_refund_plain();
  }

  function whatText(line: HistoryLine): string {
    switch (line.outcome) {
      case 'taken':
        return line.causeType === 'dispute'
          ? m.support_history_what_taken_dispute()
          : m.support_history_what_taken_refund();
      case 'taken_from_repay':
        return m.support_history_what_taken_from_repay();
      case 'owed':
        return m.support_history_what_owed();
      case 'paid_back':
        return m.support_history_what_paid_back();
      case 'not_taken':
        return m.support_history_what_not_taken();
      case 'in_progress':
        return m.support_history_what_in_progress();
      case 'retrying':
        return m.support_history_what_retrying();
      case 'refused':
        return m.support_history_what_refused();
    }
  }

  function isThisDebt(line: HistoryLine): boolean {
    return (
      debtCause !== null &&
      line.outcome === 'owed' &&
      line.debtResolution === null &&
      line.causeType === debtCause.type &&
      line.causeId === debtCause.id
    );
  }
</script>

<div class="slice-history">
  <p class="slice-history__title" id={titleId}>{title}</p>
  <ul class="history" aria-labelledby={titleId}>
    {#each lines as line, i (`${line.causeType}:${line.causeId}:${line.outcome}:${i}`)}
      {@const badge = historyOutcome(line.outcome, isThisDebt(line))}
      <li data-testid="history-line" data-outcome={line.outcome}>
        <span class="history__cause">{causeText(line)}</span>
        <span class="history__amount">{formatPrice(line.amountCents)}</span>
        <span class="history__what">
          {whatText(line)}
          {#if line.outcome === 'owed' && line.debtResolution}
            {m.support_history_settled({ resolution: resolutionLabel(line.debtResolution) })}
          {/if}
        </span>
        <span class="history__tags">
          <Badge variant={badge.variant}>{badge.label}</Badge>
          <span class="mono">{line.causeId}</span>
        </span>
      </li>
    {/each}
  </ul>
</div>

<style>
  .slice-history {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: var(--container-md);
  }

  .slice-history__title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .history {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .history li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }

  .history__cause,
  .history__amount {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .history__amount {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .history__what {
    grid-column: 1 / -1;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .history__tags {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    overflow-wrap: anywhere;
  }
</style>

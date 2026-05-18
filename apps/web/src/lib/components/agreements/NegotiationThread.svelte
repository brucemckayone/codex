<!--
  @component NegotiationThread

  Chronological list of proposals in a negotiation thread for one
  (org, creator, revenueType) triple. Shared between WP-7 owner surface
  and WP-8 creator surface — the component itself is role-agnostic; the
  parent decides which action callbacks to wire based on who's viewing.

  All share % copy explicitly says "of post-platform [revenue_type] revenue"
  per the C1 math semantic. Currency GBP.

  The latest open proposal (`proposals.at(-1)` if `status === 'open'`) is
  the only one that's actionable. The parent decides which callbacks to
  wire based on actor role + counterparty rules. The component just
  renders buttons for whatever callbacks it received.
-->
<script lang="ts">
  import type { AgreementProposal } from '@codex/agreements';

  type RevenueType = 'subscription' | 'content_purchase';

  interface Props {
    /** Chronological proposals; oldest first. */
    proposals: AgreementProposal[];
    /**
     * Revenue type for copy alignment ("subscription revenue" vs
     * "content-purchase revenue").
     */
    revenueType: RevenueType;
    /**
     * Display names for proposer roles. Use 'You' for the current viewer.
     * Example: { owner: 'You', creator: 'Alex Rivera' }
     */
    roleLabels: { owner: string; creator: string };
    /** Only wired when the viewer is allowed to counter the latest open proposal. */
    onCounter?: (proposalId: string) => void;
    /** Only wired when the viewer is the counterparty of an open proposal. */
    onAccept?: (proposalId: string) => void;
    /** Only wired when the viewer is the counterparty of an open proposal. */
    onDecline?: (proposalId: string) => void;
    /** Only wired when the viewer is the proposing side of an open proposal. */
    onWithdraw?: (proposalId: string) => void;
    /** Optional composition seam. */
    class?: string;
  }

  const {
    proposals,
    revenueType,
    roleLabels,
    onCounter,
    onAccept,
    onDecline,
    onWithdraw,
    class: className,
  }: Props = $props();

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function formatPercent(bp: number): string {
    const pct = bp / 100;
    return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
  }

  function formatDate(date: Date | string | null | undefined): string {
    if (!date) return '—';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toISOString().slice(0, 10);
  }

  function formatTerm(months: number | null): string {
    if (months == null) return 'Indefinite';
    return months === 1 ? '1 month' : `${months} months`;
  }

  function statusLabel(status: string): string {
    switch (status) {
      case 'open':
        return 'Open';
      case 'accepted':
        return 'Accepted';
      case 'declined':
        return 'Declined';
      case 'countered':
        return 'Countered';
      case 'withdrawn':
        return 'Withdrawn';
      case 'superseded':
        return 'Superseded';
      default:
        return status;
    }
  }

  const revenueLabel = $derived(
    revenueType === 'subscription' ? 'subscription' : 'content-purchase'
  );

  // The latest proposal — open ones are the only actionable rows.
  const latestProposal = $derived(proposals.at(-1) ?? null);
  const latestIsOpen = $derived(latestProposal?.status === 'open');
</script>

<ol class="negotiation-thread {className ?? ''}" aria-label="Negotiation history">
  {#if proposals.length === 0}
    <li class="negotiation-thread__empty">
      <p>No proposals yet. Start a negotiation to record terms here.</p>
    </li>
  {:else}
    {#each proposals as proposal, index (proposal.id)}
      {@const isLatest = index === proposals.length - 1}
      {@const proposerLabel = proposal.proposedByRole === 'owner' ? roleLabels.owner : roleLabels.creator}
      <li class="negotiation-thread__item" data-status={proposal.status}>
        <div class="negotiation-thread__item-head">
          <span class="negotiation-thread__round">Round {proposal.roundNumber}</span>
          <span class="negotiation-thread__proposer">
            Proposed by <strong>{proposerLabel}</strong>
          </span>
          <span class="negotiation-thread__date">
            {formatDate(proposal.createdAt)}
          </span>
          <span
            class="negotiation-thread__status"
            data-status={proposal.status}
          >
            {statusLabel(proposal.status)}
          </span>
        </div>

        <dl class="negotiation-thread__details">
          <div class="negotiation-thread__detail-cell">
            <dt>Share</dt>
            <dd>
              <strong>{formatPercent(proposal.proposedCreatorSharePercent)}</strong>
              <span class="negotiation-thread__detail-hint">
                of post-platform {revenueLabel} revenue
              </span>
            </dd>
          </div>
          <div class="negotiation-thread__detail-cell">
            <dt>Term</dt>
            <dd>{formatTerm(proposal.proposedTermMonths)}</dd>
          </div>
          <div class="negotiation-thread__detail-cell">
            <dt>Effective from</dt>
            <dd>{formatDate(proposal.proposedEffectiveFrom)}</dd>
          </div>
        </dl>

        {#if proposal.note}
          <blockquote class="negotiation-thread__note">
            <strong>Note:</strong> {proposal.note}
          </blockquote>
        {/if}

        {#if proposal.status === 'declined' && proposal.declineReason}
          <blockquote class="negotiation-thread__note negotiation-thread__note--decline">
            <strong>Decline reason:</strong> {proposal.declineReason}
          </blockquote>
        {/if}

        {#if isLatest && latestIsOpen}
          <div class="negotiation-thread__actions">
            {#if onAccept}
              <button
                type="button"
                class="negotiation-thread__btn negotiation-thread__btn--primary"
                onclick={() => onAccept?.(proposal.id)}
              >
                Accept
              </button>
            {/if}
            {#if onCounter}
              <button
                type="button"
                class="negotiation-thread__btn negotiation-thread__btn--secondary"
                onclick={() => onCounter?.(proposal.id)}
              >
                Counter
              </button>
            {/if}
            {#if onDecline}
              <button
                type="button"
                class="negotiation-thread__btn negotiation-thread__btn--ghost"
                onclick={() => onDecline?.(proposal.id)}
              >
                Decline
              </button>
            {/if}
            {#if onWithdraw}
              <button
                type="button"
                class="negotiation-thread__btn negotiation-thread__btn--ghost"
                onclick={() => onWithdraw?.(proposal.id)}
              >
                Withdraw
              </button>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  {/if}
</ol>

<style>
  .negotiation-thread {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .negotiation-thread__empty {
    padding: var(--space-6);
    text-align: center;
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
  }

  .negotiation-thread__empty p {
    margin: 0;
    font-size: var(--text-sm);
  }

  .negotiation-thread__item {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
  }

  .negotiation-thread__item[data-status='superseded'],
  .negotiation-thread__item[data-status='withdrawn'] {
    opacity: var(--opacity-60, 0.6);
  }

  .negotiation-thread__item-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .negotiation-thread__round {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
    font-weight: var(--font-medium);
  }

  .negotiation-thread__proposer {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    flex: 1;
    min-width: 0;
  }

  .negotiation-thread__proposer strong {
    color: var(--color-text);
  }

  .negotiation-thread__date {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .negotiation-thread__status {
    display: inline-flex;
    align-items: center;
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-secondary);
  }

  .negotiation-thread__status[data-status='open'] {
    background: var(--color-info-50);
    color: var(--color-info-700);
    border-color: var(--color-info-200);
  }

  .negotiation-thread__status[data-status='accepted'] {
    background: var(--color-success-50);
    color: var(--color-success-700);
    border-color: var(--color-success-200);
  }

  .negotiation-thread__status[data-status='declined'],
  .negotiation-thread__status[data-status='withdrawn'] {
    background: var(--color-surface-secondary);
    color: var(--color-text-muted);
  }

  .negotiation-thread__details {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    gap: var(--space-2);
    margin: 0;
  }

  .negotiation-thread__detail-cell {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .negotiation-thread__detail-cell dt {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .negotiation-thread__detail-cell dd {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .negotiation-thread__detail-cell dd strong {
    font-family: var(--font-mono);
    font-size: var(--text-base);
  }

  .negotiation-thread__detail-hint {
    display: block;
    margin-top: var(--space-0-5);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .negotiation-thread__note {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-secondary);
    border-inline-start: var(--border-width-thick) solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .negotiation-thread__note strong {
    color: var(--color-text);
  }

  .negotiation-thread__note--decline {
    border-inline-start-color: var(--color-error-200);
  }

  .negotiation-thread__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding-top: var(--space-2);
    border-top: var(--border-width) var(--border-style) var(--color-border-subtle);
  }

  .negotiation-thread__btn {
    display: inline-flex;
    align-items: center;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) transparent;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .negotiation-thread__btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .negotiation-thread__btn--primary {
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  .negotiation-thread__btn--primary:hover {
    background: var(--color-interactive-hover);
  }

  .negotiation-thread__btn--secondary {
    background: var(--color-surface);
    color: var(--color-text);
    border-color: var(--color-border);
  }

  .negotiation-thread__btn--secondary:hover {
    background: var(--color-surface-tertiary);
  }

  .negotiation-thread__btn--ghost {
    background: transparent;
    color: var(--color-text-secondary);
  }

  .negotiation-thread__btn--ghost:hover {
    color: var(--color-text);
    background: var(--color-surface-tertiary);
  }
</style>

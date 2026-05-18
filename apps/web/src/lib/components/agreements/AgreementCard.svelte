<!--
  @component AgreementCard

  Per-creator card on the studio settings → revenue-share tab. Shows
  side-by-side subscription + content_purchase agreement state for one
  creator, with role-flipped action buttons.

  Rows:
    - "Subscription": share % of post-platform subscription revenue
    - "Content purchase": share % of post-platform content_purchase revenue
      for content this creator uploaded (per Decision Q1 —
      creator's-own-content scope; see project_revenue_share_decisions).

  Action button per row:
    - No active agreement, no pending → "Propose"
    - Active agreement → "Amend" (which proposes a fresh round-1)
    - Pending proposal waiting on creator → "View thread" + status pill
    - Pending counter received → "View thread" with action emphasis

  All share % copy explicitly says "of post-platform [type] revenue" so the
  user understands the math. Currency GBP throughout.

  Props mirror the WP-7 spec in Codex-s80r6.
-->
<script lang="ts">
  import {
    type AgreementProposal,
    type CreatorOrganizationAgreement,
    formatRevenueTypeLabel,
  } from '@codex/agreements';

  interface Creator {
    id: string;
    name: string | null;
    avatarUrl: string | null;
  }

  interface PendingProposalSummary {
    proposalId: string;
    sharePercent: number;
    termMonths: number | null;
    proposedByRole: 'owner' | 'creator';
    waitingOnRole: 'owner' | 'creator';
    roundNumber: number;
  }

  interface Props {
    creator: Creator;
    /** Active agreement for subscription, if any. */
    subscriptionAgreement?: CreatorOrganizationAgreement | null;
    /** Active agreement for content_purchase, if any. */
    contentPurchaseAgreement?: CreatorOrganizationAgreement | null;
    /** Open / countered proposal for subscription, if any. */
    pendingSubscriptionProposal?: PendingProposalSummary | null;
    /** Open / countered proposal for content_purchase, if any. */
    pendingContentPurchaseProposal?: PendingProposalSummary | null;
    /** Triggers ProposeAgreementDialog at the parent. */
    onPropose: (revenueType: 'subscription' | 'content_purchase') => void;
    /** Triggers amend flow (a fresh round-1) at the parent. */
    onAmend: (
      revenueType: 'subscription' | 'content_purchase',
      currentShareBp: number
    ) => void;
    /** Opens the negotiation thread drawer. */
    onViewThread: (
      revenueType: 'subscription' | 'content_purchase'
    ) => void;
    /** Optional composition seam — forwarded to the root element. */
    class?: string;
  }

  const {
    creator,
    subscriptionAgreement = null,
    contentPurchaseAgreement = null,
    pendingSubscriptionProposal = null,
    pendingContentPurchaseProposal = null,
    onPropose,
    onAmend,
    onViewThread,
    class: className,
  }: Props = $props();

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function formatPercent(bp: number): string {
    const pct = bp / 100;
    return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
  }

  /**
   * Reconstruct the creator share from the legacy `organization_fee_percentage`
   * column. WP-4 introduced the via-proposal read path for the payout
   * pipeline; the active agreement row still carries the legacy dual-write
   * for narrow consumers (this card included).
   */
  function shareFromAgreement(
    a: CreatorOrganizationAgreement | null | undefined
  ): number | null {
    if (!a) return null;
    return 10000 - a.organizationFeePercentage;
  }

  function formatDate(date: Date | string | null | undefined): string {
    if (!date) return '—';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toISOString().slice(0, 10);
  }

  function getInitials(name: string | null): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // ─── Row state derivation ─────────────────────────────────────────────────

  type RowState =
    | { kind: 'none' }
    | { kind: 'active'; sharePercent: number; effectiveFrom: Date | string; effectiveUntil: Date | string | null }
    | { kind: 'pending-owner-waiting'; sharePercent: number; roundNumber: number }
    | { kind: 'pending-counter-received'; sharePercent: number; roundNumber: number }
    | { kind: 'active-with-pending'; sharePercent: number; pendingShare: number; pendingWaitingOnCreator: boolean };

  function deriveRowState(
    active: CreatorOrganizationAgreement | null,
    pending: PendingProposalSummary | null
  ): RowState {
    const activeShare = shareFromAgreement(active);
    if (active && activeShare != null && pending) {
      return {
        kind: 'active-with-pending',
        sharePercent: activeShare,
        pendingShare: pending.sharePercent,
        pendingWaitingOnCreator: pending.waitingOnRole === 'creator',
      };
    }
    if (active && activeShare != null) {
      return {
        kind: 'active',
        sharePercent: activeShare,
        effectiveFrom: active.effectiveFrom,
        effectiveUntil: active.effectiveUntil,
      };
    }
    if (pending) {
      // From the owner's perspective: "waiting on creator" or "counter received"
      if (pending.waitingOnRole === 'creator') {
        return {
          kind: 'pending-owner-waiting',
          sharePercent: pending.sharePercent,
          roundNumber: pending.roundNumber,
        };
      }
      return {
        kind: 'pending-counter-received',
        sharePercent: pending.sharePercent,
        roundNumber: pending.roundNumber,
      };
    }
    return { kind: 'none' };
  }

  const subscriptionState = $derived(
    deriveRowState(subscriptionAgreement, pendingSubscriptionProposal)
  );
  const contentPurchaseState = $derived(
    deriveRowState(contentPurchaseAgreement, pendingContentPurchaseProposal)
  );
</script>

<article class="agreement-card {className ?? ''}" aria-label="Agreement for {creator.name ?? 'Creator'}">
  <header class="agreement-card__header">
    <div class="agreement-card__identity">
      <div class="agreement-card__avatar" aria-hidden="true">
        {#if creator.avatarUrl}
          <img src={creator.avatarUrl} alt="" loading="lazy" />
        {:else}
          <span class="agreement-card__avatar-fallback">{getInitials(creator.name)}</span>
        {/if}
      </div>
      <div class="agreement-card__identity-text">
        <h3 class="agreement-card__name">{creator.name ?? 'Unnamed creator'}</h3>
      </div>
    </div>
  </header>

  <div class="agreement-card__rows">
    {#each [
      {
        revType: 'subscription' as const,
        label: 'Subscription',
        // copyLabel is what gets interpolated into prose ("of post-platform
        // {copyLabel} revenue"). Sourced from `formatRevenueTypeLabel` so it
        // matches the hyphenated `revenue_type` enum value used in
        // NegotiationThread, ProposeAgreementDialog, +page.svelte etc.
        copyLabel: formatRevenueTypeLabel('subscription'),
        state: subscriptionState,
      },
      {
        revType: 'content_purchase' as const,
        label: 'Content purchase',
        copyLabel: formatRevenueTypeLabel('content_purchase'),
        state: contentPurchaseState,
      },
    ] as row (row.revType)}
      <section
        class="agreement-card__row"
        data-state={row.state.kind}
        aria-label="{row.label} agreement"
      >
        <div class="agreement-card__row-head">
          <span class="agreement-card__row-label">{row.label}</span>
          {#if row.state.kind === 'pending-owner-waiting'}
            <span class="agreement-card__pill agreement-card__pill--neutral">
              Waiting on creator · Round {row.state.roundNumber}
            </span>
          {:else if row.state.kind === 'pending-counter-received'}
            <span class="agreement-card__pill agreement-card__pill--info">
              Counter received · Round {row.state.roundNumber}
            </span>
          {:else if row.state.kind === 'active'}
            <span class="agreement-card__pill agreement-card__pill--success">Active</span>
          {:else if row.state.kind === 'active-with-pending'}
            <span class="agreement-card__pill agreement-card__pill--success">Active</span>
            <span class="agreement-card__pill agreement-card__pill--info">
              {row.state.pendingWaitingOnCreator ? 'Amendment waiting' : 'Counter received'}
            </span>
          {:else}
            <span class="agreement-card__pill agreement-card__pill--muted">No agreement</span>
          {/if}
        </div>

        <div class="agreement-card__row-body">
          {#if row.state.kind === 'active' || row.state.kind === 'active-with-pending'}
            <dl class="agreement-card__row-detail">
              <div class="agreement-card__row-detail-cell">
                <dt>Share</dt>
                <dd>
                  <strong>{formatPercent(row.state.sharePercent)}</strong>
                  <span class="agreement-card__row-detail-hint">
                    of post-platform {row.copyLabel} revenue
                  </span>
                </dd>
              </div>
              {#if row.state.kind === 'active'}
                <div class="agreement-card__row-detail-cell">
                  <dt>Effective from</dt>
                  <dd>{formatDate(row.state.effectiveFrom)}</dd>
                </div>
                {#if row.state.effectiveUntil}
                  <div class="agreement-card__row-detail-cell">
                    <dt>Effective until</dt>
                    <dd>{formatDate(row.state.effectiveUntil)}</dd>
                  </div>
                {/if}
              {/if}
              {#if row.state.kind === 'active-with-pending'}
                <div class="agreement-card__row-detail-cell">
                  <dt>Pending share</dt>
                  <dd>
                    <strong>{formatPercent(row.state.pendingShare)}</strong>
                    <span class="agreement-card__row-detail-hint">
                      of post-platform {row.copyLabel} revenue
                    </span>
                  </dd>
                </div>
              {/if}
            </dl>
          {:else if row.state.kind === 'pending-owner-waiting' || row.state.kind === 'pending-counter-received'}
            <dl class="agreement-card__row-detail">
              <div class="agreement-card__row-detail-cell">
                <dt>Proposed share</dt>
                <dd>
                  <strong>{formatPercent(row.state.sharePercent)}</strong>
                  <span class="agreement-card__row-detail-hint">
                    of post-platform {row.copyLabel} revenue
                  </span>
                </dd>
              </div>
            </dl>
          {:else}
            <p class="agreement-card__row-empty">
              No revenue share configured. Default: org keeps 100% of post-platform {row.copyLabel} revenue.
            </p>
          {/if}
        </div>

        <div class="agreement-card__row-actions">
          {#if row.state.kind === 'none'}
            <button
              type="button"
              class="agreement-card__btn agreement-card__btn--primary"
              onclick={() => onPropose(row.revType)}
            >
              Propose agreement
            </button>
          {:else if row.state.kind === 'active'}
            {@const activeShare = row.state.sharePercent}
            <button
              type="button"
              class="agreement-card__btn agreement-card__btn--secondary"
              onclick={() => onAmend(row.revType, activeShare)}
            >
              Amend
            </button>
            <button
              type="button"
              class="agreement-card__btn agreement-card__btn--ghost"
              onclick={() => onViewThread(row.revType)}
            >
              View thread
            </button>
          {:else if row.state.kind === 'pending-owner-waiting' || row.state.kind === 'pending-counter-received' || row.state.kind === 'active-with-pending'}
            {@const showReviewCopy =
              row.state.kind === 'pending-counter-received' ||
              (row.state.kind === 'active-with-pending' && !row.state.pendingWaitingOnCreator)}
            <button
              type="button"
              class="agreement-card__btn agreement-card__btn--primary"
              onclick={() => onViewThread(row.revType)}
            >
              {showReviewCopy ? 'Review counter' : 'View thread'}
            </button>
          {/if}
        </div>
      </section>
    {/each}
  </div>
</article>

<style>
  .agreement-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
  }

  .agreement-card__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .agreement-card__identity {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .agreement-card__avatar {
    display: grid;
    place-items: center;
    width: var(--space-10);
    height: var(--space-10);
    background: var(--color-surface-secondary);
    color: var(--color-text-secondary);
    border-radius: var(--radius-full);
    overflow: hidden;
    flex-shrink: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }

  .agreement-card__avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .agreement-card__avatar-fallback {
    line-height: 1;
  }

  .agreement-card__identity-text {
    min-width: 0;
  }

  .agreement-card__name {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agreement-card__rows {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
  }

  @container (min-width: 48rem) {
    .agreement-card__rows {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .agreement-card__row {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
  }

  .agreement-card__row-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .agreement-card__row-label {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    flex: 1;
    min-width: 0;
  }

  .agreement-card__pill {
    display: inline-flex;
    align-items: center;
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) transparent;
  }

  .agreement-card__pill--muted {
    background: var(--color-surface);
    color: var(--color-text-muted);
    border-color: var(--color-border);
  }

  .agreement-card__pill--neutral {
    background: var(--color-surface);
    color: var(--color-text-secondary);
    border-color: var(--color-border);
  }

  .agreement-card__pill--info {
    background: var(--color-info-50);
    color: var(--color-info-700);
    border-color: var(--color-info-200);
  }

  .agreement-card__pill--success {
    background: var(--color-success-50);
    color: var(--color-success-700);
    border-color: var(--color-success-200);
  }

  .agreement-card__row-body {
    flex: 1;
    min-height: 0;
  }

  .agreement-card__row-detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
  }

  .agreement-card__row-detail-cell {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .agreement-card__row-detail-cell dt {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .agreement-card__row-detail-cell dd {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .agreement-card__row-detail-cell dd strong {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    color: var(--color-text);
  }

  .agreement-card__row-detail-hint {
    display: block;
    margin-top: var(--space-0-5);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .agreement-card__row-empty {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .agreement-card__row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .agreement-card__btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) transparent;
    cursor: pointer;
    transition: var(--transition-colors);
    text-decoration: none;
  }

  .agreement-card__btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .agreement-card__btn--primary {
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  .agreement-card__btn--primary:hover {
    background: var(--color-interactive-hover);
  }

  .agreement-card__btn--secondary {
    background: var(--color-surface);
    color: var(--color-text);
    border-color: var(--color-border);
  }

  .agreement-card__btn--secondary:hover {
    background: var(--color-surface-tertiary);
  }

  .agreement-card__btn--ghost {
    background: transparent;
    color: var(--color-text-secondary);
  }

  .agreement-card__btn--ghost:hover {
    color: var(--color-text);
    background: var(--color-surface-tertiary);
  }
</style>

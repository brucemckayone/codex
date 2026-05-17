<!--
  @component CreatorStudioNegotiations

  Creator-side revenue-share negotiations portfolio (WP-8 — Codex-bw2wf).

  First major surface on the personal creator studio subdomain. Four
  sections:
    1. Pending — Action Required: owner proposed; creator must respond.
    2. Pending — Waiting on Org: creator countered; org owner must respond.
    3. Active Agreements: signed and in force.
    4. Past: declined / withdrawn / superseded / terminated (read-only).

  Studio is `ssr = false`, so data is fetched client-side via the
  `getMyAgreementPortfolio` remote query. The worker enforces the
  anonymisation contract — only `peers: { count, aggregateSharePercent }`
  ever crosses the wire; never peer userId / creatorId / name.

  All share % copy explicitly says "of post-platform [type] revenue" per
  the C1 math semantic (see project_revenue_share_decisions.md).
  Currency GBP throughout.
-->
<script lang="ts">
  import { browser } from '$app/environment';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import {
    acceptAgreement,
    declineAgreement,
    getMyAgreementPortfolio,
    withdrawAgreement,
  } from '$lib/remote/agreements.remote';
  import { toast } from '$lib/components/ui/Toast/toast-store';

  type RevenueType = 'subscription' | 'content_purchase';

  // ─── Data ─────────────────────────────────────────────────────────────────
  const portfolioQuery = $derived(browser ? getMyAgreementPortfolio() : null);

  const portfolio = $derived(portfolioQuery?.current ?? null);
  const isLoading = $derived(portfolioQuery?.loading ?? true);

  const pendingActionRequired = $derived(portfolio?.pendingActionRequired ?? []);
  const pendingWaitingOnOrg = $derived(portfolio?.pendingWaitingOnOrg ?? []);
  const active = $derived(portfolio?.active ?? []);
  const past = $derived(portfolio?.past ?? []);

  const isEmpty = $derived(
    !isLoading &&
      pendingActionRequired.length === 0 &&
      pendingWaitingOnOrg.length === 0 &&
      active.length === 0 &&
      past.length === 0
  );

  let pastExpanded = $state(false);

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

  function revenueLabel(revenueType: string): string {
    return revenueType === 'subscription' ? 'subscription' : 'content-purchase';
  }

  function statusLabel(status: string): string {
    switch (status) {
      case 'declined':
        return 'Declined';
      case 'withdrawn':
        return 'Withdrawn';
      case 'superseded':
        return 'Superseded';
      case 'terminated':
        return 'Terminated';
      case 'active':
        return 'Active';
      default:
        return status;
    }
  }

  function detailHref(proposalId: string): string {
    return `/studio/negotiations/${proposalId}`;
  }

  function activeDetailHref(activeRow: { currentProposalId: string | null; id: string }): string {
    // currentProposalId is always set on active rows (set by acceptProposal);
    // fall back to agreement id if somehow null.
    return `/studio/negotiations/${activeRow.currentProposalId ?? activeRow.id}`;
  }

  // ─── Row actions ──────────────────────────────────────────────────────────

  async function handleAccept(proposalId: string) {
    try {
      await acceptAgreement({ proposalId });
      toast.success('Agreement accepted', 'The agreement is now active.');
      await portfolioQuery?.refresh();
    } catch (err) {
      toast.error(
        'Could not accept proposal',
        err instanceof Error ? err.message : 'Unknown error'
      );
    }
  }

  async function handleDecline(proposalId: string) {
    try {
      await declineAgreement({ proposalId });
      toast.info('Proposal declined', 'The org owner will be notified.');
      await portfolioQuery?.refresh();
    } catch (err) {
      toast.error(
        'Could not decline proposal',
        err instanceof Error ? err.message : 'Unknown error'
      );
    }
  }

  async function handleWithdraw(proposalId: string) {
    try {
      await withdrawAgreement({ proposalId });
      toast.info('Counter withdrawn');
      await portfolioQuery?.refresh();
    } catch (err) {
      toast.error(
        'Could not withdraw counter',
        err instanceof Error ? err.message : 'Unknown error'
      );
    }
  }
</script>

<svelte:head>
  <title>Negotiations | Creator Studio</title>
</svelte:head>

<div class="negotiations-page">
  <header class="negotiations-page__intro">
    <h2 class="negotiations-page__heading">Negotiations</h2>
    <p class="negotiations-page__lede">
      Revenue-share agreements with the orgs you create for. All shares are
      calculated against <strong>post-platform revenue</strong> — the platform
      fee is taken first, and your share applies to what remains.
    </p>
  </header>

  {#if isLoading}
    <div class="negotiations-page__loading">
      <Skeleton width="100%" height="var(--space-24)" />
      <Skeleton width="100%" height="var(--space-24)" />
    </div>
  {:else if isEmpty}
    <section
      class="negotiations-page__section negotiations-page__section--empty"
      aria-labelledby="empty-heading"
    >
      <h3 id="empty-heading" class="negotiations-page__section-heading">
        No revenue-share agreements yet
      </h3>
      <p class="negotiations-page__section-lede">
        When an org owner proposes a revenue-share agreement with you, it will
        appear here. You can accept, counter, or decline each proposal — and
        track your active agreements once accepted.
      </p>
    </section>
  {:else}
    <!-- ─── 1. Pending — Action Required ────────────────────────────────── -->
    {#if pendingActionRequired.length > 0}
      <section
        class="negotiations-page__section negotiations-page__section--alert"
        aria-labelledby="action-required-heading"
      >
        <header class="negotiations-page__section-head">
          <h3
            id="action-required-heading"
            class="negotiations-page__section-heading"
          >
            Action required
          </h3>
          <span class="negotiations-page__count-pill" aria-hidden="true">
            {pendingActionRequired.length}
          </span>
        </header>
        <p class="negotiations-page__section-lede">
          Proposals waiting on your response.
        </p>
        <ul class="negotiations-page__list">
          {#each pendingActionRequired as row (row.proposalId)}
            {@const revLabel = revenueLabel(row.revenueType)}
            <li class="negotiations-page__item" data-tone="alert">
              <div class="negotiations-page__item-info">
                <a
                  href={detailHref(row.threadProposalId)}
                  class="negotiations-page__item-org"
                >
                  {row.organizationName ?? 'Organisation'}
                </a>
                <span class="negotiations-page__item-type">
                  {revLabel}
                </span>
                <span class="negotiations-page__item-share">
                  {formatPercent(row.proposedSharePercent)}
                  <span class="negotiations-page__item-hint">
                    of post-platform {revLabel} revenue · {formatTerm(row.proposedTermMonths)} · Round {row.roundNumber}
                  </span>
                </span>
                {#if row.note}
                  <p class="negotiations-page__item-note">
                    <strong>Note:</strong> {row.note}
                  </p>
                {/if}
              </div>
              <div class="negotiations-page__item-actions">
                <button
                  type="button"
                  class="negotiations-page__btn negotiations-page__btn--primary"
                  onclick={() => handleAccept(row.proposalId)}
                >
                  Accept
                </button>
                <a
                  href={detailHref(row.threadProposalId)}
                  class="negotiations-page__btn negotiations-page__btn--secondary"
                >
                  Counter
                </a>
                <button
                  type="button"
                  class="negotiations-page__btn negotiations-page__btn--ghost"
                  onclick={() => handleDecline(row.proposalId)}
                >
                  Decline
                </button>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- ─── 2. Pending — Waiting on Org ─────────────────────────────────── -->
    {#if pendingWaitingOnOrg.length > 0}
      <section
        class="negotiations-page__section"
        aria-labelledby="waiting-on-org-heading"
      >
        <header class="negotiations-page__section-head">
          <h3
            id="waiting-on-org-heading"
            class="negotiations-page__section-heading"
          >
            Waiting on org
          </h3>
          <span class="negotiations-page__count-pill" aria-hidden="true">
            {pendingWaitingOnOrg.length}
          </span>
        </header>
        <p class="negotiations-page__section-lede">
          Counters you've sent. The org owner will be notified.
        </p>
        <ul class="negotiations-page__list">
          {#each pendingWaitingOnOrg as row (row.proposalId)}
            {@const revLabel = revenueLabel(row.revenueType)}
            <li class="negotiations-page__item">
              <div class="negotiations-page__item-info">
                <a
                  href={detailHref(row.threadProposalId)}
                  class="negotiations-page__item-org"
                >
                  {row.organizationName ?? 'Organisation'}
                </a>
                <span class="negotiations-page__item-type">
                  {revLabel}
                </span>
                <span class="negotiations-page__item-share">
                  {formatPercent(row.proposedSharePercent)}
                  <span class="negotiations-page__item-hint">
                    of post-platform {revLabel} revenue · {formatTerm(row.proposedTermMonths)} · Round {row.roundNumber}
                  </span>
                </span>
              </div>
              <div class="negotiations-page__item-actions">
                <a
                  href={detailHref(row.threadProposalId)}
                  class="negotiations-page__btn negotiations-page__btn--secondary"
                >
                  View thread
                </a>
                <button
                  type="button"
                  class="negotiations-page__btn negotiations-page__btn--ghost"
                  onclick={() => handleWithdraw(row.proposalId)}
                >
                  Withdraw
                </button>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- ─── 3. Active Agreements ─────────────────────────────────────────── -->
    {#if active.length > 0}
      <section
        class="negotiations-page__section"
        aria-labelledby="active-heading"
      >
        <header class="negotiations-page__section-head">
          <h3 id="active-heading" class="negotiations-page__section-heading">
            Active agreements
          </h3>
          <span class="negotiations-page__count-pill" aria-hidden="true">
            {active.length}
          </span>
        </header>
        <ul class="negotiations-page__list">
          {#each active as row (row.id)}
            {@const revLabel = revenueLabel(row.revenueType)}
            {@const myShareBp = 10000 - row.organizationFeePercentage}
            <li class="negotiations-page__item" data-tone="success">
              <div class="negotiations-page__item-info">
                <a
                  href={activeDetailHref(row)}
                  class="negotiations-page__item-org"
                >
                  {row.organizationName ?? 'Organisation'}
                </a>
                <span class="negotiations-page__item-type">
                  {revLabel}
                </span>
                <span class="negotiations-page__item-share">
                  {formatPercent(myShareBp)}
                  <span class="negotiations-page__item-hint">
                    of post-platform {revLabel} revenue · effective from
                    {formatDate(row.effectiveFrom)}{row.effectiveUntil
                      ? ` until ${formatDate(row.effectiveUntil)}`
                      : ''}
                  </span>
                </span>
                {#if row.peers.count > 0}
                  <span class="negotiations-page__item-peers">
                    {row.peers.count}
                    {row.peers.count === 1 ? 'other creator' : 'other creators'}
                    on this pool ({formatPercent(row.peers.aggregateSharePercent)} aggregate share)
                  </span>
                {/if}
              </div>
              <div class="negotiations-page__item-actions">
                <a
                  href={activeDetailHref(row)}
                  class="negotiations-page__btn negotiations-page__btn--secondary"
                >
                  Manage
                </a>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- ─── 4. Past (collapsible, read-only) ─────────────────────────────── -->
    {#if past.length > 0}
      <section
        class="negotiations-page__section"
        aria-labelledby="past-heading"
      >
        <header class="negotiations-page__section-head">
          <h3 id="past-heading" class="negotiations-page__section-heading">
            Past
          </h3>
          <span class="negotiations-page__count-pill" aria-hidden="true">
            {past.length}
          </span>
          <button
            type="button"
            class="negotiations-page__toggle"
            aria-expanded={pastExpanded}
            aria-controls="past-list"
            onclick={() => (pastExpanded = !pastExpanded)}
          >
            {pastExpanded ? 'Hide' : 'Show'}
          </button>
        </header>
        {#if pastExpanded}
          <ul id="past-list" class="negotiations-page__list">
            {#each past as row (row.proposalId)}
              {@const revLabel = revenueLabel(row.revenueType)}
              <li class="negotiations-page__item" data-tone="muted">
                <div class="negotiations-page__item-info">
                  <span class="negotiations-page__item-org-static">
                    {row.organizationName ?? 'Organisation'}
                  </span>
                  <span class="negotiations-page__item-type">
                    {revLabel}
                  </span>
                  <span class="negotiations-page__item-share">
                    {formatPercent(row.proposedSharePercent)}
                    <span class="negotiations-page__item-hint">
                      of post-platform {revLabel} revenue · Round {row.roundNumber} · {formatDate(row.endedAt)}
                    </span>
                  </span>
                  {#if row.declineReason}
                    <p class="negotiations-page__item-note">
                      <strong>Decline reason:</strong> {row.declineReason}
                    </p>
                  {/if}
                </div>
                <div class="negotiations-page__item-actions">
                  <span
                    class="negotiations-page__pill"
                    data-status={row.status}
                  >
                    {statusLabel(row.status)}
                  </span>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  {/if}
</div>

<style>
  .negotiations-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: var(--container-lg);
    container-type: inline-size;
  }

  .negotiations-page__intro {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .negotiations-page__heading {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .negotiations-page__lede {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    max-width: 60ch;
    line-height: var(--leading-relaxed);
  }

  .negotiations-page__lede strong {
    color: var(--color-text);
  }

  .negotiations-page__loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .negotiations-page__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-5);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
  }

  .negotiations-page__section--alert {
    border-color: var(--color-warning-200);
    background: var(--color-warning-50);
  }

  .negotiations-page__section--empty {
    text-align: center;
    padding: var(--space-8) var(--space-5);
  }

  .negotiations-page__section-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .negotiations-page__section-heading {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .negotiations-page__section-lede {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    max-width: 60ch;
  }

  .negotiations-page__count-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--space-5);
    height: var(--space-5);
    padding: 0 var(--space-2);
    background: var(--color-surface-secondary);
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .negotiations-page__section--alert .negotiations-page__count-pill {
    background: var(--color-warning-100);
    color: var(--color-warning-700);
    border-color: var(--color-warning-200);
  }

  .negotiations-page__toggle {
    margin-inline-start: auto;
    padding: var(--space-1) var(--space-2);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .negotiations-page__toggle:hover {
    background: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .negotiations-page__toggle:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .negotiations-page__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .negotiations-page__item {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
  }

  .negotiations-page__item[data-tone='alert'] {
    border-color: var(--color-warning-200);
    background: var(--color-surface);
  }

  .negotiations-page__item[data-tone='success'] {
    border-color: var(--color-success-200);
  }

  .negotiations-page__item[data-tone='muted'] {
    background: var(--color-surface-secondary);
    color: var(--color-text-secondary);
  }

  .negotiations-page__item-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    flex: 1;
  }

  .negotiations-page__item-org {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    text-decoration: none;
  }

  .negotiations-page__item-org:hover {
    color: var(--color-interactive);
    text-decoration: underline;
  }

  .negotiations-page__item-org:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .negotiations-page__item-org-static {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .negotiations-page__item-type {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-muted);
  }

  .negotiations-page__item-share {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .negotiations-page__item-hint {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .negotiations-page__item-peers {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .negotiations-page__item-note {
    margin: var(--space-1) 0 0;
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-secondary);
    border-inline-start: var(--border-width-thick) solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .negotiations-page__item-note strong {
    color: var(--color-text);
  }

  .negotiations-page__item-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  .negotiations-page__btn {
    display: inline-flex;
    align-items: center;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) transparent;
    cursor: pointer;
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .negotiations-page__btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .negotiations-page__btn--primary {
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  .negotiations-page__btn--primary:hover {
    background: var(--color-interactive-hover);
  }

  .negotiations-page__btn--secondary {
    background: var(--color-surface);
    color: var(--color-text);
    border-color: var(--color-border);
  }

  .negotiations-page__btn--secondary:hover {
    background: var(--color-surface-tertiary);
  }

  .negotiations-page__btn--ghost {
    background: transparent;
    color: var(--color-text-secondary);
  }

  .negotiations-page__btn--ghost:hover {
    color: var(--color-text);
    background: var(--color-surface-tertiary);
  }

  .negotiations-page__pill {
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

  .negotiations-page__pill[data-status='declined'],
  .negotiations-page__pill[data-status='withdrawn'],
  .negotiations-page__pill[data-status='superseded'] {
    background: var(--color-surface-secondary);
    color: var(--color-text-muted);
  }
</style>

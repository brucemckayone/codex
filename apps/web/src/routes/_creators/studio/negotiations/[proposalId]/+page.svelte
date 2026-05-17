<!--
  @component CreatorStudioNegotiationDetail

  Single-thread detail view for a creator-side revenue-share agreement
  (WP-8 — Codex-bw2wf). The URL takes ANY proposal id within the thread;
  the worker resolves the full chronological thread + portfolio context
  so we can show:
    - Org name + revenue type + thread status
    - Anonymised revenue split (creator's slice + peer aggregate +
      platform fee) via RevenueSplitPie in `mode='creator'`
    - Full chronological NegotiationThread, role-agnostic
    - Action bar appropriate to current state (accept / counter /
      decline / withdraw / terminate)

  Cross-tenant access — if `proposalId` doesn't belong to the caller,
  the worker returns 404 and we render an access-denied state.

  Studio is `ssr = false`, so all data is fetched client-side. The
  anonymisation contract is enforced server-side by the worker (peer
  aggregate only, no peer identifiers); UI defensively renders only
  what's provided.

  All share % copy explicitly says "of post-platform [type] revenue".
  Currency GBP.
-->
<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import CounterProposalDialog from '$lib/components/agreements/CounterProposalDialog.svelte';
  import NegotiationThread from '$lib/components/agreements/NegotiationThread.svelte';
  import RevenueSplitPie from '$lib/components/agreements/RevenueSplitPie.svelte';
  import type { RevenueSplitSlice } from '$lib/components/agreements/types';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import {
    acceptAgreement,
    counterAgreement,
    declineAgreement,
    getMyAgreementPortfolio,
    getMyAgreementThread,
    terminateAgreement,
    withdrawAgreement,
  } from '$lib/remote/agreements.remote';

  type RevenueType = 'subscription' | 'content_purchase';

  // Platform fee — read fresh from constants. Matches FEES.PLATFORM_PERCENT.
  // Per Decision Q2, platform fee is the platform's operational lever; agreements
  // don't snapshot it. WP-7 mirror.
  const PLATFORM_FEE_BP = 1000;

  // ─── URL state ────────────────────────────────────────────────────────────
  const proposalId = $derived(page.params.proposalId ?? '');

  // ─── Queries ──────────────────────────────────────────────────────────────
  const threadQuery = $derived(
    browser && proposalId ? getMyAgreementThread({ proposalId }) : null
  );
  const portfolioQuery = $derived(browser ? getMyAgreementPortfolio() : null);

  const thread = $derived(threadQuery?.current ?? null);
  const portfolio = $derived(portfolioQuery?.current ?? null);
  const isLoading = $derived(
    (threadQuery?.loading ?? true) || (portfolioQuery?.loading ?? true)
  );
  const threadError = $derived(threadQuery?.error ?? null);

  // The thread is chronological — first proposal carries the org+type
  // identity; the latest proposal is the actionable one (if open).
  const firstProposal = $derived(thread?.[0] ?? null);
  const latestProposal = $derived(thread && thread.length > 0 ? thread[thread.length - 1] : null);
  const latestIsOpen = $derived(latestProposal?.status === 'open');
  const latestProposedByOwner = $derived(latestProposal?.proposedByRole === 'owner');

  // Locate the active agreement (if any) corresponding to this thread.
  // Match on (organizationId, revenueType) so direct links to historical
  // proposals still surface the active row.
  const activeAgreement = $derived.by(() => {
    if (!firstProposal || !portfolio) return null;
    return (
      portfolio.active.find(
        (a) =>
          a.organizationId === firstProposal.organizationId &&
          a.revenueType === firstProposal.revenueType
      ) ?? null
    );
  });

  const organizationId = $derived(firstProposal?.organizationId ?? null);
  const revenueType = $derived<RevenueType | null>(
    firstProposal?.revenueType === 'subscription' ||
      firstProposal?.revenueType === 'content_purchase'
      ? (firstProposal.revenueType as RevenueType)
      : null
  );
  const revenueLabel = $derived(
    revenueType === 'subscription' ? 'subscription' : 'content-purchase'
  );

  // Resolve the org name from the portfolio (any matching row, active or pending).
  const organizationName = $derived.by(() => {
    if (!organizationId || !portfolio) return null;
    const fromActive = portfolio.active.find(
      (a) => a.organizationId === organizationId
    );
    if (fromActive?.organizationName) return fromActive.organizationName;
    const fromPending = [
      ...portfolio.pendingActionRequired,
      ...portfolio.pendingWaitingOnOrg,
    ].find((p) => p.organizationId === organizationId);
    if (fromPending?.organizationName) return fromPending.organizationName;
    const fromPast = portfolio.past.find(
      (p) => p.organizationId === organizationId
    );
    return fromPast?.organizationName ?? null;
  });

  // Peer aggregate — only meaningful when there's an active agreement OR
  // a portfolio row referencing the same (org, revenueType) pool. The
  // anonymisation contract is enforced server-side; we don't fabricate
  // peer rows here.
  const peersForPool = $derived.by(() => {
    if (!activeAgreement) return null;
    return activeAgreement.peers;
  });

  // The creator's own current share (BP) in this pool. Source of truth
  // priority:
  //   1. Active agreement row (`10000 - organizationFeePercentage`)
  //   2. Latest open proposal's proposed share (proposal-only thread)
  //   3. Latest proposal in thread (for past states)
  const mySharePercent = $derived.by(() => {
    if (activeAgreement) {
      return 10000 - activeAgreement.organizationFeePercentage;
    }
    if (latestProposal) {
      return latestProposal.proposedCreatorSharePercent;
    }
    return 0;
  });

  // Build the anonymised pie slices for `mode='creator'`. Slice order:
  // platform fee (locked, handled by component) → my slice → anonymised
  // peer aggregate (single slice) → org residual. No peer identifiers
  // present anywhere in this array — defensive against any future
  // server-side leak.
  const pieSlices = $derived.by((): RevenueSplitSlice[] => {
    const availableBp = 10000 - PLATFORM_FEE_BP;
    const peerAggregate = peersForPool?.aggregateSharePercent ?? 0;
    const orgResidual = Math.max(
      0,
      availableBp - mySharePercent - peerAggregate
    );

    const slices: RevenueSplitSlice[] = [
      {
        id: '__me__',
        label: 'Your share',
        percent: mySharePercent,
        color: 'var(--color-interactive)',
        locked: true,
        anonymous: false,
      },
    ];
    if (peersForPool && peersForPool.count > 0) {
      slices.push({
        id: '__peers__',
        label: `Other creators (${peersForPool.count})`,
        percent: peerAggregate,
        color: 'var(--color-info-600)',
        locked: true,
        anonymous: true,
      });
    }
    if (orgResidual > 0) {
      slices.push({
        id: '__org_residual__',
        label: 'Org residual',
        percent: orgResidual,
        color: 'var(--color-surface-tertiary)',
        locked: true,
        anonymous: false,
      });
    }
    return slices;
  });

  // ─── Counter dialog state ────────────────────────────────────────────────
  let counterDialogOpen = $state(false);

  function openCounter() {
    if (!latestProposal) return;
    counterDialogOpen = true;
  }

  function handleCounterOpenChange(next: boolean) {
    if (next === counterDialogOpen) return;
    counterDialogOpen = next;
  }

  async function handleCounterSubmit(input: {
    sharePercent: number;
    termMonths: number;
    note?: string;
  }) {
    if (!latestProposal) {
      throw new Error('No proposal to counter');
    }
    await counterAgreement({
      proposalId: latestProposal.id,
      sharePercent: input.sharePercent,
      termMonths: input.termMonths,
      note: input.note,
    });
    toast.success('Counter sent', `${ownerName} will be notified.`);
    counterDialogOpen = false;
    await threadQuery?.refresh();
    await portfolioQuery?.refresh();
  }

  // ─── Action handlers ──────────────────────────────────────────────────────
  async function handleAccept() {
    if (!latestProposal) return;
    try {
      await acceptAgreement({ proposalId: latestProposal.id });
      toast.success('Agreement accepted', 'The agreement is now active.');
      await threadQuery?.refresh();
      await portfolioQuery?.refresh();
    } catch (err) {
      toast.error(
        'Could not accept proposal',
        err instanceof Error ? err.message : 'Unknown error'
      );
    }
  }

  async function handleDecline() {
    if (!latestProposal) return;
    try {
      await declineAgreement({ proposalId: latestProposal.id });
      toast.info('Proposal declined', 'The org owner will be notified.');
      await threadQuery?.refresh();
      await portfolioQuery?.refresh();
      goto('/studio/negotiations');
    } catch (err) {
      toast.error(
        'Could not decline proposal',
        err instanceof Error ? err.message : 'Unknown error'
      );
    }
  }

  async function handleWithdraw() {
    if (!latestProposal) return;
    try {
      await withdrawAgreement({ proposalId: latestProposal.id });
      toast.info('Counter withdrawn');
      await threadQuery?.refresh();
      await portfolioQuery?.refresh();
    } catch (err) {
      toast.error(
        'Could not withdraw counter',
        err instanceof Error ? err.message : 'Unknown error'
      );
    }
  }

  let terminateConfirming = $state(false);
  let terminateReason = $state('');

  async function handleTerminate() {
    if (!activeAgreement) return;
    try {
      await terminateAgreement({
        agreementId: activeAgreement.id,
        reason: terminateReason.trim() || undefined,
      });
      toast.success('Agreement terminated');
      terminateConfirming = false;
      terminateReason = '';
      await threadQuery?.refresh();
      await portfolioQuery?.refresh();
      goto('/studio/negotiations');
    } catch (err) {
      toast.error(
        'Could not terminate agreement',
        err instanceof Error ? err.message : 'Unknown error'
      );
    }
  }

  // ─── Display helpers ──────────────────────────────────────────────────────
  const ownerName = $derived(organizationName ?? 'The org owner');

  function formatPercent(bp: number): string {
    const pct = bp / 100;
    return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
  }

  function statusLabel(): string {
    if (activeAgreement) return 'Active';
    if (!latestProposal) return 'Unknown';
    switch (latestProposal.status) {
      case 'open':
        return latestProposedByOwner ? 'Awaiting your response' : 'Waiting on org';
      case 'declined':
        return 'Declined';
      case 'withdrawn':
        return 'Withdrawn';
      case 'superseded':
        return 'Superseded';
      case 'accepted':
        return 'Accepted';
      default:
        return latestProposal.status;
    }
  }
</script>

<svelte:head>
  <title>Negotiation | Creator Studio</title>
</svelte:head>

<div class="agreement-detail">
  <nav class="agreement-detail__crumbs" aria-label="Breadcrumb">
    <a href="/studio/negotiations" class="agreement-detail__crumb-link">
      Negotiations
    </a>
    <span aria-hidden="true">/</span>
    <span>{organizationName ?? 'Detail'}</span>
  </nav>

  {#if isLoading}
    <div class="agreement-detail__loading">
      <Skeleton width="60%" height="var(--space-8)" />
      <Skeleton width="100%" height="var(--space-16)" />
      <Skeleton width="100%" height="var(--space-32)" />
    </div>
  {:else if threadError || !thread || thread.length === 0 || !revenueType}
    <section
      class="agreement-detail__section agreement-detail__section--error"
      aria-labelledby="error-heading"
    >
      <h2 id="error-heading" class="agreement-detail__heading">
        You don't have access to this agreement
      </h2>
      <p class="agreement-detail__lede">
        This negotiation either doesn't exist or you're not the named
        creator on it. If you reached this page from a link, the agreement
        may have been removed.
      </p>
      <a
        href="/studio/negotiations"
        class="agreement-detail__btn agreement-detail__btn--secondary"
      >
        Back to negotiations
      </a>
    </section>
  {:else}
    <header class="agreement-detail__header">
      <h2 class="agreement-detail__heading">
        {organizationName ?? 'Organisation'}
        <span class="agreement-detail__type">{revenueLabel}</span>
      </h2>
      <p class="agreement-detail__lede">
        <span
          class="agreement-detail__status-pill"
          data-active={activeAgreement ? 'true' : 'false'}
        >
          {statusLabel()}
        </span>
      </p>
    </header>

    <section
      class="agreement-detail__section"
      aria-labelledby="split-heading"
    >
      <h3 id="split-heading" class="agreement-detail__section-heading">
        Revenue split
      </h3>
      <p class="agreement-detail__section-lede">
        How {revenueLabel} revenue is split with this org. The platform fee is
        taken first; your share applies to what remains.
      </p>
      <RevenueSplitPie
        mode="creator"
        platformFeePercent={PLATFORM_FEE_BP}
        slices={pieSlices}
        readOnly
      />
      <p class="agreement-detail__split-summary">
        Your share: <strong>{formatPercent(mySharePercent)}</strong>
        of post-platform {revenueLabel} revenue.
        {#if peersForPool && peersForPool.count > 0}
          {peersForPool.count}
          {peersForPool.count === 1 ? 'other creator' : 'other creators'}
          on this pool collectively earn
          {formatPercent(peersForPool.aggregateSharePercent)}.
        {/if}
      </p>
    </section>

    <section
      class="agreement-detail__section"
      aria-labelledby="thread-heading"
    >
      <h3 id="thread-heading" class="agreement-detail__section-heading">
        Negotiation history
      </h3>
      <NegotiationThread
        proposals={thread}
        revenueType={revenueType}
        roleLabels={{ owner: ownerName, creator: 'You' }}
        onAccept={latestIsOpen && latestProposedByOwner ? handleAccept : undefined}
        onCounter={latestIsOpen && latestProposedByOwner ? openCounter : undefined}
        onDecline={latestIsOpen && latestProposedByOwner ? handleDecline : undefined}
        onWithdraw={latestIsOpen && !latestProposedByOwner ? handleWithdraw : undefined}
      />
    </section>

    {#if activeAgreement}
      <section
        class="agreement-detail__section agreement-detail__section--danger"
        aria-labelledby="terminate-heading"
      >
        <h3 id="terminate-heading" class="agreement-detail__section-heading">
          Terminate agreement
        </h3>
        <p class="agreement-detail__section-lede">
          End this revenue-share agreement. You'll keep any earnings already
          accrued under it. The org owner will be notified.
        </p>
        {#if terminateConfirming}
          <div class="agreement-detail__confirm">
            <label
              for="terminate-reason"
              class="agreement-detail__field-label"
            >
              Reason (optional)
            </label>
            <textarea
              id="terminate-reason"
              class="agreement-detail__textarea"
              bind:value={terminateReason}
              rows="3"
              maxlength="500"
              placeholder="e.g. Moving on from this team."
            ></textarea>
            <div class="agreement-detail__confirm-actions">
              <button
                type="button"
                class="agreement-detail__btn agreement-detail__btn--ghost"
                onclick={() => {
                  terminateConfirming = false;
                  terminateReason = '';
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                class="agreement-detail__btn agreement-detail__btn--danger"
                onclick={handleTerminate}
              >
                Confirm terminate
              </button>
            </div>
          </div>
        {:else}
          <button
            type="button"
            class="agreement-detail__btn agreement-detail__btn--danger"
            onclick={() => (terminateConfirming = true)}
          >
            Terminate
          </button>
        {/if}
      </section>
    {/if}
  {/if}
</div>

{#if browser && latestProposal && latestIsOpen && latestProposedByOwner}
  <CounterProposalDialog
    open={counterDialogOpen}
    onOpenChange={handleCounterOpenChange}
    proposalId={latestProposal.id}
    currentSharePercent={latestProposal.proposedCreatorSharePercent}
    currentTermMonths={latestProposal.proposedTermMonths}
    ownerName={ownerName}
    revenueType={revenueType ?? 'subscription'}
    onSubmit={handleCounterSubmit}
  />
{/if}

<style>
  .agreement-detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    max-width: 1100px;
    container-type: inline-size;
  }

  .agreement-detail__crumbs {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .agreement-detail__crumb-link {
    color: var(--color-text-secondary);
    text-decoration: none;
  }

  .agreement-detail__crumb-link:hover {
    color: var(--color-interactive);
    text-decoration: underline;
  }

  .agreement-detail__crumb-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .agreement-detail__loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .agreement-detail__header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .agreement-detail__heading {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .agreement-detail__type {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .agreement-detail__lede {
    margin: 0;
  }

  .agreement-detail__status-pill {
    display: inline-flex;
    align-items: center;
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    border-radius: var(--radius-full);
    background: var(--color-surface-secondary);
    color: var(--color-text-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .agreement-detail__status-pill[data-active='true'] {
    background: var(--color-success-50);
    color: var(--color-success-700);
    border-color: var(--color-success-200);
  }

  .agreement-detail__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-5);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
  }

  .agreement-detail__section--error {
    text-align: center;
    padding: var(--space-8) var(--space-5);
  }

  .agreement-detail__section--danger {
    border-color: var(--color-error-200);
  }

  .agreement-detail__section-heading {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .agreement-detail__section-lede {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    max-width: 60ch;
    line-height: var(--leading-relaxed);
  }

  .agreement-detail__split-summary {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .agreement-detail__split-summary strong {
    font-family: var(--font-mono);
  }

  .agreement-detail__field-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .agreement-detail__textarea {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    resize: vertical;
    min-height: var(--space-16);
  }

  .agreement-detail__textarea:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-color: var(--color-border-focus);
  }

  .agreement-detail__confirm {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .agreement-detail__confirm-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    justify-content: flex-end;
  }

  .agreement-detail__btn {
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

  .agreement-detail__btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .agreement-detail__btn--secondary {
    background: var(--color-surface);
    color: var(--color-text);
    border-color: var(--color-border);
  }

  .agreement-detail__btn--secondary:hover {
    background: var(--color-surface-secondary);
  }

  .agreement-detail__btn--ghost {
    background: transparent;
    color: var(--color-text-secondary);
  }

  .agreement-detail__btn--ghost:hover {
    color: var(--color-text);
    background: var(--color-surface-tertiary);
  }

  .agreement-detail__btn--danger {
    background: var(--color-error-50);
    color: var(--color-error-700);
    border-color: var(--color-error-200);
  }

  .agreement-detail__btn--danger:hover {
    background: var(--color-error-100);
  }
</style>

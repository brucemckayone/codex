<!--
  @component SettingsRevenueShare

  Studio settings → revenue-share tab (Codex-s80r6 — WP-7).

  Owner-facing UI for managing per-creator revenue-share agreements. Shows:
    1. Team Budget pie — platform fee + per-creator slices + org residual
    2. Per-creator cards — subscription + content_purchase rows, side-by-side
    3. Counter Proposals Received — accept / counter / decline action buttons
    4. Pending Proposals (Waiting on Creator) — withdraw button
    5. History — declined / terminated / superseded, collapsible

  Studio uses `ssr = false`, so all data is fetched client-side via remote
  queries. Role guard runs client-side (admin / owner only).

  All share % copy explicitly says "of post-platform [type] revenue" per
  the C1 math semantic (see project_revenue_share_decisions.md). Currency
  GBP throughout.
-->
<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import {
    type CreatorOrganizationAgreement,
    formatRevenueTypeLabel,
  } from '@codex/agreements';
  import { FEES } from '@codex/constants';
  import AgreementCard from '$lib/components/agreements/AgreementCard.svelte';
  import NegotiationThread from '$lib/components/agreements/NegotiationThread.svelte';
  import ProposeAgreementDialog from '$lib/components/agreements/ProposeAgreementDialog.svelte';
  import RevenueSplitPie from '$lib/components/agreements/RevenueSplitPie.svelte';
  import type { RevenueSplitSlice } from '$lib/components/agreements/types';
  import * as Dialog from '$lib/components/ui/Dialog';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import {
    acceptAgreement,
    counterAgreement,
    declineAgreement,
    getAgreementThread,
    listActiveAgreements,
    listPendingProposals,
    proposeAgreement,
    terminateAgreement,
    withdrawAgreement,
  } from '$lib/remote/agreements.remote';
  import { getOrgMembers } from '$lib/remote/org.remote';

  let { data } = $props();

  type RevenueType = 'subscription' | 'content_purchase';

  // ─── Role guard (client-side; studio is ssr=false) ────────────────────────

  $effect(() => {
    if (data.userRole !== 'admin' && data.userRole !== 'owner') {
      goto('/studio');
    }
  });

  const isAuthorized = $derived(
    data.userRole === 'admin' || data.userRole === 'owner'
  );
  const orgId = $derived(data.org.id);

  // ─── Data queries ─────────────────────────────────────────────────────────

  // Active agreements for the whole org (both revenue types).
  const agreementsQuery = $derived(
    isAuthorized ? listActiveAgreements({ organizationId: orgId }) : null
  );

  // Open + countered proposals on the org (both directions). Drives the
  // per-creator "Review counter" / "Pending — waiting on creator" surfaces
  // on each AgreementCard. Without this the card only knows about active
  // agreements and cannot reflect a pending negotiation round.
  const pendingProposalsQuery = $derived(
    isAuthorized ? listPendingProposals({ organizationId: orgId }) : null
  );

  // Org members — needed to render one card per team creator. We filter
  // out subscribers; everyone else may hold an agreement (per
  // assertActiveMember in the service: any active role qualifies).
  const membersQuery = $derived(
    isAuthorized ? getOrgMembers({ orgId, limit: 100 }) : null
  );

  // ─── Derived: per-creator + pending proposal maps ────────────────────────

  // Use the canonical row type from @codex/agreements directly. The earlier
  // conditional `infer` chain collapsed to `never` under Vite SSR module-load
  // cascades (see [[vite_ssr_module_load_cascade]]) when one of the
  // intermediate imports failed; the explicit import is robust to that.
  type ActiveAgreementRow = CreatorOrganizationAgreement;

  const activeAgreements = $derived(
    (agreementsQuery?.current?.items ?? []) as ActiveAgreementRow[]
  );

  const teamMembers = $derived(
    (membersQuery?.current?.items ?? [])
      .filter((m) => m.role !== 'subscriber')
      .map((m) => ({
        id: m.userId,
        name: m.name ?? m.email,
        avatarUrl: m.avatarUrl,
      }))
  );

  // The org-members remote caps at 100 rows per page (no pagination UI
  // here yet — TODO once orgs grow large enough). When we receive a full
  // 100-row page, surface an inline note so owners with bigger teams
  // aren't silently missing creators from the cards grid.
  const MEMBERS_PAGE_CAP = 100;
  const membersPageCapHit = $derived(
    (membersQuery?.current?.items?.length ?? 0) >= MEMBERS_PAGE_CAP
  );

  /**
   * Build a lookup of active agreements keyed on `${creatorId}:${revenueType}`.
   * Per the partial unique index, at most one active row per pair exists.
   */
  const activeByCreatorAndType = $derived.by(() => {
    const map = new Map<string, ActiveAgreementRow>();
    for (const a of activeAgreements) {
      map.set(`${a.creatorId}:${a.revenueType}`, a);
    }
    return map;
  });

  /**
   * Pending proposal lookup, same key shape. Built from the
   * `listPendingProposals` query — only open + countered rows.
   *
   * Shape conversion (AgreementProposal → PendingProposalSummary that
   * AgreementCard accepts): basis-points share is divided by 100 so the
   * card renders display-percent without re-doing the math; waitingOnRole
   * is the inverse of proposedByRole. The most recent round wins if
   * multiple pendings exist for a (creator, type) pair — the listPending
   * endpoint returns chronological asc, so iterating in order leaves the
   * last (highest round_number) in the map.
   */
  const pendingProposals = $derived(
    pendingProposalsQuery?.current?.items ?? []
  );
  const pendingByCreatorAndType = $derived.by(() => {
    type PendingSummary = {
      proposalId: string;
      sharePercent: number;
      termMonths: number | null;
      proposedByRole: 'owner' | 'creator';
      waitingOnRole: 'owner' | 'creator';
      roundNumber: number;
    };
    const map = new Map<string, PendingSummary>();
    for (const p of pendingProposals) {
      map.set(`${p.creatorId}:${p.revenueType}`, {
        proposalId: p.id,
        sharePercent: p.proposedCreatorSharePercent / 100,
        termMonths: p.proposedTermMonths ?? null,
        proposedByRole: p.proposedByRole as 'owner' | 'creator',
        waitingOnRole: p.proposedByRole === 'owner' ? 'creator' : 'owner',
        roundNumber: p.roundNumber,
      });
    }
    return map;
  });

  function getPendingFor(creatorId: string, revenueType: RevenueType) {
    return pendingByCreatorAndType.get(`${creatorId}:${revenueType}`) ?? null;
  }

  // ─── Pie data ────────────────────────────────────────────────────────────

  // Illustrative — real payouts read from feeConfigService per WP-4 (the
  // org may run a custom rate). Sourced here from @codex/constants so the
  // default-rate display can't drift from the SDK constant. Per Decision
  // Q2 the platform fee is the platform's operational lever, not
  // snapshotted on agreements.
  // TODO(codex-hrqz6 follow-up): pipe the live FeeConfigService rate to
  // this remote so per-org overrides also show through here.
  const platformFeeBp = FEES.PLATFORM_PERCENT;

  /**
   * Pie slices for the "Team Budget" overview. Each active creator on the
   * subscription pool gets one slice; the org residual is the remainder.
   * Content-purchase agreements are NOT pooled (Decision Q1 — creator's
   * own content), so they aren't shown in the team-budget pie.
   */
  const pieSlices = $derived.by((): RevenueSplitSlice[] => {
    const subscriptionRows = activeAgreements.filter(
      (a) => a.revenueType === 'subscription'
    );
    const memberById = new Map(teamMembers.map((m) => [m.id, m]));

    // Pool of available basis points after platform fee
    const availableBp = 10000 - platformFeeBp;
    const slices: RevenueSplitSlice[] = subscriptionRows.map((a, i) => {
      const share = 10000 - a.organizationFeePercentage;
      const member = memberById.get(a.creatorId);
      const colorTokens = [
        'var(--color-info-600)',
        'var(--color-success-600)',
        'var(--color-warning-600)',
        'var(--color-error-600)',
        'var(--color-interactive)',
      ];
      return {
        id: a.id,
        label: member?.name ?? 'Creator',
        percent: share,
        color: colorTokens[i % colorTokens.length] ?? 'var(--color-interactive)',
        locked: true,
        anonymous: false,
      };
    });

    // Org residual — whatever's left of the available pool
    const allocated = slices.reduce((sum, s) => sum + s.percent, 0);
    const orgResidual = Math.max(0, availableBp - allocated);
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

  // ─── Propose dialog state ────────────────────────────────────────────────

  let proposeDialogOpen = $state(false);
  let proposeCreatorId = $state<string | null>(null);
  let proposeCreatorName = $state('');
  let proposeRevenueType = $state<RevenueType>('subscription');
  let proposeMode = $state<'propose' | 'amend' | 'counter'>('propose');
  let proposeInitialShareBp = $state(3000);

  function openProposeDialog(
    creatorId: string,
    creatorName: string,
    revenueType: RevenueType,
    mode: 'propose' | 'amend' | 'counter',
    initialShareBp = 3000
  ) {
    proposeCreatorId = creatorId;
    proposeCreatorName = creatorName;
    proposeRevenueType = revenueType;
    proposeMode = mode;
    proposeInitialShareBp = initialShareBp;
    proposeDialogOpen = true;
  }

  function handleProposeOpenChange(next: boolean) {
    if (next === proposeDialogOpen) return;
    proposeDialogOpen = next;
  }

  async function handleProposeSubmit(input: {
    sharePercent: number;
    termMonths: number;
    note?: string;
  }) {
    if (!proposeCreatorId) {
      throw new Error('Creator not selected');
    }
    await proposeAgreement({
      organizationId: orgId,
      creatorId: proposeCreatorId,
      revenueType: proposeRevenueType,
      sharePercent: input.sharePercent,
      termMonths: input.termMonths,
      note: input.note,
    });
    toast.success(
      proposeMode === 'amend' ? 'Amendment sent' : 'Proposal sent',
      `${proposeCreatorName} will be notified.`
    );
    proposeDialogOpen = false;
    await Promise.all([agreementsQuery?.refresh(), pendingProposalsQuery?.refresh()]);
  }

  // ─── Thread dialog state ─────────────────────────────────────────────────

  let threadDialogOpen = $state(false);
  let threadCreatorId = $state<string | null>(null);
  let threadCreatorName = $state('');
  let threadRevenueType = $state<RevenueType>('subscription');

  const threadQuery = $derived(
    threadDialogOpen && threadCreatorId
      ? getAgreementThread({
          organizationId: orgId,
          creatorId: threadCreatorId,
          revenueType: threadRevenueType,
        })
      : null
  );

  function openThreadDialog(
    creatorId: string,
    creatorName: string,
    revenueType: RevenueType
  ) {
    threadCreatorId = creatorId;
    threadCreatorName = creatorName;
    threadRevenueType = revenueType;
    threadDialogOpen = true;
  }

  function handleThreadOpenChange(next: boolean) {
    if (next === threadDialogOpen) return;
    threadDialogOpen = next;
  }

  async function handleAccept(proposalId: string) {
    try {
      await acceptAgreement({ proposalId });
      toast.success('Agreement accepted', 'The new agreement is now active.');
      threadDialogOpen = false;
      await Promise.all([agreementsQuery?.refresh(), pendingProposalsQuery?.refresh()]);
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
      toast.info('Proposal declined', `The creator will be notified.`);
      threadDialogOpen = false;
      await Promise.all([agreementsQuery?.refresh(), pendingProposalsQuery?.refresh()]);
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
      toast.info('Proposal withdrawn');
      threadDialogOpen = false;
      await Promise.all([agreementsQuery?.refresh(), pendingProposalsQuery?.refresh()]);
    } catch (err) {
      toast.error(
        'Could not withdraw proposal',
        err instanceof Error ? err.message : 'Unknown error'
      );
    }
  }

  let counterDialogOpen = $state(false);
  let counterProposalId = $state<string | null>(null);
  let counterInitialShareBp = $state(3000);
  let counterCreatorName = $state('');
  let counterRevenueType = $state<RevenueType>('subscription');

  function handleCounter(proposalId: string) {
    // Open the propose dialog in "counter" mode — same form, but submit
    // calls counterAgreement instead of proposeAgreement.
    // We piggyback on the propose dialog by using a custom mode flag.
    const proposals = threadQuery?.current ?? [];
    const proposal = proposals.find((p) => p.id === proposalId);
    if (!proposal) return;
    counterProposalId = proposalId;
    counterInitialShareBp = proposal.proposedCreatorSharePercent;
    counterCreatorName = threadCreatorName;
    counterRevenueType = threadRevenueType;
    threadDialogOpen = false;
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
    if (!counterProposalId) {
      throw new Error('No proposal selected');
    }
    await counterAgreement({
      proposalId: counterProposalId,
      sharePercent: input.sharePercent,
      termMonths: input.termMonths,
      note: input.note,
    });
    toast.success('Counter sent', `${counterCreatorName} will be notified.`);
    counterDialogOpen = false;
    await Promise.all([agreementsQuery?.refresh(), pendingProposalsQuery?.refresh()]);
  }

  // ─── Terminate handler ────────────────────────────────────────────────────

  async function handleTerminate(agreementId: string) {
    try {
      await terminateAgreement({ agreementId });
      toast.success('Agreement terminated');
      await Promise.all([agreementsQuery?.refresh(), pendingProposalsQuery?.refresh()]);
    } catch (err) {
      toast.error(
        'Could not terminate agreement',
        err instanceof Error ? err.message : 'Unknown error'
      );
    }
  }

  // ─── Helpers for per-card prop wiring ────────────────────────────────────

  function getAgreementFor(creatorId: string, revenueType: RevenueType) {
    return activeByCreatorAndType.get(`${creatorId}:${revenueType}`) ?? null;
  }

  function getCreatorName(creatorId: string): string {
    return teamMembers.find((m) => m.id === creatorId)?.name ?? 'Creator';
  }
</script>

<svelte:head>
  <title>Revenue share | {data.org.name} Studio</title>
</svelte:head>

{#if !isAuthorized}
  <!-- Redirecting via $effect -->
{:else}
  <div class="revenue-share-page">
    <header class="revenue-share-page__intro">
      <h2 class="revenue-share-page__heading">Team revenue share</h2>
      <p class="revenue-share-page__lede">
        Negotiate per-creator splits on subscription and content-purchase revenue.
        All shares are calculated against <strong>post-platform revenue</strong> —
        the platform fee is taken first, and the share applies to what remains.
      </p>
    </header>

    <!-- ─── Section 1: Team Budget pie ─────────────────────────────────── -->
    <section class="revenue-share-page__section" aria-labelledby="team-budget-heading">
      <h3 id="team-budget-heading" class="revenue-share-page__section-heading">
        Team budget — subscription revenue
      </h3>
      <p class="revenue-share-page__section-lede">
        How subscription revenue is currently split across the platform fee,
        active creator agreements, and the org residual.
      </p>
      {#if agreementsQuery?.loading}
        <Skeleton width="100%" height="var(--space-16)" />
      {:else}
        <RevenueSplitPie
          mode="owner"
          platformFeePercent={platformFeeBp}
          slices={pieSlices}
          readOnly
        />
      {/if}
    </section>

    <!-- ─── Section 2: Per-Creator Cards ───────────────────────────────── -->
    <section class="revenue-share-page__section" aria-labelledby="creators-heading">
      <h3 id="creators-heading" class="revenue-share-page__section-heading">
        Creators
      </h3>
      {#if membersQuery?.loading || agreementsQuery?.loading}
        <div class="revenue-share-page__cards-grid">
          {#each Array(3) as _, i (i)}
            <Skeleton width="100%" height="var(--space-32)" />
          {/each}
        </div>
      {:else if teamMembers.length === 0}
        <p class="revenue-share-page__empty">
          No team creators yet. Invite members from the
          <a href="/studio/team">team page</a> to start a revenue-share agreement.
        </p>
      {:else}
        {#if membersPageCapHit}
          <p
            class="revenue-share-page__cap-warning"
            role="status"
            aria-live="polite"
          >
            Showing the first {MEMBERS_PAGE_CAP} team members. Pagination
            support is on the roadmap — until then, manage agreements for
            additional creators via direct propose links from the
            <a href="/studio/team">team page</a>.
          </p>
        {/if}
        <div class="revenue-share-page__cards-grid">
          {#each teamMembers as creator (creator.id)}
            <AgreementCard
              {creator}
              subscriptionAgreement={getAgreementFor(creator.id, 'subscription')}
              contentPurchaseAgreement={getAgreementFor(creator.id, 'content_purchase')}
              pendingSubscriptionProposal={getPendingFor(creator.id, 'subscription')}
              pendingContentPurchaseProposal={getPendingFor(
                creator.id,
                'content_purchase'
              )}
              onPropose={(revType) =>
                openProposeDialog(creator.id, creator.name, revType, 'propose')}
              onAmend={(revType, currentShare) =>
                openProposeDialog(
                  creator.id,
                  creator.name,
                  revType,
                  'amend',
                  currentShare
                )}
              onViewThread={(revType) =>
                openThreadDialog(creator.id, creator.name, revType)}
            />
          {/each}
        </div>
      {/if}
    </section>

    <!-- ─── Section 3: Active agreements quick-actions ─────────────────── -->
    {#if activeAgreements.length > 0}
      <section
        class="revenue-share-page__section"
        aria-labelledby="active-agreements-heading"
      >
        <h3 id="active-agreements-heading" class="revenue-share-page__section-heading">
          Active agreements
        </h3>
        <p class="revenue-share-page__section-lede">
          Terminate or review the full negotiation thread for each active
          agreement.
        </p>
        <ul class="revenue-share-page__active-list">
          {#each activeAgreements as agreement (agreement.id)}
            {@const creatorName = getCreatorName(agreement.creatorId)}
            {@const sharePct = (10000 - agreement.organizationFeePercentage) / 100}
            {@const sharePctDisplay = Number.isInteger(sharePct)
              ? `${sharePct}%`
              : `${sharePct.toFixed(1)}%`}
            {@const revLabel = formatRevenueTypeLabel(
              agreement.revenueType as RevenueType
            )}
            <li class="revenue-share-page__active-item">
              <div class="revenue-share-page__active-info">
                <span class="revenue-share-page__active-creator">{creatorName}</span>
                <span class="revenue-share-page__active-type">
                  {revLabel}
                </span>
                <span class="revenue-share-page__active-share">
                  {sharePctDisplay}
                  <span class="revenue-share-page__active-share-hint">
                    of post-platform {revLabel} revenue
                  </span>
                </span>
              </div>
              <div class="revenue-share-page__active-actions">
                <button
                  type="button"
                  class="revenue-share-page__btn revenue-share-page__btn--ghost"
                  onclick={() =>
                    openThreadDialog(
                      agreement.creatorId,
                      creatorName,
                      agreement.revenueType as RevenueType
                    )}
                >
                  View thread
                </button>
                <button
                  type="button"
                  class="revenue-share-page__btn revenue-share-page__btn--danger"
                  onclick={() => handleTerminate(agreement.id)}
                >
                  Terminate
                </button>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>

  <!-- ─── Dialogs (browser-guarded — DialogForm uses Melt UI portal) ──── -->
  {#if browser}
    <ProposeAgreementDialog
      open={proposeDialogOpen}
      onOpenChange={handleProposeOpenChange}
      creatorName={proposeCreatorName}
      revenueType={proposeRevenueType}
      initialShareBp={proposeInitialShareBp}
      mode={proposeMode}
      onSubmit={handleProposeSubmit}
    />

    <ProposeAgreementDialog
      open={counterDialogOpen}
      onOpenChange={handleCounterOpenChange}
      creatorName={counterCreatorName}
      revenueType={counterRevenueType}
      initialShareBp={counterInitialShareBp}
      mode="counter"
      onSubmit={handleCounterSubmit}
    />

    <!-- ─── Thread review dialog ──────────────────────────────────────── -->
    <Dialog.Root open={threadDialogOpen} onOpenChange={handleThreadOpenChange}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>
            Negotiation with {threadCreatorName}
          </Dialog.Title>
          <Dialog.Description>
            {threadRevenueType === 'subscription'
              ? 'Subscription'
              : 'Content-purchase'} agreement thread
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          {#if threadQuery?.loading}
            <Skeleton width="100%" height="var(--space-32)" />
          {:else if threadQuery?.current}
            {@const thread = threadQuery.current}
            {@const latest = thread.at(-1)}
            {@const latestIsOpen = latest?.status === 'open'}
            {@const ownerProposedLatest = latest?.proposedByRole === 'owner'}
            <NegotiationThread
              proposals={thread}
              revenueType={threadRevenueType}
              roleLabels={{ owner: 'You', creator: threadCreatorName }}
              onAccept={latestIsOpen && !ownerProposedLatest ? handleAccept : undefined}
              onCounter={latestIsOpen && !ownerProposedLatest ? handleCounter : undefined}
              onDecline={latestIsOpen && !ownerProposedLatest ? handleDecline : undefined}
              onWithdraw={latestIsOpen && ownerProposedLatest ? handleWithdraw : undefined}
            />
          {/if}
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  {/if}
{/if}

<style>
  .revenue-share-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    max-width: 1200px;
    container-type: inline-size;
  }

  .revenue-share-page__intro {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .revenue-share-page__heading {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .revenue-share-page__lede {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    max-width: 60ch;
    line-height: var(--leading-relaxed);
  }

  .revenue-share-page__lede strong {
    color: var(--color-text);
  }

  .revenue-share-page__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-5);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
  }

  .revenue-share-page__section-heading {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .revenue-share-page__section-lede {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    max-width: 60ch;
  }

  .revenue-share-page__cards-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    margin-top: var(--space-2);
  }

  @container (min-width: 56rem) {
    .revenue-share-page__cards-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .revenue-share-page__empty {
    margin: 0;
    padding: var(--space-4);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .revenue-share-page__empty a {
    color: var(--color-interactive);
    text-decoration: underline;
  }

  .revenue-share-page__cap-warning {
    margin: 0 0 var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--color-warning-50);
    border: var(--border-width) var(--border-style) var(--color-warning-200);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--color-warning-700);
  }

  .revenue-share-page__cap-warning a {
    color: inherit;
    text-decoration: underline;
  }

  .revenue-share-page__active-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .revenue-share-page__active-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
  }

  .revenue-share-page__active-info {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
    min-width: 0;
    flex: 1;
  }

  .revenue-share-page__active-creator {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .revenue-share-page__active-type {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .revenue-share-page__active-share {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .revenue-share-page__active-share-hint {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .revenue-share-page__active-actions {
    display: flex;
    gap: var(--space-2);
  }

  .revenue-share-page__btn {
    display: inline-flex;
    align-items: center;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) transparent;
    cursor: pointer;
    background: transparent;
    color: var(--color-text-secondary);
    transition: var(--transition-colors);
  }

  .revenue-share-page__btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .revenue-share-page__btn--ghost:hover {
    color: var(--color-text);
    background: var(--color-surface);
  }

  .revenue-share-page__btn--danger {
    color: var(--color-error-700);
    border-color: var(--color-error-200);
  }

  .revenue-share-page__btn--danger:hover {
    background: var(--color-error-50);
  }
</style>

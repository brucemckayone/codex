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
  import Avatar from '$lib/components/ui/Avatar/Avatar.svelte';
  import AvatarImage from '$lib/components/ui/Avatar/AvatarImage.svelte';
  import AvatarFallback from '$lib/components/ui/Avatar/AvatarFallback.svelte';
  import NegotiationThread from '$lib/components/agreements/NegotiationThread.svelte';
  import ProposeAgreementDialog from '$lib/components/agreements/ProposeAgreementDialog.svelte';
  import RevenueSplitPie from '$lib/components/agreements/RevenueSplitPie.svelte';
  import type { RevenueSplitSlice } from '$lib/components/agreements/types';
  import * as m from '$paraglide/messages';
  import { Alert, Button, PageHeader } from '$lib/components/ui';
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
  import { logger } from '$lib/observability';

  let { data } = $props();

  type RevenueType = 'subscription' | 'content_purchase';

  // ─── Role guard (client-side; studio is ssr=false) ────────────────────────
  //
  // Wait for `data.userRole` to be populated before deciding whether to
  // redirect. With `ssr=false`, the layout server load runs AFTER initial
  // hydration — so on first render `data.userRole` is `undefined`, and a
  // naïve `userRole !== 'admin' && userRole !== 'owner'` check fires the
  // redirect before the role has been resolved, blocking authorised users
  // from ever seeing the page.

  $effect(() => {
    if (
      data.userRole !== undefined &&
      data.userRole !== 'admin' &&
      data.userRole !== 'owner'
    ) {
      goto('/studio');
    }
  });

  const isAuthorized = $derived(
    data.userRole === 'admin' || data.userRole === 'owner'
  );
  // Optional chain: `data.org` is undefined on first render under ssr=false
  // (server-load hasn't yet streamed); throwing here breaks all downstream
  // deriveds and the page never mounts (heading invisible to E2E).
  const orgId = $derived(data.org?.id);

  // ─── Data queries ─────────────────────────────────────────────────────────

  // Active agreements for the whole org (both revenue types).
  const agreementsQuery = $derived(
    isAuthorized ? listActiveAgreements({ organizationId: orgId }) : null
  );

  // Open proposals for the whole org. Both owner-proposed AND
  // creator-countered rows — the AgreementCard derives the row state
  // from the proposal's `proposedByRole` to label the CTA correctly
  // ("View thread" vs "Review counter").
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
   * Build a lookup of pending proposals (open status, either side) keyed on
   * `${creatorId}:${revenueType}`. AgreementCard reads this to surface
   * "Review counter" vs "View thread" CTAs and the awaiting-action banners.
   * At most one open proposal can exist per (creatorId, revenueType) — the
   * service supersedes siblings inside the accept transaction.
   */
  const pendingByCreatorAndType = $derived.by(() => {
    const items = pendingProposalsQuery?.current?.items ?? [];
    const map = new Map<
      string,
      {
        // `proposalId` was missing here while AgreementCard's
        // PendingProposalSummary requires it — two pre-existing svelte-check
        // errors on this file, fixed rather than stepped around.
        proposalId: string;
        sharePercent: number;
        termMonths: number | null;
        proposedByRole: 'owner' | 'creator';
        waitingOnRole: 'owner' | 'creator';
        roundNumber: number;
      }
    >();
    for (const p of items) {
      const proposedByRole = (p.proposedByRole === 'creator'
        ? 'creator'
        : 'owner') as 'owner' | 'creator';
      const waitingOnRole: 'owner' | 'creator' =
        proposedByRole === 'owner' ? 'creator' : 'owner';
      map.set(`${p.creatorId}:${p.revenueType}`, {
        proposalId: p.id,
        sharePercent: p.proposedCreatorSharePercent,
        termMonths: p.proposedTermMonths,
        proposedByRole,
        waitingOnRole,
        roundNumber: p.roundNumber,
      });
    }
    return map;
  });

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
      proposeMode === 'amend'
        ? m.monetisation_revshare_amendment_sent()
        : m.monetisation_revshare_proposal_sent(),
      m.monetisation_revshare_will_be_notified({ name: proposeCreatorName })
    );
    proposeDialogOpen = false;
    await Promise.all([
      agreementsQuery?.refresh(),
      pendingProposalsQuery?.refresh(),
    ]);
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
      toast.success(
        m.monetisation_revshare_accepted(),
        m.monetisation_revshare_accepted_detail()
      );
      threadDialogOpen = false;
      await Promise.all([
      agreementsQuery?.refresh(),
      pendingProposalsQuery?.refresh(),
    ]);
    } catch (err) {
      toast.error(
        m.monetisation_revshare_accept_error(),
        err instanceof Error ? err.message : m.monetisation_revshare_unknown_error()
      );
    }
  }

  async function handleDecline(proposalId: string) {
    try {
      await declineAgreement({ proposalId });
      toast.info(
        m.monetisation_revshare_declined(),
        m.monetisation_revshare_declined_detail()
      );
      threadDialogOpen = false;
      await Promise.all([
      agreementsQuery?.refresh(),
      pendingProposalsQuery?.refresh(),
    ]);
    } catch (err) {
      toast.error(
        m.monetisation_revshare_decline_error(),
        err instanceof Error ? err.message : m.monetisation_revshare_unknown_error()
      );
    }
  }

  async function handleWithdraw(proposalId: string) {
    try {
      await withdrawAgreement({ proposalId });
      toast.info(m.monetisation_revshare_withdrawn());
      threadDialogOpen = false;
      await Promise.all([
      agreementsQuery?.refresh(),
      pendingProposalsQuery?.refresh(),
    ]);
    } catch (err) {
      toast.error(
        m.monetisation_revshare_withdraw_error(),
        err instanceof Error ? err.message : m.monetisation_revshare_unknown_error()
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
    toast.success(
      m.monetisation_revshare_counter_sent(),
      m.monetisation_revshare_will_be_notified({ name: counterCreatorName })
    );
    counterDialogOpen = false;
    await Promise.all([
      agreementsQuery?.refresh(),
      pendingProposalsQuery?.refresh(),
    ]);
  }

  // ─── Terminate (confirmed) ────────────────────────────────────────────────
  //
  // Terminating ends a LIVE financial commitment governing how a creator's
  // earnings are split. It used to fire on one click with no confirmation of any
  // kind, which WCAG 3.3.4 (Error Prevention — Legal, Financial, Data) does not
  // allow: a financial submission has to be reversible, checked or confirmed,
  // and this is none of the three. It also stayed enabled through the whole
  // await, so a second click on a slow connection fired a second terminate.
  // Both are handled by routing it through a confirm dialog whose action is a
  // `ui/Button` (disabled + spinner + aria-busy while it runs) — the same shape
  // the pricing-FAQ delete confirmation uses.

  let terminateOpen = $state(false);
  let terminateLoading = $state(false);
  let terminateTarget = $state<{
    id: string;
    creatorName: string;
    revenueLabel: string;
  } | null>(null);

  function askTerminate(
    agreementId: string,
    creatorName: string,
    revenueLabel: string
  ) {
    terminateTarget = { id: agreementId, creatorName, revenueLabel };
    terminateOpen = true;
  }

  async function confirmTerminate() {
    if (!terminateTarget) return;
    terminateLoading = true;
    try {
      await terminateAgreement({ agreementId: terminateTarget.id });
      toast.success(m.monetisation_revshare_terminated());
      terminateOpen = false;
      terminateTarget = null;
      await Promise.all([
        agreementsQuery?.refresh(),
        pendingProposalsQuery?.refresh(),
      ]);
    } catch (err) {
      // Fixed copy in the toast; the real text goes to the logger, which
      // redacts. A terminate failure is a money-path failure.
      toast.error(
        m.monetisation_revshare_terminate_error(),
        m.monetisation_revshare_unknown_error()
      );
      logger.error('studio/revenue-share: terminate failed', {
        organizationId: orgId,
        reason: err instanceof Error ? err.message : String(err),
      });
    } finally {
      terminateLoading = false;
    }
  }

  // ─── Helpers for per-card prop wiring ────────────────────────────────────

  function getAgreementFor(creatorId: string, revenueType: RevenueType) {
    return activeByCreatorAndType.get(`${creatorId}:${revenueType}`) ?? null;
  }

  function getPendingFor(creatorId: string, revenueType: RevenueType) {
    return pendingByCreatorAndType.get(`${creatorId}:${revenueType}`) ?? null;
  }

  function getCreatorName(creatorId: string): string {
    return teamMembers.find((m) => m.id === creatorId)?.name ?? 'Creator';
  }

  // ─── Roster shape ─────────────────────────────────────────────────────────
  //
  // One flat "Creators" grid of 16 members × 2 revenue panels rendered 3044px of
  // identical cards, so nothing on the page was a decision. Group by what the
  // OWNER has to do about each creator, and only render the groups that have
  // anyone in them.

  /** Search appears past this many creators — below it, scanning is faster. */
  const SEARCH_THRESHOLD = 8;

  let creatorSearch = $state('');

  const filteredMembers = $derived.by(() => {
    const q = creatorSearch.trim().toLowerCase();
    if (!q) return teamMembers;
    return teamMembers.filter((c) => c.name.toLowerCase().includes(q));
  });

  type RosterGroup = {
    id: 'attention' | 'agreed' | 'waiting' | 'none';
    heading: string;
    lede?: string;
    members: typeof teamMembers;
  };

  const roster = $derived.by((): RosterGroup[] => {
    const attention: typeof teamMembers = [];
    const agreed: typeof teamMembers = [];
    const waiting: typeof teamMembers = [];
    const none: typeof teamMembers = [];

    for (const creator of filteredMembers) {
      const pendings = [
        getPendingFor(creator.id, 'subscription'),
        getPendingFor(creator.id, 'content_purchase'),
      ];
      const actives = [
        getAgreementFor(creator.id, 'subscription'),
        getAgreementFor(creator.id, 'content_purchase'),
      ];

      // Owner must act: a counter is sitting with them.
      if (pendings.some((p) => p && p.waitingOnRole === 'owner')) {
        attention.push(creator);
      } else if (actives.some((a) => a)) {
        agreed.push(creator);
      } else if (pendings.some((p) => p)) {
        waiting.push(creator);
      } else {
        none.push(creator);
      }
    }

    return [
      {
        id: 'attention' as const,
        heading: m.monetisation_revshare_group_attention(),
        lede: m.monetisation_revshare_group_attention_lede(),
        members: attention,
      },
      { id: 'agreed' as const, heading: m.monetisation_revshare_group_agreed(), members: agreed },
      { id: 'waiting' as const, heading: m.monetisation_revshare_group_waiting(), members: waiting },
      { id: 'none' as const, heading: m.monetisation_revshare_group_none(), members: none },
    ].filter((g) => g.members.length > 0);
  });

  function initialsOf(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function groupCount(n: number): string {
    return n === 1
      ? m.monetisation_revshare_count_one()
      : m.monetisation_revshare_count({ count: String(n) });
  }
</script>

<svelte:head>
  <title>{m.monetisation_revenue_share_title()} | {data.org?.name ?? ''} Studio</title>
</svelte:head>

{#if !isAuthorized}
  <!-- Redirecting via $effect -->
{:else}
  <div class="revenue-share-page">
    <!-- No kicker: it was a back-link to /studio/monetisation, i.e. the tab
         strip 24px above this heading. See the hub layout's masthead contract. -->
    <PageHeader
      variant="compact"
      title={m.monetisation_revenue_share_title()}
      description={m.monetisation_revenue_share_description()}
    />

    <!-- ─── Section 1: Team Budget pie ─────────────────────────────────── -->
    <section class="revenue-share-page__section" aria-labelledby="team-budget-heading">
      <h3 id="team-budget-heading" class="revenue-share-page__section-heading">
        {m.monetisation_revshare_budget_title()}
      </h3>
      <p class="revenue-share-page__section-lede">
        {m.monetisation_revshare_budget_lede()}
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

    <!-- ─── Section 2: Creator roster, grouped by what the owner must do ── -->
    <section class="revenue-share-page__section" aria-labelledby="creators-heading">
      <div class="revenue-share-page__section-head">
        <h3 id="creators-heading" class="revenue-share-page__section-heading">
          {m.monetisation_revshare_creators_title()}
          {#if !membersQuery?.loading && teamMembers.length > 0}
            <span class="revenue-share-page__count">
              {groupCount(teamMembers.length)}
            </span>
          {/if}
        </h3>
        {#if !membersQuery?.loading && teamMembers.length > SEARCH_THRESHOLD}
          <!-- Appears only past 8 creators; below that, scanning beats typing. -->
          <input
            class="revenue-share-page__search"
            type="search"
            bind:value={creatorSearch}
            placeholder={m.monetisation_revshare_search_placeholder()}
            aria-label={m.monetisation_revshare_search()}
          />
        {/if}
      </div>

      <!-- Said ONCE, at section level. It used to be repeated inside all 32
           no-agreement card panels. -->
      <p class="revenue-share-page__section-lede">
        {m.monetisation_revshare_default_split()}
      </p>

      {#if membersQuery?.loading || agreementsQuery?.loading}
        <div class="revenue-share-page__cards-grid">
          {#each Array(3) as _, i (i)}
            <Skeleton width="100%" height="var(--space-32)" />
          {/each}
        </div>
      {:else if teamMembers.length === 0}
        <p class="revenue-share-page__empty">
          {m.monetisation_revshare_empty_team()}
          <a href="/studio/team">{m.team_meta_members()}</a>
        </p>
      {:else}
        {#if membersPageCapHit}
          <p
            class="revenue-share-page__cap-warning"
            role="status"
            aria-live="polite"
          >
            {m.monetisation_revshare_cap_warning({ cap: String(MEMBERS_PAGE_CAP) })}
            <a href="/studio/team">{m.team_meta_members()}</a>
          </p>
        {/if}

        {#if roster.length === 0}
          <p class="revenue-share-page__empty">
            {m.monetisation_revshare_search_empty({ query: creatorSearch })}
          </p>
        {/if}

        {#each roster as group (group.id)}
          <div class="revenue-share-page__group">
            <div class="revenue-share-page__group-head">
              <h4 class="revenue-share-page__group-heading">
                {group.heading}
                <span class="revenue-share-page__count">
                  {groupCount(group.members.length)}
                </span>
              </h4>
              {#if group.lede}
                <p class="revenue-share-page__group-lede">{group.lede}</p>
              {/if}
            </div>
            {#if group.id === 'none'}
              <!-- Compact roster, not a full card each. of-blood-and-bones has
                   16 members and zero agreements, so this group IS the page: as
                   two-panel cards it measured 2758px of identical markup with 32
                   "Propose agreement" buttons. A creator with nothing happening
                   needs a NAME and a way to start — not a card restating "No
                   agreement" four times. The groups that carry real state keep
                   the full card below. -->
              <ul class="revenue-share-page__roster">
                {#each group.members as creator (creator.id)}
                  <li class="revenue-share-page__roster-row">
                    <span class="revenue-share-page__roster-identity">
                      <Avatar class="roster-avatar">
                        {#if creator.avatarUrl}
                          <AvatarImage src={creator.avatarUrl} alt="" />
                        {/if}
                        <AvatarFallback>{initialsOf(creator.name)}</AvatarFallback>
                      </Avatar>
                      <span class="revenue-share-page__roster-name">{creator.name}</span>
                    </span>
                    <span class="revenue-share-page__roster-actions">
                      <span class="revenue-share-page__roster-prefix">
                        {m.monetisation_revshare_propose_prefix()}
                      </span>
                      <button
                        type="button"
                        class="revenue-share-page__btn revenue-share-page__btn--ghost"
                        aria-label={m.monetisation_revshare_propose_aria({
                          type: m.monetisation_revshare_type_subscription(),
                          name: creator.name,
                        })}
                        onclick={() =>
                          openProposeDialog(creator.id, creator.name, 'subscription', 'propose')}
                      >
                        {m.monetisation_revshare_type_subscription()}
                      </button>
                      <button
                        type="button"
                        class="revenue-share-page__btn revenue-share-page__btn--ghost"
                        aria-label={m.monetisation_revshare_propose_aria({
                          type: m.monetisation_revshare_type_content(),
                          name: creator.name,
                        })}
                        onclick={() =>
                          openProposeDialog(creator.id, creator.name, 'content_purchase', 'propose')}
                      >
                        {m.monetisation_revshare_type_content()}
                      </button>
                    </span>
                  </li>
                {/each}
              </ul>
            {:else}
            <div class="revenue-share-page__cards-grid">
              {#each group.members as creator (creator.id)}
                <AgreementCard
                  {creator}
                  headingLevel={5}
                  subscriptionAgreement={getAgreementFor(creator.id, 'subscription')}
                  contentPurchaseAgreement={getAgreementFor(creator.id, 'content_purchase')}
                  pendingSubscriptionProposal={getPendingFor(creator.id, 'subscription')}
                  pendingContentPurchaseProposal={getPendingFor(creator.id, 'content_purchase')}
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
          </div>
        {/each}
      {/if}
    </section>

    <!-- ─── Section 3: Active agreements quick-actions ─────────────────── -->
    {#if activeAgreements.length > 0}
      <section
        class="revenue-share-page__section"
        aria-labelledby="active-agreements-heading"
      >
        <h3 id="active-agreements-heading" class="revenue-share-page__section-heading">
          {m.monetisation_revshare_active_title()}
        </h3>
        <p class="revenue-share-page__section-lede">
          {m.monetisation_revshare_active_lede()}
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
                    {m.monetisation_revshare_share_hint({ type: revLabel })}
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
                  {m.monetisation_revshare_view_thread()}
                </button>
                <button
                  type="button"
                  class="revenue-share-page__btn revenue-share-page__btn--danger"
                  onclick={() => askTerminate(agreement.id, creatorName, revLabel)}
                >
                  {m.monetisation_revshare_terminate()}
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

    <!-- ─── Terminate confirmation ────────────────────────────────────── -->
    <Dialog.Root bind:open={terminateOpen}>
      <Dialog.Content size="sm">
        <Dialog.Header>
          <Dialog.Title>{m.monetisation_revshare_terminate_title()}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <p class="revenue-share-page__confirm">
            {m.monetisation_revshare_terminate_confirm()}
          </p>
          {#if terminateTarget}
            <!-- Echo the target, so there is something to REVIEW: which
                 creator, and which revenue stream. -->
            <Alert variant="info">
              {m.monetisation_revshare_terminate_target({
                name: terminateTarget.creatorName,
                type: terminateTarget.revenueLabel,
              })}
            </Alert>
          {/if}
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            variant="ghost"
            onclick={() => {
              terminateOpen = false;
              terminateTarget = null;
            }}
            disabled={terminateLoading}
          >
            {m.common_cancel()}
          </Button>
          <Button
            variant="destructive"
            onclick={confirmTerminate}
            loading={terminateLoading}
          >
            {m.monetisation_revshare_terminate()}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>

    <!-- ─── Thread review dialog ──────────────────────────────────────── -->
    <Dialog.Root open={threadDialogOpen} onOpenChange={handleThreadOpenChange}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>
            {m.monetisation_revshare_negotiation_with({ name: threadCreatorName })}
          </Dialog.Title>
          <Dialog.Description>
            {threadRevenueType === 'subscription'
              ? m.monetisation_revshare_thread_subscription()
              : m.monetisation_revshare_thread_content()}
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
              roleLabels={{ owner: m.monetisation_revshare_you(), creator: threadCreatorName }}
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
    container-type: inline-size;
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
    max-width: var(--measure-lede);
  }

  .revenue-share-page__section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .revenue-share-page__count {
    margin-inline-start: var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-normal);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .revenue-share-page__search {
    min-width: 0;
    /* A `ch` measure, not a spacing step — the scale stops at --space-32 (128px),
       too narrow for a name field, and inventing a token for one input is worse
       than sizing it in the unit that tracks its own text. */
    inline-size: min(100%, 26ch);
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
  }

  .revenue-share-page__search:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* Each group is its own band so a 16-creator roster has a shape. */
  .revenue-share-page__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-block-start: var(--space-4);
    border-block-start: var(--border-width) var(--border-style) var(--color-border-subtle);
  }

  .revenue-share-page__group:first-of-type {
    padding-block-start: 0;
    border-block-start: none;
  }

  .revenue-share-page__group-head {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .revenue-share-page__group-heading {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    text-transform: var(--text-transform-label, uppercase);
    letter-spacing: var(--tracking-wider);
  }

  .revenue-share-page__group-lede {
    margin: 0;
    max-width: var(--measure-lede);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .revenue-share-page__roster {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  /* name · actions · slack. NOT `justify-content: space-between`, which is the
     mechanism behind every label→control gap this pass removed — here it parked
     the propose actions ~1300px from the creator they belong to. A bounded name
     track keeps the action column CONSISTENT down the list (so it scans like a
     table) while starting it right after the longest expected name. */
  .revenue-share-page__roster-row {
    display: grid;
    grid-template-columns: minmax(0, 34ch) auto 1fr;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
  }

  @media (--below-sm) {
    .revenue-share-page__roster-row {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .revenue-share-page__roster-row:hover {
    background: var(--color-surface-secondary);
  }

  .revenue-share-page__roster-identity {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  :global(.roster-avatar) {
    width: var(--space-8) !important;
    height: var(--space-8) !important;
    flex-shrink: 0 !important;
  }

  .revenue-share-page__roster-name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    min-width: 0;
    /* Wrap rather than truncate: a person's name is not a place to put an
       ellipsis, and only the longest few need a second line. */
    text-wrap: pretty;
  }

  .revenue-share-page__roster-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
  }

  /* `--color-text-secondary`, not `--color-text-muted`: muted never clears
     4.5:1 in any org × theme (2.52:1 on the platform light theme) and this
     label renders 16 times on of-blood-and-bones at 12px. */
  .revenue-share-page__roster-prefix {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    margin-inline-end: var(--space-1);
  }

  .revenue-share-page__confirm {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
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

  /* --color-status-* rather than the raw --color-warning-* / --color-error-*
     steps: those are fixed light-mode sRGB with no [data-theme] remap, so the
     -50 tints invert into the brightest thing on a dark page and the -700
     foregrounds never lighten. See styles/themes/status.css. The four
     --color-*-600 strings near the top of this file are RevenueSplitPie slice
     colours — a chart palette, deliberately left alone. */
  .revenue-share-page__cap-warning {
    margin: 0 0 var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--color-status-warning-surface);
    border: var(--border-width) var(--border-style) var(--color-status-warning-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--color-status-warning-text);
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
    text-transform: var(--text-transform-label, uppercase);
    letter-spacing: var(--tracking-wider);
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
    color: var(--color-status-error-text);
    border-color: var(--color-status-error-border);
  }

  .revenue-share-page__btn--danger:hover {
    background: var(--color-status-error-surface);
  }
</style>

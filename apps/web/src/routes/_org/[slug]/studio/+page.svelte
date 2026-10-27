<!--
  @component StudioDashboard

  Editorial studio dashboard. Production-grade creator-first surface built
  to the house style established by ContentForm (numbered ordinals,
  backdrop-filter command bar, brand-tinted OKLCH accents, focus rail).

  Layout (from top):
    01  Sticky DashboardCommandBar        — org identity + today narrative + actions
    02  TodayStat hero + inline stat row  — feature stat (revenue if admin, else content)
                                             with 14-point sparkline, supporting tiles
    03  Two-column: FocusRail + ActivityStream
                                           — what needs you / what just happened

  Role gating:
   - Admin/owner see revenue + customers stats and the revenue-feature tile
   - All roles see content + views (read only for admin/owner: the figures
     route requires org management, so other roles see "–")
   - Admin-only actions (Create, branding focus) hidden for members
   - The activity stream is admin/owner only (its route requires org
     management); other roles get the focus rail across the row
   - Agreement nudges are the owner's only: every agreement change is
     (Codex-2hxff.20 AGR-14)

  All remote function calls and request shapes are preserved —
  getDashboardStats(orgId) + getActivityFeed({ organizationId, limit }).
-->
<script lang="ts">
  import DashboardCommandBar from '$lib/components/studio/dashboard/DashboardCommandBar.svelte';
  import TodayStat from '$lib/components/studio/dashboard/TodayStat.svelte';
  import FocusRail from '$lib/components/studio/dashboard/FocusRail.svelte';
  import ActivityStream from '$lib/components/studio/dashboard/ActivityStream.svelte';
  import type { FocusItem } from '$lib/components/studio/dashboard/FocusRail.svelte';
  import { buildOwnerAgreementFocusItems } from '$lib/components/studio/dashboard/agreement-focus-items';
  import { revenueSparkline } from '$lib/components/studio/dashboard/dashboard-figures';
  import RevenueKindsLine from '$lib/components/studio/analytics/RevenueKindsLine.svelte';
  import LoadFailedAlert from '$lib/components/studio/LoadFailedAlert.svelte';
  import {
    PlusIcon,
    EditIcon,
    UsersIcon,
    FileTextIcon,
  } from '$lib/components/ui/Icon';
  import { dismiss, isDismissed } from '$lib/collections/dismissals';
  import { formatPrice } from '$lib/utils/format';
  import { connectQueryState } from '$lib/utils/connect-readiness';
  import type { QueryResult } from '$lib/remote/query-result';
  import { getDashboardStats, getActivityFeed } from '$lib/remote/admin.remote';
  import {
    listActiveAgreements,
    listPendingProposals,
  } from '$lib/remote/agreements.remote';
  import { getOrgMembers } from '$lib/remote/org.remote';
  import * as m from '$paraglide/messages';

  let { data } = $props();

  const isAdmin = $derived(
    data.userRole === 'admin' || data.userRole === 'owner'
  );
  // Every agreement change is the owner's alone (agreements.md §Who sees
  // what; Codex-2hxff.20 AGR-14), so only the owner gets the nudges to make
  // one. An admin would be sent to a page that refuses them.
  const isOwner = $derived(data.userRole === 'owner');

  // The figures route requires org management: a creator or member would get
  // a guaranteed 403, which used to come back as "0 content". Their tiles
  // read "–" instead.
  const statsQuery = $derived(
    isAdmin && data.org?.id ? getDashboardStats(data.org.id) : null
  );
  // The activity route requires org management too: other roles got a 403
  // shown as "No activity yet", so the stream is for owners and admins only.
  const activitiesQuery = $derived(
    isAdmin && data.org?.id
      ? getActivityFeed({ organizationId: data.org.id, limit: 12 })
      : null
  );

  // ── Revenue-share signal data (WP-9 — Codex-k9no0) ──────────────────────
  // Only the owner sees agreement focus items (see `isOwner`). The worker
  // routes gate both endpoints with requireOrgManagement, so skipping the
  // query for every other role also avoids a guaranteed 403.
  const agreementsQuery = $derived(
    isOwner && data.org?.id
      ? listActiveAgreements({ organizationId: data.org.id })
      : null
  );
  const pendingCountersQuery = $derived(
    isOwner && data.org?.id
      ? listPendingProposals({
          organizationId: data.org.id,
          proposedByRole: 'creator',
        })
      : null
  );
  // Team members feed the propose-nudge — every non-subscriber creator
  // without a subscription agreement gets a card.
  const teamMembersQuery = $derived(
    isOwner && data.org?.id
      ? getOrgMembers({ orgId: data.org.id, limit: 100 })
      : null
  );

  // ── Dismissal reactivity ────────────────────────────────────────────────
  // dismiss() / isDismissed() read from the localStorage collection; the
  // collection mutates synchronously, but Svelte 5 derived values need an
  // explicit trigger to re-evaluate. We bump `dismissTick` on every
  // dismissal, then read it inside the focusItems $derived so the rebuild
  // fires.
  let dismissTick = $state(0);
  function handleFocusDismiss(itemId: string) {
    dismiss(itemId);
    dismissTick += 1;
  }

  // Loading, failed or ok. A failed read has `current: undefined`, which the
  // tiles used to cover as £0; the stat grid gives way to "We couldn't load
  // your revenue." with Retry instead (Codex-2hxff.74's pattern).
  const statsState = $derived(
    connectQueryState(
      statsQuery as QueryResult<
        NonNullable<typeof statsQuery>['current']
      > | null
    )
  );
  const stats = $derived(statsState.kind === 'ok' ? statsState.status : null);
  const statsFailed = $derived(statsState.kind === 'failed');
  // Only a query still on its way is loading; one never made (a creator's)
  // or failed is not.
  const statsLoading = $derived(
    statsQuery !== null && statsState.kind === 'loading'
  );
  const activities = $derived(activitiesQuery?.current?.items ?? []);
  const activitiesLoading = $derived(activitiesQuery?.loading ?? false);
  // A failed feed is not an empty one (review N-3): the stream gives way to
  // "We couldn't load your recent activity." with Retry.
  const activitiesFailed = $derived(
    connectQueryState(
      activitiesQuery as QueryResult<
        NonNullable<typeof activitiesQuery>['current']
      > | null
    ).kind === 'failed'
  );

  // ── Sparkline series: the last 14 calendar days, oldest first ─────────────
  const revenueSeries = $derived(
    revenueSparkline(stats?.revenue.revenueByDay ?? [])
  );

  // ── Today narrative ───────────────────────────────────────────────────────
  // Single-line English summary. Graceful for missing fields.
  // TODO i18n — key: studio_dashboard_narrative_placeholder
  const narrative = $derived.by(() => {
    if (statsLoading) return 'Pulling today\u2019s numbers together…';

    const parts: string[] = [];
    const drafts = data.badgeCounts?.draftContent ?? 0;
    // Today's UTC date, never "the last day that had a sale" (Codex-2hxff.75).
    // `null` when the series has no entry for today: unknown, not £0 (L7).
    const todayRevenue = stats?.revenue.todayCents ?? null;
    const newCustomers = stats?.customers.newThisWeek ?? 0;

    if (isAdmin && todayRevenue !== null && todayRevenue > 0) {
      parts.push(`${formatPrice(todayRevenue)} earned today`);
    }
    if (drafts > 0) {
      parts.push(drafts === 1 ? '1 draft in progress' : `${drafts} drafts in progress`);
    }
    if (isAdmin && newCustomers > 0) {
      parts.push(
        newCustomers === 1
          ? '1 new customer this week'
          : `${newCustomers} new customers this week`
      );
    }

    if (parts.length === 0) {
      // "Quiet so far" is a claim about today's sales: never make it on
      // figures that failed to load, or with no figure for today.
      return isAdmin && !statsFailed && todayRevenue !== null
        ? 'Quiet so far. A good time to publish something new.'
        : 'Nothing pressing — plenty of room to create.';
    }
    return parts.join(' · ') + '.';
  });

  // ── Focus items (contextual — real work, not generic links) ──────────────
  // Order: drafts > revenue-share signals > customers > branding nudges.
  // Dismissable items are filtered against the localStorage dismissal
  // collection (WP-9). The `dismissTick` read forces re-derivation when
  // the user dismisses a card.
  const focusItems = $derived.by<FocusItem[]>(() => {
    // Touch the tick so dismissals re-fire derivation.
    void dismissTick;

    const items: FocusItem[] = [];
    const drafts = data.badgeCounts?.draftContent ?? 0;

    if (drafts > 0) {
      items.push({
        id: 'drafts-ready',
        eyebrow: drafts === 1 ? '1 draft' : `${drafts} drafts`,
        title: 'Continue a draft',
        description:
          'Pick up where you left off — finish the details, attach media, and publish.',
        href: '/studio/content?status=draft',
        tone: 'action',
        icon: EditIcon,
      });
    }

    // Empty-state nudges — only shown when there's nothing else pressing, and
    // only on a count we have: an unread one is not zero.
    if (items.length === 0 && stats !== null && stats.contentCount.value === 0) {
      items.push({
        id: 'first-content',
        eyebrow: 'First step',
        title: 'Create your first piece of content',
        description:
          'Upload a video, record audio, or write an article. Your audience is waiting.',
        href: '/studio/content?action=create',
        tone: 'action',
        icon: PlusIcon,
      });
    }

    if (isAdmin) {
      // WP-9 revenue-share signals, the owner's only (AGR-14) — and only
      // when all three data sources have resolved. We deliberately don't
      // render partial sets while queries are still loading; the rest of the
      // rail covers the skeleton state.
      const activeAgreements = agreementsQuery?.current?.items ?? [];
      const pendingCounters = pendingCountersQuery?.current?.items ?? [];
      const teamMembers = teamMembersQuery?.current?.items ?? [];
      const dataReady =
        isOwner &&
        agreementsQuery?.current != null &&
        pendingCountersQuery?.current != null &&
        teamMembersQuery?.current != null;
      if (dataReady) {
        const agreementItems = buildOwnerAgreementFocusItems({
          teamMembers: teamMembers
            .filter((m) => m.role !== 'subscriber')
            .map((m) => ({
              userId: m.userId,
              name: m.name,
              email: m.email,
              role: m.role,
              hasCreatorAccount: m.hasCreatorAccount,
            })),
          activeAgreements: activeAgreements.map((a) => ({
            id: a.id,
            creatorId: a.creatorId,
            revenueType: a.revenueType,
            effectiveUntil: a.effectiveUntil,
          })),
          pendingCreatorCounters: pendingCounters.map((p) => ({
            id: p.id,
            creatorId: p.creatorId,
            proposedByRole: p.proposedByRole,
            revenueType: p.revenueType,
            proposedCreatorSharePercent: p.proposedCreatorSharePercent,
          })),
        }).filter((item) => !item.dismissable || !isDismissed(item.id));
        items.push(...agreementItems);
      }

      // Customers tile — visible only to admin/owner, prompts CRM review
      const customerCount = stats?.customers?.value ?? 0;
      if (customerCount > 0) {
        items.push({
          id: 'review-customers',
          eyebrow: customerCount === 1 ? '1 customer' : `${customerCount} customers`,
          title: 'Review customer activity',
          description:
            'See recent purchases, top spenders, and who to thank personally.',
          href: '/studio/customers',
          tone: 'muted',
          icon: UsersIcon,
        });
      }

      // Branding nudge — always useful for an admin, especially new orgs
      items.push({
        id: 'refine-brand',
        eyebrow: 'Craft',
        title: 'Refine your brand',
        description:
          'Colour, typography, and hero shader presets — your public face.',
        href: '/studio/brand',
        tone: 'muted',
        icon: EditIcon,
      });
    } else {
      // Non-admin surface: point them at creating/viewing content
      items.push({
        id: 'browse-content',
        eyebrow: 'Library',
        title: 'Browse your content',
        description: 'Search, filter, and jump straight into any piece.',
        href: '/studio/content',
        tone: 'muted',
        icon: FileTextIcon,
      });
    }

    return items;
  });

  // ── Supporting stat config ───────────────────────────────────────────────
  // `feature` for the hero tile, `inline` for the compact row beneath
  const statConfig = $derived.by(() => {
    if (isAdmin) {
      return [
        {
          ordinal: '01',
          label: m.studio_stat_revenue(),
          value: stats ? formatPrice(stats.revenue.value) : '£–',
          // Calendar weeks; `null` (no badge) with nothing to compare with.
          change: stats?.revenue.change ?? undefined,
          series: revenueSeries,
          variant: 'feature' as const,
        },
        {
          ordinal: '02',
          label: m.studio_stat_customers(),
          value: stats?.customers.value ?? '–',
          // This week's growth of the customer base; was always 0.
          change: stats?.customers.change ?? undefined,
          variant: 'inline' as const,
        },
        {
          ordinal: '03',
          label: m.studio_stat_content(),
          value: stats?.contentCount.value ?? '–',
          change: stats?.contentCount.change,
          variant: 'inline' as const,
        },
        {
          ordinal: '04',
          label: m.studio_stat_views(),
          value: stats?.views.value ?? '–',
          change: stats?.views.change,
          variant: 'inline' as const,
        },
      ];
    }
    // Non-admin: only content + views; use content as feature tile
    return [
      {
        ordinal: '01',
        label: m.studio_stat_content(),
        value: stats?.contentCount.value ?? '–',
        change: stats?.contentCount.change,
        series: undefined,
        variant: 'feature' as const,
      },
      {
        ordinal: '02',
        label: m.studio_stat_views(),
        value: stats?.views.value ?? '–',
        change: stats?.views.change,
        variant: 'inline' as const,
      },
    ];
  });

  const featureStat = $derived(statConfig[0]);
  const inlineStats = $derived(statConfig.slice(1));
</script>

<svelte:head>
  <title>{m.studio_dashboard_title()} | {data.org.name}</title>
</svelte:head>

<div class="dashboard">
  <!-- ── 01  Command bar (sticky editorial header) ── -->
  <DashboardCommandBar
    orgName={data.org.name}
    logoUrl={data.org.logoUrl}
    userName={data.studioUser.name}
    {narrative}
    {isAdmin}
  />

  <!-- ── 02  Stat tiles (feature + inline row) ──
       A failed read shows the alert in place of the tiles, whose every figure
       came from it; mounted unconditionally (see LoadFailedAlert). -->
  <LoadFailedAlert
    query={statsQuery}
    message={m.dashboard_revenue_load_failed()}
    againMessage={m.dashboard_revenue_load_failed_again()}
    loadedMessage={m.dashboard_revenue_load_retry_ok()}
    data-testid="dashboard-stats-load-error"
  />
  {#if !statsFailed}
    <section class="stat-grid" aria-label="Dashboard statistics">
      <div class="stat-feature">
        <TodayStat
          ordinal={featureStat.ordinal}
          label={featureStat.label}
          value={featureStat.value}
          change={featureStat.change}
          series={'series' in featureStat ? featureStat.series : undefined}
          detail={isAdmin && stats ? revenueKinds : undefined}
          loading={statsLoading}
          variant="feature"
        />
      </div>
      <div class="stat-inline-row" data-single={inlineStats.length === 1 || undefined}>
        {#each inlineStats as stat (stat.ordinal)}
          <TodayStat
            ordinal={stat.ordinal}
            label={stat.label}
            value={stat.value}
            change={stat.change}
            loading={statsLoading}
            variant="inline"
          />
        {/each}
      </div>
    </section>
  {/if}

  <!-- Every kind of payment the Revenue figure counts, in exact pence like
       the figure (Codex-2hxff.20 WEB-02). -->
  {#snippet revenueKinds()}
    {#if stats}
      <RevenueKindsLine kinds={stats.revenue.byKind} format="exact" />
    {/if}
  {/snippet}

  <!-- ── 03  Split: Focus rail + Activity stream ──
       The stream is the org's activity, owners' and admins' only; for anyone
       else the rail takes the row. -->
  <section class="below-fold" data-single={!isAdmin || undefined}>
    <FocusRail items={focusItems} onDismiss={handleFocusDismiss} />
    {#if isAdmin}
      <div class="activity-column">
        <LoadFailedAlert
          query={activitiesQuery}
          message={m.dashboard_activity_load_failed()}
          againMessage={m.dashboard_activity_load_failed_again()}
          loadedMessage={m.dashboard_activity_load_retry_ok()}
          data-testid="dashboard-activity-load-error"
        />
        {#if !activitiesFailed}
          <ActivityStream
            activities={activities}
            loading={activitiesLoading}
          />
        {/if}
      </div>
    {/if}
  </section>
</div>

<style>
  .dashboard {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    width: 100%;
  }

  /* ── Stat tiles ────────────────────────────────────────────── */
  .stat-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }

  .stat-feature {
    min-width: 0;
  }

  .stat-inline-row {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
    min-width: 0;
  }

  /* Small tablet: inline stats become 2-up */
  @media (--breakpoint-sm) {
    .stat-inline-row {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  /* Wide: feature tile takes the left half, inline stats fill a 3-up row
     to the right. The feature tile is intentionally tall + sparkline-rich,
     so it balances against three tighter supporting tiles. */
  @media (--breakpoint-lg) {
    .stat-grid {
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.9fr);
      gap: var(--space-5);
      align-items: stretch;
    }
    .stat-inline-row {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  /* Non-admin path only has one supporting stat — keep it single-column on lg.
     An attribute, not `:has(> :only-child)`: the children are components, so
     Svelte could not see them, called that selector unused and dropped it. */
  @media (--breakpoint-lg) {
    .stat-inline-row[data-single] {
      grid-template-columns: 1fr;
    }
  }

  /* ── Below the fold: focus + activity ──────────────────────── */
  .below-fold {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }

  @media (--breakpoint-lg) {
    .below-fold {
      /* Focus rail is narrower than activity — editorial asymmetry.
         minmax(0, …) prevents intrinsic min-content from blowing the grid. */
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr);
      gap: var(--space-5);
      align-items: start;
    }

    /* The rail alone (no activity stream for this role) takes the row. */
    .below-fold[data-single] {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  /* The alert and the stream share the activity column. */
  .activity-column {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
</style>

<!--
  @component StudioAnalytics

  Studio analytics dashboard. Four URL params drive the entire page
  (startDate, endDate, compareFrom, compareTo) via the AnalyticsCommandBar.
  Five remote queries fetch revenue / subscribers / followers / top-content /
  content-performance; each component owns its own skeleton. When every
  query resolves with genuinely empty data, the full-page zero state renders
  instead of the dashboard.

  @prop data - Parent studio layout data: { org, userRole, ... }
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { PageHeader } from '$lib/components/ui';
  import {
    AnalyticsCommandBar,
    AnalyticsZeroState,
    HeroAnalyticsChart,
    KPICard,
    NarrativeSummary,
    TopContentLeaderboard,
  } from '$lib/components/studio/analytics';
  import {
    getAnalyticsContentPerformance,
    getAnalyticsFollowers,
    getAnalyticsRevenue,
    getAnalyticsSubscribers,
    getAnalyticsTopContent,
  } from '$lib/remote/admin.remote';

  let { data } = $props();

  // ─── Auth / role guard ────────────────────────────────────────────────
  // Preserve parity with FE-7: admin + owner only.
  $effect(() => {
    if (data.userRole !== 'admin' && data.userRole !== 'owner') {
      goto('/studio');
    }
  });

  const isAuthorized = $derived(
    data.userRole === 'admin' || data.userRole === 'owner'
  );

  // ─── URL → state ──────────────────────────────────────────────────────
  // AnalyticsCommandBar writes these four params; we derive here and pass
  // the resolved values back into the bar (controlled component pattern).
  // Legacy `dateFrom` / `dateTo` params are accepted for backward-compat
  // links that predate FE-1's rename.
  const startDate = $derived.by(() => {
    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setDate(defaultFrom.getDate() - 30);
    return (
      page.url.searchParams.get('startDate') ??
      page.url.searchParams.get('dateFrom') ??
      defaultFrom.toISOString().split('T')[0]
    );
  });

  const endDate = $derived(
    page.url.searchParams.get('endDate') ??
      page.url.searchParams.get('dateTo') ??
      new Date().toISOString().split('T')[0]
  );

  const compareFrom = $derived(
    page.url.searchParams.get('compareFrom') ?? undefined
  );
  const compareTo = $derived(
    page.url.searchParams.get('compareTo') ?? undefined
  );

  const hasCompareWindow = $derived(Boolean(compareFrom && compareTo));

  // ─── Remote queries ───────────────────────────────────────────────────
  // All five queries re-key off the same (orgId, window) tuple so URL-param
  // navigation automatically refetches. Each returns `{ current, loading }`.
  const revenueQuery = $derived(
    isAuthorized
      ? getAnalyticsRevenue({
          organizationId: data.org.id,
          startDate,
          endDate,
          compareFrom,
          compareTo,
        })
      : null
  );

  const subscribersQuery = $derived(
    isAuthorized
      ? getAnalyticsSubscribers({
          organizationId: data.org.id,
          startDate,
          endDate,
          compareFrom,
          compareTo,
        })
      : null
  );

  const followersQuery = $derived(
    isAuthorized
      ? getAnalyticsFollowers({
          organizationId: data.org.id,
          startDate,
          endDate,
          compareFrom,
          compareTo,
        })
      : null
  );

  const topContentQuery = $derived(
    isAuthorized
      ? getAnalyticsTopContent({
          organizationId: data.org.id,
          limit: 10,
          startDate,
          endDate,
          compareFrom,
          compareTo,
        })
      : null
  );

  const contentPerformanceQuery = $derived(
    isAuthorized
      ? getAnalyticsContentPerformance({
          organizationId: data.org.id,
          limit: 10,
          startDate,
          endDate,
          compareFrom,
          compareTo,
        })
      : null
  );

  // ─── Resolved data + loading flags ────────────────────────────────────
  const revenue = $derived(revenueQuery?.current);
  const subscribers = $derived(subscribersQuery?.current);
  const followers = $derived(followersQuery?.current);
  const topContent = $derived(topContentQuery?.current?.items ?? []);
  const contentPerformance = $derived(
    contentPerformanceQuery?.current?.items ?? []
  );

  const revenueLoading = $derived(
    (revenueQuery?.loading ?? true) || !revenueQuery?.current
  );
  const subscribersLoading = $derived(
    (subscribersQuery?.loading ?? true) || !subscribersQuery?.current
  );
  const followersLoading = $derived(
    (followersQuery?.loading ?? true) || !followersQuery?.current
  );
  const topContentLoading = $derived(
    (topContentQuery?.loading ?? true) || !topContentQuery?.current
  );
  const contentPerformanceLoading = $derived(
    (contentPerformanceQuery?.loading ?? true) ||
      !contentPerformanceQuery?.current
  );

  // Narrative + zero-state gating wait for every query to resolve at least
  // once. We don't want to flash the zero state while revenue is still
  // pending — that would look like data loss.
  const allResolved = $derived(
    !revenueLoading &&
      !subscribersLoading &&
      !followersLoading &&
      !topContentLoading
  );

  const narrativeLoading = $derived(
    revenueLoading || subscribersLoading || followersLoading
  );

  // ─── Zero-state detection ─────────────────────────────────────────────
  // "Brand-new org" = zero across every axis. Any signal (revenue, any
  // subscriber activity, any follower activity, any top-content row) flips
  // into the full dashboard. When top-content alone is empty we rely on
  // TopContentLeaderboard's inline empty state instead.
  const isZeroState = $derived.by(() => {
    if (!allResolved || !revenue || !subscribers || !followers) return false;
    const noRevenue = revenue.totalRevenueCents === 0;
    const noSubs =
      subscribers.activeSubscribers === 0 &&
      subscribers.newSubscribers === 0 &&
      subscribers.churnedSubscribers === 0;
    const noFollowers =
      followers.totalFollowers === 0 && followers.newFollowers === 0;
    const noContent = topContent.length === 0;
    return noRevenue && noSubs && noFollowers && noContent;
  });

  // ─── KPI sparkline + previousValue derivations ────────────────────────
  const revenueSparkline = $derived(
    (revenue?.revenueByDay ?? []).map((d) => ({
      date: d.date,
      value: d.revenueCents,
    }))
  );

  const subscriberSparkline = $derived(
    (subscribers?.subscribersByDay ?? []).map((d) => ({
      date: d.date,
      value: d.newSubscribers,
    }))
  );

  const followerSparkline = $derived(
    (followers?.followersByDay ?? []).map((d) => ({
      date: d.date,
      value: d.newFollowers,
    }))
  );

  const purchaseSparkline = $derived(
    (revenue?.revenueByDay ?? []).map((d) => ({
      date: d.date,
      value: d.purchaseCount,
    }))
  );
</script>

<svelte:head>
  <title>{m.analytics_title()} | {data.org.name}</title>
</svelte:head>

{#if !isAuthorized}
  <!-- Redirect in-flight — render nothing to avoid a flash of unauthorised UI. -->
{:else}
  <div class="analytics-page">
    <PageHeader
      title={m.analytics_title()}
      description={m.analytics_page_description()}
    />

    <AnalyticsCommandBar
      {startDate}
      {endDate}
      {compareFrom}
      {compareTo}
    />

    {#if isZeroState}
      <AnalyticsZeroState />
    {:else}
      <NarrativeSummary
        revenue={revenue ?? {
          totalRevenueCents: 0,
          totalPurchases: 0,
          averageOrderValueCents: 0,
          platformFeeCents: 0,
          organizationFeeCents: 0,
          creatorPayoutCents: 0,
          revenueByDay: [],
        }}
        subscribers={subscribers ?? {
          activeSubscribers: 0,
          newSubscribers: 0,
          churnedSubscribers: 0,
          subscribersByDay: [],
        }}
        followers={followers ?? {
          totalFollowers: 0,
          newFollowers: 0,
          followersByDay: [],
        }}
        topContent={topContent}
        topPerformance={contentPerformance}
        {hasCompareWindow}
        loading={narrativeLoading}
      />

      <section
        class="kpi-row"
        aria-label={m.analytics_section_kpis_label()}
      >
        <KPICard
          label={m.analytics_kpi_revenue_label()}
          value={revenue?.totalRevenueCents ?? 0}
          format="money"
          previousValue={revenue?.previous?.totalRevenueCents ?? null}
          sparkline={revenueSparkline}
          loading={revenueLoading}
        />
        <KPICard
          label={m.analytics_kpi_subscribers_label()}
          value={subscribers?.activeSubscribers ?? 0}
          format="number"
          previousValue={subscribers?.previous?.activeSubscribers ?? null}
          sparkline={subscriberSparkline}
          loading={subscribersLoading}
        />
        <KPICard
          label={m.analytics_kpi_followers_label()}
          value={followers?.totalFollowers ?? 0}
          format="number"
          previousValue={followers?.previous?.totalFollowers ?? null}
          sparkline={followerSparkline}
          loading={followersLoading}
        />
        <KPICard
          label={m.analytics_kpi_purchases_label()}
          value={revenue?.totalPurchases ?? 0}
          format="number"
          previousValue={revenue?.previous?.totalPurchases ?? null}
          sparkline={purchaseSparkline}
          loading={revenueLoading}
        />
      </section>

      <section
        class="chart-section"
        aria-label={m.analytics_section_chart_label()}
      >
        <HeroAnalyticsChart
          revenue={revenue ?? {
            totalRevenueCents: 0,
            totalPurchases: 0,
            averageOrderValueCents: 0,
            platformFeeCents: 0,
            organizationFeeCents: 0,
            creatorPayoutCents: 0,
            revenueByDay: [],
          }}
          subscribers={subscribers ?? {
            activeSubscribers: 0,
            newSubscribers: 0,
            churnedSubscribers: 0,
            subscribersByDay: [],
          }}
          followers={followers ?? {
            totalFollowers: 0,
            newFollowers: 0,
            followersByDay: [],
          }}
          {hasCompareWindow}
          loading={revenueLoading || subscribersLoading || followersLoading}
        />
      </section>

      <section
        class="leaderboard-section"
        aria-labelledby="analytics-leaderboard-heading"
      >
        <h2
          id="analytics-leaderboard-heading"
          class="leaderboard-section__heading"
        >
          {m.analytics_section_leaderboard_heading()}
        </h2>
        <TopContentLeaderboard
          items={topContent}
          {hasCompareWindow}
          loading={topContentLoading}
        />
      </section>
    {/if}
  </div>
{/if}

<style>
  .analytics-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    width: 100%;
  }

  /* KPI row: 4-up desktop, 2-up tablet, 1-up mobile.
     auto-fit with minmax keeps it honest on mid-range widths and lets the
     cards breathe to the studio content width. */
  .kpi-row {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-4);
  }

  @media (max-width: 1024px) {
    .kpi-row {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 560px) {
    .kpi-row {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .chart-section,
  .leaderboard-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .leaderboard-section__heading {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    line-height: var(--leading-snug);
  }
</style>

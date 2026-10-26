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
  import type {
    FollowerStats,
    RevenueStats,
    SubscriberStats,
  } from '@codex/admin';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import {
    AnalyticsCommandBar,
    AnalyticsZeroState,
    CreatorRevenueTable,
    HeroAnalyticsChart,
    KPICard,
    NarrativeSummary,
    RevenueKindsLine,
    TopContentLeaderboard,
  } from '$lib/components/studio/analytics';
  import { trailingRange } from '$lib/components/studio/analytics/analytics-range';
  import LoadFailedAlert from '$lib/components/studio/LoadFailedAlert.svelte';
  import { connectQueryState } from '$lib/utils/connect-readiness';
  import type { QueryResult } from '$lib/remote/query-result';
  import {
    getAnalyticsContentPerformance,
    getAnalyticsFollowers,
    getAnalyticsRevenue,
    getAnalyticsRevenueByCreator,
    getAnalyticsSubscribers,
    getAnalyticsTopContent,
  } from '$lib/remote/admin.remote';

  let { data } = $props();

  // ─── Auth / role guard ────────────────────────────────────────────────
  // Preserve parity with FE-7: admin + owner only.
  // Wait for data.userRole to populate — ssr=false means first render has
  // data.userRole === undefined (would falsely redirect authorised users).
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

  // ─── URL → state ──────────────────────────────────────────────────────
  // AnalyticsCommandBar writes these four params; we derive here and pass
  // the resolved values back into the bar (controlled component pattern).
  // Legacy `dateFrom` / `dateTo` params are accepted for backward-compat
  // links that predate FE-1's rename. The default is the last 30 UTC calendar
  // days, today included: the 30 days Billing and the dashboard read, since
  // the API reads an end date as the whole of that day (review I-1).
  const defaultRange = trailingRange(30);
  const startDate = $derived(
    page.url.searchParams.get('startDate') ??
      page.url.searchParams.get('dateFrom') ??
      defaultRange.startDate
  );

  const endDate = $derived(
    page.url.searchParams.get('endDate') ??
      page.url.searchParams.get('dateTo') ??
      defaultRange.endDate
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

  // Codex-mtv05 / zsh2p: Revenue by creator, one row per creator. Only
  // renders when more than one creator is listed (items.length > 1, which
  // now counts people, not agreements). Comparison windows are NOT applied:
  // the shares are today's, not history.
  const revenueByCreatorQuery = $derived(
    isAuthorized
      ? getAnalyticsRevenueByCreator({
          organizationId: data.org.id,
          startDate,
          endDate,
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

  // Loading flag: request is in flight when we're authorised AND we have
  // neither resolved data nor an error. The `.loading` property on the remote
  // query handle has been unreliable in testing (staying undefined after
  // settle), so we derive from the settlement signals directly — this treats
  // errored queries as "settled" (not loading) so the dashboard can still
  // render fallbacks and the zero-state can resolve.
  function isLoading<T>(
    q: { current?: T; error?: unknown } | null | undefined
  ): boolean {
    if (!q) return false;
    return q.current === undefined && q.error === undefined;
  }

  const revenueLoading = $derived(isLoading(revenueQuery));
  // A failed revenue read is not £0 (Codex-2hxff.74's pattern, review N-3):
  // the Revenue and Purchases KPIs give way to "We couldn't load your
  // revenue." with Retry, the chart drops its Revenue tab and the summary
  // makes no revenue claim. The remote logs the raw error.
  const revenueFailed = $derived(
    connectQueryState(revenueQuery as QueryResult<RevenueStats> | null).kind ===
      'failed'
  );
  const subscribersLoading = $derived(isLoading(subscribersQuery));
  const followersLoading = $derived(isLoading(followersQuery));
  const topContentLoading = $derived(isLoading(topContentQuery));
  const contentPerformanceLoading = $derived(isLoading(contentPerformanceQuery));

  // Codex-mtv05 derivations — kept alongside their peers for consistency.
  // `showRevenueByCreator` gates the entire section render: one creator (or
  // none) → hidden.
  const revenueByCreatorItems = $derived(
    revenueByCreatorQuery?.current?.items ?? []
  );
  const revenueByCreatorLoading = $derived(
    isLoading(revenueByCreatorQuery)
  );
  const showRevenueByCreator = $derived(revenueByCreatorItems.length > 1);

  // Zero-state gating waits for every query to settle (success or error).
  // Using .loading (not .current) means errored queries still "resolve" for
  // gating purposes — the dashboard renders with whatever data landed.
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

  // Stable empty-shape fallbacks. Declared once at component-module scope so
  // their object identity is stable across re-renders — critical because the
  // hand-rolled SVG chart's $derived blocks read revenue/subscribers/followers
  // by reference. Inline `??{...}` fallbacks would hand the chart a brand-new
  // object every reactive tick and thrash its geometry derivations.
  const EMPTY_REVENUE: RevenueStats = {
    totalRevenueCents: 0,
    revenueByKind: { one_off: 0, course: 0, subscription: 0, course_plan: 0 },
    totalPurchases: 0,
    averageOrderValueCents: 0,
    platformFeeCents: 0,
    organizationFeeCents: 0,
    creatorPayoutCents: 0,
    revenueByDay: [],
  };
  const EMPTY_SUBSCRIBERS: SubscriberStats = {
    activeSubscribers: 0,
    newSubscribers: 0,
    churnedSubscribers: 0,
    subscribersByDay: [],
  };
  const EMPTY_FOLLOWERS: FollowerStats = {
    totalFollowers: 0,
    newFollowers: 0,
    followersByDay: [],
  };
</script>

<svelte:head>
  <title>{m.analytics_title()} | {data.org.name}</title>
</svelte:head>

{#snippet revenueKinds()}
  {#if revenue}
    <RevenueKindsLine kinds={revenue.revenueByKind} format="compact" />
  {/if}
{/snippet}

{#if !isAuthorized}
  <!-- Redirect in-flight — render nothing to avoid a flash of unauthorised UI. -->
{:else}
  <div class="analytics-page">
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
        revenue={revenue ?? EMPTY_REVENUE}
        subscribers={subscribers ?? EMPTY_SUBSCRIBERS}
        followers={followers ?? EMPTY_FOLLOWERS}
        topContent={topContent}
        topPerformance={contentPerformance}
        {hasCompareWindow}
        loading={narrativeLoading}
        revenueUnavailable={revenueFailed}
      />

      <!-- Mounted unconditionally (see LoadFailedAlert); visible only when
           the revenue read failed, in place of the two KPIs it feeds. -->
      <LoadFailedAlert
        query={revenueQuery}
        message={m.analytics_revenue_load_failed()}
        againMessage={m.analytics_revenue_load_failed_again()}
        loadedMessage={m.analytics_revenue_load_retry_ok()}
        data-testid="analytics-revenue-load-error"
      />
      <section
        class="kpi-row"
        aria-label={m.analytics_section_kpis_label()}
      >
        {#if !revenueFailed}
          <!-- Every kind of payment, from the payouts ledger, with what it is
               made of beneath (Codex-2hxff.20 WEB-02), rounded like the figure. -->
          <KPICard
            label={m.analytics_kpi_revenue_label()}
            value={revenue?.totalRevenueCents ?? 0}
            format="money"
            previousValue={revenue?.previous?.totalRevenueCents ?? null}
            sparkline={revenueSparkline}
            loading={revenueLoading}
            detail={revenue ? revenueKinds : undefined}
          />
        {/if}
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
        {#if !revenueFailed}
          <KPICard
            label={m.analytics_kpi_purchases_label()}
            value={revenue?.totalPurchases ?? 0}
            format="number"
            previousValue={revenue?.previous?.totalPurchases ?? null}
            sparkline={purchaseSparkline}
            loading={revenueLoading}
          />
        {/if}
      </section>

      <section
        class="chart-section"
        aria-label={m.analytics_section_chart_label()}
      >
        <HeroAnalyticsChart
          revenue={revenue ?? EMPTY_REVENUE}
          subscribers={subscribers ?? EMPTY_SUBSCRIBERS}
          followers={followers ?? EMPTY_FOLLOWERS}
          {hasCompareWindow}
          loading={revenueLoading || subscribersLoading || followersLoading}
          revenueUnavailable={revenueFailed}
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

      {#if showRevenueByCreator}
        <section
          class="creator-revenue-section"
          data-test="revenue-by-creator-section"
          aria-labelledby="analytics-creator-revenue-heading"
        >
          <h2
            id="analytics-creator-revenue-heading"
            class="creator-revenue-section__heading"
          >
            {m.analytics_section_creator_revenue_heading()}
          </h2>
          <CreatorRevenueTable
            items={revenueByCreatorItems}
            loading={revenueByCreatorLoading}
          />
        </section>
      {/if}
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

  @media (--below-lg) {
    .kpi-row {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (--below-sm) {
    .kpi-row {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .chart-section,
  .leaderboard-section,
  .creator-revenue-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .leaderboard-section__heading,
  .creator-revenue-section__heading {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    line-height: var(--leading-snug);
  }
</style>

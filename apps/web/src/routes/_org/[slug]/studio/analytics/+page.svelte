<!--
  @component StudioAnalytics

  Analytics page showing revenue chart and top content table.
  Supports date range preset buttons (7d, 30d, 90d, year) that update the URL.
  Fetches data client-side to avoid __data.json round-trips.

  @prop data - Org info and userRole from parent studio layout
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { Card, PageHeader } from '$lib/components/ui';
  import RevenueChart from '$lib/components/studio/RevenueChart.svelte';
  import TopContentTable from '$lib/components/studio/TopContentTable.svelte';
  import {
    getAnalyticsRevenue,
    getAnalyticsTopContent,
  } from '$lib/remote/admin.remote';
  import { formatPriceCompact } from '$lib/utils/format';

  let { data } = $props();

  // Role guard: admin/owner only
  $effect(() => {
    if (data.userRole !== 'admin' && data.userRole !== 'owner') {
      goto('/studio');
    }
  });

  const isAuthorized = $derived(data.userRole === 'admin' || data.userRole === 'owner');

  // Parse date range from URL, default to last 30 days.
  // URL params use `startDate`/`endDate` to match the admin-api schema;
  // legacy `dateFrom`/`dateTo` are still accepted for backward-compat links.
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

  // $derived queries react to URL param changes
  const revenueQuery = $derived(
    isAuthorized
      ? getAnalyticsRevenue({
          organizationId: data.org.id,
          startDate,
          endDate,
        })
      : null
  );

  const topContentQuery = $derived(
    isAuthorized
      ? getAnalyticsTopContent({
          organizationId: data.org.id,
          limit: 10,
        })
      : null
  );

  // Derive chart data from revenue response
  const chartData = $derived(
    (revenueQuery?.current?.revenueByDay ?? []).map((d: any) => ({
      date: d.date,
      revenue: d.revenueCents,
    }))
  );

  // Derive top content items
  const topContentItems = $derived(topContentQuery?.current?.items ?? []);

  const loading = $derived((revenueQuery?.loading ?? true) || (topContentQuery?.loading ?? true));

  /**
   * Calculate how many days back a date range covers from today
   */
  function getActivePreset(): string {
    const now = new Date();
    const from = new Date(startDate);
    const diffDays = Math.round(
      (now.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays <= 8) return '7d';
    if (diffDays <= 31) return '30d';
    if (diffDays <= 91) return '90d';
    return 'year';
  }

  const activePreset = $derived(getActivePreset());

  /**
   * Navigate to the analytics page with a new date range
   */
  function setDateRange(days: number) {
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - days);

    const params = new URLSearchParams();
    params.set('startDate', from.toISOString().split('T')[0]);
    params.set('endDate', now.toISOString().split('T')[0]);

    goto(`/studio/analytics?${params}`, {
      keepFocus: true,
      noScroll: true,
    });
  }

</script>

<svelte:head>
  <title>{m.analytics_title()} | {data.org.name}</title>
</svelte:head>

{#if !isAuthorized}
  <!-- Redirecting... -->
{:else}
<div class="analytics-page">
  <PageHeader title={m.analytics_title()} />

  <!-- Date Range Presets -->
  <div class="date-presets" role="group" aria-label="Date range">
    <button
      class="preset-btn"
      class:active={activePreset === '7d'}
      onclick={() => setDateRange(7)}
    >
      {m.analytics_date_7d()}
    </button>
    <button
      class="preset-btn"
      class:active={activePreset === '30d'}
      onclick={() => setDateRange(30)}
    >
      {m.analytics_date_30d()}
    </button>
    <button
      class="preset-btn"
      class:active={activePreset === '90d'}
      onclick={() => setDateRange(90)}
    >
      {m.analytics_date_90d()}
    </button>
    <button
      class="preset-btn"
      class:active={activePreset === 'year'}
      onclick={() => setDateRange(365)}
    >
      {m.analytics_date_year()}
    </button>
  </div>

  <!-- Revenue Summary -->
  {#if revenueQuery?.current}
    {@const revenue = revenueQuery.current}
    <div class="summary-cards">
      <Card.Root class="summary-card">
        <Card.Content>
          <span class="summary-label">{m.billing_total_revenue()}</span>
          <span class="summary-value">
            {formatPriceCompact(revenue.totalRevenueCents)}
          </span>
        </Card.Content>
      </Card.Root>
      <Card.Root class="summary-card">
        <Card.Content>
          <span class="summary-label">{m.billing_total_purchases()}</span>
          <span class="summary-value">{revenue.totalPurchases}</span>
        </Card.Content>
      </Card.Root>
      <Card.Root class="summary-card">
        <Card.Content>
          <span class="summary-label">{m.billing_avg_order()}</span>
          <span class="summary-value">
            {formatPriceCompact(revenue.averageOrderValueCents)}
          </span>
        </Card.Content>
      </Card.Root>
    </div>
  {/if}

  <!-- Revenue Chart -->
  <section class="chart-section">
    <Card.Root>
      <Card.Header>
        <Card.Title level={2}>{m.analytics_revenue_title()}</Card.Title>
      </Card.Header>
      <Card.Content>
        <RevenueChart data={chartData} loading={loading || !revenueQuery?.current} />
      </Card.Content>
    </Card.Root>
  </section>

  <!-- Top Content -->
  <section class="table-section">
    <Card.Root>
      <Card.Header>
        <Card.Title level={2}>{m.analytics_top_content()}</Card.Title>
      </Card.Header>
      <Card.Content>
        <TopContentTable items={topContentItems} loading={loading || !topContentQuery?.current} />
      </Card.Content>
    </Card.Root>
  </section>
</div>
{/if}

<style>
  .analytics-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 1200px;
  }

  /* Date Range Presets */
  .date-presets {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .preset-btn {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-surface);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .preset-btn:hover {
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .preset-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .preset-btn.active {
    background-color: var(--color-interactive);
    border-color: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  .preset-btn.active:hover {
    background-color: var(--color-interactive-hover);
  }

  /* Summary Cards */
  .summary-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--space-4);
  }

  :global(.summary-card .card-content) {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .summary-label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .summary-value {
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

</style>

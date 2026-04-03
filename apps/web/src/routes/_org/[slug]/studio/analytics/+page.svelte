<!--
  @component StudioAnalytics

  Analytics page showing revenue chart and top content table.
  Supports date range preset buttons (7d, 30d, 90d, year) that update the URL.

  @prop {PageData} data - Server-loaded analytics data + org info from parent
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import RevenueChart from '$lib/components/studio/RevenueChart.svelte';
  import TopContentTable from '$lib/components/studio/TopContentTable.svelte';

  let { data } = $props();

  const slug = $derived(page.params.slug);

  // Derive chart data from revenue response
  const chartData = $derived(
    (data.revenue?.revenueByDay ?? []).map((d) => ({
      date: d.date,
      revenue: d.revenueCents,
    }))
  );

  // Derive top content items
  const topContentItems = $derived(data.topContent?.items ?? []);

  /**
   * Calculate how many days back a date range covers from today
   */
  function getActivePreset(): string {
    const now = new Date();
    const from = new Date(data.dateFrom);
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
    params.set('dateFrom', from.toISOString().split('T')[0]);
    params.set('dateTo', now.toISOString().split('T')[0]);

    goto(`/studio/analytics?${params}`, {
      keepFocus: true,
      noScroll: true,
    });
  }

  /**
   * Format cents to currency string (GBP)
   */
  function formatRevenue(cents: number | undefined | null): string {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format((cents ?? 0) / 100);
  }
</script>

<svelte:head>
  <title>{m.analytics_title()} | {data.org.name}</title>
</svelte:head>

<div class="analytics-page">
  <header class="page-header">
    <h1 class="page-title">{m.analytics_title()}</h1>
  </header>

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
  {#if data.revenue}
    <div class="summary-cards">
      <div class="summary-card">
        <span class="summary-label">{m.billing_total_revenue()}</span>
        <span class="summary-value">
          {formatRevenue(data.revenue.totalRevenueCents)}
        </span>
      </div>
      <div class="summary-card">
        <span class="summary-label">{m.billing_total_purchases()}</span>
        <span class="summary-value">{data.revenue.totalPurchases}</span>
      </div>
      <div class="summary-card">
        <span class="summary-label">{m.billing_avg_order()}</span>
        <span class="summary-value">
          {formatRevenue(data.revenue.averageOrderValueCents)}
        </span>
      </div>
    </div>
  {/if}

  <!-- Revenue Chart -->
  <section class="chart-section">
    <h2 class="section-title">{m.analytics_revenue_title()}</h2>
    <div class="chart-card">
      <RevenueChart data={chartData} loading={!data.revenue} />
    </div>
  </section>

  <!-- Top Content -->
  <section class="table-section">
    <h2 class="section-title">{m.analytics_top_content()}</h2>
    <div class="table-card">
      <TopContentTable items={topContentItems} loading={!data.topContent} />
    </div>
  </section>
</div>

<style>
  .analytics-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 1200px;
  }

  .page-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .page-title {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
    line-height: var(--leading-tight);
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

  .summary-card {
    padding: var(--space-4);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
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

  /* Sections */
  .section-title {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0 0 var(--space-3) 0;
  }

  .chart-card,
  .table-card {
    padding: var(--space-4);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
  }
</style>

<!--
  @component RevenueChart

  A simple CSS-only bar chart for revenue over time.
  Each bar represents one day, with height proportional to max revenue.
  Includes hover tooltip with date and amount.

  @prop {{ date: string; revenue: number }[]} data - Revenue data points
  @prop {boolean} loading - Whether the data is loading
-->
<script lang="ts">
  import * as m from '$paraglide/messages';

  interface Props {
    data: { date: string; revenue: number }[];
    loading?: boolean;
  }

  const { data, loading = false }: Props = $props();

  const maxRevenue = $derived(
    data.length > 0 ? Math.max(...data.map((d) => d.revenue), 1) : 1
  );

  const isEmpty = $derived(data.length === 0 || data.every((d) => d.revenue === 0));

  /**
   * Format cents to currency string (GBP)
   */
  function formatRevenue(cents: number): string {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  }

  /**
   * Format date for tooltip display
   */
  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }

  /**
   * Build aria-label summarizing the chart
   */
  const chartLabel = $derived(() => {
    if (isEmpty) return m.analytics_empty();
    const total = data.reduce((sum, d) => sum + d.revenue, 0);
    return `Revenue chart: ${formatRevenue(total)} total over ${data.length} days`;
  });
</script>

{#if loading}
  <div class="chart-skeleton">
    <div class="skeleton-bars">
      {#each Array(14) as _, i}
        <div
          class="skeleton-bar"
          style="height: {20 + Math.random() * 60}%"
        ></div>
      {/each}
    </div>
  </div>
{:else if isEmpty}
  <div class="chart-empty">
    <p class="empty-text">{m.analytics_empty()}</p>
  </div>
{:else}
  <div
    class="chart-container"
    role="img"
    aria-label={chartLabel()}
  >
    <div class="chart-bars">
      {#each data as point, index (point.date)}
        {@const heightPercent = (point.revenue / maxRevenue) * 100}
        <div class="bar-wrapper" title="{formatDate(point.date)}: {formatRevenue(point.revenue)}">
          <div class="bar-tooltip">
            <span class="tooltip-date">{formatDate(point.date)}</span>
            <span class="tooltip-value">{formatRevenue(point.revenue)}</span>
          </div>
          <div
            class="bar"
            style="height: {Math.max(heightPercent, 2)}%"
            class:bar-zero={point.revenue === 0}
          ></div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .chart-container {
    width: 100%;
    min-height: 200px;
    max-height: 280px;
    padding: var(--space-2) 0;
  }

  .chart-bars {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 200px;
    width: 100%;
  }

  .bar-wrapper {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: stretch;
    position: relative;
  }

  .bar {
    background-color: var(--color-primary-500);
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    transition: background-color 0.15s ease;
    min-height: 2px;
  }

  .bar-zero {
    background-color: var(--color-surface-secondary);
  }

  .bar-wrapper:hover .bar {
    background-color: var(--color-primary-600);
  }

  .bar-wrapper:hover .bar.bar-zero {
    background-color: var(--color-border);
  }

  /* Tooltip */
  .bar-tooltip {
    position: absolute;
    bottom: calc(100% + var(--space-1));
    left: 50%;
    transform: translateX(-50%);
    background-color: var(--color-text);
    color: var(--color-background);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
    white-space: nowrap;
    display: none;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    z-index: 10;
    pointer-events: none;
  }

  .bar-wrapper:hover .bar-tooltip {
    display: flex;
  }

  .tooltip-date {
    opacity: 0.8;
  }

  .tooltip-value {
    font-weight: var(--font-semibold);
  }

  /* Loading skeleton */
  .chart-skeleton {
    width: 100%;
    min-height: 200px;
    padding: var(--space-2) 0;
  }

  .skeleton-bars {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 200px;
  }

  .skeleton-bar {
    flex: 1;
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    animation: pulse 1.5s ease-in-out infinite;
  }

  /* Empty state */
  .chart-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
  }

  .empty-text {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.4;
    }
    50% {
      opacity: 0.8;
    }
  }

  /* Dark mode */
  :global([data-theme='dark']) .bar-tooltip {
    background-color: var(--color-surface-dark);
    color: var(--color-text-dark);
    border: var(--border-width) var(--border-style) var(--color-border-dark);
  }
</style>

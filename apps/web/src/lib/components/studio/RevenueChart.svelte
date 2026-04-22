<!--
  @component RevenueChart

  A simple CSS-only bar chart for revenue over time.
  Each bar represents one day, with height proportional to max revenue.
  Includes hover tooltip with date and amount, plus an sr-only data table
  so keyboard + screen-reader users can access the full dataset
  (per ref 05 §Data visualisation, WCAG 2.1.1 + 1.3.1).

  @prop {{ date: string; revenue: number }[]} data - Revenue data points
  @prop {boolean} loading - Whether the data is loading
  @prop {string} [class] - Optional class forwarded to the root element
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { formatPriceCompact, formatDate } from '$lib/utils/format';

  interface Props {
    data: { date: string; revenue: number }[];
    loading?: boolean;
    class?: string;
  }

  const {
    data,
    loading = false,
    class: className = '',
  }: Props = $props();

  const maxRevenue = $derived(
    data.length > 0 ? Math.max(...data.map((d) => d.revenue), 1) : 1
  );

  const isEmpty = $derived(data.length === 0 || data.every((d) => d.revenue === 0));

  /**
   * Build aria-label summarising the chart — total, peak, and low so SR
   * users get extremes not just aggregate (ref 05 §Data visualisation).
   */
  const chartLabel = $derived.by(() => {
    if (isEmpty) return m.analytics_empty();
    const total = data.reduce((sum, d) => sum + d.revenue, 0);
    let peakIdx = 0;
    let lowIdx = 0;
    for (let i = 1; i < data.length; i++) {
      if (data[i].revenue > data[peakIdx].revenue) peakIdx = i;
      if (data[i].revenue < data[lowIdx].revenue) lowIdx = i;
    }
    const peak = data[peakIdx];
    const low = data[lowIdx];
    return `Revenue over ${data.length} days — total ${formatPriceCompact(total)}, peak ${formatPriceCompact(peak.revenue)} on ${formatDate(peak.date)}, lowest ${formatPriceCompact(low.revenue)} on ${formatDate(low.date)}`;
  });
</script>

{#if loading}
  <div class="chart-skeleton {className}">
    <div class="skeleton-bars">
      {#each Array(14) as _, i (i)}
        <div
          class="skeleton-bar"
          style="height: {20 + Math.random() * 60}%"
        ></div>
      {/each}
    </div>
  </div>
{:else if isEmpty}
  <div class="chart-empty {className}">
    <p class="empty-text">{m.analytics_empty()}</p>
  </div>
{:else}
  <div
    class="chart-container {className}"
    role="img"
    aria-label={chartLabel}
  >
    <div class="chart-bars">
      {#each data as point, index (point.date)}
        {@const heightPercent = (point.revenue / maxRevenue) * 100}
        <div class="bar-wrapper" title="{formatDate(point.date)}: {formatPriceCompact(point.revenue)}">
          <div class="bar-tooltip" aria-hidden="true">
            <span class="tooltip-date">{formatDate(point.date)}</span>
            <span class="tooltip-value">{formatPriceCompact(point.revenue)}</span>
          </div>
          <div
            class="bar"
            style="height: {Math.max(heightPercent, 2)}%"
            class:bar-zero={point.revenue === 0}
          ></div>
        </div>
      {/each}
    </div>

    <!--
      Screen-reader-only data table mirrors the chart's data array so
      keyboard + SR users get the per-day detail that sighted mouse users
      see in the hover tooltip (WCAG 1.3.1 + 2.1.1; ref 05 §Data visualisation).
    -->
    <table class="sr-only">
      <caption>Revenue by day, past {data.length} days</caption>
      <thead>
        <tr>
          <th scope="col">Day</th>
          <th scope="col">Revenue</th>
        </tr>
      </thead>
      <tbody>
        {#each data as point (point.date)}
          <tr>
            <td>{formatDate(point.date)}</td>
            <td>{formatPriceCompact(point.revenue)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .chart-container {
    width: 100%;
    min-height: 200px;
    max-height: 280px;
    padding: var(--space-2) 0;
    position: relative;
  }

  .chart-bars {
    display: flex;
    align-items: flex-end;
    gap: var(--space-0-5);
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
    background-color: var(--color-interactive);
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    transition: var(--transition-colors);
    min-height: 2px;
  }

  .bar-zero {
    background-color: var(--color-surface-secondary);
  }

  .bar-wrapper:hover .bar {
    background-color: var(--color-interactive-hover);
  }

  .bar-wrapper:hover .bar.bar-zero {
    background-color: var(--color-border);
  }

  /* Tooltip — sighted-mouse polish only.
     Keyboard + SR users consume the sibling sr-only table. */
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
    gap: var(--space-0-5);
    z-index: 10;
    pointer-events: none;
  }

  .bar-wrapper:hover .bar-tooltip {
    display: flex;
  }

  .tooltip-date {
    opacity: var(--opacity-80);
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
    gap: var(--space-1);
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
      opacity: var(--opacity-40);
    }
    50% {
      opacity: var(--opacity-80);
    }
  }

  /* Infinite-iteration animations bypass the token-level duration collapse;
     neutralise for vestibular safety (ref 03 §9 Skeleton Contract). */
  @media (prefers-reduced-motion: reduce) {
    .skeleton-bar {
      animation: none;
    }
  }
</style>

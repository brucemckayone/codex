<!--
  @component HeroAnalyticsChart

  Hero time-series chart for the rebuilt studio analytics page. Three tabs
  (Revenue / Subscribers / Followers) each render a full-width SVG line +
  area chart with an optional compare-period overlay. Hand-rolled SVG —
  same sparkline pattern as KPICard, scaled up with axes and a hover
  tooltip.

  The compare overlay is drawn on a normalised index-based time axis:
  main range day N aligns with compare range day N. The two windows may
  have different calendar dates but we guarantee equal duration upstream
  (AnalyticsCommandBar's `previousPeriod`).

  @prop {RevenueStats}    revenue            Current + previous revenue block
  @prop {SubscriberStats} subscribers        Current + previous subscribers block
  @prop {FollowerStats}   followers          Current + previous followers block
  @prop {boolean}         hasCompareWindow   When true AND the active tab's block has `previous`, overlay renders
  @prop {boolean}         [loading=false]    Shimmer skeleton state
  @prop {'revenue'|'subscribers'|'followers'} [initialTab='revenue']  Initial active tab
-->
<script lang="ts">
  import type {
    FollowerStats,
    RevenueStats,
    SubscriberStats,
  } from '@codex/admin';
  import * as m from '$paraglide/messages';
  import { Tabs } from '$lib/components/ui';
  import { formatPriceCompact } from '$lib/utils/format';

  type TabKey = 'revenue' | 'subscribers' | 'followers';

  interface Props {
    revenue: RevenueStats;
    subscribers: SubscriberStats;
    followers: FollowerStats;
    hasCompareWindow: boolean;
    loading?: boolean;
    initialTab?: TabKey;
  }

  const {
    revenue,
    subscribers,
    followers,
    hasCompareWindow,
    loading = false,
    initialTab = 'revenue',
  }: Props = $props();

  let activeTab = $state<string | undefined>(initialTab);

  // ─── Formatters ─────────────────────────────────────────────────────────
  const numberFormatter = new Intl.NumberFormat('en-GB');
  const axisDateFormatter = new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    day: 'numeric',
  });
  const tooltipDateFormatter = new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  // ─── Data normalisation ─────────────────────────────────────────────────
  // Each tab maps to { date, value } points for main + optional previous series.
  interface Point {
    date: string;
    value: number;
  }

  interface Series {
    main: Point[];
    previous: Point[] | null;
  }

  const revenueSeries = $derived<Series>({
    main: revenue.revenueByDay.map((d) => ({
      date: d.date,
      value: d.revenueCents,
    })),
    previous:
      revenue.previous?.revenueByDay.map((d) => ({
        date: d.date,
        value: d.revenueCents,
      })) ?? null,
  });

  const subscriberSeries = $derived<Series>({
    main: subscribers.subscribersByDay.map((d) => ({
      date: d.date,
      value: d.newSubscribers,
    })),
    previous:
      subscribers.previous?.subscribersByDay.map((d) => ({
        date: d.date,
        value: d.newSubscribers,
      })) ?? null,
  });

  const followerSeries = $derived<Series>({
    main: followers.followersByDay.map((d) => ({
      date: d.date,
      value: d.newFollowers,
    })),
    previous:
      followers.previous?.followersByDay.map((d) => ({
        date: d.date,
        value: d.newFollowers,
      })) ?? null,
  });

  const activeSeries = $derived<Series>(
    activeTab === 'subscribers'
      ? subscriberSeries
      : activeTab === 'followers'
        ? followerSeries
        : revenueSeries
  );

  const activeKey = $derived<TabKey>(
    activeTab === 'subscribers' || activeTab === 'followers'
      ? activeTab
      : 'revenue'
  );

  const isMoney = $derived(activeKey === 'revenue');

  // Compare overlay only renders when the bar says compare is on AND the
  // active tab's block actually carries previous data.
  const showCompare = $derived(
    hasCompareWindow &&
      activeSeries.previous !== null &&
      activeSeries.previous.length >= 2
  );

  // ─── Chart geometry (viewBox coordinate space) ──────────────────────────
  // SVG viewBox numbers are arbitrary — preserveAspectRatio="none" scales
  // the path horizontally to the container width. vector-effect on strokes
  // keeps line width visually correct. Axis labels live in HTML siblings so
  // text doesn't distort.
  const VB_WIDTH = 1000;
  const VB_HEIGHT = 260;
  const PAD_X = 8;
  const PAD_TOP = 12;
  const PAD_BOTTOM = 12;

  const innerWidth = VB_WIDTH - PAD_X * 2;
  const innerHeight = VB_HEIGHT - PAD_TOP - PAD_BOTTOM;

  function valueFormatter(value: number): string {
    return isMoney ? formatPriceCompact(value) : numberFormatter.format(value);
  }

  // Domain combines both series so compare overlay stays in-frame. We
  // always anchor the Y floor to 0 — time-series counts (subs, followers,
  // revenue/day) read more honestly from zero than from a floating min.
  interface Domain {
    min: number;
    max: number;
    steps: number;
    stepCount: number;
  }

  function niceCeil(raw: number): number {
    if (raw <= 0) return 1;
    const exp = Math.floor(Math.log10(raw));
    const base = Math.pow(10, exp);
    const frac = raw / base;
    let nice: number;
    if (frac <= 1) nice = 1;
    else if (frac <= 2) nice = 2;
    else if (frac <= 5) nice = 5;
    else nice = 10;
    return nice * base;
  }

  const domain = $derived.by<Domain>(() => {
    const values: number[] = [];
    for (const p of activeSeries.main) values.push(p.value);
    if (showCompare && activeSeries.previous) {
      for (const p of activeSeries.previous) values.push(p.value);
    }
    const rawMax = values.length > 0 ? Math.max(...values) : 0;
    const max = Math.max(niceCeil(rawMax || 1), 1);
    const stepCount = 4;
    return { min: 0, max, steps: max / stepCount, stepCount };
  });

  interface PathData {
    linePath: string;
    areaPath: string;
    points: Array<{ x: number; y: number; value: number; date: string }>;
  }

  function buildPath(
    points: Point[],
    pointCount: number, // total points on the x axis (main length drives scale)
    domainMax: number
  ): PathData {
    if (points.length < 2 || pointCount < 2) {
      return { linePath: '', areaPath: '', points: [] };
    }
    const stepX = innerWidth / (pointCount - 1);
    const range = domainMax || 1;

    const coords = points.map((point, i) => {
      const x = PAD_X + i * stepX;
      const y =
        PAD_TOP + innerHeight - (point.value / range) * innerHeight;
      return { x, y, value: point.value, date: point.date };
    });

    const linePath = coords
      .map(
        (c, i) =>
          `${i === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`
      )
      .join(' ');

    const first = coords[0];
    const last = coords[coords.length - 1];
    const baseY = PAD_TOP + innerHeight;
    const areaPath = [
      `M${first.x.toFixed(2)},${baseY.toFixed(2)}`,
      `L${first.x.toFixed(2)},${first.y.toFixed(2)}`,
      ...coords
        .slice(1)
        .map((c) => `L${c.x.toFixed(2)},${c.y.toFixed(2)}`),
      `L${last.x.toFixed(2)},${baseY.toFixed(2)}`,
      'Z',
    ].join(' ');

    return { linePath, areaPath, points: coords };
  }

  const mainPath = $derived(
    buildPath(activeSeries.main, activeSeries.main.length, domain.max)
  );

  // Compare series is normalised to MAIN's point count so day-1-of-main
  // aligns with day-1-of-compare visually, regardless of calendar date.
  const comparePath = $derived.by<PathData>(() => {
    if (!showCompare || !activeSeries.previous) {
      return { linePath: '', areaPath: '', points: [] };
    }
    return buildPath(
      activeSeries.previous,
      activeSeries.main.length,
      domain.max
    );
  });

  // ─── X-axis tick labels (first / middle / last) ─────────────────────────
  interface AxisTick {
    label: string;
    percent: number; // 0..100 position in the chart's inner width
  }

  const xTicks = $derived.by<AxisTick[]>(() => {
    const pts = activeSeries.main;
    if (pts.length < 2) return [];
    const indices =
      pts.length >= 3
        ? [0, Math.floor((pts.length - 1) / 2), pts.length - 1]
        : [0, pts.length - 1];
    return indices.map((i) => ({
      label: axisDateFormatter.format(new Date(pts[i].date)),
      percent: (i / (pts.length - 1)) * 100,
    }));
  });

  const yTicks = $derived.by<AxisTick[]>(() => {
    const ticks: AxisTick[] = [];
    for (let i = 0; i <= domain.stepCount; i++) {
      const value = (domain.max / domain.stepCount) * i;
      ticks.push({
        label: valueFormatter(value),
        // percent from TOP of chart → i=stepCount is the floor (0 value)
        percent: ((domain.stepCount - i) / domain.stepCount) * 100,
      });
    }
    return ticks;
  });

  // ─── Empty state ─────────────────────────────────────────────────────────
  const isEmpty = $derived(activeSeries.main.length < 2);

  // ─── Hover tooltip ───────────────────────────────────────────────────────
  interface HoverState {
    index: number;
    clientX: number; // 0..1 fraction across the chart surface (for tooltip positioning)
    mainPoint: { x: number; y: number; value: number; date: string };
    comparePoint: { value: number; date: string } | null;
  }

  let hover = $state<HoverState | null>(null);
  let chartSurface: HTMLDivElement | undefined = $state();

  function handleMove(event: MouseEvent | TouchEvent) {
    if (!chartSurface || mainPath.points.length === 0) return;
    const rect = chartSurface.getBoundingClientRect();
    const clientX =
      'touches' in event
        ? event.touches[0]?.clientX ?? 0
        : (event as MouseEvent).clientX;
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const index = Math.round(frac * (mainPath.points.length - 1));
    const mainPoint = mainPath.points[index];
    if (!mainPoint) return;
    const comparePoint =
      showCompare && comparePath.points[index]
        ? {
            value: comparePath.points[index].value,
            date: comparePath.points[index].date,
          }
        : null;
    hover = { index, clientX: frac, mainPoint, comparePoint };
  }

  function handleLeave() {
    hover = null;
  }

  const tooltipDelta = $derived.by(() => {
    if (!hover?.comparePoint) return null;
    const prev = hover.comparePoint.value;
    const current = hover.mainPoint.value;
    if (prev === 0) return null;
    const pct = Math.round(((current - prev) / Math.abs(prev)) * 100);
    return pct;
  });

  // ─── Accessibility summary ──────────────────────────────────────────────
  const ariaLabel = $derived.by(() => {
    const pts = activeSeries.main;
    const days = pts.length;
    const total = pts.reduce((sum, p) => sum + p.value, 0);
    const totalStr = valueFormatter(total);
    if (activeKey === 'subscribers') {
      return m.analytics_chart_aria_subscribers({
        days: String(days),
        total: totalStr,
      });
    }
    if (activeKey === 'followers') {
      return m.analytics_chart_aria_followers({
        days: String(days),
        total: totalStr,
      });
    }
    return m.analytics_chart_aria_revenue({
      days: String(days),
      total: totalStr,
    });
  });
</script>

<div class="hero-chart" data-loading={loading ? 'true' : 'false'}>
  {#if loading}
    <span class="sr-only">{m.analytics_chart_loading_label()}</span>
    <div class="hero-chart__skeleton-tabs" aria-hidden="true">
      <div class="hero-chart__skeleton-tab"></div>
      <div class="hero-chart__skeleton-tab"></div>
      <div class="hero-chart__skeleton-tab"></div>
    </div>
    <div class="hero-chart__skeleton-body" aria-hidden="true"></div>
  {:else}
    <Tabs.Root bind:value={activeTab} class="hero-chart__tabs">
      <Tabs.List class="hero-chart__tabs-list">
        <Tabs.Trigger value="revenue">
          {m.analytics_chart_tab_revenue()}
        </Tabs.Trigger>
        <Tabs.Trigger value="subscribers">
          {m.analytics_chart_tab_subscribers()}
        </Tabs.Trigger>
        <Tabs.Trigger value="followers">
          {m.analytics_chart_tab_followers()}
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="revenue" class="hero-chart__panel">
        {#if activeKey === 'revenue'}
          {@render chartBody()}
        {/if}
      </Tabs.Content>
      <Tabs.Content value="subscribers" class="hero-chart__panel">
        {#if activeKey === 'subscribers'}
          {@render chartBody()}
        {/if}
      </Tabs.Content>
      <Tabs.Content value="followers" class="hero-chart__panel">
        {#if activeKey === 'followers'}
          {@render chartBody()}
        {/if}
      </Tabs.Content>
    </Tabs.Root>
  {/if}
</div>

{#snippet chartBody()}
  {#if isEmpty}
    <div class="hero-chart__empty">
      <p class="hero-chart__empty-text">{m.analytics_chart_empty()}</p>
    </div>
  {:else}
    <div class="hero-chart__layout">
      <!-- Y-axis labels rendered in HTML so text stays crisp.
           Each tick is absolutely positioned by top-percent. -->
      <div class="hero-chart__y-axis" aria-hidden="true">
        {#each yTicks as tick, i (i)}
          <span
            class="hero-chart__y-tick"
            style:top="{tick.percent}%"
          >
            {tick.label}
          </span>
        {/each}
      </div>

      <div
        class="hero-chart__surface"
        bind:this={chartSurface}
        role="img"
        aria-label={ariaLabel}
        onmousemove={handleMove}
        onmouseleave={handleLeave}
        ontouchstart={handleMove}
        ontouchmove={handleMove}
        ontouchend={handleLeave}
      >
        <!-- Grid lines behind the series — purely decorative. -->
        <svg
          class="hero-chart__grid"
          viewBox="0 0 {VB_WIDTH} {VB_HEIGHT}"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {#each yTicks as tick, i (i)}
            {@const y =
              PAD_TOP + innerHeight * (tick.percent / 100)}
            <line
              class="hero-chart__gridline"
              x1={PAD_X}
              x2={VB_WIDTH - PAD_X}
              y1={y}
              y2={y}
            />
          {/each}
        </svg>

        <svg
          class="hero-chart__series"
          viewBox="0 0 {VB_WIDTH} {VB_HEIGHT}"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {#if showCompare && comparePath.linePath}
            <path
              class="hero-chart__compare-line"
              d={comparePath.linePath}
            />
          {/if}
          <path class="hero-chart__area" d={mainPath.areaPath} />
          <path class="hero-chart__line" d={mainPath.linePath} />
        </svg>

        {#if hover}
          <!-- Cursor guide line -->
          <div
            class="hero-chart__cursor"
            style:left="{hover.clientX * 100}%"
            aria-hidden="true"
          ></div>

          <!-- Tooltip anchored above the cursor, clamped with translate rules. -->
          <div
            class="hero-chart__tooltip"
            style:left="{hover.clientX * 100}%"
            data-align={hover.clientX > 0.7
              ? 'right'
              : hover.clientX < 0.3
                ? 'left'
                : 'center'}
            role="presentation"
          >
            <span class="hero-chart__tooltip-date">
              {tooltipDateFormatter.format(
                new Date(hover.mainPoint.date)
              )}
            </span>
            <span class="hero-chart__tooltip-value">
              {valueFormatter(hover.mainPoint.value)}
            </span>
            {#if hover.comparePoint}
              <span class="hero-chart__tooltip-compare">
                {m.analytics_chart_compare_label()}:
                {valueFormatter(hover.comparePoint.value)}
              </span>
              {#if tooltipDelta !== null}
                <span
                  class="hero-chart__tooltip-delta"
                  data-direction={tooltipDelta > 0
                    ? 'up'
                    : tooltipDelta < 0
                      ? 'down'
                      : 'flat'}
                >
                  {#if tooltipDelta > 0}
                    {m.analytics_chart_tooltip_delta_up({
                      percent: String(Math.abs(tooltipDelta)),
                    })}
                  {:else if tooltipDelta < 0}
                    {m.analytics_chart_tooltip_delta_down({
                      percent: String(Math.abs(tooltipDelta)),
                    })}
                  {:else}
                    {m.analytics_chart_tooltip_delta_flat()}
                  {/if}
                </span>
              {/if}
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <!-- X-axis row sits below the chart surface, aligned to its inner width. -->
    <div class="hero-chart__x-axis" aria-hidden="true">
      {#each xTicks as tick, i (i)}
        <span
          class="hero-chart__x-tick"
          style:left="{tick.percent}%"
          data-align={tick.percent === 0
            ? 'start'
            : tick.percent === 100
              ? 'end'
              : 'center'}
        >
          {tick.label}
        </span>
      {/each}
    </div>

    {#if showCompare}
      <div class="hero-chart__legend" aria-hidden="true">
        <span class="hero-chart__legend-item">
          <span class="hero-chart__legend-swatch hero-chart__legend-swatch--main"></span>
          {m.analytics_chart_current_label()}
        </span>
        <span class="hero-chart__legend-item">
          <span class="hero-chart__legend-swatch hero-chart__legend-swatch--compare"></span>
          {m.analytics_chart_compare_label()}
        </span>
      </div>
    {/if}
  {/if}
{/snippet}

<style>
  .hero-chart {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background-color: var(--color-surface-card);
    color: var(--color-text);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    width: 100%;
  }

  /* Wrap Melt Tabs so the list has consistent spacing with the rest of the
     studio. Global selectors target child components rendered by Tabs.* */
  :global(.hero-chart__tabs) {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  :global(.hero-chart__panel) {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .hero-chart__layout {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-3);
    min-height: calc(var(--space-24) * 2);
  }

  .hero-chart__y-axis {
    position: relative;
    width: var(--space-12);
    height: 100%;
    min-height: calc(var(--space-24) * 2);
  }

  .hero-chart__y-tick {
    position: absolute;
    right: 0;
    transform: translateY(-50%);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
    line-height: var(--leading-none);
    white-space: nowrap;
  }

  .hero-chart__surface {
    position: relative;
    width: 100%;
    min-height: calc(var(--space-24) * 2);
    cursor: crosshair;
  }

  .hero-chart__grid,
  .hero-chart__series {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    overflow: visible;
    pointer-events: none;
  }

  .hero-chart__gridline {
    stroke: var(--color-border);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
    opacity: var(--opacity-50);
  }

  .hero-chart__area {
    fill: color-mix(in srgb, var(--color-interactive) 12%, transparent);
    stroke: none;
  }

  .hero-chart__line {
    fill: none;
    stroke: var(--color-interactive);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }

  .hero-chart__compare-line {
    fill: none;
    stroke: color-mix(in srgb, var(--color-interactive) 45%, transparent);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 4 4;
    vector-effect: non-scaling-stroke;
  }

  /* Vertical cursor guide */
  .hero-chart__cursor {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background-color: var(--color-border);
    opacity: var(--opacity-70);
    pointer-events: none;
    transform: translateX(-50%);
  }

  /* Tooltip — positioned above the cursor, clamped to chart bounds via
     data-align translate rules so it never overflows on edges. */
  .hero-chart__tooltip {
    position: absolute;
    bottom: calc(100% + var(--space-2));
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    padding: var(--space-2) var(--space-3);
    background-color: var(--color-text);
    color: var(--color-background);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    font-size: var(--text-xs);
    white-space: nowrap;
    pointer-events: none;
    z-index: 2;
  }

  .hero-chart__tooltip[data-align='center'] {
    transform: translateX(-50%);
  }

  .hero-chart__tooltip[data-align='left'] {
    transform: translateX(0);
  }

  .hero-chart__tooltip[data-align='right'] {
    transform: translateX(-100%);
  }

  .hero-chart__tooltip-date {
    opacity: var(--opacity-80);
  }

  .hero-chart__tooltip-value {
    font-weight: var(--font-semibold);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  .hero-chart__tooltip-compare {
    opacity: var(--opacity-70);
    font-variant-numeric: tabular-nums;
  }

  .hero-chart__tooltip-delta {
    font-weight: var(--font-medium);
    font-variant-numeric: tabular-nums;
  }

  .hero-chart__tooltip-delta[data-direction='up'] {
    color: var(--color-success);
  }

  .hero-chart__tooltip-delta[data-direction='down'] {
    color: var(--color-error);
  }

  .hero-chart__tooltip-delta[data-direction='flat'] {
    opacity: var(--opacity-80);
  }

  /* X-axis row aligned to the chart surface (Y-axis column + gap). */
  .hero-chart__x-axis {
    position: relative;
    margin-inline-start: calc(var(--space-12) + var(--space-3));
    height: var(--space-4);
  }

  .hero-chart__x-tick {
    position: absolute;
    top: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .hero-chart__x-tick[data-align='center'] {
    transform: translateX(-50%);
  }

  .hero-chart__x-tick[data-align='end'] {
    transform: translateX(-100%);
  }

  /* Legend — only appears when compare overlay is active. */
  .hero-chart__legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    padding-inline-start: calc(var(--space-12) + var(--space-3));
  }

  .hero-chart__legend-item {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .hero-chart__legend-swatch {
    display: inline-block;
    width: var(--space-4);
    height: var(--space-1);
    border-radius: var(--radius-sm);
  }

  .hero-chart__legend-swatch--main {
    background-color: var(--color-interactive);
  }

  .hero-chart__legend-swatch--compare {
    background: repeating-linear-gradient(
      to right,
      color-mix(in srgb, var(--color-interactive) 45%, transparent) 0,
      color-mix(in srgb, var(--color-interactive) 45%, transparent)
        var(--space-1),
      transparent var(--space-1),
      transparent var(--space-2)
    );
  }

  /* Empty state */
  .hero-chart__empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(var(--space-24) * 2);
  }

  .hero-chart__empty-text {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* Skeleton — dimensions match the loaded layout to prevent CLS. */
  .hero-chart__skeleton-tabs {
    display: flex;
    gap: var(--space-4);
    padding-block-end: var(--space-2);
    border-bottom: var(--border-width) var(--border-style)
      var(--color-border);
  }

  .hero-chart__skeleton-tab {
    width: var(--space-16);
    height: var(--text-base);
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-sm);
    animation: hero-chart-pulse 1.5s ease-in-out infinite;
  }

  .hero-chart__skeleton-body {
    width: 100%;
    min-height: calc(var(--space-24) * 2);
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-md);
    animation: hero-chart-pulse 1.5s ease-in-out infinite;
  }

  @keyframes hero-chart-pulse {
    0%,
    100% {
      opacity: var(--opacity-40);
    }
    50% {
      opacity: var(--opacity-80);
    }
  }

  /* Infinite-iteration animations bypass token-level duration collapse;
     neutralise explicitly for vestibular safety. */
  @media (prefers-reduced-motion: reduce) {
    .hero-chart__skeleton-tab,
    .hero-chart__skeleton-body {
      animation: none;
    }
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
</style>

<!--
  @component KPICard

  Headline metric tile for the studio analytics page. Surfaces a single number
  (revenue, subscribers, followers, etc.) with an optional period-over-period
  delta and a small trend sparkline underneath.

  Used across `_org/[slug]/studio/analytics` and coexists with the simpler
  `StatCard` tile on the studio dashboard.

  @prop {string}  label              Metric label (already localised by caller, e.g. "Total revenue").
  @prop {number}  value              Primary number. For money, treat as pence (GBP).
  @prop {'money'|'number'} [format]  `money` → formatPriceCompact, `number` → Intl.NumberFormat('en-GB'). Default `number`.
  @prop {number|null} [previousValue] Previous-period value for delta. null/undefined/0 skips the delta row.
  @prop {Array<{ date: string; value: number }>} [sparkline] Optional trend data. Omitted → no sparkline.
  @prop {boolean} [loading]          Shimmer skeleton state.
  @prop {string}  [unit]             Optional suffix for `format='number'` (e.g. "followers").
  @prop {Snippet} [valueContent]     Bespoke value rendering for advanced callers.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import * as m from '$paraglide/messages';
  import { formatPriceCompact } from '$lib/utils/format';

  interface SparklinePoint {
    date: string;
    value: number;
  }

  interface Props extends HTMLAttributes<HTMLDivElement> {
    label: string;
    value: number;
    format?: 'money' | 'number';
    previousValue?: number | null;
    sparkline?: SparklinePoint[];
    loading?: boolean;
    unit?: string;
    valueContent?: Snippet;
  }

  const {
    label,
    value,
    format = 'number',
    previousValue = null,
    sparkline,
    loading = false,
    unit,
    valueContent,
    class: className,
    ...restProps
  }: Props = $props();

  const numberFormatter = new Intl.NumberFormat('en-GB');

  const formattedValue = $derived(
    format === 'money' ? formatPriceCompact(value) : numberFormatter.format(value)
  );

  // Delta rules: need a valid non-zero previousValue to compute a meaningful %.
  // Zero or null previousValue → no delta row (avoid div-by-zero + meaningless "+∞%").
  const hasDelta = $derived(
    previousValue !== null &&
      previousValue !== undefined &&
      previousValue !== 0 &&
      Number.isFinite(previousValue)
  );

  const deltaPercent = $derived.by(() => {
    if (!hasDelta) return 0;
    const prev = previousValue as number;
    return Math.round(((value - prev) / Math.abs(prev)) * 100);
  });

  const deltaDirection = $derived<'up' | 'down' | 'flat'>(
    !hasDelta || deltaPercent === 0
      ? 'flat'
      : deltaPercent > 0
        ? 'up'
        : 'down'
  );

  const deltaDisplay = $derived(
    deltaPercent > 0 ? `+${deltaPercent}%` : `${deltaPercent}%`
  );

  const deltaAriaLabel = $derived.by(() => {
    if (deltaDirection === 'up') {
      return m.kpi_delta_increase({ percent: String(Math.abs(deltaPercent)) });
    }
    if (deltaDirection === 'down') {
      return m.kpi_delta_decrease({ percent: String(Math.abs(deltaPercent)) });
    }
    return m.kpi_delta_no_change();
  });

  // Empty state: value is zero AND no sparkline data → suppress delta row to
  // avoid a meaningless "0%" indicator (spec: zero/empty state behaviour).
  const showDelta = $derived(
    hasDelta && !(value === 0 && (!sparkline || sparkline.length === 0))
  );

  // Sparkline geometry — viewBox-based so it scales to the card width.
  // Values are normalised into 0..1 then flipped (SVG y=0 is top).
  const SPARK_WIDTH = 100;
  const SPARK_HEIGHT = 28;
  const SPARK_PAD = 2;

  const hasSparkline = $derived(Boolean(sparkline && sparkline.length >= 2));

  const sparkGeometry = $derived.by(() => {
    if (!hasSparkline || !sparkline) {
      return { linePath: '', areaPath: '', min: 0, max: 0 };
    }
    const values = sparkline.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const stepX = (SPARK_WIDTH - SPARK_PAD * 2) / (sparkline.length - 1);
    const innerH = SPARK_HEIGHT - SPARK_PAD * 2;

    const points = sparkline.map((point, i) => {
      const x = SPARK_PAD + i * stepX;
      const y = SPARK_PAD + innerH - ((point.value - min) / range) * innerH;
      return { x, y };
    });

    const linePath = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(' ');

    const first = points[0];
    const last = points[points.length - 1];
    const areaPath = [
      `M${first.x.toFixed(2)},${(SPARK_HEIGHT - SPARK_PAD).toFixed(2)}`,
      `L${first.x.toFixed(2)},${first.y.toFixed(2)}`,
      ...points.slice(1).map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`),
      `L${last.x.toFixed(2)},${(SPARK_HEIGHT - SPARK_PAD).toFixed(2)}`,
      'Z',
    ].join(' ');

    return { linePath, areaPath, min, max };
  });

  const sparkAriaLabel = $derived(
    hasSparkline && sparkline
      ? m.kpi_sparkline_label({
          count: String(sparkline.length),
          min:
            format === 'money'
              ? formatPriceCompact(sparkGeometry.min)
              : numberFormatter.format(sparkGeometry.min),
          max:
            format === 'money'
              ? formatPriceCompact(sparkGeometry.max)
              : numberFormatter.format(sparkGeometry.max),
        })
      : ''
  );
</script>

<div
  class="kpi-card {className ?? ''}"
  data-loading={loading ? 'true' : 'false'}
  aria-busy={loading}
  aria-live={loading ? 'polite' : undefined}
  {...restProps}
>
  {#if loading}
    <span class="sr-only">{m.kpi_loading_label()}</span>
    <div class="kpi-card__skeleton-label" aria-hidden="true"></div>
    <div class="kpi-card__skeleton-value" aria-hidden="true"></div>
    <div class="kpi-card__skeleton-spark" aria-hidden="true"></div>
  {:else}
    <span class="kpi-card__label">{label}</span>

    <div class="kpi-card__value-row">
      {#if valueContent}
        {@render valueContent()}
      {:else}
        <span class="kpi-card__value">{formattedValue}</span>
        {#if unit && format === 'number'}
          <span class="kpi-card__unit">{unit}</span>
        {/if}
      {/if}
    </div>

    {#if showDelta}
      <div class="kpi-card__delta" data-direction={deltaDirection}>
        {#if deltaDirection === 'up'}
          <svg
            class="kpi-card__delta-glyph"
            viewBox="0 0 12 12"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M6 2 L10 7 L7 7 L7 10 L5 10 L5 7 L2 7 Z"
              fill="currentColor"
            />
          </svg>
        {:else if deltaDirection === 'down'}
          <svg
            class="kpi-card__delta-glyph"
            viewBox="0 0 12 12"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M6 10 L2 5 L5 5 L5 2 L7 2 L7 5 L10 5 Z"
              fill="currentColor"
            />
          </svg>
        {/if}
        <span class="kpi-card__delta-value" aria-hidden="true">{deltaDisplay}</span>
        <span class="sr-only">{deltaAriaLabel}</span>
      </div>
    {/if}

    {#if hasSparkline}
      <svg
        class="kpi-card__spark"
        viewBox="0 0 {SPARK_WIDTH} {SPARK_HEIGHT}"
        preserveAspectRatio="none"
        role="img"
        aria-label={sparkAriaLabel}
      >
        <path class="kpi-card__spark-area" d={sparkGeometry.areaPath} />
        <path class="kpi-card__spark-line" d={sparkGeometry.linePath} />
      </svg>
    {/if}
  {/if}
</div>

<style>
  .kpi-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    background-color: var(--color-surface-card);
    color: var(--color-text);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    min-height: var(--space-24);
  }

  .kpi-card__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
  }

  .kpi-card__value-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .kpi-card__value {
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    line-height: var(--leading-tight);
    font-variant-numeric: tabular-nums;
  }

  .kpi-card__unit {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
  }

  .kpi-card__delta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    line-height: var(--leading-normal);
  }

  .kpi-card__delta[data-direction='up'] {
    color: var(--color-success);
  }

  .kpi-card__delta[data-direction='down'] {
    color: var(--color-error);
  }

  .kpi-card__delta[data-direction='flat'] {
    color: var(--color-text-secondary);
  }

  .kpi-card__delta-glyph {
    width: var(--space-3);
    height: var(--space-3);
    flex-shrink: 0;
  }

  .kpi-card__delta-value {
    font-variant-numeric: tabular-nums;
  }

  .kpi-card__spark {
    display: block;
    width: 100%;
    height: var(--space-8);
    overflow: visible;
    margin-top: auto;
  }

  .kpi-card__spark-line {
    fill: none;
    stroke: var(--color-interactive);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }

  .kpi-card__spark-area {
    fill: color-mix(in srgb, var(--color-interactive) 12%, transparent);
    stroke: none;
  }

  /* Skeleton — dimensions chosen to match the loaded layout so the swap
     doesn't introduce CLS (ref 03 §9 Skeleton Contract). */
  .kpi-card__skeleton-label,
  .kpi-card__skeleton-value,
  .kpi-card__skeleton-spark {
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-sm);
    animation: kpi-card-pulse 1.5s ease-in-out infinite;
  }

  .kpi-card__skeleton-label {
    width: 40%;
    height: var(--text-sm);
  }

  .kpi-card__skeleton-value {
    width: 60%;
    height: var(--text-3xl);
  }

  .kpi-card__skeleton-spark {
    width: 100%;
    height: var(--space-8);
    margin-top: auto;
  }

  @keyframes kpi-card-pulse {
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
    .kpi-card__skeleton-label,
    .kpi-card__skeleton-value,
    .kpi-card__skeleton-spark {
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

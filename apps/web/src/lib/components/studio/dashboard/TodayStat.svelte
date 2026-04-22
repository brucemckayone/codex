<!--
  @component TodayStat

  Editorial numbered stat tile for the dashboard. Replaces StatCard with:
  - "01/04" ordinal eyebrow (like ContentForm FormSection) for editorial rhythm
  - Big-type value with tabular numerals
  - Optional change chip (Δ% vs previous 7-day)
  - Inline 14-point sparkline rendered beneath the value using brand
    interactive colour with a subtle area fill

  @prop ordinal  Zero-padded index ("01", "02") for eyebrow
  @prop label    Metric name
  @prop value    Display string (already formatted — formatPrice/number)
  @prop change   Percentage change vs previous period (optional)
  @prop series   Optional numeric series for the sparkline (14 points recommended)
  @prop loading  True while data is pending
  @prop variant  'feature' (primary tile, taller) or 'inline' (compact row)
-->
<script lang="ts">
  interface Props {
    ordinal: string;
    label: string;
    value: string | number;
    change?: number;
    series?: number[];
    loading?: boolean;
    variant?: 'feature' | 'inline';
  }

  const {
    ordinal,
    label,
    value,
    change,
    series = [],
    loading = false,
    variant = 'inline',
  }: Props = $props();

  // Build a simple polyline path for the sparkline.
  // The viewBox is 100x30; x spans evenly, y inverts around the max.
  const spark = $derived.by(() => {
    if (!series || series.length < 2) return null;
    const maxVal = Math.max(...series, 1);
    const step = 100 / (series.length - 1);
    const points = series.map((v, i) => {
      const x = i * step;
      const y = 30 - (v / maxVal) * 28 - 1; // 1px top padding
      return [x, y] as const;
    });
    const line = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    const area = `0,30 ${line} 100,30`;
    return { line, area };
  });

  const changeDirection = $derived(
    change === undefined || change === 0
      ? 'flat'
      : change > 0
        ? 'up'
        : 'down'
  );

  const changeText = $derived(
    change === undefined
      ? null
      : change > 0
        ? `+${change}%`
        : `${change}%`
  );
</script>

<article
  class="today-stat"
  data-variant={variant}
  data-loading={loading || undefined}
  aria-busy={loading}
>
  <header class="stat-header">
    <span class="stat-ordinal" aria-hidden="true">{ordinal}</span>
    <h3 class="stat-label">{label}</h3>
    {#if changeText}
      <span class="stat-change" data-direction={changeDirection} aria-label="Change versus previous period {changeText}">
        <span class="change-arrow" aria-hidden="true">
          {#if changeDirection === 'up'}↑{:else if changeDirection === 'down'}↓{:else}—{/if}
        </span>
        {changeText}
      </span>
    {/if}
  </header>

  <div class="stat-body">
    {#if loading}
      <div class="stat-value-skeleton" aria-hidden="true"></div>
    {:else}
      <span class="stat-value">{value}</span>
    {/if}
  </div>

  {#if variant === 'feature'}
    <div class="stat-spark" aria-hidden="true">
      {#if spark}
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" class="spark-svg">
          <polygon points={spark.area} class="spark-area" />
          <polyline points={spark.line} class="spark-line" />
        </svg>
      {:else}
        <span class="spark-empty"></span>
      {/if}
    </div>
  {/if}
</article>

<style>
  .today-stat {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-5) var(--space-5);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    transition: border-color var(--duration-normal) var(--ease-out),
                box-shadow var(--duration-normal) var(--ease-out);
    min-width: 0;
  }

  .today-stat[data-variant='feature'] {
    padding: var(--space-6);
    gap: var(--space-3);
    background:
      /* subtle brand-tinted wash top-right — distinctive texture */
      radial-gradient(
        120% 80% at 100% 0%,
        color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 8%, transparent),
        transparent 60%
      ),
      var(--color-surface);
  }

  /* ── Header (ordinal + label + change) ──────────────────────── */
  .stat-header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: baseline;
    column-gap: var(--space-3);
  }

  .stat-ordinal {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-muted);
    /* matches FormSection editorial rule */
    border-right: var(--border-width) var(--border-style) var(--color-border);
    padding-right: var(--space-3);
    line-height: var(--leading-none);
  }

  .stat-label {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-secondary);
  }

  .stat-change {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full, 9999px);
    font-family: var(--font-mono);
    font-feature-settings: 'tnum';
    font-variant-numeric: tabular-nums;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    line-height: var(--leading-none);
    background: var(--color-surface-secondary);
    color: var(--color-text-muted);
  }

  .stat-change[data-direction='up'] {
    color: var(--color-success-700);
    background: color-mix(in srgb, var(--color-success-500) 10%, var(--color-surface));
  }

  .stat-change[data-direction='down'] {
    color: var(--color-error-700, var(--color-error-500));
    background: color-mix(in srgb, var(--color-error-500) 10%, var(--color-surface));
  }

  .change-arrow {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    line-height: 1;
  }

  /* ── Body (big-type value) ──────────────────────────────────── */
  .stat-body {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-height: var(--space-10);
  }

  .stat-value {
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    letter-spacing: var(--tracking-tighter);
    line-height: var(--leading-none);
    color: var(--color-text);
    font-feature-settings: 'tnum';
    font-variant-numeric: tabular-nums;
  }

  .today-stat[data-variant='feature'] .stat-value {
    /* clamp lets this read as hero on wide tiles, proportional on narrow */
    font-size: clamp(var(--text-3xl), 2.4vw + 1rem, var(--text-5xl));
  }

  .stat-value-skeleton {
    width: 60%;
    height: var(--text-2xl);
    background: linear-gradient(
      90deg,
      var(--color-surface-secondary) 25%,
      var(--color-surface-tertiary) 50%,
      var(--color-surface-secondary) 75%
    );
    background-size: 200% 100%;
    animation: shimmer var(--duration-slowest, 1500ms) linear infinite;
    border-radius: var(--radius-sm);
  }

  @media (prefers-reduced-motion: reduce) {
    .stat-value-skeleton { animation: none; }
  }

  /* ── Sparkline ───────────────────────────────────────────── */
  .stat-spark {
    height: 2rem; /* 32px — matches one-third of stat-body height for proportional tile */
    margin-top: var(--space-2);
  }

  .spark-svg {
    width: 100%;
    height: 100%;
    display: block;
    overflow: visible;
  }

  .spark-line {
    fill: none;
    stroke: var(--color-brand-primary, var(--color-interactive));
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }

  .spark-area {
    fill: color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 12%, transparent);
    stroke: none;
  }

  .spark-empty {
    display: block;
    width: 100%;
    height: 100%;
    border-bottom: var(--border-width) dashed var(--color-border);
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>

<!--
  @component ProgressRing

  Token-driven circular completion indicator (FRONTEND-MAP §5.3 — net-new).
  Used for course + stage progress on the journey dashboard. Presentational:
  the caller supplies an already-computed integer percent.

  @prop {number} percent - Completion 0–100 (clamped).
  @prop {string} [size] - CSS length for the ring diameter. Default 1 stage tile.
  @prop {boolean} [showLabel=true] - Render the "N%" (or check at 100%) in-ring.
  @prop {string} [ariaLabel] - Accessible label; falls back to "N% complete".
-->
<script lang="ts">
  import { CheckIcon } from '$lib/components/ui/Icon';

  interface Props {
    percent: number;
    size?: string;
    showLabel?: boolean;
    ariaLabel?: string;
  }

  const {
    percent,
    size = 'var(--space-16)',
    showLabel = true,
    ariaLabel,
  }: Props = $props();

  // Clamp to a valid integer percentage.
  const pct = $derived(Math.max(0, Math.min(100, Math.round(percent))));
  const isComplete = $derived(pct >= 100);

  // Geometry lives in the SVG viewBox coordinate space (unitless — not CSS px).
  const RADIUS = 16;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const dashOffset = $derived(CIRCUMFERENCE * (1 - pct / 100));
  const label = $derived(ariaLabel ?? `${pct}% complete`);
</script>

<div
  class="ring"
  class:ring--complete={isComplete}
  style="--journey-ring-size: {size};"
  role="img"
  aria-label={label}
>
  <svg viewBox="0 0 40 40" aria-hidden="true">
    <circle class="ring__track" cx="20" cy="20" r={RADIUS} />
    <circle
      class="ring__value"
      cx="20"
      cy="20"
      r={RADIUS}
      stroke-dasharray={CIRCUMFERENCE}
      stroke-dashoffset={dashOffset}
    />
  </svg>
  {#if showLabel}
    <span class="ring__label">
      {#if isComplete}
        <CheckIcon />
      {:else}
        {pct}<span class="ring__pct">%</span>
      {/if}
    </span>
  {/if}
</div>

<style>
  .ring {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: var(--journey-ring-size);
    height: var(--journey-ring-size);
  }

  svg {
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
  }

  .ring__track {
    fill: none;
    stroke: var(--color-border-subtle);
    stroke-width: 3;
  }

  .ring__value {
    fill: none;
    stroke: var(--color-primary-600);
    stroke-width: 3;
    stroke-linecap: round;
    transition: stroke-dashoffset var(--duration-slow) ease;
  }

  .ring--complete .ring__value {
    stroke: var(--color-success);
  }

  .ring__label {
    position: absolute;
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-0-5);
    font-family: var(--font-heading);
    font-weight: var(--font-semibold);
    font-size: var(--text-sm);
    color: var(--color-heading);
    line-height: var(--leading-none);
  }

  .ring--complete .ring__label {
    color: var(--color-success);
  }

  .ring__pct {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  @media (prefers-reduced-motion: reduce) {
    .ring__value {
      transition: none;
    }
  }
</style>

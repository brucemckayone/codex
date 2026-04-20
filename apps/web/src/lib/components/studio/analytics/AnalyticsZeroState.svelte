<!--
  @component AnalyticsZeroState

  Full-page zero state for the studio analytics surface. Rendered when the
  org genuinely has no activity yet (new workspace, no customers, no
  published content, no playback). Purely illustrative — NOT actionable.
  No CTAs, no buttons. Communicates "your chart is waiting" via a faint,
  hand-rolled flat-graph motif that matches the SVG language of
  KPICard.svelte and HeroAnalyticsChart.svelte.

  Illustration: four stacked paths with a low-amplitude sine undulation,
  rendered at descending opacities over a faint horizontal grid. Fully
  static — no keyframes or JS animation — so prefers-reduced-motion is
  honoured by construction.

  @prop {string} [class]  Optional outer class for layout control.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';

  interface Props {
    class?: string;
  }

  const { class: className }: Props = $props();

  // ─── Illustration geometry ──────────────────────────────────────────────
  // viewBox is arbitrary — preserveAspectRatio + max-width on the <svg>
  // scale this responsively. Matches the stroke/vector-effect pattern from
  // KPICard's sparkline + HeroAnalyticsChart's series paths.
  const VB_WIDTH = 320;
  const VB_HEIGHT = 120;
  const PAD_X = 12;

  // Four stacked lines, top to bottom. Opacities descend so the eye lands
  // on the topmost "this is where your trend will live" path.
  interface LineSpec {
    y: number; // base y (viewBox units)
    amplitude: number; // sine peak-to-trough / 2 in viewBox units
    phase: number; // radians
    frequency: number; // cycles across the full width
    opacity: number; // 0..1
  }

  const LINES: LineSpec[] = [
    { y: 32, amplitude: 3.5, phase: 0.2, frequency: 1.4, opacity: 1 },
    { y: 58, amplitude: 2.5, phase: 1.6, frequency: 1.1, opacity: 0.6 },
    { y: 80, amplitude: 2, phase: 3.1, frequency: 1.6, opacity: 0.35 },
    { y: 100, amplitude: 1.5, phase: 4.4, frequency: 0.9, opacity: 0.2 },
  ];

  // Grid marks (behind the lines) — 5 horizontal rules at low opacity to
  // reinforce the "chart grid waiting for data" reading.
  const GRID_YS = [20, 44, 68, 92, 112];

  // Pre-compute each line path at authoring time. Small sample count (33
  // points) keeps the DOM tiny and the curve readably gentle.
  const SAMPLES = 32;
  const innerWidth = VB_WIDTH - PAD_X * 2;

  function buildPath(line: LineSpec): string {
    const segments: string[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const x = PAD_X + t * innerWidth;
      const y =
        line.y +
        Math.sin(t * Math.PI * 2 * line.frequency + line.phase) *
          line.amplitude;
      segments.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return segments.join(' ');
  }

  const linePaths = LINES.map((line) => ({
    d: buildPath(line),
    opacity: line.opacity,
  }));
</script>

<section
  class="zero-state {className ?? ''}"
  aria-labelledby="analytics-zero-state-heading"
>
  <svg
    class="zero-state__illustration"
    viewBox="0 0 {VB_WIDTH} {VB_HEIGHT}"
    preserveAspectRatio="xMidYMid meet"
    role="img"
    aria-label={m.analytics_zero_state_illustration_alt()}
  >
    <!-- Faint horizontal grid marks (chart-grid-in-waiting) -->
    <g class="zero-state__grid" aria-hidden="true">
      {#each GRID_YS as gy (gy)}
        <line
          x1={PAD_X}
          x2={VB_WIDTH - PAD_X}
          y1={gy}
          y2={gy}
        />
      {/each}
    </g>

    <!-- Stacked flat lines with subtle sine undulation -->
    <g class="zero-state__lines" aria-hidden="true">
      {#each linePaths as path, i (i)}
        <path d={path.d} style:opacity={path.opacity} />
      {/each}
    </g>
  </svg>

  <div class="zero-state__copy">
    <h2 id="analytics-zero-state-heading" class="zero-state__heading">
      {m.analytics_zero_state_heading()}
    </h2>
    <p class="zero-state__description">
      {m.analytics_zero_state_description()}
    </p>
  </div>
</section>

<style>
  .zero-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-8);
    padding-block: var(--space-16);
    padding-inline: var(--space-6);
    width: 100%;
    text-align: center;
  }

  .zero-state__illustration {
    display: block;
    width: 100%;
    max-width: 25rem;
    height: auto;
    /* Reserve vertical space to prevent CLS — aspect derived from
       viewBox 320 × 120 = 8:3. */
    aspect-ratio: 8 / 3;
    overflow: visible;
  }

  .zero-state__grid > line {
    stroke: var(--color-border);
    stroke-width: 1;
    stroke-dasharray: 2 4;
    opacity: var(--opacity-30, 0.3);
    vector-effect: non-scaling-stroke;
  }

  .zero-state__lines > path {
    fill: none;
    stroke: color-mix(in srgb, var(--color-interactive) 55%, transparent);
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }

  .zero-state__copy {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-width: 32rem;
  }

  .zero-state__heading {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: var(--font-semibold);
    line-height: var(--leading-snug);
    color: var(--color-text);
    margin: 0;
  }

  .zero-state__description {
    font-size: var(--text-sm);
    font-weight: var(--font-normal);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
    margin: 0;
  }
</style>

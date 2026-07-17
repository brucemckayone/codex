<!--
  @component AudioWaveform

  Decorative SVG waveform primitive for audio content cards. Renders a thin
  horizontal strip of bars whose heights are derived deterministically from
  the content `id` — a simple FNV-1a hash seeds each bar so the strip
  appears distinct per card but is byte-identical across SSR and client
  hydration (no flash, no hydration mismatch).

  Treated as decorative: `aria-hidden="true"` and a `role="presentation"`
  kept implicit via the hidden SVG. No stable width/height in the attrs —
  the strip sizes to its container, preserving aspect via `viewBox`.

  Inherits colour via `currentColor` so the parent can tint via `color:`
  (used in ContentCard audio row to pick up brand tint).

  Two rendering modes:
  - `variant='strip'` (default) — thin horizontal decoration used inside
    the audio row under the title.
  - `variant='thumb'` — square, prominent rendering that stands in for a
    missing album-art thumbnail. Bars are chunkier, taller, and tinted so
    the 1:1 tile still reads as an audio signature.

  @prop {string} id       - Content id used to seed bar heights.
  @prop {string} class    - Optional class forwarded to <svg>.
  @prop {number} bars     - Bar count override. Defaults: strip=24, thumb=18.
  @prop {'strip'|'thumb'} variant - Rendering mode; see above.
-->
<script lang="ts">
  interface Props {
    id: string;
    class?: string;
    bars?: number;
    variant?: 'strip' | 'thumb';
  }

  const { id, class: className, bars, variant = 'strip' }: Props = $props();

  // ─────────────────────────────────────────────────────────────────
  // FNV-1a 32-bit hash → deterministic pseudo-random seed.
  // We *must* use a stable hash (not Math.random) so the server-rendered
  // SVG matches the client hydration exactly — otherwise Svelte logs a
  // mismatch and the strip flashes on mount.
  // ─────────────────────────────────────────────────────────────────
  function fnv1a(str: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      // 32-bit FNV prime multiply, stay in unsigned range
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  }

  // xorshift32 — cheap deterministic stream from a seed.
  function* xorshiftStream(seed: number): Generator<number> {
    let x = seed || 0x9e3779b9;
    while (true) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      // Yield normalised [0, 1)
      yield x / 0xffffffff;
    }
  }

  // Resolve bar count with per-variant defaults. Strip renders a dense, fine
  // wave (matches the AudioPlayer scrubber's 20–40 bars); thumb renders
  // fewer, chunkier bars so the square album-art fallback reads at a glance.
  const barCount = $derived(bars ?? (variant === 'thumb' ? 24 : 40));

  // ── Slot-based geometry ───────────────────────────────────────────
  // Each bar owns a fixed-width horizontal SLOT and the viewBox WIDTH
  // scales with the bar count, so the bar:gap ratio is CONSTANT no matter
  // how many bars a caller asks for. This is the fix for the "blocky"
  // editor's-pick wave: the old fixed 240-unit viewBox made `bars={64}`
  // overflow into a NEGATIVE gap, so rectangles overlapped into solid
  // slabs. With a scaled viewBox + `preserveAspectRatio="none"`, the clean
  // strip simply stretches to fill whatever box it is handed.
  const SLOT = 10;
  // Skinny bars + wide gaps mirror the player scrubber (gap ≈ 34–42% of the
  // slot). Thumb keeps slightly chunkier bars for the square fallback tile.
  const GAP_RATIO = $derived(variant === 'thumb' ? 0.34 : 0.42);
  const BAR_WIDTH = $derived(SLOT * (1 - GAP_RATIO));
  const GAP = $derived(SLOT * GAP_RATIO);
  const VIEWBOX_W = $derived(barCount * SLOT);
  const VIEWBOX_H = $derived(variant === 'thumb' ? 120 : 48);

  // Derive bar heights once. `$derived` keeps this reactive if `id`/`bars`
  // changes (rare but cheap). Thumb variant clamps to a narrower band
  // (0.45–1.0) so the silhouette stays full-looking; strip uses a wider
  // band (0.28–1.0) for a livelier scrubber-like silhouette.
  const heights = $derived.by(() => {
    const seed = fnv1a(id);
    const rng = xorshiftStream(seed);
    const out: number[] = [];
    const min = variant === 'thumb' ? 0.45 : 0.28;
    const range = variant === 'thumb' ? 0.55 : 0.72;
    for (let i = 0; i < barCount; i++) {
      const n = rng.next().value ?? 0.5;
      out.push(min + n * range);
    }
    return out;
  });

  const centerY = $derived(VIEWBOX_H / 2);
  // Rounded (not full-pill) caps — echoes the player's `barRadius ≈ 0.4 ×
  // bar width` so bars read as soft rounded strokes, not hard blocks.
  const barRadius = $derived(BAR_WIDTH * 0.4);
</script>

<svg
  class="waveform waveform--{variant} {className ?? ''}"
  viewBox="0 0 {VIEWBOX_W} {VIEWBOX_H}"
  preserveAspectRatio="none"
  aria-hidden="true"
  focusable="false"
  xmlns="http://www.w3.org/2000/svg"
>
  {#each heights as h, i (i)}
    {@const barHeight = h * VIEWBOX_H}
    <rect
      class="waveform__bar"
      style="--_bar-index: {i}; --_bar-count: {barCount};"
      x={i * SLOT + GAP / 2}
      y={centerY - barHeight / 2}
      width={BAR_WIDTH}
      height={barHeight}
      rx={barRadius}
      fill="currentColor"
    />
  {/each}
</svg>

<style>
  .waveform {
    display: block;
    width: 100%;
    height: 100%;
    /* Decorative; don't interrupt pointer events for the wrapping link. */
    pointer-events: none;
  }

  /* ── Strip variant ────────────────────────────────────────────────
     Thin decoration used under the audio-row title. Tinted via parent
     `color:` — see ContentCard audio-row styles. */
  .waveform--strip {
    opacity: var(--opacity-60, 0.6);
  }

  /* ── Thumb variant ────────────────────────────────────────────────
     Stands in for missing album art. Square 1:1 tile. Full opacity —
     the tile IS the audio signature, so the bars need to carry the
     visual weight. Parent supplies the brand tint + backdrop. */
  .waveform--thumb {
    /* Slight inset so bars don't touch the rounded tile edge. */
    padding: var(--space-2);
    box-sizing: border-box;
    opacity: var(--opacity-90, 0.9);
  }

  /* Individual bars carry a private hover-scale hook (`--_bar-hover-scale`)
     so the parent (ContentCard audio-row OR the thumb-fallback) can animate
     them on :hover / :focus-within via CSS with a staggered transition-
     delay. Default is 1 (no scale), reduced-motion collapses to 1 via the
     motion tokens. Bars stay completely static at rest — no idle motion. */
  .waveform__bar {
    transform-origin: center;
    transform: scaleY(var(--_bar-hover-scale, 1));
    transition:
      transform var(--duration-slow) var(--ease-smooth),
      opacity var(--duration-slow) var(--ease-smooth);
    /* Stagger: each bar delays by (index / count) * 120ms — short enough
       to feel like a single gesture, long enough to read as a wave. */
    transition-delay: calc((var(--_bar-index) / var(--_bar-count)) * 120ms);
  }
</style>

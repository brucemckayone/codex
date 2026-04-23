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

  @prop {string} id     - Content id used to seed bar heights.
  @prop {string} class  - Optional class forwarded to <svg>.
  @prop {number} bars   - Bar count, defaults to 24.
-->
<script lang="ts">
  interface Props {
    id: string;
    class?: string;
    bars?: number;
  }

  const { id, class: className, bars = 24 }: Props = $props();

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

  // Viewport fixed — bars scale to fit via width/spacing maths below.
  const VIEWBOX_W = 240;
  const VIEWBOX_H = 24;
  const BAR_WIDTH = 6;

  // Derive bar heights once. `$derived` keeps this reactive if `id`/`bars`
  // changes (rare but cheap).
  const heights = $derived.by(() => {
    const seed = fnv1a(id);
    const rng = xorshiftStream(seed);
    const out: number[] = [];
    for (let i = 0; i < bars; i++) {
      const n = rng.next().value ?? 0.5;
      // Clamp to [0.3, 1.0] — always visibly present, never fills 0.
      out.push(0.3 + n * 0.7);
    }
    return out;
  });

  // Layout maths: evenly-distributed bars across the viewBox width.
  const gap = $derived((VIEWBOX_W - bars * BAR_WIDTH) / (bars - 1));
  const centerY = VIEWBOX_H / 2;
</script>

<svg
  class="waveform {className ?? ''}"
  viewBox="0 0 {VIEWBOX_W} {VIEWBOX_H}"
  preserveAspectRatio="none"
  aria-hidden="true"
  focusable="false"
  xmlns="http://www.w3.org/2000/svg"
>
  {#each heights as h, i (i)}
    {@const barHeight = h * VIEWBOX_H}
    <rect
      x={i * (BAR_WIDTH + gap)}
      y={centerY - barHeight / 2}
      width={BAR_WIDTH}
      height={barHeight}
      rx="1"
      fill="currentColor"
    />
  {/each}
</svg>

<style>
  .waveform {
    display: block;
    width: 100%;
    height: 100%;
    /* Tinted via parent `color:` — see ContentCard audio-row styles. */
    opacity: var(--opacity-60, 0.6);
    /* Decorative; don't interrupt pointer events for the wrapping link. */
    pointer-events: none;
  }
</style>

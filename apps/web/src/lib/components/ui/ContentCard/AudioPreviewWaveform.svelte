<!--
  @component AudioPreviewWaveform

  Live, FFT-reactive sibling of `AudioWaveform`. Same visual silhouette and
  layout maths so both can be swapped 1-for-1 in audio-thumb contexts (see
  Spotlight's audio overlay), but bar heights are driven from a Web Audio
  AnalyserNode's raw byte frequency bins while the source is playing. When
  the analyser is null or paused, falls back to the same deterministic
  FNV-1a heights `AudioWaveform` produces — so SSR / paused-state markup
  is byte-identical to the static component.

  Analyser ownership lives with the caller: Spotlight creates the handle
  via `createAudioAnalyser(audioEl)` on first hover and tears it down on
  unmount. This component is purely a renderer.

  Reduced-motion: `prefers-reduced-motion: reduce` freezes bars at the
  fallback FNV-1a heights even while audio plays. The audio itself is
  unaffected — reduced-motion is about visual motion, not sound.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { AudioAnalyserHandle } from '$lib/components/AudioPlayer/audio-analyser';

  interface Props {
    id: string;
    /**
     * Live analyser handle. `null` (or paused source) → fall back to the
     * deterministic FNV-1a heights so the overlay reads identically to the
     * static `AudioWaveform` until the user triggers preview playback.
     */
    analyser: AudioAnalyserHandle | null;
    class?: string;
    bars?: number;
  }

  const { id, analyser, class: className, bars }: Props = $props();

  // Bar count + viewbox match AudioWaveform's `thumb` variant so the two
  // components are visually interchangeable in the spotlight overlay.
  const barCount = $derived(bars ?? 18);
  const VIEWBOX_W = 120;
  const VIEWBOX_H = 120;
  const BAR_WIDTH = 4;
  const BAR_RADIUS = 2;

  // ── Deterministic fallback heights (FNV-1a + xorshift) ────────────
  // Identical maths to AudioWaveform so the paused-state SSR markup
  // matches byte-for-byte. Hash hoisted out of the live loop so it
  // runs once per id, not every frame.
  function fnv1a(str: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  }

  function* xorshiftStream(seed: number): Generator<number> {
    let x = seed || 0x9e3779b9;
    while (true) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      yield x / 0xffffffff;
    }
  }

  const fallbackHeights = $derived.by(() => {
    const seed = fnv1a(id);
    const rng = xorshiftStream(seed);
    const out: number[] = [];
    for (let i = 0; i < barCount; i++) {
      const n = rng.next().value ?? 0.5;
      // Match AudioWaveform's `thumb` band (0.45–1.0) so paused parity holds.
      out.push(0.45 + n * 0.55);
    }
    return out;
  });

  // ── Live state ────────────────────────────────────────────────────
  // `liveHeights` is a `$state` array so the SVG re-renders cheaply when
  // we mutate individual indices in the RAF loop. We re-initialise via
  // a $derived setter only when bar count changes; per-frame updates
  // mutate in place to avoid GC pressure.
  let liveHeights = $state<number[]>([]);
  let reducedMotion = $state(false);
  let hasRendered = $state(false);

  // EMA state — one per bar, asymmetric attack/release like audio-analyser.
  let smoothed: number[] = [];
  let rafId: number | null = null;
  let lastFrameTime = 0;

  // ── Bar EMA tunables ──────────────────────────────────────────────
  // Mirror audio-analyser.ts's overall attack/release character so the
  // spotlight bars feel of-a-piece with the rest of the audio-reactive
  // system (shader presets, immersive player).
  const ATTACK_SEC = 0.08;
  const RELEASE_SEC = 0.35;
  const MAX_DT = 0.1;
  const MIN_BAR = 0.15;
  const MAX_BAR = 1.0;

  function ema(prev: number, target: number, dt: number): number {
    const tau = target > prev ? ATTACK_SEC : RELEASE_SEC;
    const alpha = 1 - Math.exp(-dt / tau);
    return prev + alpha * (target - prev);
  }

  /**
   * Map FFT bin range to bar heights using a logarithmic window. Human
   * pitch perception is roughly log-scaled, so a linear bin→bar mapping
   * leaves the high end of the spectrum looking dead. The log mapping
   * gives each bar an exponentially wider slice of the spectrum as we
   * move right, matching how the ear groups frequencies.
   */
  function sampleBars(freq: Uint8Array, count: number): number[] {
    const bins = freq.length;
    // Skip the lowest bins — pure DC + sub-bass tends to swamp the
    // visual at the expense of musically-interesting bands.
    const startBin = 2;
    const endBin = Math.min(bins, 220);
    const logStart = Math.log2(startBin);
    const logEnd = Math.log2(endBin);
    const out: number[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const t0 = i / count;
      const t1 = (i + 1) / count;
      const b0 = Math.floor(2 ** (logStart + (logEnd - logStart) * t0));
      const b1 = Math.max(b0 + 1, Math.floor(2 ** (logStart + (logEnd - logStart) * t1)));
      let sum = 0;
      let n = 0;
      for (let b = b0; b < b1 && b < bins; b++) {
        sum += freq[b];
        n++;
      }
      const avg = n > 0 ? sum / n / 255 : 0;
      out[i] = avg;
    }
    return out;
  }

  function tick() {
    rafId = null;
    if (!analyser) return;
    if (reducedMotion) return;

    // Trigger the analyser's own per-frame work first so its smoothed
    // bands stay in lockstep with consumers that read `getAnalysis()`,
    // then read the raw bins our log mapping needs.
    const analysis = analyser.getAnalysis();
    const freq = analyser.getFrequencyData();

    const now = performance.now() / 1000;
    const dt = lastFrameTime === 0 ? 1 / 60 : Math.min(MAX_DT, now - lastFrameTime);
    lastFrameTime = now;

    if (!analysis.active) {
      // Paused source — let bars relax toward fallback heights so the
      // overlay falls back to the static silhouette naturally rather
      // than freezing mid-spike. When fully settled, stop the RAF.
      let allClose = true;
      for (let i = 0; i < barCount; i++) {
        const target = fallbackHeights[i] ?? 0.5;
        smoothed[i] = ema(smoothed[i] ?? target, target, dt);
        liveHeights[i] = smoothed[i];
        if (Math.abs(smoothed[i] - target) > 0.01) allClose = false;
      }
      if (!allClose) {
        rafId = requestAnimationFrame(tick);
      }
      return;
    }

    const targets = sampleBars(freq, barCount);
    for (let i = 0; i < barCount; i++) {
      const t = MIN_BAR + (MAX_BAR - MIN_BAR) * (targets[i] ?? 0);
      smoothed[i] = ema(smoothed[i] ?? t, t, dt);
      liveHeights[i] = smoothed[i];
    }

    rafId = requestAnimationFrame(tick);
  }

  onMount(() => {
    hasRendered = true;
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Track preference changes — DevTools toggles them at runtime.
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => {
      reducedMotion = e.matches;
      if (reducedMotion && rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });

  // Start / stop the RAF loop when the analyser binding changes. Skip
  // the loop entirely under reduced-motion — bars stay frozen at the
  // FNV-1a fallback heights.
  $effect(() => {
    if (!hasRendered) return;
    if (!analyser || reducedMotion) {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      return;
    }
    // Seed smoothed state from fallback heights so the first frame
    // transitions smoothly rather than slamming up from zero.
    if (smoothed.length !== barCount) {
      smoothed = fallbackHeights.slice();
      liveHeights = fallbackHeights.slice();
    }
    lastFrameTime = 0;
    if (rafId === null) {
      rafId = requestAnimationFrame(tick);
    }
    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
  });

  // Choose which height set to render. SSR + first client paint use
  // the fallback (byte-identical to AudioWaveform), then switch to
  // live values once the RAF has populated them. Reduced-motion sticks
  // to the fallback indefinitely.
  const heights = $derived.by(() => {
    if (reducedMotion || !analyser || liveHeights.length !== barCount) {
      return fallbackHeights;
    }
    return liveHeights;
  });

  const gap = $derived((VIEWBOX_W - barCount * BAR_WIDTH) / (barCount - 1));
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
      class="waveform__bar"
      style="--_bar-index: {i}; --_bar-count: {barCount};"
      x={i * (BAR_WIDTH + gap)}
      y={centerY - barHeight / 2}
      width={BAR_WIDTH}
      height={barHeight}
      rx={BAR_RADIUS}
      fill="currentColor"
    />
  {/each}
</svg>

<style>
  .waveform {
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
    padding: var(--space-2);
    box-sizing: border-box;
    opacity: var(--opacity-90, 0.9);
  }

  /* No CSS transition on `height`. The RAF loop mutates the rect's
     height attribute every frame; a CSS interpolation would fight the
     per-frame updates and smear the bar response. The EMA in `tick()`
     does the smoothing instead. */
  .waveform__bar {
    transform-origin: center;
  }
</style>

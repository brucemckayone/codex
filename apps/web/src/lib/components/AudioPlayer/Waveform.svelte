<!--
  @component Waveform

  Immersive mirrored waveform visualization with:
  - Chunky rounded bars (30-40 count, symmetric top+bottom)
  - Brand gradient fill (played) / muted brand (unplayed)
  - Opacity fade staging (focal point around playhead)
  - Soft breathing glow (always present, audio-reactive when playing)
  - Glowing playhead line with hover scrubber
  - Left-to-right cascade entrance animation
  - Audio-reactive bar pulsing (Disney: squash & stretch, secondary action)

  @prop {number[] | null} data - Normalised 0-1 amplitude samples
  @prop {number} currentTime - Current playback position in seconds
  @prop {number} duration - Total duration in seconds
  @prop {(time: number) => void} onseek - Called when user seeks
  @prop {AudioAnalysis | null} audioAnalysis - Real-time frequency data from audio-analyser
-->
<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { AudioAnalysis } from './audio-analyser';
  import {
    createSliderKeyboardHandler,
    MediaLiveRegion,
  } from '$lib/components/media-a11y';

  interface Props {
    data: number[] | null;
    currentTime: number;
    duration: number;
    playing?: boolean;
    onseek: (time: number) => void;
    audioAnalysis?: AudioAnalysis | null;
    /** Loading state announced via the hidden live region (Ref 05 §Media §4). */
    loading?: boolean;
    /** Error message announced via the nested role="alert". */
    error?: string | null;
    /** Forward additional class onto the root wrapper. R13 composition seam. */
    class?: string;
  }

  const {
    data,
    currentTime,
    duration,
    playing = false,
    onseek,
    audioAnalysis = null,
    loading = false,
    error = null,
    class: className,
  }: Props = $props();

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let containerEl: HTMLDivElement | undefined = $state();
  let isDragging = $state(false);
  let hoverProgress: number | null = $state(null);

  const playProgress = $derived(duration > 0 ? currentTime / duration : 0);

  // ── Smoothed playhead position (Disney: slow in/out on seek) ──
  let smoothProgress = 0;
  const PROGRESS_LERP = 0.15;

  function lerpProgress() {
    const diff = Math.abs(playProgress - smoothProgress);
    // Snap if difference is tiny (normal playback) or very large (initial seek)
    if (diff < 0.001 || diff > 0.3) {
      smoothProgress = playProgress;
    } else {
      smoothProgress += (playProgress - smoothProgress) * (reducedMotion ? 1.0 : PROGRESS_LERP);
    }
  }

  // ── Colour tokens (read from computed style) ──
  // Fallbacks only used pre-mount / SSR edge. Tokens resolve in readColourTokens()
  // at runtime once the container is in the DOM and org branding is applied.
  let brandPrimary = '#c24129';
  let brandPrimarySubtle = '#f5e6e3';
  let brandSecondary = '#4b5563';

  function readColourTokens() {
    if (!containerEl) return;
    const s = getComputedStyle(containerEl);
    brandPrimary = s.getPropertyValue('--color-brand-primary').trim() || s.getPropertyValue('--color-primary-500').trim() || brandPrimary;
    brandPrimarySubtle = s.getPropertyValue('--color-brand-primary-subtle').trim() || brandPrimarySubtle;
    brandSecondary = s.getPropertyValue('--color-brand-secondary').trim() || s.getPropertyValue('--color-neutral-300').trim() || brandSecondary;
  }

  // ── Smoothed audio analysis (lerped for organic feel) ──
  let smoothBass = 0;
  let smoothMids = 0;
  let smoothTreble = 0;
  let smoothAmplitude = 0;
  const LERP_RATE = 0.12;

  function lerpAudio() {
    const target = audioAnalysis;
    const rate = reducedMotion ? 1.0 : LERP_RATE;
    if (target && target.active) {
      smoothBass += ((target.bass ?? 0) - smoothBass) * rate;
      smoothMids += ((target.mids ?? 0) - smoothMids) * rate;
      smoothTreble += ((target.treble ?? 0) - smoothTreble) * rate;
      smoothAmplitude += ((target.amplitude ?? 0) - smoothAmplitude) * rate;
    } else {
      // Decay to zero when not playing
      smoothBass *= 0.95;
      smoothMids *= 0.95;
      smoothTreble *= 0.95;
      smoothAmplitude *= 0.95;
    }
  }

  // ── Entrance animation state ──
  let entranceProgress = 0; // 0 = not started, 1 = complete
  let entranceStartTime = 0;
  const ENTRANCE_DURATION = 450; // ms
  const ENTRANCE_STAGGER = 12; // ms per bar

  // ── Reduced motion (reactive subscription, Ref 05 §Media §8) ──
  // `$state()` + mq.addEventListener keeps the component responsive when the user
  // toggles the OS setting mid-session. Effect loop auto-stops when flipped to true.
  let reducedMotion = $state(false);
  let reducedMotionMq: MediaQueryList | null = null;
  function onReducedMotionChange(e: MediaQueryListEvent) {
    reducedMotion = e.matches;
  }

  // ── rAF management ──
  let rafId = 0;
  let isAnimating = false;
  // Burst rAF id — tracked so a new seek cancels any still-scheduled frame and
  // prevents overlapping bursts from trampling each other (iter-013 Codex-34rji).
  let burstRafId = 0;

  function startAnimationLoop() {
    if (isAnimating || reducedMotion) return;
    isAnimating = true;
    function tick() {
      if (!isAnimating) return;
      lerpAudio();
      draw();
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
  }

  function stopAnimationLoop() {
    isAnimating = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  // ── Colour helpers ──
  function hexToRgba(hex: string, alpha: number): string {
    // Handle named colors or rgb() values by falling back
    if (!hex.startsWith('#')) return `rgba(128, 128, 128, ${alpha})`;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function parseColor(color: string): [number, number, number] {
    if (color.startsWith('#')) {
      return [
        parseInt(color.slice(1, 3), 16),
        parseInt(color.slice(3, 5), 16),
        parseInt(color.slice(5, 7), 16),
      ];
    }
    // Try rgb(r, g, b) format
    const match = color.match(/(\d+)/g);
    if (match && match.length >= 3) {
      return [parseInt(match[0]), parseInt(match[1]), parseInt(match[2])];
    }
    return [194, 65, 41]; // fallback terracotta
  }

  // ── Main draw function ──
  function draw() {
    if (!canvasEl || !containerEl) return;

    const rect = containerEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = rect.height;

    canvasEl.width = w * dpr;
    canvasEl.height = h * dpr;
    canvasEl.style.width = `${w}px`;
    canvasEl.style.height = `${h}px`;

    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Use smoothed progress for animated playhead movement
    lerpProgress();
    const progress = smoothProgress;
    const centerY = h / 2;

    // ── Determine bar data ──
    const BAR_COUNT = Math.max(20, Math.min(40, Math.floor(w / 12)));
    const barWidth = w / BAR_COUNT;
    const gap = barWidth * 0.35; // wider gaps for skinnier bars
    const actualBarWidth = barWidth - gap;
    const barRadius = Math.min(actualBarWidth * 0.3, 4);
    const maxBarHalf = (h / 2) * 0.85; // max half-height (mirrored, so total = 2x)
    const minBarHalf = Math.max(4, h * 0.06); // minimum visible bar (scales with height)

    // Aggregate waveform data or generate fallback
    const bars: number[] = [];
    if (data && data.length > 0) {
      const samplesPerBar = data.length / BAR_COUNT;
      for (let i = 0; i < BAR_COUNT; i++) {
        const startIdx = Math.floor(i * samplesPerBar);
        const endIdx = Math.floor((i + 1) * samplesPerBar);
        let sum = 0;
        let count = 0;
        for (let j = startIdx; j < endIdx && j < data.length; j++) {
          sum += data[j];
          count++;
        }
        bars.push(count > 0 ? sum / count : 0);
      }
    } else {
      // Deterministic pseudo-random fallback
      for (let i = 0; i < BAR_COUNT; i++) {
        const seed = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
        bars.push(0.15 + (seed - Math.floor(seed)) * 0.7);
      }
    }

    // ── Create gradients ──
    const playedGrad = ctx.createLinearGradient(0, centerY + maxBarHalf, 0, centerY - maxBarHalf);
    const [pr, pg, pb] = parseColor(brandPrimary);
    playedGrad.addColorStop(0, `rgba(${pr}, ${pg}, ${pb}, 0.8)`);
    playedGrad.addColorStop(0.4, brandPrimary);
    playedGrad.addColorStop(1, `rgba(${Math.min(255, pr + 60)}, ${Math.min(255, pg + 60)}, ${Math.min(255, pb + 60)}, 1.0)`);

    const unplayedAlpha = 0.35;

    // ── Draw bars (mirrored, progressive colouring) ──
    for (let i = 0; i < BAR_COUNT; i++) {
      const amplitude = bars[i];
      const barStart = i / BAR_COUNT;
      const barEnd = (i + 1) / BAR_COUNT;
      const barCenter = (barStart + barEnd) / 2;

      // How much of this bar has the playhead filled (0 = none, 1 = fully played)
      let fillRatio: number;
      if (progress >= barEnd) {
        fillRatio = 1; // fully played
      } else if (progress <= barStart) {
        fillRatio = 0; // fully unplayed
      } else {
        fillRatio = (progress - barStart) / (barEnd - barStart); // partially played
      }

      // Entrance animation: stagger bars left-to-right
      let entranceScale = 1;
      if (entranceProgress < 1) {
        const barDelay = i * ENTRANCE_STAGGER;
        const elapsed = (performance.now() - entranceStartTime) - barDelay;
        const dur = Math.max(100, ENTRANCE_DURATION - barDelay * 0.3);
        entranceScale = Math.max(0, Math.min(1, elapsed / dur));
        entranceScale = 1 - Math.pow(1 - entranceScale, 3);
      }

      // Audio-reactive height multiplier (Disney: squash & stretch)
      let reactiveMultiplier = 1;
      if (audioAnalysis?.active && !reducedMotion) {
        const distFromPlayhead = Math.abs(barCenter - progress);
        if (distFromPlayhead < 0.1) {
          reactiveMultiplier = 1 + smoothBass * 0.15 * (1 - distFromPlayhead / 0.1);
        }
      }

      const barHalf = Math.max(minBarHalf, amplitude * maxBarHalf * entranceScale * reactiveMultiplier);
      const x = i * barWidth + gap / 2;
      const topY = centerY - barHalf;
      const totalHeight = barHalf * 2;

      // Opacity fade (staging) — focal point around playhead
      const distFromPlayhead = Math.abs(barCenter - progress);
      const fadeRadius = 0.15 + (audioAnalysis?.active ? smoothAmplitude * 0.05 : 0);
      let alpha: number;
      if (distFromPlayhead < fadeRadius) {
        alpha = 1.0;
      } else {
        alpha = Math.max(0.55, 1.0 - (distFromPlayhead - fadeRadius) * 1.5);
      }

      // Treble sparkle on unplayed bars
      if (fillRatio < 1 && audioAnalysis?.active && !reducedMotion) {
        alpha += smoothTreble * 0.08;
        alpha = Math.min(1, alpha);
      }

      ctx.globalAlpha = alpha;

      if (fillRatio >= 1) {
        // Fully played — brand gradient
        ctx.fillStyle = playedGrad;
        ctx.beginPath();
        ctx.roundRect(x, topY, actualBarWidth, totalHeight, barRadius);
        ctx.fill();
      } else if (fillRatio <= 0) {
        // Fully unplayed — muted
        ctx.fillStyle = hexToRgba(brandPrimary, unplayedAlpha);
        ctx.beginPath();
        ctx.roundRect(x, topY, actualBarWidth, totalHeight, barRadius);
        ctx.fill();
      } else {
        // Partially played — draw unplayed base, then played overlay clipped to fill
        // 1. Unplayed (full bar, muted)
        ctx.fillStyle = hexToRgba(brandPrimary, unplayedAlpha);
        ctx.beginPath();
        ctx.roundRect(x, topY, actualBarWidth, totalHeight, barRadius);
        ctx.fill();

        // 2. Played portion (clip from left edge of bar to fill position)
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, topY, actualBarWidth * fillRatio, totalHeight);
        ctx.clip();
        ctx.fillStyle = playedGrad;
        ctx.beginPath();
        ctx.roundRect(x, topY, actualBarWidth, totalHeight, barRadius);
        ctx.fill();
        ctx.restore();
      }
    }

    ctx.globalAlpha = 1;

    // ── Glow pass (single rectangle under played region) ──
    // Only render glow with shadowBlur during rAF (playing) for performance.
    // Static redraws get a simple semi-transparent overlay instead.
    if (progress > 0) {
      ctx.save();
      if (isAnimating) {
        const glowIntensity = 6 + smoothAmplitude * 10;
        ctx.shadowColor = hexToRgba(brandPrimary, 0.5);
        ctx.shadowBlur = Math.max(4, glowIntensity);
        ctx.globalAlpha = 0.08 + smoothAmplitude * 0.06;
      } else {
        ctx.globalAlpha = 0.06;
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = hexToRgba(brandPrimary, 0.15);
      ctx.beginPath();
      ctx.roundRect(0, centerY - maxBarHalf * 0.6, progress * w, maxBarHalf * 1.2, barRadius);
      ctx.fill();
      ctx.restore();
    }

    // ── Playhead (glowing vertical line) ──
    const phX = progress * w;
    ctx.save();
    // Only use expensive shadowBlur during rAF animation loop (playing)
    if (isAnimating) {
      ctx.shadowColor = hexToRgba(brandPrimary, 0.8);
      ctx.shadowBlur = 10 + smoothAmplitude * 8;
    }
    // Bright white-tinted playhead for visibility on dark bg
    ctx.strokeStyle = `rgba(${Math.min(255, pr + 80)}, ${Math.min(255, pg + 80)}, ${Math.min(255, pb + 80)}, 1)`;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 1.0;
    ctx.beginPath();
    ctx.moveTo(phX, 4);
    ctx.lineTo(phX, h - 4);
    ctx.stroke();
    ctx.restore();

    // ── Hover scrubber (appears on hover) ──
    if (hoverProgress !== null) {
      const hX = hoverProgress * w;

      // Scrubber line
      ctx.save();
      ctx.strokeStyle = hexToRgba(brandPrimary, 0.3);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hX, 4);
      ctx.lineTo(hX, h - 4);
      ctx.stroke();

      // Scrubber dot
      ctx.fillStyle = brandPrimary;
      ctx.shadowColor = hexToRgba(brandPrimary, 0.5);
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(hX, centerY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Timestamp integrated into glow (near cursor)
      if (duration > 0) {
        const time = hoverProgress * duration;
        const label = formatTime(time);
        ctx.save();
        ctx.font = `${11 * dpr / dpr}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.shadowColor = hexToRgba(brandPrimary, 0.6);
        ctx.shadowBlur = 8;
        ctx.fillStyle = brandPrimary;
        ctx.globalAlpha = 0.9;
        // Position above center
        const labelY = Math.max(14, centerY - maxBarHalf - 6);
        ctx.fillText(label, hX, labelY);
        ctx.restore();
      }
    }
  }

  // ── Pointer interaction ──
  function getNormalisedX(e: PointerEvent): number {
    if (!containerEl) return 0;
    const rect = containerEl.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }

  function handlePointerDown(e: PointerEvent) {
    isDragging = true;
    containerEl?.setPointerCapture(e.pointerId);
    const pos = getNormalisedX(e);
    onseek(pos * duration);
  }

  function handlePointerMove(e: PointerEvent) {
    const pos = getNormalisedX(e);
    hoverProgress = pos;
    if (isDragging) {
      onseek(pos * duration);
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (isDragging) {
      isDragging = false;
      containerEl?.releasePointerCapture(e.pointerId);
      const pos = getNormalisedX(e);
      onseek(pos * duration);
    }
  }

  function handlePointerLeave() {
    hoverProgress = null;
  }

  // ── Start/stop animation loop based on playback state ──
  $effect(() => {
    if (playing && !reducedMotion) {
      startAnimationLoop();
    } else {
      stopAnimationLoop();
    }
  });

  // ── Reactive redraw when paused (data, hover, or seek changes) ──
  $effect(() => {
    void data;
    void playProgress;
    void hoverProgress;
    if (!isAnimating) {
      // Cancel any in-flight burst before scheduling a new one (Codex-34rji).
      // Without this, rapid seek events would spawn overlapping bursts that
      // race to mutate smoothProgress and leak rAF ids on unmount.
      if (burstRafId) cancelAnimationFrame(burstRafId);
      let frames = 0;
      function burst() {
        frames++;
        lerpProgress();
        draw();
        if (frames < 12 && Math.abs(playProgress - smoothProgress) > 0.002) {
          burstRafId = requestAnimationFrame(burst);
        } else {
          burstRafId = 0;
        }
      }
      burstRafId = requestAnimationFrame(burst);
    }
  });

  onMount(() => {
    // Reactive reduced-motion: $state flip drives $effect rerun which halts the
    // rAF loop without polling. Matches Ref 05 §Media §8 "CSS-first with JS
    // subscription only when the value must drive JS calculations" — the rAF
    // loop gating is that JS calculation.
    reducedMotionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = reducedMotionMq.matches;
    reducedMotionMq.addEventListener('change', onReducedMotionChange);

    readColourTokens();

    // Skip entrance animation for now — render immediately
    entranceProgress = 1;
    draw();

    // Responsive redraw
    const observer = new ResizeObserver(() => {
      readColourTokens();
      draw();
    });
    if (containerEl) observer.observe(containerEl);

    return () => {
      observer.disconnect();
      stopAnimationLoop();
      if (burstRafId) cancelAnimationFrame(burstRafId);
    };
  });

  onDestroy(() => {
    reducedMotionMq?.removeEventListener('change', onReducedMotionChange);
    reducedMotionMq = null;
  });

  // Canonical WAI-ARIA slider keyboard contract (Ref 05 §Media §10).
  // Home/End, PageUp/PageDown, and Shift-modifier fine-grain for free —
  // the previous inline handler only covered ArrowLeft/ArrowRight and
  // violated APG. `createSliderKeyboardHandler` is the sibling of
  // `createMediaKeyboardHandler` (iter-012) for canvas widgets with no
  // underlying HTMLMediaElement.
  // Getter form for duration so reactive prop updates flow through.
  const handleKey = createSliderKeyboardHandler({
    onSeek: (t) => onseek(t),
    getCurrentTime: () => currentTime,
    duration: () => duration,
  });
</script>

<div
  class="waveform {className ?? ''}"
  bind:this={containerEl}
  role="slider"
  aria-label="Audio seek bar"
  aria-valuemin={0}
  aria-valuemax={Math.round(duration)}
  aria-valuenow={Math.round(currentTime)}
  tabindex={0}
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointerleave={handlePointerLeave}
  onkeydown={handleKey}
>
  <canvas bind:this={canvasEl}></canvas>
  <MediaLiveRegion {loading} {error} loadingLabel="Loading audio waveform…" />
</div>

<script lang="ts" module>
  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
</script>

<style>
  .waveform {
    position: relative;
    width: 100%;
    height: var(--waveform-height, var(--space-24, 96px));
    cursor: pointer;
    touch-action: none;
    user-select: none;
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  /* R14 canonical focus ring — uses --color-focus so contrast + density follow
     the design system instead of the brand palette (which can be low-contrast
     on dark waveform backgrounds). */
  .waveform:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .waveform canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>

<!--
  @component Waveform

  Canvas 2D waveform visualization that doubles as a seek bar.
  Click/drag on the waveform to seek. Played region fills with
  the primary colour; unplayed region uses neutral tone.

  @prop {number[] | null} data - Normalised 0-1 amplitude samples
  @prop {number} currentTime - Current playback position in seconds
  @prop {number} duration - Total duration in seconds
  @prop {(time: number) => void} onseek - Called when user seeks

  Falls back to a simple progress bar when waveform data is unavailable.
-->
<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    data: number[] | null;
    currentTime: number;
    duration: number;
    onseek: (time: number) => void;
  }

  const { data, currentTime, duration, onseek }: Props = $props();

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let containerEl: HTMLDivElement | undefined = $state();
  let isDragging = $state(false);
  let hoverProgress: number | null = $state(null);

  const playProgress = $derived(duration > 0 ? currentTime / duration : 0);

  // Colour tokens — read once from computed style on mount
  let playedColour = '#6366f1';
  let unplayedColour = '#d4d4d8';
  let playheadColour = '#4338ca';

  function readColourTokens() {
    if (!containerEl) return;
    const style = getComputedStyle(containerEl);
    playedColour = style.getPropertyValue('--color-primary-500').trim() || playedColour;
    unplayedColour = style.getPropertyValue('--color-neutral-300').trim() || unplayedColour;
    playheadColour = style.getPropertyValue('--color-primary-700').trim() || playheadColour;
  }

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

    const progress = playProgress;

    if (!data || data.length === 0) {
      // Fallback: generate pseudo-random bars for visual interest
      const fallbackBars = 80;
      const barW = w / fallbackBars;
      const gapF = Math.max(1, barW * 0.25);
      const actualW = barW - gapF;

      for (let i = 0; i < fallbackBars; i++) {
        // Deterministic pseudo-random heights based on bar index
        const seed = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
        const amplitude = 0.15 + (seed - Math.floor(seed)) * 0.7;
        const barH = Math.max(4, amplitude * h * 0.85);
        const x = i * barW + gapF / 2;
        const y = (h - barH) / 2;
        const barProgress = (i + 0.5) / fallbackBars;
        ctx.fillStyle = barProgress <= progress ? playedColour : unplayedColour;
        ctx.fillRect(x, y, actualW, barH);
      }

      // Playhead
      const phX = progress * w;
      ctx.strokeStyle = playheadColour;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(phX, 0);
      ctx.lineTo(phX, h);
      ctx.stroke();
      return;
    }

    // Draw waveform bars
    const barCount = Math.min(data.length, Math.floor(w / 2));
    const barWidth = w / barCount;
    const gap = Math.max(1, barWidth * 0.2);
    const actualBarWidth = barWidth - gap;
    const minBarHeight = 2;
    const maxBarHeight = h * 0.9;
    const samplesPerBar = data.length / barCount;

    for (let i = 0; i < barCount; i++) {
      // Average samples for this bar
      const startIdx = Math.floor(i * samplesPerBar);
      const endIdx = Math.floor((i + 1) * samplesPerBar);
      let sum = 0;
      let count = 0;
      for (let j = startIdx; j < endIdx && j < data.length; j++) {
        sum += data[j];
        count++;
      }
      const amplitude = count > 0 ? sum / count : 0;

      const barHeight = Math.max(minBarHeight, amplitude * maxBarHeight);
      const x = i * barWidth + gap / 2;
      const y = (h - barHeight) / 2;

      const barProgress = (i + 0.5) / barCount;
      ctx.fillStyle = barProgress <= progress ? playedColour : unplayedColour;
      ctx.fillRect(x, y, actualBarWidth, barHeight);
    }

    // Draw playhead line
    const playheadX = progress * w;
    ctx.strokeStyle = playheadColour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, h);
    ctx.stroke();

    // Draw hover position indicator
    if (hoverProgress !== null) {
      ctx.strokeStyle = playheadColour;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.moveTo(hoverProgress * w, 0);
      ctx.lineTo(hoverProgress * w, h);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

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

  // Redraw on data/progress changes
  $effect(() => {
    // Touch reactive deps
    void data;
    void playProgress;
    void hoverProgress;
    draw();
  });

  onMount(() => {
    readColourTokens();
    draw();

    // Responsive redraw
    const observer = new ResizeObserver(() => {
      readColourTokens();
      draw();
    });
    if (containerEl) observer.observe(containerEl);
    return () => observer.disconnect();
  });
</script>

<div
  class="waveform"
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
  onkeydown={(e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onseek(Math.max(0, currentTime - 10));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onseek(Math.min(duration, currentTime + 10));
    }
  }}
>
  <canvas bind:this={canvasEl}></canvas>

  {#if hoverProgress !== null && duration > 0}
    <div
      class="waveform__tooltip"
      style:left="{hoverProgress * 100}%"
    >
      {formatTime(hoverProgress * duration)}
    </div>
  {/if}
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
    height: var(--space-16, 64px);
    cursor: pointer;
    touch-action: none;
    user-select: none;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .waveform:focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
  }

  .waveform canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  .waveform__tooltip {
    position: absolute;
    bottom: 100%;
    transform: translateX(-50%);
    padding: var(--space-1) var(--space-2);
    background: var(--color-surface-overlay, rgba(0, 0, 0, 0.8));
    color: var(--color-text-on-dark, #fff);
    font-size: var(--text-xs);
    border-radius: var(--radius-sm);
    pointer-events: none;
    white-space: nowrap;
    margin-bottom: var(--space-1);
  }
</style>

<script lang="ts">
  import { oklchToSrgb, isInGamut, maxChromaForLH } from '$lib/brand-editor/oklch-math';

  interface Props {
    /** Current hue (0-360). Canvas re-renders when this changes. */
    hue: number;
    /** Current lightness (0-1). */
    lightness?: number;
    /** Current chroma (0-0.4). */
    chroma?: number;
    /** Called on every selection change. */
    onchange?: (l: number, c: number) => void;
  }

  let {
    hue,
    lightness = $bindable(0.6),
    chroma = $bindable(0.15),
    onchange,
  }: Props = $props();

  const CANVAS_W = 256;
  const CANVAS_H = 160;
  const MAX_CHROMA = 0.4;

  let canvas: HTMLCanvasElement | undefined = $state();
  let dragging = $state(false);

  // Thumb position derived from L/C values
  const thumbX = $derived((chroma / MAX_CHROMA) * CANVAS_W);
  const thumbY = $derived((1 - lightness) * CANVAS_H);

  // Render the canvas gradient when hue changes
  $effect(() => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;
    ctx.scale(dpr, dpr);

    const imageData = ctx.createImageData(CANVAS_W, CANVAS_H);
    const data = imageData.data;

    for (let y = 0; y < CANVAS_H; y++) {
      const l = 1 - y / CANVAS_H; // Top = 1 (white), bottom = 0 (black)
      for (let x = 0; x < CANVAS_W; x++) {
        const c = (x / CANVAS_W) * MAX_CHROMA;
        const idx = (y * CANVAS_W + x) * 4;

        if (isInGamut(l, c, hue)) {
          const rgb = oklchToSrgb(l, c, hue);
          data[idx] = rgb.r;
          data[idx + 1] = rgb.g;
          data[idx + 2] = rgb.b;
          data[idx + 3] = 255;
        } else {
          // Out of gamut — subtle checkerboard
          const checker = ((x >> 2) + (y >> 2)) % 2;
          const v = checker ? 220 : 210;
          data[idx] = v;
          data[idx + 1] = v;
          data[idx + 2] = v;
          data[idx + 3] = 255;
        }
      }
    }

    // Draw at 1x then let canvas scaling handle DPR
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = CANVAS_W;
    tempCanvas.height = CANVAS_H;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(tempCanvas, 0, 0, CANVAS_W, CANVAS_H);

    // Stroke the sRGB gamut boundary curve
    ctx.beginPath();
    for (let y = 0; y < CANVAS_H; y++) {
      const l = 1 - y / CANVAS_H;
      const maxC = maxChromaForLH(l, hue);
      const x = (maxC / MAX_CHROMA) * CANVAS_W;
      if (y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  function updateFromPosition(clientX: number, clientY: number) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(CANVAS_W, ((clientX - rect.left) / rect.width) * CANVAS_W));
    const y = Math.max(0, Math.min(CANVAS_H, ((clientY - rect.top) / rect.height) * CANVAS_H));

    chroma = (x / CANVAS_W) * MAX_CHROMA;
    lightness = 1 - y / CANVAS_H;
    onchange?.(lightness, chroma);
  }

  function handlePointerDown(e: PointerEvent) {
    dragging = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    updateFromPosition(e.clientX, e.clientY);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!dragging) return;
    requestAnimationFrame(() => updateFromPosition(e.clientX, e.clientY));
  }

  function handlePointerUp() {
    dragging = false;
  }
</script>

<div
  class="color-area"
  role="application"
  aria-label="Color selection area"
>
  <canvas
    bind:this={canvas}
    class="color-area__canvas"
    style="width: {CANVAS_W}px; height: {CANVAS_H}px"
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerUp}
  ></canvas>
  <div
    class="color-area__thumb"
    style="left: {thumbX}px; top: {thumbY}px"
    aria-hidden="true"
  ></div>
</div>

<style>
  .color-area {
    position: relative;
    border-radius: var(--radius-md);
    overflow: hidden;
    cursor: crosshair;
    touch-action: none;
  }

  .color-area__canvas {
    display: block;
  }

  .color-area__thumb {
    position: absolute;
    width: 12px;
    height: 12px;
    border-radius: var(--radius-full);
    border: 2px solid white;
    box-shadow: var(--shadow-sm), 0 0 0 1px color-mix(in srgb, black 30%, transparent);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
</style>

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
    /** Optional class forwarded to root — composition seam per R13 inverse. */
    class?: string;
  }

  let {
    hue,
    lightness = $bindable(0.6),
    chroma = $bindable(0.15),
    onchange,
    class: className,
  }: Props = $props();

  const CANVAS_W = 256;
  const CANVAS_H = 160;
  const MAX_CHROMA = 0.4;

  // Keyboard step sizes — see 05-accessibility.md §"Custom 2D slider / color area".
  const L_STEP = 0.01; // 1% lightness
  const C_STEP = 0.01; // 0.01 chroma
  const L_STEP_COARSE = 0.1; // 10% lightness (Shift / PageUp/Down)
  const C_STEP_COARSE = 0.1; // 0.1 chroma (Shift)

  let canvas: HTMLCanvasElement | undefined = $state();
  let thumb: HTMLDivElement | undefined = $state();
  let activePointerId: number | null = null;

  // Cached ImageData for paint — bucketed by stepped hue to skip full repaint on every degree.
  let paintedHueBucket = -1;

  // Thumb position in percent so it scales with the responsive canvas element.
  const thumbX = $derived((chroma / MAX_CHROMA) * 100);
  const thumbY = $derived((1 - lightness) * 100);

  // Aria announcement — both axes in natural language (per ref 05 §"Custom 2D slider").
  const ariaValueText = $derived(
    `Lightness ${Math.round(lightness * 100)}%, chroma ${chroma.toFixed(2)}`,
  );

  // RAF pointer coalescing — ref 04 §"Pointer event coalescing in RAF".
  let rafPending = false;
  let latestPointer: { x: number; y: number } | null = null;

  // Render the canvas gradient when hue (bucketed) changes.
  $effect(() => {
    if (!canvas) return;

    // Bucket hue to integer degrees — HueSlider step=1 so this is safe and avoids
    // duplicate repaints during drag (ref 06-performance.md).
    const bucket = Math.round(hue);
    if (bucket === paintedHueBucket) return;
    paintedHueBucket = bucket;

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

        if (isInGamut(l, c, bucket)) {
          const rgb = oklchToSrgb(l, c, bucket);
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

    // Draw at 1x then let canvas scaling handle DPR.
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = CANVAS_W;
    tempCanvas.height = CANVAS_H;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(tempCanvas, 0, 0, CANVAS_W, CANVAS_H);

    // Stroke the sRGB gamut boundary curve — read theme tokens so stroke inverts per theme
    // (R1 — never hardcode literals that a token exists for).
    const cs = getComputedStyle(canvas);
    const strokeColor = cs.getPropertyValue('--color-picker-gamut-stroke').trim()
      || cs.getPropertyValue('--color-text').trim()
      || 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    for (let y = 0; y < CANVAS_H; y++) {
      const l = 1 - y / CANVAS_H;
      const maxC = maxChromaForLH(l, bucket);
      const x = (maxC / MAX_CHROMA) * CANVAS_W;
      if (y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = strokeColor;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  });

  function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
  }

  function clampC(v: number): number {
    return Math.max(0, Math.min(MAX_CHROMA, v));
  }

  function commit(l: number, c: number) {
    lightness = clamp01(l);
    chroma = clampC(c);
    onchange?.(lightness, chroma);
  }

  function updateFromPosition(clientX: number, clientY: number) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(CANVAS_W, ((clientX - rect.left) / rect.width) * CANVAS_W));
    const y = Math.max(0, Math.min(CANVAS_H, ((clientY - rect.top) / rect.height) * CANVAS_H));
    commit(1 - y / CANVAS_H, (x / CANVAS_W) * MAX_CHROMA);
  }

  function handlePointerDown(e: PointerEvent) {
    if (!canvas) return;
    activePointerId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    updateFromPosition(e.clientX, e.clientY);
    // Move focus to the thumb so keyboard takes over cleanly when the user releases.
    thumb?.focus();
  }

  function handlePointerMove(e: PointerEvent) {
    if (activePointerId !== e.pointerId) return;
    // Coalesce into a single RAF — ref 04 §"Pointer event coalescing in RAF".
    latestPointer = { x: e.clientX, y: e.clientY };
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        if (latestPointer) updateFromPosition(latestPointer.x, latestPointer.y);
      });
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (activePointerId !== e.pointerId) return;
    if (canvas?.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    activePointerId = null;
  }

  // Keyboard contract per ref 05 §"Custom 2D slider / color area":
  //   ArrowUp/Down       → L ±1 step
  //   ArrowLeft/Right    → C ±1 step
  //   Shift + any arrow  → ±10 steps (coarse)
  //   Home / End         → C min / max
  //   PageUp / PageDown  → L ±10 steps
  function handleKeydown(e: KeyboardEvent) {
    const coarse = e.shiftKey;
    const lStep = coarse ? L_STEP_COARSE : L_STEP;
    const cStep = coarse ? C_STEP_COARSE : C_STEP;

    let nextL = lightness;
    let nextC = chroma;
    let handled = true;

    switch (e.key) {
      case 'ArrowUp':
        nextL = lightness + lStep;
        break;
      case 'ArrowDown':
        nextL = lightness - lStep;
        break;
      case 'ArrowRight':
        nextC = chroma + cStep;
        break;
      case 'ArrowLeft':
        nextC = chroma - cStep;
        break;
      case 'Home':
        nextC = 0;
        break;
      case 'End':
        nextC = MAX_CHROMA;
        break;
      case 'PageUp':
        nextL = lightness + L_STEP_COARSE;
        break;
      case 'PageDown':
        nextL = lightness - L_STEP_COARSE;
        break;
      default:
        handled = false;
    }

    if (!handled) return;
    e.preventDefault();
    commit(nextL, nextC);
  }

  // Release pointer capture on unmount if a drag was in flight (ref 04 cleanup rule).
  $effect(() => {
    return () => {
      if (canvas && activePointerId !== null && canvas.hasPointerCapture(activePointerId)) {
        canvas.releasePointerCapture(activePointerId);
      }
    };
  });
</script>

<div class="color-area {className ?? ''}">
  <!-- Canvas is paint surface only — no role, no tabindex, no ARIA.
       Per ref 05 §"Custom 2D slider / color area", the thumb owns all a11y. -->
  <canvas
    bind:this={canvas}
    class="color-area__canvas"
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerUp}
  ></canvas>
  <!-- Focusable 2D slider thumb. `aria-valuenow` tracks the more meaningful axis
       (lightness as a 0-100 integer); `aria-valuetext` announces both axes. -->
  <div
    bind:this={thumb}
    class="color-area__thumb"
    style="left: {thumbX}%; top: {thumbY}%"
    tabindex="0"
    role="slider"
    aria-label="Lightness and chroma — arrow keys adjust"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={Math.round(lightness * 100)}
    aria-valuetext={ariaValueText}
    onkeydown={handleKeydown}
  ></div>
</div>

<style>
  /* Internal canvas pixel buffer is 256×160 (kept fixed for crispness — see script).
     Element size is responsive via aspect-ratio so the picker fits narrow panels
     without overflow (ki2ne — 02-css-architecture.md). */
  .color-area {
    position: relative;
    width: 100%;
    max-width: 256px;
    aspect-ratio: 256 / 160;
    border-radius: var(--radius-md);
    overflow: hidden;
    cursor: crosshair;
    touch-action: none;
  }

  .color-area__canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  /* Thumb — R1: no raw literals; R12: system-scope tokens only (picker renders in
     brand-editor panel which is NOT inside .org-layout).
     Visual marker stays small; WCAG 2.5.5 44x44 touch target met by the ::before
     invisible hit-box pseudo (05-accessibility.md §8, §"Custom 2D slider"). */
  .color-area__thumb {
    position: absolute;
    width: var(--space-3); /* 12px visual marker */
    height: var(--space-3);
    border-radius: var(--radius-full);
    border: var(--border-width-thick) solid var(--color-surface);
    box-shadow:
      var(--shadow-sm),
      0 0 0 1px color-mix(in srgb, var(--color-text) 30%, transparent);
    transform: translate(-50%, -50%);
    background: transparent;
  }

  /* Invisible 44×44 hit-box per WCAG 2.5.5 — touch target without bloating the visual marker. */
  .color-area__thumb::before {
    content: '';
    position: absolute;
    inset: 50%;
    width: var(--space-11); /* 44px */
    height: var(--space-11);
    transform: translate(-50%, -50%);
    /* Passes through hits so the canvas still receives pointerdown when the user
       starts a drag from inside the thumb's hit region. */
    pointer-events: none;
  }

  .color-area__thumb:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  @media (forced-colors: active) {
    .color-area__thumb {
      border-color: CanvasText;
    }
  }
</style>

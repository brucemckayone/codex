<!--
  @component ShaderHero

  Animated WebGL shader background for organization hero sections.
  Reads shader preset + config from brand CSS custom properties (tokenOverrides).
  Progressive enhancement: CSS gradient fallback when WebGL unavailable.

  Features:
  - 4 presets: suture (RDA), ether (raymarch), warp (FBM), ripple (wave eq)
  - Brand-colored — reads org palette from CSS vars
  - IntersectionObserver pauses when off-screen
  - prefers-reduced-motion, `still`, or a page holding it (`tone`): render one
    static frame, then stop
  - Mobile DPR capped at 1 for performance
  - Live-preview: brand editor changes take effect immediately
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { destroyJFACache } from './jfa-sdf';
  import { getShaderConfig, type ShaderPresetId } from './shader-config';
  import { loadRenderer } from './load-renderer';
  import type { ShaderRenderer, MouseState } from './renderer-types';
  import { shaderTone, toneViewport } from './shader-tone';
  import { averageCells, visibleBufferRegion } from './tone-grid';

  interface Props {
    class?: string;
    /**
     * Optional preset override. When set, this preset is used regardless
     * of the org's `--brand-shader-preset` CSS custom property. Useful for
     * decorative surfaces (Spotlight cards, banners) that want a shader
     * even when the org hasn't configured one on the main hero.
     */
    preset?: ShaderPresetId;
    /**
     * Draw one frame and stop, as for reduced motion, for a surface where the
     * shader sits far behind the content and its motion buys nothing: the
     * studio, behind an 80% cover and a 60px blur. There every frame costs a
     * full-viewport render (on a CPU-rendered context, as in CI, ~8s per
     * click). Turning it off resumes the motion.
     */
    still?: boolean;
    /**
     * Report what it draws, cell by cell, to `shaderTone`, while a page asks
     * (the page kit's live veil, landing-builder 03 X54). For the one shader
     * the window shows behind a page: the org layout's fullpage one. Read
     * once, at mount. That shader also stands still while a page holds it
     * (`shaderTone.hold`, its motion dial, 03 X62).
     */
    tone?: boolean;
  }

  const {
    class: className,
    preset: presetOverride,
    still = false,
    tone = false,
  }: Props = $props();

  // Set by onMount; the effect below hands it each new `still`. Read `still`
  // first: `applyStill?.(still)` skips its argument while applyStill is unset,
  // so the effect would never track it.
  let applyStill: ((still: boolean) => void) | undefined;
  $effect(() => {
    const next = still;
    applyStill?.(next);
  });

  // Frame-rate-independent burst decay (docs/04-motion.md §4).
  // Old per-frame multiplier `burstStrength *= 0.85` decayed 2× faster on 120Hz
  // displays and half as fast on throttled 30Hz tabs. The canonical equivalent
  // at 60fps is `0.85^60 ≈ 1.63e-5` per second; tuned here to that value so
  // the felt decay matches the previous 60fps behaviour exactly.
  const BURST_DECAY_PER_SECOND = 0.85 ** 60;

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let containerEl: HTMLDivElement | undefined = $state();
  let hasWebGL = $state(true);

  onMount(() => {
    if (!canvasEl || !browser) return;

    // ── WebGL context ──────────────────────────────────────────
    const gl = canvasEl.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
    });

    if (!gl) {
      hasWebGL = false;
      return;
    }

    // ── State ──────────────────────────────────────────────────
    let renderer: ShaderRenderer | null = null;
    let currentPreset: ShaderPresetId = 'none';
    let animFrameId = 0;
    let startTime = performance.now();
    let lastFrameTime = performance.now();
    let isVisible = true;
    let isReducedMotion = false;
    let isStill = still;
    // One static frame, then stop: reduced motion, or `still`.
    let isFrozen = false;
    let hasRenderedStaticFrame = false;
    // The moment a frozen shader shows, kept so that drawing it again (after
    // a resize, or for a sample) draws the same frame rather than a later one.
    let frozenElapsed: number | null = null;
    let pointerListenersAttached = false;

    const mouse: MouseState = { x: 0.5, y: 0.5, active: false, burstStrength: 0 };

    // ── RAF scheduling ─────────────────────────────────────────
    // Guarded re-prime: the loop re-schedules itself only from the render
    // branch inside `frame()`. State transitions (visibility, reduced-motion,
    // renderer init) call `scheduleFrame()` to resume after a pause.
    function scheduleFrame() {
      if (animFrameId !== 0) return; // already scheduled
      // Reset lastFrameTime so the first frame after a pause (tab hidden,
      // reduced-motion pause, preset switch) sees dt ≈ 16ms instead of the
      // real wall-clock gap — otherwise burstStrength would decay to ~0
      // instantly on resume.
      lastFrameTime = performance.now();
      animFrameId = requestAnimationFrame(frame);
    }

    // ── Reduced motion check ───────────────────────────────────
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    isReducedMotion = motionQuery.matches;
    // A page the window shows asked it to stand still (its motion dial).
    let isHeld = tone && shaderTone.held;
    isFrozen = isReducedMotion || isStill || isHeld;
    function setFrozen(next: boolean) {
      if (next === isFrozen) return;
      isFrozen = next;
      frozenElapsed = null;
      if (isFrozen) {
        hasRenderedStaticFrame = false;
        detachPointerListeners();
        // Schedule one frame to render the static snapshot, then loop self-exits.
        scheduleFrame();
      } else {
        attachPointerListeners();
        scheduleFrame();
      }
    }
    const onMotionChange = (e: MediaQueryListEvent) => {
      isReducedMotion = e.matches;
      setFrozen(isReducedMotion || isStill || isHeld);
    };
    motionQuery.addEventListener('change', onMotionChange);
    applyStill = (next) => {
      isStill = next;
      setFrozen(isReducedMotion || isStill || isHeld);
    };

    // Renderer factory is imported from ./load-renderer — single source of
    // truth shared with ImmersiveShaderPlayer. Adding a new preset only
    // requires touching load-renderer.ts.

    // ── Canvas sizing ──────────────────────────────────────────
    function resize() {
      if (!canvasEl || !containerEl) return;
      const rect = containerEl.getBoundingClientRect();
      // Cap DPR at 1 on mobile for performance (9x fewer fragments vs DPR 3)
      const isMobile = rect.width < 768;
      const dpr = isMobile ? 1 : Math.min(window.devicePixelRatio, 2);
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvasEl.width !== w || canvasEl.height !== h) {
        canvasEl.width = w;
        canvasEl.height = h;
        renderer?.resize(gl!, w, h);
        clearTone();
        // Resizing clears the canvas, and a frozen one has no next frame to
        // repaint it, so it draws its static frame again.
        if (isFrozen && hasRenderedStaticFrame) {
          hasRenderedStaticFrame = false;
          scheduleFrame();
        }
      }
    }

    // ── Config polling ─────────────────────────────────────────
    // Read shader config from CSS vars. Called each frame to pick up
    // live brand editor changes without needing a Svelte store bridge.
    // If a `preset` prop is supplied, we pass it to `getShaderConfig` as
    // an override so callers can force a preset regardless of org config.
    let configPollCounter = 0;
    let cachedConfig = getShaderConfig(undefined, presetOverride);
    let cachedConfigKey = JSON.stringify(cachedConfig);

    function pollConfig() {
      // Poll every 30 frames (~0.5s at 60fps) to avoid getComputedStyle overhead
      configPollCounter++;
      if (configPollCounter >= 30) {
        configPollCounter = 0;
        cachedConfig = getShaderConfig(undefined, presetOverride);
        const key = JSON.stringify(cachedConfig);
        // New colours or settings draw a different picture under each cell.
        if (key !== cachedConfigKey) clearTone();
        cachedConfigKey = key;
      }
      return cachedConfig;
    }

    // ── Tone (03 X54) ──────────────────────────────────────────
    // While a page asks, about twice a second, the part of the frame the
    // window shows, drawn small and averaged per cell, goes to `shaderTone`.
    // Read straight after render, in the same task: the drawing buffer is not
    // preserved, so once the frame is composited it reads back blank.
    const TONE_EVERY_MS = 500;
    const TONE_SCALE = 4;
    let toneCtx: CanvasRenderingContext2D | null = null;
    let nextToneAt = 0;

    /** What was sampled no longer lies under the same cells: start again,
     *  with the next frame drawn (a still shader may draw no other). */
    function clearTone() {
      if (!tone) return;
      shaderTone.clear();
      nextToneAt = 0;
    }

    /** The CSS blur over the shader (the org layout's filter), in px. */
    function blurRadius(): number {
      const radius = /blur\(([\d.]+)px\)/.exec(
        containerEl ? getComputedStyle(containerEl).filter : ''
      );
      return radius ? Number(radius[1]) : 0;
    }

    function sampleTone() {
      if (!tone || !shaderTone.wanted || !canvasEl) return;
      const now = performance.now();
      if (now < nextToneAt) return;
      nextToneAt = now + TONE_EVERY_MS;
      const { cols, rows } = shaderTone.grid;
      const width = cols * TONE_SCALE;
      const height = rows * TONE_SCALE;
      if (!toneCtx) {
        const small = document.createElement('canvas');
        small.width = width;
        small.height = height;
        toneCtx = small.getContext('2d');
        if (!toneCtx) return;
      }
      const { sx, sy, sw, sh } = visibleBufferRegion({
        rect: canvasEl.getBoundingClientRect(),
        buffer: canvasEl,
        fit: getComputedStyle(canvasEl).objectFit,
        viewport: toneViewport(),
      });
      if (sw <= 0 || sh <= 0) return;
      toneCtx.drawImage(canvasEl, sx, sy, sw, sh, 0, 0, width, height);
      shaderTone.record(
        averageCells(toneCtx.getImageData(0, 0, width, height).data, cols, rows, TONE_SCALE),
        { still: isFrozen, blur: blurRadius() }
      );
    }

    if (tone)
      shaderTone.onHold((held) => {
        isHeld = held;
        setFrozen(isReducedMotion || isStill || isHeld);
      });

    // A page that starts asking gets a sample at the next frame; a frozen
    // shader has none coming, so it draws its frame again.
    if (tone)
      shaderTone.onDemand(() => {
        nextToneAt = 0;
        if (isFrozen && hasRenderedStaticFrame) {
          hasRenderedStaticFrame = false;
          scheduleFrame();
        }
      });

    // ── Preset switching ───────────────────────────────────────
    async function ensureRenderer(preset: ShaderPresetId): Promise<boolean> {
      if (preset === currentPreset && renderer) return true;

      // Clean up old renderer
      if (renderer) {
        renderer.destroy(gl!);
        renderer = null;
      }

      currentPreset = preset;
      clearTone();

      if (preset === 'none') {
        // Hide canvas so CSS gradient fallback shows through.
        canvasEl!.style.opacity = '0';
        // Keep the poll loop alive so a brand-editor activation (user sets a
        // shader preset via CSS var) is detected — frame() polls every ~30
        // frames and calls ensureRenderer on preset mismatch. Without this,
        // orgs that ship without a shader can never light one up at runtime.
        scheduleFrame();
        return false;
      }

      const newRenderer = await loadRenderer(preset);
      if (!newRenderer) {
        // Loader failed — keep polling so the user (or editor) can switch to
        // a working preset without a full remount.
        scheduleFrame();
        return false;
      }

      resize(); // Ensure canvas is sized before init
      const ok = newRenderer.init(gl!, canvasEl!.width, canvasEl!.height);
      if (!ok) {
        newRenderer.destroy(gl!);
        // init() failure (e.g. missing EXT_color_buffer_float) — keep polling
        // so switching to a less-demanding preset still works.
        scheduleFrame();
        return false;
      }

      renderer = newRenderer;
      hasRenderedStaticFrame = false;
      canvasEl!.style.opacity = '1';
      // Re-prime the loop: frame() returns early on preset mismatch without
      // re-scheduling, so after an async preset switch the loop is released.
      scheduleFrame();
      return true;
    }

    // ── Render loop ────────────────────────────────────────────
    // RAF hygiene (docs/04-motion.md §6): the loop re-primes ONLY at the end
    // of the render branch. Short-circuit returns (no renderer, hidden tab,
    // reduced-motion after static frame) release the loop; `scheduleFrame()`
    // resumes it from state-change handlers (visibility/motion/ensureRenderer).
    function frame() {
      animFrameId = 0; // this callback has fired — clear handle before deciding to re-prime

      const config = pollConfig();

      // Switch preset if needed (async — may take a frame).
      // ensureRenderer calls scheduleFrame() on all branches (success AND
      // every failure mode, including 'none') so the poll loop keeps running
      // and later brand-editor activations are detected.
      if (config.preset !== currentPreset) {
        ensureRenderer(config.preset);
        return;
      }

      // Tab hidden — release loop; onVisibilityChange re-primes on return.
      if (!isVisible) return;

      // No renderer but preset matches (i.e. currentPreset === 'none'): keep
      // polling so a future brand-editor preset change is detected. Hidden
      // tab early-return above still cuts this path on inactive tabs.
      if (!renderer) {
        animFrameId = requestAnimationFrame(frame);
        return;
      }

      // Reduced motion or `still`: render one static frame, then release the
      // loop. setFrozen re-primes when both are off again.
      if (isFrozen) {
        if (hasRenderedStaticFrame) return;
        hasRenderedStaticFrame = true;
        frozenElapsed ??= (performance.now() - startTime) / 1000;
        renderer.render(gl!, frozenElapsed, mouse, config, canvasEl!.width, canvasEl!.height);
        sampleTone();
        return; // no re-prime — static frame is final
      }

      // Frame-rate-independent burst decay (docs/04-motion.md §4).
      // dt is clamped to 0.1s to avoid a tiny residual cliff if the RAF
      // loop happens to fire before `scheduleFrame` resets lastFrameTime.
      const now = performance.now();
      const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
      lastFrameTime = now;

      if (mouse.burstStrength > 0) {
        mouse.burstStrength *= Math.pow(BURST_DECAY_PER_SECOND, dt);
        if (mouse.burstStrength < 0.01) mouse.burstStrength = 0;
      }

      const elapsed = (now - startTime) / 1000;
      renderer.render(gl!, elapsed, mouse, config, canvasEl!.width, canvasEl!.height);
      sampleTone();

      // Re-prime ONLY from the render branch — hidden tabs and reduced-motion
      // users no longer pay for 1Hz / 60Hz wake-ups that render nothing.
      animFrameId = requestAnimationFrame(frame);
    }

    // ── Mouse / touch events ───────────────────────────────────
    // Listen on window so mouse interaction works even when content
    // layers (backdrop-blur divs, links) sit on top of the canvas.
    function mapMouse(clientX: number, clientY: number) {
      const rect = canvasEl!.getBoundingClientRect();
      mouse.x = (clientX - rect.left) / rect.width;
      mouse.y = 1.0 - (clientY - rect.top) / rect.height;
    }

    function onMouseMove(e: MouseEvent) {
      mapMouse(e.clientX, e.clientY);
      mouse.active = true;
    }
    function onClick(e: MouseEvent) {
      mapMouse(e.clientX, e.clientY);
      mouse.burstStrength = 1.0;
    }
    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      mapMouse(t.clientX, t.clientY);
      mouse.active = true;
      mouse.burstStrength = 1.0;
    }
    function onTouchMove(e: TouchEvent) {
      const t = e.touches[0];
      mapMouse(t.clientX, t.clientY);
      mouse.active = true;
    }
    function onTouchEnd() {
      mouse.active = false;
    }

    function attachPointerListeners() {
      if (pointerListenersAttached) return;
      pointerListenersAttached = true;
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('click', onClick);
      window.addEventListener('touchstart', onTouchStart, { passive: true });
      window.addEventListener('touchmove', onTouchMove, { passive: true });
      window.addEventListener('touchend', onTouchEnd);
    }

    function detachPointerListeners() {
      if (!pointerListenersAttached) return;
      pointerListenersAttached = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('click', onClick);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    }

    if (!isFrozen) attachPointerListeners();

    // ── Visibility — pause when tab is hidden ───────────────────
    // For full-page fixed backgrounds, IntersectionObserver doesn't work
    // reliably. Use document visibility instead (saves GPU when tab is hidden).
    function onVisibilityChange() {
      const wasVisible = isVisible;
      isVisible = document.visibilityState === 'visible';
      // Resume the loop when the tab becomes visible again — frame() releases
      // the loop on hidden tabs (no re-prime), so nothing restarts it otherwise.
      if (isVisible && !wasVisible) scheduleFrame();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    // ── Resize listener ────────────────────────────────────────
    // ResizeObserver on the container catches CSS size changes
    // (window resize, sidebar collapse, view-transition size changes,
    // rotation) without the 60/sec getBoundingClientRect cost of
    // per-frame polling. Fires once on observe() for initial sizing.
    const resizeObserver = new ResizeObserver(() => resize());
    if (containerEl) resizeObserver.observe(containerEl);

    // ── Start ──────────────────────────────────────────────────
    // ensureRenderer() calls scheduleFrame() on success — no need to re-prime here.
    const initialConfig = getShaderConfig(undefined, presetOverride);
    void ensureRenderer(initialConfig.preset);

    // ── Cleanup ────────────────────────────────────────────────
    return () => {
      applyStill = undefined;
      if (tone) {
        shaderTone.onHold(null);
        shaderTone.onDemand(null);
        shaderTone.clear();
      }
      cancelAnimationFrame(animFrameId);
      if (renderer) renderer.destroy(gl!);
      // JFA program cache is module-scoped and stays warm across preset
      // switches (pulse recompilation would otherwise cost ~3ms per activation).
      // On actual subsystem unmount it would orphan without this — the GL
      // context lives on the canvas element, module lives across SPA nav.
      if (gl) destroyJFACache(gl);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      motionQuery.removeEventListener('change', onMotionChange);
      resizeObserver.disconnect();
      detachPointerListeners();
    };
  });
</script>

<div
  bind:this={containerEl}
  class="shader-hero {className ?? ''}"
  aria-hidden="true"
>
  {#if browser && hasWebGL}
    <canvas
      bind:this={canvasEl}
      class="shader-hero__canvas"
    ></canvas>
  {/if}
</div>

<style>
  .shader-hero {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 0;
    /* Exclude from view transition snapshots so shader stays live during navigation */
    view-transition-name: none;
  }

  .shader-hero__canvas {
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: auto;
    opacity: 0;
    transition: var(--transition-opacity);
  }
</style>

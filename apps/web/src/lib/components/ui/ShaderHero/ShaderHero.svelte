<!--
  @component ShaderHero

  Animated WebGL shader background for organization hero sections.
  Reads shader preset + config from brand CSS custom properties (tokenOverrides).
  Progressive enhancement: CSS gradient fallback when WebGL unavailable.

  Features:
  - 4 presets: suture (RDA), ether (raymarch), warp (FBM), ripple (wave eq)
  - Brand-colored — reads org palette from CSS vars
  - IntersectionObserver pauses when off-screen
  - prefers-reduced-motion: render one static frame, then stop
  - Mobile DPR capped at 1 for performance
  - Live-preview: brand editor changes take effect immediately
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { getShaderConfig, type ShaderPresetId } from './shader-config';
  import type { ShaderRenderer, MouseState } from './renderer-types';

  interface Props {
    class?: string;
  }

  const { class: className }: Props = $props();

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
    let isVisible = true;
    let isReducedMotion = false;
    let hasRenderedStaticFrame = false;

    const mouse: MouseState = { x: 0.5, y: 0.5, active: false, burstStrength: 0 };

    // ── Reduced motion check ───────────────────────────────────
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    isReducedMotion = motionQuery.matches;
    const onMotionChange = (e: MediaQueryListEvent) => {
      isReducedMotion = e.matches;
      if (isReducedMotion) {
        hasRenderedStaticFrame = false;
      }
    };
    motionQuery.addEventListener('change', onMotionChange);

    // ── Renderer factory ───────────────────────────────────────
    async function loadRenderer(preset: ShaderPresetId): Promise<ShaderRenderer | null> {
      switch (preset) {
        case 'suture': {
          const { createSutureRenderer } = await import('./renderers/suture-renderer');
          return createSutureRenderer();
        }
        case 'ether': {
          const { createEtherRenderer } = await import('./renderers/ether-renderer');
          return createEtherRenderer();
        }
        case 'warp': {
          const { createWarpRenderer } = await import('./renderers/warp-renderer');
          return createWarpRenderer();
        }
        case 'ripple': {
          const { createRippleRenderer } = await import('./renderers/ripple-renderer');
          return createRippleRenderer();
        }
        default:
          return null;
      }
    }

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
      }
    }

    // ── Config polling ─────────────────────────────────────────
    // Read shader config from CSS vars. Called each frame to pick up
    // live brand editor changes without needing a Svelte store bridge.
    let configPollCounter = 0;
    let cachedConfig = getShaderConfig();

    function pollConfig() {
      // Poll every 30 frames (~0.5s at 60fps) to avoid getComputedStyle overhead
      configPollCounter++;
      if (configPollCounter >= 30) {
        configPollCounter = 0;
        cachedConfig = getShaderConfig();
      }
      return cachedConfig;
    }

    // ── Preset switching ───────────────────────────────────────
    async function ensureRenderer(preset: ShaderPresetId): Promise<boolean> {
      if (preset === currentPreset && renderer) return true;

      // Clean up old renderer
      if (renderer) {
        renderer.destroy(gl!);
        renderer = null;
      }

      currentPreset = preset;

      if (preset === 'none') {
        // Hide canvas so CSS gradient fallback shows through
        canvasEl!.style.opacity = '0';
        return false;
      }

      const newRenderer = await loadRenderer(preset);
      if (!newRenderer) return false;

      resize(); // Ensure canvas is sized before init
      const ok = newRenderer.init(gl!, canvasEl!.width, canvasEl!.height);
      if (!ok) {
        newRenderer.destroy(gl!);
        return false;
      }

      renderer = newRenderer;
      hasRenderedStaticFrame = false;
      canvasEl!.style.opacity = '1';
      return true;
    }

    // ── Render loop ────────────────────────────────────────────
    function frame() {
      animFrameId = requestAnimationFrame(frame);

      const config = pollConfig();

      // Switch preset if needed (async — may take a frame)
      if (config.preset !== currentPreset) {
        ensureRenderer(config.preset);
        return;
      }

      if (!renderer || !isVisible) return;

      // Reduced motion: render one frame then stop
      if (isReducedMotion) {
        if (hasRenderedStaticFrame) return;
        hasRenderedStaticFrame = true;
      }

      // Decay burst strength
      if (mouse.burstStrength > 0) {
        mouse.burstStrength *= 0.85;
        if (mouse.burstStrength < 0.01) mouse.burstStrength = 0;
      }

      const elapsed = (performance.now() - startTime) / 1000;
      resize();
      renderer.render(gl!, elapsed, mouse, config, canvasEl!.width, canvasEl!.height);
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

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('click', onClick);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);

    // ── Visibility — pause when tab is hidden ───────────────────
    // For full-page fixed backgrounds, IntersectionObserver doesn't work
    // reliably. Use document visibility instead (saves GPU when tab is hidden).
    function onVisibilityChange() {
      isVisible = document.visibilityState === 'visible';
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    // ── Resize listener ────────────────────────────────────────
    window.addEventListener('resize', resize);

    // ── Start ──────────────────────────────────────────────────
    const initialConfig = getShaderConfig();
    ensureRenderer(initialConfig.preset).then(() => {
      animFrameId = requestAnimationFrame(frame);
    });

    // ── Cleanup ────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(animFrameId);
      if (renderer) renderer.destroy(gl!);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      motionQuery.removeEventListener('change', onMotionChange);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('click', onClick);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
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
  }

  .shader-hero__canvas {
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: auto;
    opacity: 0;
    transition: opacity var(--duration-normal, 200ms) var(--ease-default, ease);
  }
</style>

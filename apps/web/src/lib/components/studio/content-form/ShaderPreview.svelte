<!--
  @component ShaderPreview

  Live WebGL preview of a shader preset — used above the ShaderPicker grid
  so creators can see what the currently-selected preset looks like before
  committing. Strips audio-reactivity from the ImmersiveShaderPlayer
  formula; keeps the brand-colored config pipeline.

  Reads brand colors from the nearest .org-layout via getShaderConfig().
  Respects prefers-reduced-motion (renders one static frame then stops).
  Pauses when scrolled off-screen via IntersectionObserver.

  @prop {string | null} preset - Selected preset ID. `null` hides the preview.
-->
<script lang="ts">
  import { browser } from '$app/environment';
  import { loadRenderer } from '$lib/components/ui/ShaderHero/load-renderer';
  import { getShaderConfig, type ShaderPresetId } from '$lib/components/ui/ShaderHero/shader-config';
  import { createPollConfig } from '$lib/components/ui/ShaderHero/use-poll-config';
  import type { ShaderRenderer, MouseState } from '$lib/components/ui/ShaderHero/renderer-types';

  interface Props {
    preset: string | null;
  }

  const { preset }: Props = $props();

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let containerEl: HTMLDivElement | undefined = $state();
  let hasWebGL = $state(true);
  let ready = $state(false);

  let gl: WebGL2RenderingContext | null = null;
  let renderer: ShaderRenderer | null = null;
  let currentPreset: ShaderPresetId | null = null;
  // Closure reads `currentPreset` lexically — switchPreset() updates the
  // variable, the next 30-frame tick picks it up. Amortises getShaderConfig
  // (forced style recalc) per ShaderHero.svelte:135-146.
  const pollConfig = createPollConfig(() =>
    getShaderConfig(null, currentPreset as ShaderPresetId)
  );
  let animFrameId = 0;
  let startTime = 0;
  let isReducedMotion = false;
  let hasRenderedStaticFrame = false;
  let isVisible = true;
  let loadToken = 0;

  const mouse: MouseState = { x: 0.5, y: 0.5, active: false, burstStrength: 0 };

  function resize() {
    if (!canvasEl || !containerEl || !gl) return;
    const rect = containerEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const isMobile = rect.width < 768;
    const dpr = isMobile ? 1 : Math.min(window.devicePixelRatio, 2);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvasEl.width !== w || canvasEl.height !== h) {
      canvasEl.width = w;
      canvasEl.height = h;
      gl.viewport(0, 0, w, h);
      renderer?.resize(gl, w, h);
    }
  }

  function renderFrame() {
    if (!gl || !renderer || !canvasEl) {
      animFrameId = 0;
      return;
    }

    if (isReducedMotion && hasRenderedStaticFrame) {
      animFrameId = 0;
      return;
    }

    if (!isVisible) {
      animFrameId = requestAnimationFrame(renderFrame);
      return;
    }

    const time = (performance.now() - startTime) / 1000;
    if (mouse.burstStrength > 0.01) mouse.burstStrength *= 0.85;
    else mouse.burstStrength = 0;

    const config = pollConfig();
    renderer.render(gl, time, mouse, config, canvasEl.width, canvasEl.height);
    hasRenderedStaticFrame = true;
    animFrameId = requestAnimationFrame(renderFrame);
  }

  async function switchPreset(target: ShaderPresetId | null) {
    if (!gl || !canvasEl) return;

    // Token guard — if switchPreset is called again while the previous
    // loadRenderer() is still in-flight, the newer call wins.
    const token = ++loadToken;

    cancelAnimationFrame(animFrameId);
    animFrameId = 0;

    if (renderer) {
      renderer.destroy(gl);
      renderer = null;
    }

    currentPreset = target;
    hasRenderedStaticFrame = false;

    if (target === null || target === 'none') return;

    const next = await loadRenderer(target);
    if (token !== loadToken || !next || !gl || !canvasEl) return;

    renderer = next;
    resize();
    const ok = renderer.init(gl, canvasEl.width, canvasEl.height);
    if (!ok) {
      renderer = null;
      return;
    }

    startTime = performance.now();
    animFrameId = requestAnimationFrame(renderFrame);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) / rect.width;
    mouse.y = 1 - (e.clientY - rect.top) / rect.height;
    mouse.active = true;
  }

  function handlePointerLeave() {
    mouse.active = false;
  }

  function handleClick() {
    mouse.burstStrength = 1.0;
    // Restart animation if it stopped (reduced motion + static frame case)
    if (!animFrameId && gl && renderer) {
      hasRenderedStaticFrame = false;
      animFrameId = requestAnimationFrame(renderFrame);
    }
  }

  // Lazy WebGL init. The canvas is conditionally rendered (only when a
  // preset is selected), so its `bind:this` resolves AFTER mount — meaning
  // the old `onMount(() => if (!canvasEl) return)` bailed on first paint
  // and never ran again once the canvas appeared. We now initialise in an
  // $effect that re-runs whenever `canvasEl` changes from undefined to a
  // real element, and keep a `initialised` guard so it only runs once.
  let initialised = false;
  $effect(() => {
    if (!browser || !canvasEl || initialised) return;
    initialised = true;

    gl = canvasEl.getContext('webgl2', {
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

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    isReducedMotion = motionQuery.matches;
    const onMotionChange = (e: MediaQueryListEvent) => {
      isReducedMotion = e.matches;
      if (isReducedMotion) hasRenderedStaticFrame = false;
    };
    motionQuery.addEventListener('change', onMotionChange);

    const visibilityObs = new IntersectionObserver(
      (entries) => {
        isVisible = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0 }
    );
    visibilityObs.observe(canvasEl);

    const resizeObs = new ResizeObserver(() => resize());
    if (containerEl) resizeObs.observe(containerEl);

    ready = true;

    return () => {
      cancelAnimationFrame(animFrameId);
      motionQuery.removeEventListener('change', onMotionChange);
      visibilityObs.disconnect();
      resizeObs.disconnect();
      if (gl && renderer) renderer.destroy(gl);
      gl = null;
      renderer = null;
      initialised = false;
      ready = false;
    };
  });

  // React to preset changes — covers both the initial load (after ready flips)
  // and subsequent selections from the grid.
  $effect(() => {
    if (!ready) return;
    const target = preset as ShaderPresetId | null;
    if (target === currentPreset) return;
    void switchPreset(target);
  });
</script>

<div class="shader-preview" bind:this={containerEl}>
  {#if preset && preset !== 'none'}
    {#if hasWebGL}
      <canvas
        bind:this={canvasEl}
        class="preview-canvas"
        onpointermove={handlePointerMove}
        onpointerleave={handlePointerLeave}
        onclick={handleClick}
        aria-hidden="true"
      ></canvas>
      <span class="preview-label">Preview</span>
    {:else}
      <div class="preview-fallback">
        <span>Preview unavailable — WebGL not supported in this browser</span>
      </div>
    {/if}
  {:else}
    <div class="preview-empty">
      <span>Select a shader preset below to see a live preview</span>
    </div>
  {/if}
</div>

<style>
  .shader-preview {
    position: relative;
    width: 100%;
    aspect-ratio: 21 / 9;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .preview-canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  .preview-label {
    position: absolute;
    top: var(--space-2);
    left: var(--space-2);
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--color-text-inverse);
    background: color-mix(in srgb, black 50%, transparent);
    border-radius: var(--radius-sm);
    pointer-events: none;
  }

  .preview-empty,
  .preview-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: var(--space-4);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    text-align: center;
  }
</style>

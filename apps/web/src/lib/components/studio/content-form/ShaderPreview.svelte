<!--
  @component ShaderPreview

  Live WebGL preview of a shader preset — used above the ShaderPicker grid
  so creators can see what the currently-selected preset looks like before
  committing. Strips audio-reactivity from the ImmersiveShaderPlayer
  formula; keeps the brand-colored config pipeline.

  Reads brand colors from the nearest .org-layout via getShaderConfig().
  Respects prefers-reduced-motion (renders one static frame then stops).
  Pauses when scrolled off-screen via IntersectionObserver.

  @prop {string | null} preset - The piece's saved preset ID. It previews what
    immersive mode will actually play (`immersivePreset`): the piece's own
    shader, else the org's brand shader, else flow. A saved ID that names no
    preset says so in words above that preview.
-->
<script lang="ts">
  import { browser } from '$app/environment';
  import { presetLabel } from '$lib/brand-editor/hero-fx-presets';
  import { immersivePreset, noShaderPlays } from '$lib/components/AudioPlayer/immersive-preset';
  import {
    getBrandPresetId,
    getShaderConfig,
    type LivePresetId,
    presetIsUnknown,
    type ShaderConfig,
    warnUnknownPreset,
  } from '$lib/components/ui/ShaderHero/shader-config';
  import { destroyRenderer, startRenderer } from '$lib/components/ui/ShaderHero/start-renderer';
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
  let currentPreset: LivePresetId | null = null;
  // Built per renderer, for the preset that started, so its first frame
  // reads its own config. One poller built at init for `currentPreset` handed
  // a new renderer the PREVIOUS preset's config for up to 29 frames, which
  // ripple and suture turn into NaN: a preview black for good. Amortises
  // getShaderConfig (forced style recalc) per ShaderHero.svelte.
  let pollConfig: (() => ShaderConfig) | null = null;
  /** The shader would not load or start, even on the fallback. */
  let startFailed = $state(false);
  /** The chosen shader would not start here, so the fallback plays instead. */
  let fellBack = $state<{ from: LivePresetId; to: LivePresetId } | null>(null);
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
    if (!gl || !renderer || !canvasEl || !pollConfig) {
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

  async function switchPreset(target: LivePresetId | null) {
    if (!gl || !canvasEl) return;

    // Token guard — if switchPreset is called again while the previous
    // load is still in flight, the newer call wins.
    const token = ++loadToken;

    cancelAnimationFrame(animFrameId);
    animFrameId = 0;

    if (renderer) {
      renderer.destroy(gl);
      renderer = null;
    }
    pollConfig = null;

    currentPreset = target;
    hasRenderedStaticFrame = false;
    startFailed = false;
    fellBack = null;

    if (target === null) return;

    // Logs a failure, destroys a half-built renderer, and retries an init
    // failure once on single-pass `film` (`start-renderer.ts`).
    const context = gl;
    const started = await startRenderer(target, {
      gl: context,
      surface: 'shader_preview',
      size: () => {
        resize();
        return canvasEl ? { width: canvasEl.width, height: canvasEl.height } : null;
      },
      isCurrent: () => token === loadToken && gl === context,
    });
    if (token !== loadToken || gl !== context) {
      if (started.ok === true) destroyRenderer(started.renderer, context, 'shader_preview');
      return;
    }
    if (started.ok === false) {
      startFailed = true;
      return;
    }

    renderer = started.renderer;
    const shown = started.preset;
    // The film retry ran: say what plays, as immersive mode will play it.
    if (shown !== target) fellBack = { from: target, to: shown };
    pollConfig = createPollConfig(() => getShaderConfig(null, shown));
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

  // Lazy WebGL init. The canvas is conditionally rendered (only in the
  // browser, once `playing` is known), so its `bind:this` resolves AFTER mount — meaning
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

  /** The saved id names no preset, live or cut (an unset one is not unknown). */
  const unknown = $derived(presetIsUnknown(preset));

  /**
   * What immersive mode will actually play for this piece, so the preview
   * never shows a shader it will not get: its own (a cut one as its
   * survivor), else the org's brand shader — what the None card promises —
   * else flow. The brand's is read off the org layout, so in the browser only.
   */
  const brandPreset = $derived(browser ? getBrandPresetId() : null);
  const playing = $derived<LivePresetId | null>(
    browser ? immersivePreset(preset, brandPreset) : null
  );
  /** "your brand's shader", or Flow where the brand has none. */
  const fallbackPlays = $derived(noShaderPlays(brandPreset));

  // A saved id naming no preset plays the brand's shader; say so in the logs.
  $effect(() => {
    if (preset && unknown) warnUnknownPreset(preset, 'studio');
  });

  // React to preset changes — covers both the initial load (after ready flips)
  // and subsequent selections from the grid.
  $effect(() => {
    if (!ready) return;
    const target = playing;
    if (target === currentPreset) return;
    void switchPreset(target);
  });
</script>

<div class="shader-preview" bind:this={containerEl}>
  {#if playing}
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
      <!-- Over the canvas, never instead of it: the canvas (and its
           context) must stay for the next shader picked to start on. -->
      {#if startFailed}
        <p class="preview-fallback preview-fallback--over">
          Preview unavailable — this shader could not start in this browser
        </p>
      {/if}
    {:else}
      <div class="preview-fallback">
        <span>Preview unavailable — WebGL not supported in this browser</span>
      </div>
    {/if}
  {/if}
  {#if unknown}
    <p class="preview-note">
      This piece's saved shader is no longer available, so it plays
      {fallbackPlays}.
    </p>
  {/if}
</div>
{#if fellBack}
  <p class="preview-fell-back">
    {presetLabel(fellBack.from)} can't run in this browser, so it plays
    {presetLabel(fellBack.to)} here.
  </p>
{/if}

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
    /* Text over media on a fixed dark scrim. `--color-text-inverse` follows
       the page, so it was near-black here in dark (Codex-mik4h). */
    color: var(--media-glyph);
    background: color-mix(in srgb, black 50%, transparent);
    border-radius: var(--radius-sm);
    pointer-events: none;
  }

  /* Words over the preview, on the label's fixed dark scrim. */
  .preview-note {
    position: absolute;
    right: var(--space-2);
    bottom: var(--space-2);
    left: var(--space-2);
    margin: 0;
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-sm);
    color: var(--media-glyph);
    background: color-mix(in srgb, black 60%, transparent);
    border-radius: var(--radius-sm);
  }

  .preview-fell-back {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .preview-fallback--over {
    position: absolute;
    inset: 0;
    margin: 0;
    background: var(--color-surface-secondary);
  }

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

<!--
  @component ShaderHero

  Animated WebGL shader background for organization hero sections.
  Reads shader preset + config from brand CSS custom properties (tokenOverrides).
  Progressive enhancement: CSS gradient fallback when WebGL unavailable.

  Features:
  - every `ShaderPresetId`, each its own lazily loaded renderer
  - Brand-colored — reads org palette from CSS vars
  - IntersectionObserver pauses when off-screen
  - prefers-reduced-motion, `still`, or a page holding it (`tone`): render one
    static frame, then stop
  - Mobile DPR capped at 1 for performance
  - Live-preview: brand editor changes take effect immediately
  - `data-live` on its root once a renderer has drawn a frame the canvas shows
    (moving or still); the org layout's `tone` one also reports to `shaderLive`
  - `data-drawn` once the canvas shows any frame: a shader's, or the
    Showreel's plain ground, which is drawn but not live (no brand shader
    paints under the words)
  - the brand shader STACK (Codex-1yd58.4): a second preset, a blend, layers
    and a frame, drawn through the compositor (`compositor/`). A bare stack,
    the base alone, takes today's path: no compositor, no framebuffer, the
    canvas at today's size.
  - the Showreel's film (`showreelFeed`, the org layout's hero only), drawn
    through the compositor too, on a plain ground of the brand's background
    when the brand has no shader
  - a lost WebGL context is restored: everything is rebuilt and it goes live
    again once it draws
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { createFrameBudget, PHONE_MAX_WIDTH } from './compositor/budget';
  import type { Compositor } from './compositor/compositor';
  import { showreelFeed } from './compositor/showreel-feed';
  import {
    BARE_STACK,
    getStackConfig,
    needsCompositor,
    type StackConfig,
    stackKey,
  } from './compositor/stack-config';
  import { destroyJFACache, resetJFACache } from './jfa-sdf';
  import {
    getShaderConfig,
    type LivePresetId,
    type ShaderConfig,
    type ShaderPresetId,
    shaderIsDark,
  } from './shader-config';
  import { loadRenderer } from './load-renderer';
  import { setOutputTarget } from './output-target';
  import {
    type RendererFailure,
    reportCompositorFailure,
    reportContextLost,
    reportContextRestored,
    reportRendererFailure,
    reportRetryFailure,
    reportSecondFailure,
    reportStackBudget,
  } from './renderer-failure';
  import { destroyRenderer } from './start-renderer';
  import { withProgramLabel } from './webgl-utils';
  import type { ShaderRenderer, MouseState } from './renderer-types';
  import { shaderLive } from './shader-live.svelte';
  import { captureStill, shaderStill } from './shader-still.svelte';
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
     * click). Turning it off resumes the motion. With `tone` (the org
     * layout's shader, so the studio's), that one frame is also copied for
     * the page editor's Moving bands (`shaderStill`, Codex-61zsk.73).
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
  // `data-live` (Codex-1yd58.3): the canvas shows a frame that a renderer drew.
  // What reads "a shader is painting" keys on this attribute, never on the
  // canvas's inline style: the home hero's ink, OrgHero's shader ink, and
  // (through `shaderLive`) the org layout's gate. It stays set through a
  // preset switch, because the old frame stays on screen until the new
  // renderer draws, and it is cleared when nothing would show.
  let live = $state(false);
  // `data-drawn` (Codex-1yd58.4): the canvas shows a frame, a shader's or the
  // Showreel's plain ground (its film with no brand shader under it). The
  // Showreel keys on this one. A plain ground is drawn but NOT live: no
  // brand shader paints under the words, so their ink stays the page's
  // (white shader ink on a light brand would vanish).
  let drawn = $state(false);

  onMount(() => {
    if (!canvasEl || !browser) return;

    // The org layout's shader is the one whose state the layout's gate
    // reads (`shader-live.svelte.ts` explains why there is a single writer).
    const liveWriter = tone ? shaderLive.claim() : null;

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
      // Nothing can draw, whatever the brand asks for.
      liveWriter?.report(
        getShaderConfig(undefined, presetOverride).preset === 'none' ? 'none' : 'failed'
      );
      return () => liveWriter?.release();
    }
    const glContext: WebGL2RenderingContext = gl;

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

    // The stack (Codex-1yd58.4): see "Stack" below.
    let compositor: Compositor | null = null;
    /** Bumped per compositor load and detach: a load overtaken is discarded. */
    let compositorToken = 0;
    let compositorLoading = false;
    /** It would not load or draw: the base alone, for the session. */
    let compositorBroken = false;
    let secondRenderer: ShaderRenderer | null = null;
    /** The second preset loaded or loading, else null. */
    let secondPreset: LivePresetId | null = null;
    let secondConfig: ShaderConfig | null = null;
    /** Bumped per second-preset load: a load overtaken is discarded. */
    let secondToken = 0;
    const secondsFailed = new Set<LivePresetId>();
    /** The phone budget dropped the second preset, for the session. */
    let secondDropped = false;
    const budget = createFrameBudget();

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
    /** A frozen shader has no next frame, so one that must show something
     *  new (a resize cleared it, a page asks for a sample, the studio wants
     *  its copy) draws its static frame again. */
    function redrawFrozen() {
      if (!isFrozen || !hasRenderedStaticFrame) return;
      hasRenderedStaticFrame = false;
      scheduleFrame();
    }
    const onMotionChange = (e: MediaQueryListEvent) => {
      isReducedMotion = e.matches;
      setFrozen(isReducedMotion || isStill || isHeld);
    };
    motionQuery.addEventListener('change', onMotionChange);
    applyStill = (next) => {
      const entering = next && !isStill;
      isStill = next;
      watchBrand(isStill);
      // Out of the studio the shader moves on, so the copy is no longer its
      // frame; back in, the frame drawn on freezing is copied afresh.
      if (!isStill) clearStill();
      setFrozen(isReducedMotion || isStill || isHeld);
      // Frozen already (reduced motion, a held page), it froze with no copy
      // taken and freezing again draws nothing, so it draws its frame again.
      if (entering) redrawFrozen();
    };

    // Renderer factory is imported from ./load-renderer — single source of
    // truth shared with ImmersiveShaderPlayer. Adding a new preset only
    // requires touching load-renderer.ts.

    // ── Canvas sizing ──────────────────────────────────────────
    // Two sizes (plan §5.2). The SCENE is what the presets render at:
    // today's canvas size, DPR 1 on a phone. The canvas itself is the scene,
    // except while a compositor is attached: then its frame pass draws at the
    // display DPR (<= 2) and only that pass pays for it.
    let sceneW = 0;
    let sceneH = 0;
    let cssWidth = 0;
    /** The canvas's client rect at the last resize (the compositor's stage). */
    let canvasBox = { left: 0, bottom: 0, width: 0, height: 0 };

    function resize(force = false) {
      if (!canvasEl || !containerEl) return;
      // Mid-switch (no renderer yet, the last preset's frame still live), a
      // size change would clear the canvas to black with nothing to redraw
      // it. It keeps its size until the new renderer applies it before init
      // (`resize(true)` in ensureRenderer).
      // (With no preset at all, a live canvas is the Showreel's plain ground,
      // which resizes like any frame.)
      if (!force && !renderer && currentPreset !== 'none' && drawn) return;
      const rect = containerEl.getBoundingClientRect();
      cssWidth = rect.width;
      canvasBox = { left: rect.left, bottom: rect.bottom, width: rect.width, height: rect.height };
      // Cap DPR at 1 on mobile for performance (9x fewer fragments vs DPR 3)
      const isMobile = rect.width < PHONE_MAX_WIDTH;
      const sceneDpr = isMobile ? 1 : Math.min(window.devicePixelRatio, 2);
      const dpr = compositor ? Math.min(window.devicePixelRatio, 2) : sceneDpr;
      const nextSceneW = Math.round(rect.width * sceneDpr);
      const nextSceneH = Math.round(rect.height * sceneDpr);
      if (nextSceneW !== sceneW || nextSceneH !== sceneH) {
        sceneW = nextSceneW;
        sceneH = nextSceneH;
        renderer?.resize(glContext, sceneW, sceneH);
        const [secondW, secondH] = secondSize();
        secondRenderer?.resize(glContext, secondW, secondH);
      }
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvasEl.width !== w || canvasEl.height !== h) {
        canvasEl.width = w;
        canvasEl.height = h;
        clearTone();
        // Resizing clears the canvas.
        redrawFrozen();
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

    /** The brand's stack over `base`. An override names the whole picture
     *  (the platform's own shader on the auth pane): no stack. */
    function readStack(base: ShaderPresetId, el?: Element | null): StackConfig {
      return presetOverride === undefined ? getStackConfig(el, base) : BARE_STACK;
    }
    // Read with the config, so a stack draws from the first frame. Kept by
    // identity while its key holds: the compositor plans once per stack.
    let cachedStack = readStack(cachedConfig.preset);
    let cachedStackKey = stackKey(cachedStack);

    function pollConfig(fresh: boolean) {
      // Poll every 30 frames (~0.5s at 60fps) to avoid getComputedStyle overhead
      configPollCounter++;
      if (fresh || configPollCounter >= 30) {
        configPollCounter = 0;
        cachedConfig = getShaderConfig(undefined, presetOverride);
        const key = JSON.stringify(cachedConfig);
        const stack = readStack(cachedConfig.preset);
        const nextStackKey = stackKey(stack);
        // New colours, settings or stack draw a different picture under each cell.
        if (key !== cachedConfigKey || nextStackKey !== cachedStackKey) clearTone();
        cachedConfigKey = key;
        if (nextStackKey !== cachedStackKey) {
          cachedStack = stack;
          cachedStackKey = nextStackKey;
        }
        if (secondPreset) secondConfig = getShaderConfig(undefined, secondPreset);
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

    // ── Still (Codex-61zsk.73) ─────────────────────────────────
    // The studio's one frame, copied straight after it is drawn (as a tone
    // sample is, and for the same reason) for the page editor's Moving
    // bands. Only the studio's: the org layout's shader (`tone`) while it is
    // `still`. A resize redraws it and so copies it again; the old copy
    // stays on screen until the new one is ready.
    // What the copy was drawn from: the brand's shader settings and theme.
    let stillDrawnKey = '';

    /** The theme whose colours it draws in, from the sentinel its config reads. */
    function drawsDark(): boolean {
      return shaderIsDark(containerEl ? getComputedStyle(containerEl) : null);
    }

    function copyStill() {
      if (!tone || !isStill || !canvasEl || !containerEl) return;
      // A lost context draws nothing: its copy would be blank, not the frame.
      if (gl?.isContextLost()) return;
      const width = containerEl.getBoundingClientRect().width;
      const dark = drawsDark();
      stillDrawnKey = `${cachedConfigKey}|${cachedStackKey}|${dark}`;
      captureStill(canvasEl, {
        theme: dark ? 'dark' : 'light',
        blur: width > 0 ? blurRadius() / width : 0,
      });
    }

    function clearStill() {
      if (tone) shaderStill.clear();
    }

    // A frozen shader reads the brand only when it draws, so a new preset,
    // new colours or the other theme would leave the page editor a copy of
    // the old. In the studio, once a change to the org layout's tokens (the
    // brand editor writes them inline, and its editing theme as attributes)
    // or to the site's theme settles, a copy of what the shader no longer
    // draws gives way to the glow. The frame is drawn again for a new copy
    // only while a render paints it: each is a full-viewport draw, and the
    // brand editor, where most changes are made, paints none. Watched only
    // while still: out of the studio there is no copy to keep.
    const STILL_SETTLE_MS = 250;
    let stillSettle = 0;
    const orgLayoutEl = containerEl?.closest('.org-layout') ?? null;
    const brandObserver = tone
      ? new MutationObserver(() => {
          clearTimeout(stillSettle);
          stillSettle = window.setTimeout(() => {
            const config = getShaderConfig(orgLayoutEl, presetOverride);
            // The stack too: a stack-only edit draws another picture.
            const stack = stackKey(readStack(config.preset, orgLayoutEl));
            if (`${JSON.stringify(config)}|${stack}|${drawsDark()}` === stillDrawnKey) return;
            clearStill();
            if (shaderStill.wanted) redrawFrozen();
          }, STILL_SETTLE_MS);
        })
      : null;
    function watchBrand(on: boolean) {
      if (!brandObserver) return;
      brandObserver.disconnect();
      clearTimeout(stillSettle);
      if (!on) return;
      if (orgLayoutEl)
        brandObserver.observe(orgLayoutEl, {
          attributes: true,
          attributeFilter: ['style', 'data-editing-theme', 'data-org-brand'],
        });
      brandObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
    }
    watchBrand(isStill);

    // A render that starts painting the copy, with none shown or being made
    // (the brand changed while none painted it, or a copy failed), gets the
    // frame drawn again to copy: once for each brand drawn, so a copy that
    // cannot be made is not drawn for again on every mount.
    let demandedKey = '';
    if (tone)
      shaderStill.onDemand(() => {
        if (!isStill || shaderStill.current || shaderStill.encoding) return;
        if (demandedKey === stillDrawnKey) return;
        demandedKey = stillDrawnKey;
        redrawFrozen();
      });

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
        redrawFrozen();
      });

    // The Showreel's film, its frame and the org's name (WP-5) reach the
    // window's shader through `showreelFeed`. A film attaches a compositor
    // (`syncStack`), even with no preset; a frozen hero draws again to show
    // what changed.
    if (tone)
      showreelFeed.onChange((changed) => {
        if (compositor) {
          if (changed === 'media') compositor.setMedia(showreelFeed.media);
          else if (changed === 'stage') compositor.setStage(showreelFeed.stage);
          else compositor.setNameMask(showreelFeed.mask);
        }
        if (changed === 'media') scheduleFrame();
        redrawFrozen();
      });

    // ── Live (Codex-1yd58.3) ───────────────────────────────────
    // The canvas is shown only once a renderer has drawn into it, so the fade
    // in starts from a real frame, and `data-live`, which the hero's ink keys
    // on, flips in the same task as the fade it is timed to. (The canvas used
    // to be shown at init, one frame before anything was drawn, and stayed
    // shown with nothing on it while a hidden tab drew no frames.)
    /** What the layout's gate was last told (`shaderLive`). */
    let reported: 'live' | 'none' | 'failed' | null = null;
    function report(state: 'live' | 'none' | 'failed') {
      if (state === reported) return;
      reported = state;
      liveWriter?.report(state);
    }
    /** A frame is drawn and the canvas shows it: a brand shader's ('live'),
     *  or the Showreel's plain ground, under no shader ('none') or one that
     *  would not start ('failed'). Every frame calls this, so it returns
     *  early once settled. (No frame renders on a lost context: `frame()`
     *  stops first.) */
    function shown(state: 'live' | 'none' | 'failed') {
      if (drawn && reported === state) return;
      drawn = true;
      live = state === 'live';
      if (canvasEl) canvasEl.style.opacity = '1';
      report(state);
    }
    /** Nothing is drawn: no preset, or a shader that cannot draw. */
    function hidden(state: 'none' | 'failed') {
      drawn = false;
      live = false;
      if (canvasEl) canvasEl.style.opacity = '0';
      report(state);
    }

    // ── Renderer failure ───────────────────────────────────────
    // A preset whose renderer will not load or start STOPS the loop (retried
    // every frame it would only fail again) and hides the canvas
    // (`hidden('failed')`). Then `data-live` is cleared, and the layout's gate
    // clears too, so the page's surfaces go back to opaque. The loop wakes
    // when the brand's preset tokens or the theme change, and goes on once
    // the preset it reads is another one, which then loads. A LOAD failure (offline, a replaced chunk) is also retried ONCE,
    // when the browser comes back online or the tab is shown again: the org
    // layout's hero is mounted once per SPA session, so nothing else would.
    let failedPreset: ShaderPresetId | null = null;
    // Bumped per load, so a load overtaken by a newer preset is discarded.
    let loadToken = 0;

    /** The raw preset tokens, and which theme's applies, as the config reads them. */
    function presetTokens(): string {
      const layout = document.querySelector('.org-layout');
      if (!layout) return '';
      const style = getComputedStyle(layout);
      return ['--brand-shader-preset', '--brand-shader-preset-dark', '--brand-shader-is-dark']
        .map((prop) => style.getPropertyValue(prop).trim())
        .join('|');
    }
    let failedTokens = '';

    function wake() {
      failedPreset = null;
      retryObserver?.disconnect();
      // The poll's cached read still names the failed preset: read afresh.
      configPollCounter = 30;
      scheduleFrame();
    }

    // Only where the brand can change the preset: an override never changes.
    const retryObserver =
      presetOverride === undefined
        ? new MutationObserver(() => {
            if (failedPreset === null) return;
            // Most mutations are other tokens; the full read is the costly one.
            const tokens = presetTokens();
            if (tokens === failedTokens) return;
            failedTokens = tokens;
            if (getShaderConfig(undefined, presetOverride).preset === failedPreset) return;
            wake();
          })
        : null;

    // One retry per preset after a load failure, then it gives up. Plain
    // bookkeeping inside onMount: nothing renders from it.
    const loadRetried: ShaderPresetId[] = [];
    let disarmLoadRetry: (() => void) | null = null;
    /** The preset whose one retry is loading now, so its failure is told apart. */
    let retrying: ShaderPresetId | null = null;
    function armLoadRetry(preset: ShaderPresetId) {
      if (loadRetried.includes(preset)) return;
      loadRetried.push(preset);
      // Some engines cache a failed module fetch, so this may fail the same
      // way; it is one cheap, safe attempt, and its outcome is logged.
      const retry = () => {
        if (document.visibilityState !== 'visible') return;
        disarm();
        if (failedPreset !== preset) return;
        retrying = preset;
        wake();
      };
      const disarm = () => {
        window.removeEventListener('online', retry);
        document.removeEventListener('visibilitychange', retry);
        disarmLoadRetry = null;
      };
      window.addEventListener('online', retry);
      document.addEventListener('visibilitychange', retry);
      disarmLoadRetry = disarm;
    }

    function rendererFailed(preset: ShaderPresetId, reason: 'load' | 'init', thrown?: unknown) {
      reportRendererFailure(preset, reason, glContext, thrown);
      // Nothing runs, so the state says nothing does: a later change of
      // preset, even back to this one after another, loads afresh.
      currentPreset = 'none';
      failedPreset = preset;
      failedTokens = presetTokens();
      // With a film to play, the plain ground takes over (`frame()`), and
      // says 'failed' as it draws; its loop goes on.
      if (hasMedia()) scheduleFrame();
      else hidden('failed');
      dropStack();
      if (retrying === preset) {
        // The one retry failed too: said once, and not tried again.
        retrying = null;
        reportRetryFailure(preset);
      } else if (reason === 'load') {
        armLoadRetry(preset);
      }
      if (!retryObserver) return;
      const layout = document.querySelector('.org-layout');
      if (layout) {
        retryObserver.observe(layout, {
          attributes: true,
          attributeFilter: ['style', 'data-editing-theme', 'data-org-brand'],
        });
      }
      retryObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
    }

    // ── Preset switching ───────────────────────────────────────
    async function ensureRenderer(preset: ShaderPresetId): Promise<boolean> {
      if (preset === currentPreset && renderer) return true;

      // Clean up old renderer
      if (renderer) {
        renderer.destroy(glContext);
        renderer = null;
      }

      const token = ++loadToken;
      // Another preset: whatever was retrying is no longer what loads.
      if (retrying !== preset) retrying = null;
      currentPreset = preset;
      failedPreset = null;
      retryObserver?.disconnect();
      disarmLoadRetry?.();
      clearTone();
      // Another shader, or none: the copy is of one that is gone.
      clearStill();

      if (preset === 'none') {
        // Hide canvas so CSS gradient fallback shows through, unless the
        // Showreel's film plays on a plain ground (`frame()`).
        if (secondPreset || secondRenderer) void setSecond(null);
        if (!hasMedia()) hidden('none');
        // Keep the poll loop alive so a brand-editor activation (user sets a
        // shader preset via CSS var) is detected — frame() polls every ~30
        // frames and calls ensureRenderer on preset mismatch. Without this,
        // orgs that ship without a shader can never light one up at runtime.
        scheduleFrame();
        return false;
      }

      let newRenderer: ShaderRenderer | null;
      try {
        newRenderer = await loadRenderer(preset);
      } catch (thrown) {
        // A chunk that will not load (offline, a deploy replaced it).
        if (token === loadToken) rendererFailed(preset, 'load', thrown);
        return false;
      }
      // Overtaken by a newer preset while it loaded: that load owns the canvas.
      if (token !== loadToken) return false;
      if (!newRenderer || !canvasEl) {
        rendererFailed(preset, 'load');
        return false;
      }

      resize(true); // Ensure canvas is sized before init (a mid-switch resize waited for this)
      // A throw from init() is an init failure too, not an escape from here.
      let ok = false;
      let initThrown: unknown;
      const building = newRenderer;
      // The scene's size: the canvas's own unless a compositor is attached.
      const box = { width: sceneW, height: sceneH };
      try {
        // Its programs' compile/link events name who built them.
        ok = withProgramLabel(`shader_hero:${preset}`, () =>
          building.init(glContext, box.width, box.height)
        );
      } catch (thrown) {
        initThrown = thrown;
      }
      if (!ok) {
        // A half-built renderer frees what it did build.
        destroyRenderer(newRenderer, glContext, 'shader_hero');
        // e.g. no EXT_color_buffer_float for a two-pass preset.
        rendererFailed(preset, 'init', initThrown);
        return false;
      }

      renderer = newRenderer;
      retrying = null;
      hasRenderedStaticFrame = false;
      // Shown once it draws (`shown()`), not now. In a switch the canvas
      // still holds the last preset's frame (`resize()` keeps its size while
      // the new preset loads), so it stays shown and live.
      // Re-prime the loop: frame() returns early on preset mismatch without
      // re-scheduling, so after an async preset switch the loop is released.
      scheduleFrame();
      return true;
    }

    // ── Stack (Codex-1yd58.4, plan §5.8) ───────────────────────
    // A stack that is more than the base, or a Showreel film (with or
    // without a base: `needsCompositor`), attaches a compositor (its own
    // chunk, loaded on first use) and the canvas rises to the display DPR;
    // without either it detaches, and the hero draws exactly as it always has.
    // The second preset is a slot of its own beside the base: a failure, or
    // the phone budget, drops it for the session and the base keeps drawing.

    /** The second preset's size: half the scene's on a phone. */
    function secondSize(): [number, number] {
      if (cssWidth >= PHONE_MAX_WIDTH) return [sceneW, sceneH];
      return [Math.max(1, Math.round(sceneW / 2)), Math.max(1, Math.round(sceneH / 2))];
    }

    /** The Showreel has handed this hero a film (only the window's, `tone`). */
    function hasMedia(): boolean {
      return tone && showreelFeed.media !== null;
    }

    /**
     * The stack this frame draws. With no base drawing (no preset, or one that
     * failed, which `cachedStack` was parsed against), the Showreel's plain
     * ground carries no second and no layers: a brand shader blended into it
     * would paint under the words with the hero saying none paints. Cached by
     * identity: the compositor plans once per stack.
     */
    let groundStack: StackConfig = BARE_STACK;
    let groundFrom: StackConfig | null = null;
    function stackNow(): StackConfig {
      if (renderer || currentPreset !== 'none') return cachedStack;
      if (groundFrom !== cachedStack) {
        groundFrom = cachedStack;
        groundStack = { ...cachedStack, second: null, layers: [] };
      }
      return groundStack;
    }

    /** Bring the second slot and the compositor in line with the stack. */
    function syncStack() {
      const base = stackNow();
      const want = base.second;
      // With no compositor to blend it (broken for the session), a second
      // would load and never draw.
      const second =
        want !== null && !compositorBroken && !secondDropped && !secondsFailed.has(want)
          ? want
          : null;
      if (second !== secondPreset) void setSecond(second);
      const stack = second === want ? base : { ...base, second };
      if (!needsCompositor(stack, currentPreset, hasMedia())) {
        if (compositor || compositorLoading) detachCompositor();
      } else if (!compositor && !compositorLoading && !compositorBroken) {
        void attachCompositor();
      }
    }

    /** The base failed: nothing to stack on. Its loop stops, unless a film
     *  plays on a plain ground, which keeps the compositor. */
    function dropStack() {
      if (secondPreset || secondRenderer) void setSecond(null);
      if (!hasMedia()) detachCompositor();
    }

    async function attachCompositor() {
      const token = ++compositorToken;
      compositorLoading = true;
      let made: Compositor | null = null;
      try {
        const { createCompositor } = await import('./compositor/compositor');
        if (token === compositorToken) made = createCompositor(glContext);
      } catch (thrown) {
        // Its chunk would not load (offline, a replaced deploy).
        if (token === compositorToken) {
          compositorBroken = true;
          reportCompositorFailure('load', thrown);
        }
      }
      // Detached, or torn down, while it loaded: the later call owns it.
      if (token !== compositorToken) return;
      compositorLoading = false;
      if (!made) return;
      compositor = made;
      if (tone) {
        made.setMedia(showreelFeed.media);
        made.setStage(showreelFeed.stage);
        made.setNameMask(showreelFeed.mask);
      }
      // The canvas rises to the display DPR; the presets keep the scene's.
      resize(true);
      // A frozen hero drew its frame bare: it draws it again, stacked.
      redrawFrozen();
    }

    function detachCompositor() {
      compositorToken++;
      compositorLoading = false;
      if (!compositor) return;
      compositor.destroy();
      compositor = null;
      // Back to today's canvas, the scene's own size.
      resize(true);
      redrawFrozen();
    }

    async function setSecond(preset: LivePresetId | null) {
      const token = ++secondToken;
      if (secondRenderer) destroyRenderer(secondRenderer, glContext, 'shader_hero');
      secondRenderer = null;
      secondPreset = preset;
      secondConfig = null;
      if (!preset) return;
      let loaded: ShaderRenderer | null = null;
      let thrown: unknown;
      try {
        loaded = await loadRenderer(preset);
      } catch (error) {
        thrown = error;
      }
      // Overtaken by another second, or none, while it loaded.
      if (token !== secondToken) return;
      if (!loaded) {
        secondFailed(preset, 'load', thrown);
        return;
      }
      const building = loaded;
      const [w, h] = secondSize();
      let ok = false;
      try {
        ok = withProgramLabel(`shader_hero:second:${preset}`, () =>
          building.init(glContext, w, h)
        );
      } catch (error) {
        thrown = error;
      }
      if (!ok) {
        destroyRenderer(building, glContext, 'shader_hero');
        secondFailed(preset, 'init', thrown);
        return;
      }
      secondRenderer = building;
      secondConfig = getShaderConfig(undefined, preset);
      // Judge the budget on frames that draw both presets.
      budget.reset();
      redrawFrozen();
    }

    /** The base never stopped: the next frame's `syncStack` goes on without it. */
    function secondFailed(preset: LivePresetId, reason: RendererFailure, thrown: unknown) {
      secondPreset = null;
      // A lost context fails every init: the restore loads it again.
      if (glContext.isContextLost()) return;
      secondsFailed.add(preset);
      reportSecondFailure(preset, reason, glContext, thrown);
    }

    /** The second preset threw in its render: dropped, and logged. */
    function secondThrew(thrown: unknown) {
      const preset = secondPreset;
      if (!secondRenderer || !preset) return;
      destroyRenderer(secondRenderer, glContext, 'shader_hero');
      secondRenderer = null;
      secondFailed(preset, 'render', thrown);
    }

    /** What a drawn frame tells the layout: a brand shader, or a plain ground
     *  under none (or under one that would not start). */
    function paints(): 'live' | 'none' | 'failed' {
      if (renderer) return 'live';
      return failedPreset ? 'failed' : 'none';
    }

    /** Draw the frame: through the compositor when one is attached (with no
     *  base preset, the film on a plain ground). False: nothing was drawn. */
    function draw(time: number, config: ShaderConfig): boolean {
      if (!canvasEl) return false;
      if (compositor) {
        let composited = false;
        let thrown: unknown;
        try {
          composited = compositor.render({
            base: renderer,
            baseConfig: config,
            second: secondRenderer,
            secondConfig,
            stack: stackNow(),
            time,
            mouse,
            scene: [sceneW, sceneH],
            secondSize: secondSize(),
            output: [canvasEl.width, canvasEl.height],
            phone: cssWidth < PHONE_MAX_WIDTH,
            reducedMotion: isReducedMotion,
            canvasBox,
            scrollY: window.scrollY,
            onSecondFailed: secondThrew,
          });
        } catch (error) {
          // A preset threw inside it: the loop must not die with it.
          thrown = error;
        }
        if (composited) return true;
        // Lost mid-frame: the loss handler's, and the restore rebuilds it.
        if (glContext.isContextLost()) return false;
        if (thrown !== undefined) reportCompositorFailure('render', thrown);
        // It could not draw (logged): the base alone from now on.
        compositorBroken = true;
        detachCompositor();
      }
      if (!renderer) return false;
      renderer.render(glContext, time, mouse, config, canvasEl.width, canvasEl.height);
      return true;
    }

    // ── Render loop ────────────────────────────────────────────
    // RAF hygiene (docs/04-motion.md §6): the loop re-primes ONLY at the end
    // of the render branch. Short-circuit returns (no renderer, hidden tab,
    // reduced-motion after static frame) release the loop; `scheduleFrame()`
    // resumes it from state-change handlers (visibility/motion/ensureRenderer).

    /**
     * A frozen shader draws seldom (a resize, a sample, the studio), so the
     * frame it is about to draw reads the brand afresh: the poll's last read
     * may be minutes and a brand edit old. With nothing to draw with it draws
     * nothing, and its loop keeps to the poll that spots a new preset.
     */
    function aboutToDrawFrozen(): boolean {
      return isFrozen && !hasRenderedStaticFrame && (renderer !== null || compositor !== null);
    }

    /**
     * Whether the brand's preset is the one to draw on. False: the loop stops
     * this frame.
     *
     * A preset that failed stays stopped until it changes (`retryObserver`):
     * whatever woke this frame (a resize, the tab coming back) is no reason to
     * fail it again. With a film, it draws the plain ground instead (owner,
     * 2026-11-19); without one, a plain ground it drew (for a film since
     * ended) goes too.
     *
     * Otherwise a new preset is switched to (async — may take a frame).
     * ensureRenderer calls scheduleFrame() on success and on 'none', so the
     * poll loop keeps running and later brand-editor activations are
     * detected; a failure stops the loop instead (`rendererFailed`).
     */
    function onBrandPreset(config: ShaderConfig): boolean {
      if (config.preset === failedPreset) {
        if (hasMedia()) return true;
        if (compositor || compositorLoading) detachCompositor();
        if (drawn) hidden('failed');
        return false;
      }
      if (config.preset === currentPreset) return true;
      ensureRenderer(config.preset);
      return false;
    }

    /**
     * Bring the stack in line, and say whether there is anything to draw: a
     * base preset, or, with no preset at all, the Showreel's film on a plain
     * ground of the brand's background, through a compositor (owner,
     * 2026-11-19). A renderer still loading is not a plain ground: its old
     * frame stays up. A plain ground that can no longer draw (its film ended,
     * or the compositor broke) hides, as no preset does.
     */
    function readyToDraw(): boolean {
      if (renderer) {
        syncStack();
        return true;
      }
      if (currentPreset !== 'none') return false;
      syncStack();
      if (compositor) return true;
      if (drawn && !compositorLoading) hidden(failedPreset ? 'failed' : 'none');
      return false;
    }

    /** Reduced motion or `still`: one static frame, then the loop is
     *  released (setFrozen re-primes when both are off again). */
    function drawFrozen(config: ShaderConfig) {
      if (hasRenderedStaticFrame) return;
      hasRenderedStaticFrame = true;
      frozenElapsed ??= (performance.now() - startTime) / 1000;
      if (!draw(frozenElapsed, config)) return;
      shown(paints());
      sampleTone();
      copyStill();
    }

    /** The phone budget: two presets that cannot hold the frame rate lose
     *  the second (the next frame's `syncStack` drops it). */
    function judgeBudget(intervalMs: number) {
      if (!secondPreset || !secondRenderer || !compositor) return;
      if (cssWidth >= PHONE_MAX_WIDTH) return;
      const breach = budget.push(intervalMs);
      if (!breach) return;
      secondDropped = true;
      reportStackBudget(secondPreset, breach);
    }

    function frame() {
      animFrameId = 0; // this callback has fired — clear handle before deciding to re-prime

      // A lost context draws nothing, so the loop stops here: every wake (a
      // resize, the tab coming back, a frozen redraw) returns at once, until
      // `onContextRestored` starts it again.
      if (glContext.isContextLost()) return;

      const config = pollConfig(aboutToDrawFrozen());
      if (!onBrandPreset(config)) return;

      // Tab hidden — release loop; onVisibilityChange re-primes on return.
      if (!isVisible) return;

      // Nothing to draw (no preset, or one still loading): keep polling so a
      // future brand-editor preset change is detected. Hidden tab
      // early-return above still cuts this path on inactive tabs.
      if (!readyToDraw()) {
        animFrameId = requestAnimationFrame(frame);
        return;
      }

      if (isFrozen) {
        drawFrozen(config);
        return; // no re-prime — static frame is final
      }

      // Frame-rate-independent burst decay (docs/04-motion.md §4).
      // dt is clamped to 0.1s to avoid a tiny residual cliff if the RAF
      // loop happens to fire before `scheduleFrame` resets lastFrameTime.
      const now = performance.now();
      const intervalMs = now - lastFrameTime;
      const dt = Math.min(intervalMs / 1000, 0.1);
      lastFrameTime = now;

      if (mouse.burstStrength > 0) {
        mouse.burstStrength *= Math.pow(BURST_DECAY_PER_SECOND, dt);
        if (mouse.burstStrength < 0.01) mouse.burstStrength = 0;
      }

      const elapsed = (now - startTime) / 1000;
      if (draw(elapsed, config)) {
        shown(paints());
        sampleTone();
      }

      judgeBudget(intervalMs);

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

    // ── Context loss and restore (Codex-1yd58.4) ────────────────
    // A lost context (a GPU reset, or the browser reclaiming its oldest)
    // shows nothing, so the page editor's bands go back to the glow and the
    // shader is no longer live. The loss is logged, and its default is
    // prevented: without that the browser never restores the context.
    function onContextLost(event: Event) {
      event.preventDefault();
      cancelAnimationFrame(animFrameId);
      animFrameId = 0;
      // A load in flight would start on a dead context: the restore starts
      // afresh instead.
      loadToken++;
      secondToken++;
      clearStill();
      hidden('failed');
      reportContextLost(currentPreset);
    }
    // Restored, the context is new and empty: every object made on the lost
    // one is dead. They are forgotten, never deleted (a dead handle is not
    // the new context's to delete): the renderers, the compositor's targets
    // and passes, the output target, the JFA program cache. Then it starts
    // the brand's preset as on mount, and goes live once it draws.
    function onContextRestored() {
      renderer = null;
      currentPreset = 'none';
      secondRenderer = null;
      secondPreset = null;
      secondConfig = null;
      compositor?.forget();
      setOutputTarget(glContext, null);
      resetJFACache();
      // Whatever failed on the lost context may work on the new one.
      compositorBroken = false;
      secondsFailed.clear();
      failedPreset = null;
      retryObserver?.disconnect();
      hasRenderedStaticFrame = false;
      const { preset } = pollConfig(true);
      reportContextRestored(preset);
      // Re-primes the loop once it is built (`scheduleFrame`).
      void ensureRenderer(preset);
    }
    canvasEl?.addEventListener('webglcontextlost', onContextLost);
    canvasEl?.addEventListener('webglcontextrestored', onContextRestored);

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
        showreelFeed.onChange(null);
        shaderStill.onDemand(null);
        shaderStill.clear();
      }
      cancelAnimationFrame(animFrameId);
      if (renderer) renderer.destroy(glContext);
      // A load still in flight finds itself overtaken and installs nothing.
      secondToken++;
      compositorToken++;
      if (secondRenderer) destroyRenderer(secondRenderer, glContext, 'shader_hero');
      compositor?.destroy();
      // JFA program cache is module-scoped and stays warm across preset
      // switches (pulse recompilation would otherwise cost ~3ms per activation).
      // On actual subsystem unmount it would orphan without this — the GL
      // context lives on the canvas element, module lives across SPA nav.
      destroyJFACache(glContext);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      motionQuery.removeEventListener('change', onMotionChange);
      resizeObserver.disconnect();
      retryObserver?.disconnect();
      disarmLoadRetry?.();
      // A load still in flight finds itself overtaken and installs nothing.
      loadToken++;
      watchBrand(false);
      canvasEl?.removeEventListener('webglcontextlost', onContextLost);
      canvasEl?.removeEventListener('webglcontextrestored', onContextRestored);
      detachPointerListeners();
      liveWriter?.release();
    };
  });
</script>

<div
  bind:this={containerEl}
  class="shader-hero {className ?? ''}"
  aria-hidden="true"
  data-live={live ? '' : undefined}
  data-drawn={drawn ? '' : undefined}
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

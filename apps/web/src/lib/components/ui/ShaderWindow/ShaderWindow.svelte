<!--
  @component ShaderWindow

  A window onto the org's moving background: a canvas showing, UNBLURRED, the
  patch of the org layout's fullpage shader that sits behind it. It copies
  that patch from each frame ShaderHero hands over (`shader-frame.svelte.ts`),
  straight after the frame is drawn: the shader's drawing buffer is not
  preserved, so it can be read then and only then.

  - The parent sizes it: the canvas fills its nearest positioned ancestor.
  - It copies only while on or near the screen, and at most `fps` times a
    second. The shader is soft, so the canvas is drawn at 1x its CSS box.
  - `fallback` (the brand's gradient, say) shows while no brand shader is live
    (no preset, a renderer that failed, no WebGL) and until the first copy
    lands.
  - A still shader (reduced motion) draws one frame and stops, so the window
    asks for it again as it comes near and once a scroll settles: its patch is
    the one behind it at rest.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import {
    isShaderLive,
    onShaderFrame,
    requestShaderFrame,
  } from '../ShaderHero/shader-frame.svelte';
  import { computeShaderPatch } from './shader-window-math';

  interface Props {
    /** At most this many copies a second. */
    fps?: number;
    /** Shown while there is no live shader to copy, or no copy yet. */
    fallback?: Snippet;
    class?: string;
  }

  const { fps = 30, fallback, class: className }: Props = $props();

  /** How far off screen it starts copying, so it shows its patch as it scrolls in. */
  const NEAR_MARGIN = '200px 0px';
  /** How long a scroll must rest before a still shader is asked for its frame again. */
  const SCROLL_SETTLE_MS = 150;

  let canvasEl: HTMLCanvasElement | undefined = $state();
  /** On or near the screen. */
  let near = $state(false);
  /** The canvas holds a copy. */
  let painted = $state(false);
  const showing = $derived(isShaderLive() && painted);

  $effect(() => {
    const canvas = canvasEl;
    if (!canvas) return;
    const observer = new IntersectionObserver(
      (entries) => {
        near = entries.at(-1)?.isIntersecting ?? near;
      },
      { rootMargin: NEAR_MARGIN }
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  });

  $effect(() => {
    const canvas = canvasEl;
    if (!canvas || !near) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let lastCopy = Number.NEGATIVE_INFINITY;

    const copy = (source: HTMLCanvasElement) => {
      const now = performance.now();
      // 90% of the interval: rAF's jitter would otherwise miss every other
      // tick at 60Hz, and copy at 20fps.
      if (now - lastCopy < (1000 / fps) * 0.9) return;
      lastCopy = now;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const patch = computeShaderPatch({
        windowRect: canvas.getBoundingClientRect(),
        sourceRect: source.getBoundingClientRect(),
        sourceWidth: source.width,
        sourceHeight: source.height,
        targetWidth: width,
        targetHeight: height,
      });
      if (!patch) return;
      // Resized only when its box changed: resizing clears it. What a clipped
      // patch leaves uncovered lies beyond the shader's canvas, off screen.
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const { sx, sy, sw, sh, dx, dy, dw, dh } = patch;
      ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
      painted = true;
    };

    const unsubscribe = onShaderFrame(copy);
    // A still shader drew its one frame before this window came near.
    requestShaderFrame();
    let settle = 0;
    const onScroll = () => {
      window.clearTimeout(settle);
      settle = window.setTimeout(requestShaderFrame, SCROLL_SETTLE_MS);
    };
    // Captured, so a scroller inside the page (a pager) counts too.
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      unsubscribe();
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.clearTimeout(settle);
    };
  });
</script>

<canvas
  bind:this={canvasEl}
  class={['shader-window', className]}
  aria-hidden="true"
  data-live={showing ? '' : undefined}
></canvas>
{#if !showing}
  {@render fallback?.()}
{/if}

<style>
  /* The reset caps a canvas at `max-width: 100%`; a replaced element does not
     stretch to `inset: 0`, so its size is set too. */
  .shader-window {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
    opacity: 0;
  }

  .shader-window[data-live] {
    opacity: 1;
  }
</style>

<!--
  @component HeroInlineVideo

  Inline video player for the org hero section (desktop only).
  Expands within the hero with feathered edges that dissolve into
  the shader background. Mobile uses IntroVideoModal instead.

  Uses HLS.js for adaptive streaming via createHlsPlayer().
  The video has CSS mask-image feathered edges — outer 25% fades
  to transparent so the shader bleeds through naturally.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { createHlsPlayer } from '$lib/components/VideoPlayer/hls';
  import type Hls from 'hls.js';

  interface Props {
    src: string;
    active: boolean;
    /** Expand origin as % of the hero container (from play button position) */
    originX?: number;
    originY?: number;
    onclose: () => void;
  }

  const { src, active, originX = 50, originY = 38, onclose }: Props = $props();

  let videoEl: HTMLVideoElement;
  let hlsInstance: Hls | null = null;
  let playing = $state(false);
  let muted = $state(true);
  let error = $state<string | null>(null);
  let closeBtn: HTMLButtonElement;

  const prefersReducedMotion = browser
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  // ── HLS init/teardown tied to active state ──
  $effect(() => {
    if (!active || !browser || !videoEl) return;

    let destroyed = false;

    async function init() {
      error = null;
      try {
        hlsInstance = await createHlsPlayer({
          video: videoEl,
          src,
          onError: (msg) => { error = msg; },
        });

        if (destroyed) {
          hlsInstance?.destroy();
          return;
        }

        // Autoplay muted (skip if reduced motion)
        if (!prefersReducedMotion) {
          videoEl.muted = true;
          muted = true;
          try { await videoEl.play(); playing = true; } catch { /* autoplay blocked */ }
        }
      } catch {
        error = 'Failed to load video';
      }
    }

    init();

    return () => {
      destroyed = true;
      hlsInstance?.destroy();
      hlsInstance = null;
      playing = false;
      muted = true;
    };
  });

  // ── Focus close button when video activates ──
  $effect(() => {
    if (active && closeBtn) {
      requestAnimationFrame(() => closeBtn?.focus());
    }
  });

  // ── Keyboard handling ──
  function handleKeydown(e: KeyboardEvent) {
    if (!active) return;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        onclose();
        break;
      case ' ':
        e.preventDefault();
        togglePlay();
        break;
      case 'm':
      case 'M':
        e.preventDefault();
        toggleMute();
        break;
    }
  }

  function togglePlay() {
    if (!videoEl) return;
    if (videoEl.paused) {
      videoEl.muted = false;
      muted = false;
      videoEl.play();
      playing = true;
    } else {
      videoEl.pause();
      playing = false;
    }
  }

  function toggleMute() {
    if (!videoEl) return;
    videoEl.muted = !videoEl.muted;
    muted = videoEl.muted;
  }

  function handleEnded() {
    // Brief delay before closing so the ending doesn't feel abrupt
    setTimeout(() => onclose(), 300);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if active}
  <div
    class="hero-inline-video"
    class:hero-inline-video--no-motion={prefersReducedMotion}
    role="region"
    aria-label="Intro video player"
    style:transform-origin="{originX}% {originY}%"
  >
    <div class="hero-inline-video__player">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={videoEl}
        class="hero-inline-video__video"
        playsinline
        preload="auto"
        onclick={togglePlay}
        onended={handleEnded}
      ></video>

      <!-- Center play overlay (shows when paused) -->
      {#if !playing}
        <button class="hero-inline-video__play-overlay" onclick={togglePlay} aria-label="Play video">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <circle cx="32" cy="32" r="31" stroke="white" stroke-width="2" opacity="0.4" />
            <path d="M26 20L46 32L26 44V20Z" fill="white" opacity="0.9" />
          </svg>
        </button>
      {/if}

      <!-- Close button -->
      <button
        bind:this={closeBtn}
        class="hero-inline-video__close"
        onclick={onclose}
        aria-label="Close video"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <!-- Mute toggle -->
      <button class="hero-inline-video__mute" onclick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
        {#if muted}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M11 5L6 9H2v6h4l5 4V5z" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        {:else}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M11 5L6 9H2v6h4l5 4V5z" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        {/if}
      </button>
    </div>

    {#if error}
      <p class="hero-inline-video__error">{error}</p>
    {/if}
  </div>
{/if}

<style>
  .hero-inline-video {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;

    /* Scale from the play button's position (transform-origin set via inline style).
       Starts tiny and expands to fill the hero. */
    animation: inline-video-expand 800ms var(--ease-out) both;
    animation-delay: 700ms;
  }

  .hero-inline-video--no-motion {
    animation: none;
  }

  @keyframes inline-video-expand {
    from {
      opacity: 0;
      transform: scale(0);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .hero-inline-video__player {
    position: relative;
    width: min(92vw, 1200px);
    aspect-ratio: 16 / 9;
    pointer-events: auto;

    /* Feathered edges — wide gradient dissolve into the shader.
       Uses intersecting linear masks so each edge feathers independently.
       The 8%/92% stops give a thick ~100px feather zone on all sides. */
    mask-image:
      linear-gradient(to right,  transparent, black 8%, black 92%, transparent),
      linear-gradient(to bottom, transparent, black 8%, black 92%, transparent);
    mask-composite: intersect;
    -webkit-mask-image:
      linear-gradient(to right,  transparent, black 8%, black 92%, transparent),
      linear-gradient(to bottom, transparent, black 8%, black 92%, transparent);
    -webkit-mask-composite: source-in;
  }

  .hero-inline-video__video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    cursor: pointer;
    background: black;
  }

  /* ── Play/pause overlay ── */
  .hero-inline-video__play-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, black 20%, transparent);
    border: none;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-default);
  }

  .hero-inline-video__play-overlay:hover {
    background: color-mix(in srgb, black 30%, transparent);
  }

  /* ── Close button ── */
  .hero-inline-video__close {
    position: absolute;
    top: var(--space-4);
    right: var(--space-4);
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-10);
    height: var(--space-10);
    border-radius: var(--radius-base);
    background: color-mix(in srgb, black 40%, transparent);
    color: white;
    border: none;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-default);
  }

  .hero-inline-video__close:hover {
    background: color-mix(in srgb, black 60%, transparent);
  }

  .hero-inline-video__close:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-1);
  }

  /* ── Mute button ── */
  .hero-inline-video__mute {
    position: absolute;
    bottom: var(--space-4);
    right: var(--space-4);
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-9);
    height: var(--space-9);
    border-radius: var(--radius-base);
    background: color-mix(in srgb, black 50%, transparent);
    color: white;
    border: none;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-default);
  }

  .hero-inline-video__mute:hover {
    background: color-mix(in srgb, black 70%, transparent);
  }

  /* ── Error message ── */
  .hero-inline-video__error {
    position: absolute;
    bottom: var(--space-8);
    left: 50%;
    transform: translateX(-50%);
    padding: var(--space-2) var(--space-4);
    background: var(--color-error-50);
    color: var(--color-error-700);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    white-space: nowrap;
    pointer-events: auto;
  }
</style>

<!--
  @component IntroVideoModal

  Fullscreen video overlay for the org hero intro video.
  Uses HLS.js for adaptive streaming via createHlsPlayer().

  The overlay uses backdrop-filter: blur so the shader background
  bleeds through. The video has CSS mask-image feathered edges that
  dissolve into the blurred backdrop — no hard rectangle.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { createHlsPlayer } from '$lib/components/VideoPlayer/hls';
  import type Hls from 'hls.js';

  interface Props {
    open: boolean;
    src: string;
    onclose: () => void;
  }

  const { open, src, onclose }: Props = $props();

  let videoEl = $state<HTMLVideoElement | undefined>(undefined);
  let hlsInstance: Hls | null = null;
  let playing = $state(false);
  let muted = $state(true);
  let error = $state<string | null>(null);
  // svelte-ignore non_reactive_update
  let dialogEl: HTMLDivElement;

  const prefersReducedMotion = browser
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  // ── HLS init/teardown tied to open state ──
  $effect(() => {
    if (!open || !browser || !videoEl) return;

    let destroyed = false;

    async function init() {
      error = null;
      try {
        hlsInstance = await createHlsPlayer({
          media: videoEl,
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

  // ── Keyboard handling ──
  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }

  // ── Click outside ──
  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose();
  }

  // ── Toggle play/pause ──
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

  // ── Toggle mute ──
  function toggleMute() {
    if (!videoEl) return;
    videoEl.muted = !videoEl.muted;
    muted = videoEl.muted;
  }

  // Focus trap: focus close button when modal opens
  let closeBtn = $state<HTMLButtonElement | undefined>(undefined);
  $effect(() => {
    if (open && closeBtn) {
      // Delay to allow transition
      requestAnimationFrame(() => closeBtn?.focus());
    }
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="intro-modal"
    class:intro-modal--no-motion={prefersReducedMotion}
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label="Intro video"
    bind:this={dialogEl}
    onclick={handleOverlayClick}
  >
    <!-- Close button -->
    <button
      bind:this={closeBtn}
      class="intro-modal__close"
      onclick={onclose}
      aria-label="Close video"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>

    <!-- Video container with feathered edges -->
    <div class="intro-modal__player">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={videoEl}
        class="intro-modal__video"
        playsinline
        preload="auto"
        onclick={togglePlay}
      ></video>

      <!-- Center play overlay (shows when paused) -->
      {#if !playing}
        <button class="intro-modal__play-overlay" onclick={togglePlay} aria-label="Play video">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <circle cx="32" cy="32" r="31" stroke="white" stroke-width="2" opacity="0.4" />
            <path d="M26 20L46 32L26 44V20Z" fill="white" opacity="0.9" />
          </svg>
        </button>
      {/if}

      <!-- Mute toggle -->
      <button class="intro-modal__mute" onclick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
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
      <p class="intro-modal__error">{error}</p>
    {/if}
  </div>
{/if}

<style>
  .intro-modal {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal-backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(var(--blur-2xl));
    -webkit-backdrop-filter: blur(var(--blur-2xl));
    background: var(--color-player-surface-active);
    animation: modal-fade-in var(--duration-slow) var(--ease-out) both;
  }

  .intro-modal--no-motion {
    animation: none;
  }

  @keyframes modal-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .intro-modal__close {
    position: absolute;
    top: var(--space-4);
    right: var(--space-4);
    z-index: var(--z-modal);
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-10);
    height: var(--space-10);
    border-radius: var(--radius-full);
    background: var(--color-player-overlay);
    color: var(--color-player-text);
    border: none;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-default);
  }

  .intro-modal__close:hover {
    background: var(--color-player-overlay);
  }

  .intro-modal__close:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-1);
  }

  .intro-modal__player {
    position: relative;
    width: 90vw;
    max-width: 960px;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-xl);
    overflow: hidden;
    animation: modal-scale-in var(--duration-slow) var(--ease-out) both;
    animation-delay: calc(var(--duration-fast) * 0.5);
    /* Feathered edges — video dissolves into the blurred backdrop */
    mask-image: radial-gradient(ellipse 92% 92% at center, black 60%, transparent 100%);
    -webkit-mask-image: radial-gradient(ellipse 92% 92% at center, black 60%, transparent 100%);
  }

  .intro-modal--no-motion .intro-modal__player {
    animation: none;
  }

  @keyframes modal-scale-in {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }

  .intro-modal__video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    cursor: pointer;
    background: var(--color-neutral-950, black);
  }

  .intro-modal__play-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-player-surface-hover);
    border: none;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-default);
  }

  .intro-modal__play-overlay:hover {
    background: var(--color-player-surface-active);
  }

  .intro-modal__mute {
    position: absolute;
    bottom: var(--space-4);
    right: var(--space-4);
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-9);
    height: var(--space-9);
    border-radius: var(--radius-full);
    background: var(--color-player-overlay);
    color: var(--color-player-text);
    border: none;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-default);
  }

  .intro-modal__mute:hover {
    background: var(--color-player-overlay-heavy);
  }

  .intro-modal__error {
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
  }

  @media (--below-md) {
    .intro-modal__player {
      width: 95vw;
      border-radius: var(--radius-lg);
    }

    .intro-modal__close {
      top: var(--space-3);
      right: var(--space-3);
    }
  }
</style>

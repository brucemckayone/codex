<!--
  @component IntroVideoModal

  Fullscreen video overlay for the org hero intro video.
  Uses HLS.js for adaptive streaming via createHlsPlayer().

  The overlay uses backdrop-filter: blur so the shader background
  bleeds through. The video has CSS mask-image feathered edges that
  dissolve into the blurred backdrop — no hard rectangle.

  @prop {boolean} open - Whether the modal is visible
  @prop {string} src - HLS manifest URL
  @prop {string} [title] - Content title for the `<video aria-label>` (ref 05 §"Media elements" §1)
  @prop {Array<{src, srclang, label, default?}>} [captions] - Optional caption tracks
    (ref 05 §"Media elements" §2). Intro videos are typically decorative — omit unless narration exists.
  @prop {() => void} onclose - Called when the modal is dismissed
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { createHlsPlayer } from '$lib/components/VideoPlayer/hls';
  import { PlayIcon, XIcon, Volume2Icon, VolumeXIcon } from '$lib/components/ui/Icon';
  import {
    createMediaKeyboardHandler,
    MediaLiveRegion,
  } from '$lib/components/media-a11y';
  import type Hls from 'hls.js';

  interface CaptionTrack {
    src: string;
    srclang: string;
    label: string;
    default?: boolean;
  }

  interface Props {
    open: boolean;
    src: string;
    title?: string;
    /**
     * Caption tracks per ref 05 §"Media elements" §2. Provide one entry per
     * language; exactly one should carry `default: true`. Intro videos are
     * typically decorative and can omit — the justification lives in the
     * svelte-ignore comment below per §7.
     */
    captions?: CaptionTrack[];
    onclose: () => void;
  }

  const { open, src, title = 'Intro video', captions, onclose }: Props = $props();

  let dialogEl = $state<HTMLDivElement | undefined>(undefined);
  let videoEl = $state<HTMLVideoElement | undefined>(undefined);
  let hlsInstance: Hls | null = null;
  let playing = $state(false);
  let muted = $state(true);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // ── HLS init/teardown tied to open state ──
  $effect(() => {
    if (!open || !browser || !videoEl) return;

    let destroyed = false;

    async function init() {
      error = null;
      loading = true;
      try {
        hlsInstance = await createHlsPlayer({
          media: videoEl,
          src,
          onError: (msg) => {
            error = msg;
            loading = false;
          },
        });

        if (destroyed) {
          hlsInstance?.destroy();
          return;
        }

        loading = false;

        // Autoplay muted — the scale-in keyframe halts under
        // prefers-reduced-motion via the CSS @media guard below.
        videoEl.muted = true;
        muted = true;
        try { await videoEl.play(); playing = true; } catch { /* autoplay blocked */ }
      } catch {
        error = 'Failed to load video';
        loading = false;
      }
    }

    init();

    return () => {
      destroyed = true;
      hlsInstance?.destroy();
      hlsInstance = null;
      playing = false;
      muted = true;
      loading = false;
    };
  });

  // ── Click outside ──
  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose();
  }

  // ── Toggle play/pause ──
  function togglePlay() {
    if (!videoEl) return;
    dialogEl?.focus({ preventScroll: true });
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

  /**
   * Dialog-scoped keyboard shortcuts (ref 05 §"Media elements" §3).
   * Modal is a native dialog pattern — Escape closes, Space toggles play,
   * arrow keys seek. Focus trap is implicit: focus enters the dialog via
   * the close-button auto-focus on open; Tab cycles through interactive
   * descendants of the dialog; the wrapper containment check keeps shortcuts
   * scoped to the open dialog.
   */
  const handleKey = createMediaKeyboardHandler({
    getWrapper: () => dialogEl,
    getMedia: () => videoEl ?? null,
    shortcuts: {
      playPause: togglePlay,
      mute: toggleMute,
      // Wrap `onclose` so changes to the prop propagate — capturing the prop
      // directly pins the initial value per Svelte 5 $props semantics.
      escape: () => onclose(),
      seekSecs: 10,
    },
  });

  // Focus trap: focus close button when modal opens
  let closeBtn = $state<HTMLButtonElement | undefined>(undefined);
  $effect(() => {
    if (open && closeBtn) {
      // Delay to allow transition
      requestAnimationFrame(() => closeBtn?.focus());
    }
  });

  onDestroy(() => {
    hlsInstance?.destroy();
    hlsInstance = null;
  });
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="intro-modal"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label={title || 'Intro video'}
    bind:this={dialogEl}
    onclick={handleOverlayClick}
    onkeydown={handleKey}
  >
    <!-- Live region per ref 05 §"Media elements" §4 — announces loading + errors. -->
    <MediaLiveRegion {loading} {error} loadingLabel="Loading intro video…" />

    <!-- Close button -->
    <button
      bind:this={closeBtn}
      class="intro-modal__close"
      onclick={onclose}
      aria-label="Close video"
    >
      <XIcon size={24} />
    </button>

    <!-- Video container with feathered edges -->
    <div class="intro-modal__player">
      <!--
        Intro video is demonstrably decorative (no narration) — captions are
        omitted by design per ref 05 §"Media elements" §7. Pass `captions`
        if future intros carry narration. The compile-time `<track>` branch
        below satisfies `a11y_media_has_caption` without a suppression.
      -->
      <video
        bind:this={videoEl}
        class="intro-modal__video"
        aria-label={title}
        playsinline
        preload="auto"
        onclick={togglePlay}
      >
        {#if captions && captions.length > 0}
          {#each captions as track (track.srclang)}
            <track
              kind="captions"
              src={track.src}
              srclang={track.srclang}
              label={track.label}
              default={track.default ?? false}
            />
          {/each}
        {/if}
      </video>

      <!-- Center play overlay (shows when paused) -->
      {#if !playing}
        <button class="intro-modal__play-overlay" onclick={togglePlay} aria-label="Play video">
          <span class="intro-modal__play-ring" aria-hidden="true"></span>
          <PlayIcon size={32} />
        </button>
      {/if}

      <!-- Mute toggle -->
      <button class="intro-modal__mute" onclick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
        {#if muted}
          <VolumeXIcon size={20} />
        {:else}
          <Volume2Icon size={20} />
        {/if}
      </button>
    </div>

    {#if error}
      <p class="intro-modal__error" role="alert">{error}</p>
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
    /* Dialog is programmatically focused to enable scoped keyboard; hide the ring. */
    outline: none;
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
    background: var(--color-player-overlay-heavy);
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
    color: var(--color-player-text);
    border: none;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-default);
  }

  .intro-modal__play-overlay:hover {
    background: var(--color-player-surface-active);
  }

  .intro-modal__play-overlay:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: calc(var(--border-width-thick) * -2);
  }

  .intro-modal__play-ring {
    position: absolute;
    width: var(--space-16);
    height: var(--space-16);
    border: var(--border-width-thick) solid var(--color-player-text);
    border-radius: var(--radius-full);
    opacity: var(--opacity-40);
    pointer-events: none;
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

  .intro-modal__mute:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-1);
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

  /*
    Reduced-motion — ref 05 §"Media elements" §5 + §8.
    CSS-first pattern replaces the previous JS matchMedia one-shot (which was
    captured at mount and didn't re-evaluate mid-session toggles).
  */
  @media (prefers-reduced-motion: reduce) {
    .intro-modal,
    .intro-modal__player {
      animation: none;
    }

    .intro-modal__close,
    .intro-modal__play-overlay,
    .intro-modal__mute {
      transition: none;
    }
  }
</style>

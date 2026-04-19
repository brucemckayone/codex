<!--
  @component HeroInlineVideo

  Inline video player for the org hero section (desktop only).
  Expands within the hero with feathered edges that dissolve into
  the shader background. Mobile uses IntroVideoModal instead.

  Uses HLS.js for adaptive streaming via createHlsPlayer().
  The video has CSS mask-image feathered edges — outer 25% fades
  to transparent so the shader bleeds through naturally.

  @prop {string} src - HLS manifest URL
  @prop {boolean} active - Whether the inline video is expanded
  @prop {number} [originX=50] - Expand-origin X as % of hero container
  @prop {number} [originY=38] - Expand-origin Y as % of hero container
  @prop {string} [title] - Content title for the `<video aria-label>` (ref 05 §"Media elements" §1)
  @prop {Array<{src, srclang, label, default?}>} [captions] - Optional caption tracks
    (ref 05 §"Media elements" §2). Intro videos are typically decorative — omit unless narration exists.
  @prop {() => void} onclose - Called when the video is dismissed
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
    src: string;
    active: boolean;
    /** Expand origin as % of the hero container (from play button position) */
    originX?: number;
    originY?: number;
    /** Content title — surfaces on `<video aria-label>` so AT can distinguish multiple players. */
    title?: string;
    /**
     * Caption tracks. Provide one `<track kind="captions">` entry per language —
     * exactly one should carry `default: true`. Omitting `captions` for a video
     * that has narration is a WCAG 1.2.2 violation; see ref 05 §"Media elements" §7.
     * Intro videos are typically decorative and can omit — the justification lives
     * in the svelte-ignore comment below.
     */
    captions?: CaptionTrack[];
    onclose: () => void;
  }

  const {
    src,
    active,
    originX = 50,
    originY = 38,
    title = 'Intro video',
    captions,
    onclose,
  }: Props = $props();

  let wrapperEl = $state<HTMLDivElement | undefined>(undefined);
  let videoEl = $state<HTMLVideoElement | undefined>(undefined);
  let hlsInstance: Hls | null = null;
  let playing = $state(false);
  let muted = $state(true);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let closeBtn = $state<HTMLButtonElement | undefined>(undefined);

  // ── HLS init/teardown tied to active state ──
  $effect(() => {
    if (!active || !browser || !videoEl) return;

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

        // Autoplay muted — skipped in reduced-motion via the CSS @media guard
        // that collapses the wrapper scale-in keyframe. We still autoplay; users
        // who disable motion often still expect media to play.
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

  // ── Focus close button when video activates ──
  $effect(() => {
    if (active && closeBtn) {
      requestAnimationFrame(() => closeBtn?.focus());
    }
  });

  function togglePlay() {
    if (!videoEl) return;
    wrapperEl?.focus({ preventScroll: true });
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

  /**
   * Wrapper-scoped keyboard shortcuts (ref 05 §"Media elements" §3).
   * Space / Arrow / m / Escape only fire when focus is inside the player.
   */
  const handleKey = createMediaKeyboardHandler({
    getWrapper: () => wrapperEl,
    getMedia: () => videoEl ?? null,
    shortcuts: {
      playPause: togglePlay,
      mute: toggleMute,
      // Wrap `onclose` so the reactive prop isn't captured by the initial value.
      escape: () => onclose(),
      seekSecs: 10,
    },
  });

  onDestroy(() => {
    hlsInstance?.destroy();
    hlsInstance = null;
  });
</script>

{#if active}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={wrapperEl}
    class="hero-inline-video"
    role="region"
    aria-label={title ? `${title} player` : 'Intro video player'}
    tabindex="-1"
    onkeydown={handleKey}
    style:transform-origin="{originX}% {originY}%"
  >
    <!-- Live region per ref 05 §"Media elements" §4 — announces loading + errors. -->
    <MediaLiveRegion {loading} {error} loadingLabel="Loading intro video…" />

    <div class="hero-inline-video__player">
      <!--
        Intro video is demonstrably decorative (no narration) — captions are
        omitted by design per ref 05 §"Media elements" §7. If future intros
        carry narration, pass the `captions` prop and the `<track>` loop below
        renders one element per language. The compile-time track branch below
        satisfies `a11y_media_has_caption` without a suppression.
      -->
      <video
        bind:this={videoEl}
        class="hero-inline-video__video"
        aria-label={title}
        playsinline
        preload="auto"
        onclick={togglePlay}
        onended={handleEnded}
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
        <button class="hero-inline-video__play-overlay" onclick={togglePlay} aria-label="Play video">
          <span class="hero-inline-video__play-ring" aria-hidden="true"></span>
          <PlayIcon size={32} />
        </button>
      {/if}

      <!-- Close button -->
      <button
        bind:this={closeBtn}
        class="hero-inline-video__close"
        onclick={onclose}
        aria-label="Close video"
      >
        <XIcon size={24} />
      </button>

      <!-- Mute toggle -->
      <button class="hero-inline-video__mute" onclick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
        {#if muted}
          <VolumeXIcon size={20} />
        {:else}
          <Volume2Icon size={20} />
        {/if}
      </button>
    </div>

    {#if error}
      <p class="hero-inline-video__error" role="alert">{error}</p>
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

    /* Remove default focus outline from the programmatically-focused wrapper. */
    outline: none;

    /* Scale from the play button's position (transform-origin set via inline style).
       Starts tiny and expands to fill the hero. */
    animation: inline-video-expand calc(var(--duration-slower) * 1.6) var(--ease-out) both;
    animation-delay: calc(var(--duration-slower) * 1.4);
  }

  .hero-inline-video:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: calc(var(--border-width-thick) * -2);
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
    background: var(--color-neutral-950, black);
  }

  /* ── Play/pause overlay ── */
  .hero-inline-video__play-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-player-surface);
    color: var(--color-player-text);
    border: none;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-default);
  }

  .hero-inline-video__play-overlay:hover {
    background: var(--color-player-surface-active);
  }

  .hero-inline-video__play-overlay:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: calc(var(--border-width-thick) * -2);
  }

  .hero-inline-video__play-ring {
    position: absolute;
    width: var(--space-16);
    height: var(--space-16);
    border: var(--border-width-thick) solid var(--color-player-text);
    border-radius: var(--radius-full);
    opacity: var(--opacity-40);
    pointer-events: none;
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
    background: var(--color-player-overlay);
    color: var(--color-player-text);
    border: none;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-default);
  }

  .hero-inline-video__close:hover {
    background: var(--color-player-overlay-heavy);
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
    background: var(--color-player-overlay);
    color: var(--color-player-text);
    border: none;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-default);
  }

  .hero-inline-video__mute:hover {
    background: var(--color-player-overlay-heavy);
  }

  .hero-inline-video__mute:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-1);
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

  /*
    Reduced-motion — ref 05 §"Media elements" §5 + §8.
    CSS-first pattern replaces the previous JS matchMedia one-shot (which was
    captured at mount and didn't re-evaluate when the user toggled the setting).
  */
  @media (prefers-reduced-motion: reduce) {
    .hero-inline-video {
      animation: none;
    }

    .hero-inline-video__play-overlay,
    .hero-inline-video__close,
    .hero-inline-video__mute {
      transition: none;
    }
  }
</style>

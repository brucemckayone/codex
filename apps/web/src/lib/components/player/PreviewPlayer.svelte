<!--
  @component PreviewPlayer

  Plays an HLS preview clip with a 30-second time limit.
  Shows a CTA overlay when the preview ends or when access is locked.

  @prop {string} previewUrl - HLS preview manifest URL
  @prop {string} [poster] - Poster/thumbnail image URL
  @prop {string} contentId - Content ID for checkout form
  @prop {string} [contentTitle] - Content title for display
  @prop {AccessState} accessState - Current access state
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { PlayIcon, PauseIcon, VolumeXIcon, Volume2Icon, MaximizeIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import { createHlsPlayer } from '$lib/components/VideoPlayer/hls';
  import { createCheckout } from '$lib/remote/checkout.remote';
  import { page } from '$app/state';
  import type Hls from 'hls.js';
  import type { AccessState } from './access-state';

  const PREVIEW_TIME_LIMIT = 30;

  interface Props {
    previewUrl: string;
    poster?: string;
    contentId: string;
    contentTitle?: string;
    accessState: AccessState;
  }

  const { previewUrl, poster, contentId, contentTitle, accessState }: Props = $props();

  let videoEl: HTMLVideoElement | undefined = $state();
  let hlsInstance: Hls | null = null;
  let loading = $state(true);
  let errorMessage = $state('');
  let previewEnded = $state(false);
  let showCta = $derived(previewEnded || accessState.status === 'locked');

  const loginUrl = $derived(`/login?redirect=${encodeURIComponent(page.url.pathname)}`);

  const ctaReason = $derived<'auth_required' | 'purchase_required'>(
    accessState.status === 'locked' ? accessState.reason : 'purchase_required'
  );

  function handleCanPlay() {
    loading = false;
  }

  function handleError() {
    if (!errorMessage) {
      errorMessage = 'Failed to load preview.';
    }
    loading = false;
  }

  function handleTimeUpdate() {
    if (!videoEl) return;
    if (videoEl.currentTime >= PREVIEW_TIME_LIMIT) {
      videoEl.pause();
      previewEnded = true;
    }
  }

  function handleEnded() {
    previewEnded = true;
  }

  async function initPlayer() {
    if (!videoEl) return;

    loading = true;
    errorMessage = '';

    try {
      hlsInstance = await createHlsPlayer({
        video: videoEl,
        src: previewUrl,
        onError: (msg) => {
          errorMessage = msg;
          loading = false;
        },
      });
    } catch {
      errorMessage = 'Failed to initialize preview player.';
      loading = false;
    }
  }

  onMount(() => {
    initPlayer();
  });

  onDestroy(() => {
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
  });
</script>

<div class="preview-player">
  {#if loading}
    <div class="preview-player__loading">
      <div class="preview-player__spinner" aria-label={m.common_loading()}></div>
    </div>
  {/if}

  {#if errorMessage}
    <div class="preview-player__error" role="alert">
      <p>{errorMessage}</p>
    </div>
  {:else}
    <div class="preview-player__video-container">
      <video
        bind:this={videoEl}
        playsinline
        preload="metadata"
        poster={poster}
        oncanplay={handleCanPlay}
        onerror={handleError}
        ontimeupdate={handleTimeUpdate}
        onended={handleEnded}
      ></video>

      <!-- Minimal controls -->
      {#if !showCta}
        <div class="preview-player__controls">
          <button
            class="preview-player__control-btn"
            onclick={() => {
              if (!videoEl) return;
              if (videoEl.paused) videoEl.play();
              else videoEl.pause();
            }}
            aria-label={videoEl?.paused ? 'Play' : 'Pause'}
          >
            {#if videoEl?.paused}
              <PlayIcon size={20} fill="currentColor" stroke="none" />
            {:else}
              <PauseIcon size={20} fill="currentColor" stroke="none" />
            {/if}
          </button>

          <button
            class="preview-player__control-btn"
            onclick={() => {
              if (videoEl) videoEl.muted = !videoEl.muted;
            }}
            aria-label={videoEl?.muted ? 'Unmute' : 'Mute'}
          >
            {#if videoEl?.muted}
              <VolumeXIcon size={20} />
            {:else}
              <Volume2Icon size={20} />
            {/if}
          </button>

          <button
            class="preview-player__control-btn"
            onclick={() => {
              const container = videoEl?.closest('.preview-player');
              if (document.fullscreenElement) {
                document.exitFullscreen();
              } else {
                container?.requestFullscreen();
              }
            }}
            aria-label="Fullscreen"
          >
            <MaximizeIcon size={20} />
          </button>
        </div>
      {/if}

      <!-- Preview badge -->
      <div class="preview-player__badge">{m.player_preview_label()}</div>

      <!-- CTA Overlay -->
      {#if showCta}
        <div class="preview-player__overlay" class:preview-player__overlay--visible={showCta}>
          <div class="preview-player__cta">
            {#if previewEnded}
              <p class="preview-player__cta-title">{m.player_preview_ended()}</p>
            {/if}

            <p class="preview-player__cta-description">
              {#if contentTitle}
                {m.purchase_cta_description()}
              {:else}
                {m.player_preview_cta()}
              {/if}
            </p>

            {#if ctaReason === 'auth_required'}
              <a href={loginUrl} class="preview-player__cta-button">
                {m.purchase_sign_in()}
              </a>
            {:else}
              <form {...createCheckout}>
                <input type="hidden" name="contentId" value={contentId} />
                <button
                  type="submit"
                  class="preview-player__cta-button"
                  disabled={createCheckout.pending}
                >
                  {createCheckout.pending ? m.common_loading() : m.purchase_cta_title()}
                </button>
              </form>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .preview-player {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    background-color: var(--color-neutral-900);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  /* Loading */
  .preview-player__loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--color-neutral-900);
    z-index: 3;
  }

  .preview-player__spinner {
    width: 2.5rem;
    height: 2.5rem;
    border: 3px solid color-mix(in srgb, white 20%, transparent);
    border-top-color: color-mix(in srgb, white 80%, transparent);
    border-radius: 50%;
    animation: preview-spin 0.8s linear infinite;
  }

  @keyframes preview-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Error */
  .preview-player__error {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--color-neutral-900);
    color: var(--color-neutral-300);
    z-index: 2;
    padding: var(--space-6);
    text-align: center;
  }

  .preview-player__error p {
    font-size: var(--text-sm);
    margin: 0;
  }

  /* Video container */
  .preview-player__video-container {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .preview-player__video-container video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  /* Minimal controls */
  .preview-player__controls {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    background: linear-gradient(to top, color-mix(in srgb, black 70%, transparent) 0%, transparent 100%);
    z-index: 2;
  }

  .preview-player__control-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--color-text-inverse);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: background-color var(--duration-fast) var(--ease-default);
  }

  .preview-player__control-btn:hover {
    background: color-mix(in srgb, white 15%, transparent);
  }

  .preview-player__control-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  /* Preview badge */
  .preview-player__badge {
    position: absolute;
    top: var(--space-3);
    left: var(--space-3);
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-inverse);
    background: color-mix(in srgb, black 60%, transparent);
    border-radius: var(--radius-sm);
    z-index: 2;
    pointer-events: none;
  }

  /* CTA Overlay */
  .preview-player__overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    z-index: 4;
    opacity: 0;
    transition:
      opacity 300ms ease,
      background 300ms ease;
    pointer-events: none;
  }

  .preview-player__overlay--visible {
    opacity: 1;
    background: color-mix(in srgb, black 70%, transparent);
    pointer-events: auto;
  }

  .preview-player__cta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    text-align: center;
    padding: var(--space-6);
    max-width: 320px;
  }

  .preview-player__cta-title {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text-inverse);
    margin: 0;
  }

  .preview-player__cta-description {
    font-size: var(--text-sm);
    color: color-mix(in srgb, white 80%, transparent);
    margin: 0;
    line-height: var(--leading-normal);
  }

  .preview-player__cta-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 2.5rem;
    padding-inline: var(--space-6);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text-inverse);
    background-color: var(--color-interactive);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    text-decoration: none;
    transition: background-color var(--duration-fast) var(--ease-default);
  }

  .preview-player__cta-button:hover {
    background-color: var(--color-interactive-hover);
  }

  .preview-player__cta-button:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .preview-player__cta-button:disabled {
    opacity: var(--opacity-60);
    cursor: not-allowed;
  }

  /* Responsive */
  @media (max-width: 640px) {
    .preview-player__controls {
      padding: var(--space-1) var(--space-2);
    }

    .preview-player__cta {
      padding: var(--space-4);
    }

    .preview-player__cta-title {
      font-size: var(--text-base);
    }
  }

  /* Dark mode */
  :global([data-theme='dark']) .preview-player__badge {
    background: color-mix(in srgb, black 70%, transparent);
  }
</style>

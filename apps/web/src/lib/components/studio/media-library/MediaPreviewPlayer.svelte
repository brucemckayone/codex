<!--
  @component MediaPreviewPlayer

  The creator's own media, played in the library's drawer before anything
  uses it (Codex-a6ofh.1.7, mockup M3). The signed URL (GET /api/media/:id/
  preview, 15 minutes) is minted only when they press Play.

  Not VideoPlayer / AudioPlayer: both take a `contentId` that drives the
  playback-progress tracker and renews through `refreshStreamingUrl`, the
  content stream. A media preview has no content, so it would save progress
  under a media id and renew against the wrong endpoint. This keeps only the
  shared HLS core (`createHlsPlayer`) and the browser's own controls.
-->
<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { describeThrown } from '$lib/client-log';
  import { playNow, settleStart } from '$lib/components/player/start';
  import { Button } from '$lib/components/ui';
  import { PlayIcon } from '$lib/components/ui/Icon';
  import { createHlsPlayer, type HlsErrorKind } from '$lib/components/VideoPlayer/hls';
  import { logger } from '$lib/observability';
  import { getMediaPreview } from '$lib/remote/media.remote';
  import { remoteErrorStatus } from '$lib/remote/query-result';
  import { getThumbnailSrcset } from '$lib/utils/image';
  import * as m from '$paraglide/messages';

  interface Props {
    mediaId: string;
    mediaType: 'video' | 'audio';
    title: string;
    poster?: string | null;
    /** The poster's rendered width: the drawer's by default, the editor's column in the editor. */
    sizes?: string;
  }

  /** The drawer is 32rem wide, or the viewport on a phone. */
  const DRAWER_SIZES = '(max-width: 39.9375rem) 100vw, 32rem';

  const { mediaId, mediaType, title, poster = null, sizes = DRAWER_SIZES }: Props = $props();

  type Phase =
    | { kind: 'idle' }
    | { kind: 'starting' }
    | { kind: 'playing' }
    | { kind: 'failed'; message: string; retry: boolean };

  let phase = $state<Phase>({ kind: 'idle' });
  let media = $state<HTMLMediaElement | null>(null);
  let handle: Awaited<ReturnType<typeof createHlsPlayer>> | null = null;
  let destroyed = false;
  /** Where playback stopped: a Retry, or a renewal, carries on from here. */
  let place = 0;
  /**
   * A renewal not yet proven: the token lasts 15 minutes, so a long preview
   * renews every 15. Only a stream that 403s again before it has played a
   * frame since its renewal is refused, never one simply played long.
   */
  let unproven = false;

  function teardown() {
    handle?.hls?.destroy();
    handle?.cleanup();
    handle = null;
  }

  /** Stop, say why, and log it: an outage as an error, a refusal as a warning. */
  function fail(message: string, retry: boolean, detail: Record<string, unknown>) {
    teardown();
    phase = { kind: 'failed', message, retry };
    const status = typeof detail.status === 'number' ? detail.status : undefined;
    const fields = { mediaId, ...detail };
    if (status !== undefined && status < 500) logger.warn('media_preview.failed', fields);
    else logger.error('media_preview.failed', fields);
  }

  const STREAM_COPY: Record<HlsErrorKind, () => string> = {
    unsupported: () => m.media_preview_unsupported(),
    media: () => m.media_preview_failed(),
    network: () => m.media_preview_failed(),
    unknown: () => m.media_preview_failed(),
  };

  /** Mint a URL and play it from `at`; rejects when the mint fails. */
  async function attach(at: number) {
    const preview = await getMediaPreview(mediaId);
    if (destroyed) return;
    phase = { kind: 'playing' };
    await tick();
    const element = media;
    if (!element || destroyed) return;
    teardown();
    const next = await createHlsPlayer({
      media: element,
      src: preview.playlistUrl,
      onError: (message, kind, failedAt) => {
        place = failedAt;
        // Another browser may play it; Try again here cannot.
        fail(STREAM_COPY[kind](), kind !== 'unsupported', { kind, message });
      },
      onUrlExpired: (expiredAt) => void renew(expiredAt),
    });
    // Closed (or moved to another item) while hls.js loaded: drop it.
    if (destroyed || media !== element) {
      next.hls?.destroy();
      next.cleanup();
      return;
    }
    handle = next;
    if (at > 0) element.currentTime = at;
    element.addEventListener('playing', () => (unproven = false), { once: true });
    // The press's activation is spent by the mint and the hls.js load, so a
    // refused sound plays muted (the controls unmute) and an attach that
    // reset the pending play is asked once more (player/start.ts).
    const started = await settleStart(element, playNow(element), () => !destroyed);
    // Even muted it would not start: the controls stay, for the creator's own press.
    if (started === 'failed' && !destroyed) logger.warn('media_preview.play_failed', { mediaId });
  }

  async function renew(at: number) {
    place = at;
    if (unproven) {
      fail(m.media_preview_expired(), true, { reason: 'expired-before-playing' });
      return;
    }
    unproven = true;
    try {
      await attach(at);
    } catch (error) {
      fail(m.media_preview_failed(), true, {
        reason: 'renew',
        status: remoteErrorStatus(error),
        ...describeThrown(error),
      });
    }
  }

  async function play() {
    if (phase.kind === 'starting') return;
    phase = { kind: 'starting' };
    unproven = false;
    try {
      await attach(place);
    } catch (error) {
      const status = remoteErrorStatus(error);
      // 422: it finished processing after the drawer read it, or not yet.
      fail(status === 422 ? m.media_preview_not_ready() : m.media_preview_failed(), status !== 422, {
        status,
        ...describeThrown(error),
      });
    }
  }

  onDestroy(() => {
    destroyed = true;
    teardown();
  });
</script>

<div class="preview" data-type={mediaType}>
  {#if phase.kind === 'playing'}
    {#if mediaType === 'video'}
      <video
        bind:this={media}
        class="preview-media"
        controls
        playsinline
        poster={poster ?? undefined}
        aria-label={m.media_preview_label({ title })}
      ></video>
    {:else}
      <audio bind:this={media} class="preview-audio" controls aria-label={m.media_preview_label({ title })}></audio>
    {/if}
  {:else}
    <button
      type="button"
      class="preview-start"
      aria-label={m.media_preview_play({ title })}
      disabled={phase.kind === 'starting'}
      onclick={play}
    >
      {#if poster && mediaType === 'video'}
        <img
          src={poster}
          srcset={getThumbnailSrcset(poster) || undefined}
          {sizes}
          alt=""
          class="preview-poster"
        />
      {/if}
      <span class="preview-play" aria-hidden="true"><PlayIcon size={22} /></span>
    </button>
    {#if phase.kind === 'failed'}
      <div class="preview-failed" role="alert">
        <p>{phase.message}</p>
        {#if phase.retry}
          <Button size="sm" variant="secondary" onclick={play}>{m.media_library_retry()}</Button>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .preview-media,
  .preview-start {
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-md);
    background: var(--color-surface-secondary);
  }

  .preview[data-type='audio'] .preview-start {
    aspect-ratio: auto;
    height: var(--space-20);
  }

  .preview-audio {
    width: 100%;
  }

  .preview-start {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    overflow: hidden;
    border: var(--border-width) var(--border-style) var(--color-border);
    cursor: pointer;
  }

  .preview-start:disabled {
    cursor: progress;
  }

  .preview-start:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .preview-poster {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .preview-play {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-12);
    height: var(--space-12);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-surface) 88%, transparent);
    color: var(--color-text);
    box-shadow: var(--shadow-md);
  }

  .preview-failed {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-status-error-text);
  }

  .preview-failed p {
    flex: 1;
    margin: 0;
  }
</style>

<!--
  @component MediaTile

  Editorial media tile for the Studio media library grid. 16:9 thumbnail
  (or branded placeholder when thumbnailUrl is absent) with duration
  overlay bottom-right, mono ordinal top-left, status pill inline,
  inline media-type chip. Upload and transcode progress render as an
  overlaid bar on the thumbnail with a step label. Hover reveals edit/delete
  overlay actions.

  Live (Codex-l2c48.7): the tile reads its item's state from the studio's one
  status socket (`$lib/client/media-status`) instead of polling, and
  `describeTile` decides what it shows: why an item waits or failed, a
  countdown to the automatic retry, and Try again where another attempt can
  help. Every state is drawn in docs/handover/live-media-status/index.html.

  Under the title, "In use by N" (`MediaUseChip`, Codex-6sbn1).
-->
<script lang="ts">
  import { mediaStatus } from '$lib/client/media-status.svelte';
  import { describeThrown } from '$lib/client-log';
  import { retryTranscoding } from '$lib/remote/media.remote';
  import { logger } from '$lib/observability';
  import type { MediaItemWithRelations } from '$lib/types';
  import { Button } from '$lib/components/ui';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import {
    FilmIcon,
    MusicIcon,
    EditIcon,
    TrashIcon,
    PlayIcon,
    AlertTriangleIcon,
    CheckIcon,
    ClockIcon,
    RefreshCwIcon,
    UploadIcon,
  } from '$lib/components/ui/Icon';
  import { formatDuration, formatFileSize, formatRelativeTime } from '$lib/utils/format';
  import { getThumbnailSrcset } from '$lib/utils/image';
  import * as m from '$paraglide/messages';
  import { MAX_TRANSCODING_ATTEMPTS } from '@codex/constants';
  import { remoteErrorStatus } from '$lib/remote/query-result';
  import { describeTile, tilePill, type TileFailure, type TilePill } from './tile-state';
  import MediaUseChip from './MediaUseChip.svelte';

  // MediaItemWithRelations doesn't declare thumbnailUrl on the base schema
  // (only thumbnailKey) — but the public content API resolves keys to CDN
  // URLs elsewhere; support it optionally for forward-compat.
  type MediaTileItem = MediaItemWithRelations & { thumbnailUrl?: string | null };

  interface Props {
    /** Two-digit zero-padded tile index ("01", "02"..) — editorial ordinal */
    ordinal: string;
    /** Media item to render */
    media: MediaTileItem;
    /** Edit action callback — parent opens EditMediaDialog */
    onEdit?: (id: string) => void;
    /** Delete action callback — parent opens confirm Dialog */
    onDelete?: (id: string) => void;
  }

  const { ordinal, media, onEdit, onDelete }: Props = $props();

  // ── Live state ──────────────────────────────────────────────────────────
  const live = $derived(mediaStatus.items.get(media.id));
  // Only a tile counting down reads the clock, so only it re-renders each second.
  const now = $derived(live?.retryAt != null ? mediaStatus.now : 0);
  const view = $derived(describeTile(media, live, now));
  const pill = $derived(tilePill(view));

  /**
   * MediaTileGrid's tile: one full-width column below 40rem, else
   * `auto-fill, minmax(var(--tile-min), 1fr)` (15rem below 48rem, then 18rem),
   * so a thumb inside the tile's 0.5rem padding is about 17-26rem. 24rem is
   * at most about 1.42x over, which picks the same file at 1x and 2x.
   */
  const TILE_SIZES = '(max-width: 39.9375rem) calc(100vw - 2rem), 24rem';

  // ── Derived meta ────────────────────────────────────────────────────────
  const isVideo = $derived(media.mediaType === 'video');
  const typeMeta = $derived(
    isVideo
      ? { label: m.media_type_video(), icon: FilmIcon }
      : { label: m.media_type_audio(), icon: MusicIcon }
  );

  const PILL_LABELS: Record<TilePill, () => string> = {
    uploading: () => m.media_status_uploading(),
    stopped: () => m.media_status_stopped(),
    processing: () => m.media_status_processing(),
    waiting: () => m.media_status_waiting(),
    ready: () => m.media_status_ready(),
    failed: () => m.media_status_failed(),
  };

  /**
   * The bar over the thumbnail; `pct` null draws it indeterminate. Its
   * colour and icon follow the tile's `data-status` (the pill).
   */
  type Overlay = { label: string; pct: number | null };

  const overlay = $derived.by((): Overlay | null => {
    switch (view.kind) {
      case 'uploading':
        return {
          label: view.elsewhere ? m.media_tile_upload_elsewhere() : m.media_status_uploading(),
          pct: view.pct,
        };
      case 'starting':
        return { label: m.media_tile_starting(), pct: null };
      case 'processing':
        return {
          label: view.step ? getStepLabel(view.step) : m.media_status_processing(),
          pct: view.pct,
        };
      case 'waiting':
        return {
          label:
            view.cause === 'config'
              ? m.media_tile_waiting_config_step()
              : m.media_tile_waiting_service_step(),
          pct: null,
        };
      default:
        return null;
    }
  });

  /** The sentence under the title: why it waits, stopped or failed. */
  const reason = $derived.by((): string | null => {
    switch (view.kind) {
      case 'stopped':
        return m.media_tile_stopped();
      case 'waiting':
        if (view.cause === 'config') return m.media_tile_waiting_config();
        return view.retryInSeconds
          ? m.media_tile_waiting_service({ time: formatDuration(view.retryInSeconds) })
          : m.media_tile_waiting_service_later();
      case 'failed':
        return FAILURE_TEXT[view.reason]();
      default:
        return null;
    }
  });

  const FAILURE_TEXT: Record<TileFailure, () => string> = {
    file: () => m.media_tile_failed_file(),
    upload: () => m.media_tile_stopped(),
    exhausted: () => m.media_tile_failed_exhausted({ count: MAX_TRANSCODING_ATTEMPTS }),
    timeout: () => m.media_tile_failed_timeout(),
    internal: () => m.media_tile_failed_internal(),
  };

  // ── Try again ───────────────────────────────────────────────────────────
  let retrying = $state(false);

  async function tryAgain() {
    if (retrying) return;
    retrying = true;
    try {
      await retryTranscoding(media.id);
      // What happens next arrives over the socket; without one, the list
      // (and its refetch drops the held `failed` this tile still shows).
      if (mediaStatus.connection !== 'live') mediaStatus.refreshList();
    } catch (error) {
      const status = remoteErrorStatus(error);
      // A 4xx refused this retry (the state moved, no tries left); anything
      // else is an outage, or a network that never answered.
      if (status === undefined || status >= 500) {
        logger.error('media_tile.retry_failed', { mediaId: media.id, ...describeThrown(error) });
      } else if (status !== 429) {
        logger.warn('media_tile.retry_refused', { mediaId: media.id, ...describeThrown(error) });
      }
      toast.error(
        status === 429 ? m.media_tile_retry_rate_limited() : m.media_tile_retry_failed()
      );
      // A refusal means the tile is out of date (another tab, or no tries left).
      mediaStatus.refreshList();
    } finally {
      retrying = false;
    }
  }

  const durationText = $derived(formatDuration(media.durationSeconds));
  const sizeText = $derived(formatFileSize(media.fileSizeBytes));
  const dateText = $derived(media.createdAt ? formatRelativeTime(media.createdAt) : '');

  const STEP_LABELS: Record<string, () => string> = {
    downloading: () => m.transcoding_step_downloading(),
    probing: () => m.transcoding_step_probing(),
    mezzanine: () => m.transcoding_step_mezzanine(),
    loudness: () => m.transcoding_step_loudness(),
    encoding_variants: () => m.transcoding_step_encoding_variants(),
    preview: () => m.transcoding_step_preview(),
    thumbnails: () => m.transcoding_step_thumbnails(),
    waveform: () => m.transcoding_step_waveform(),
    uploading_outputs: () => m.transcoding_step_uploading_outputs(),
    finalizing: () => m.transcoding_step_finalizing(),
  };
  function getStepLabel(step: string): string {
    return STEP_LABELS[step]?.() ?? step;
  }
</script>

<article class="tile" data-status={pill}>
  <div class="tile-thumb">
    {#if media.thumbnailUrl}
      <img
        src={media.thumbnailUrl}
        srcset={getThumbnailSrcset(media.thumbnailUrl) || undefined}
        sizes={TILE_SIZES}
        alt=""
        class="thumb-img"
        loading="lazy"
      />
    {:else}
      <span class="thumb-placeholder">
        <typeMeta.icon size={36} />
      </span>
    {/if}

    <!-- Top-left ordinal -->
    <span class="thumb-ordinal" aria-hidden="true">{ordinal}</span>

    <!-- Top-right type chip -->
    <span class="thumb-type-chip" aria-hidden="true">
      <typeMeta.icon size={12} />
      <span>{typeMeta.label}</span>
    </span>

    <!-- Bottom-right duration overlay (YouTube-style) when ready -->
    {#if durationText && view.kind === 'ready'}
      <span class="thumb-duration" aria-hidden="true">
        {#if isVideo}
          <PlayIcon size={10} />
        {/if}
        <span>{durationText}</span>
      </span>
    {/if}

    {#if view.kind === 'stopped'}
      <span class="thumb-dim" aria-hidden="true"></span>
    {/if}

    <!-- Upload / transcode / wait progress overlay -->
    {#if overlay}
      <div
        class="thumb-progress"
        role="progressbar"
        aria-label={overlay.label}
        aria-valuenow={overlay.pct ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div class="thumb-progress-meta">
          <span class="thumb-progress-step">
            {#if pill === 'uploading'}
              <UploadIcon size={12} />
            {:else if pill === 'waiting'}
              <ClockIcon size={12} />
            {/if}
            {overlay.label}
          </span>
          {#if overlay.pct != null}
            <span class="thumb-progress-pct">{overlay.pct}%</span>
          {/if}
        </div>
        <div class="thumb-progress-bar">
          <div
            class={['thumb-progress-fill', { indeterminate: overlay.pct == null }]}
            style:width={overlay.pct == null ? undefined : `${overlay.pct}%`}
          ></div>
        </div>
      </div>
    {/if}

    <!-- Failed overlay -->
    {#if view.kind === 'failed'}
      <div class="thumb-failed" aria-hidden="true">
        <AlertTriangleIcon size={20} />
      </div>
    {/if}

    <!-- Hover actions -->
    <div class="thumb-actions">
      {#if onEdit}
        <button
          type="button"
          class="tile-action"
          aria-label={m.media_edit_title()}
          onclick={() => onEdit(media.id)}
        >
          <EditIcon size={14} />
        </button>
      {/if}
      {#if onDelete}
        <button
          type="button"
          class="tile-action tile-action--danger"
          aria-label={m.media_delete_title()}
          onclick={() => onDelete(media.id)}
        >
          <TrashIcon size={14} />
        </button>
      {/if}
    </div>
  </div>

  <div class="tile-body">
    <div class="tile-header">
      <h3 class="tile-title" title={media.title}>{media.title}</h3>
      <span class="tile-status-pill" data-status={pill}>
        <span class="tile-status-dot" aria-hidden="true">
          {#if pill === 'ready'}
            <CheckIcon size={8} />
          {/if}
        </span>
        {PILL_LABELS[pill]()}
      </span>
    </div>

    {#if reason}
      <p class="tile-reason">{reason}</p>
    {/if}

    <MediaUseChip mediaId={media.id} usage={media.usage} />

    {#if view.kind === 'failed' && view.canRetry}
      <div class="tile-cta">
        <Button size="xs" loading={retrying} disabled={retrying} onclick={tryAgain}>
          <RefreshCwIcon size={12} />
          {m.media_tile_try_again()}
        </Button>
        <span class="tile-cta-note">
          {view.attemptsLeft === 1
            ? m.media_tile_tries_left_one()
            : m.media_tile_tries_left({ count: view.attemptsLeft })}
        </span>
      </div>
    {/if}

    <dl class="tile-meta">
      {#if sizeText}
        <div class="meta-item">
          <dt class="meta-label">Size</dt>
          <dd class="meta-value">{sizeText}</dd>
        </div>
      {/if}
      {#if durationText}
        <div class="meta-item">
          <dt class="meta-label">Duration</dt>
          <dd class="meta-value">{durationText}</dd>
        </div>
      {/if}
      {#if dateText}
        <div class="meta-item">
          <dt class="meta-label">Added</dt>
          <dd class="meta-value">{dateText}</dd>
        </div>
      {/if}
    </dl>
  </div>
</article>

<style>
  .tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-2);
    border-radius: var(--radius-lg);
    border: var(--border-width) var(--border-style) transparent;
    background-color: transparent;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out),
      transform var(--duration-fast) var(--ease-out);
  }

  .tile:hover {
    background-color: color-mix(in srgb, var(--color-surface-secondary) 50%, var(--color-surface));
    border-color: var(--color-border);
  }

  @media (prefers-reduced-motion: no-preference) {
    .tile:hover { transform: translateY(calc(-1 * var(--space-0-5))); }
  }

  /* ── Thumbnail frame ──────────────────────────────────── */
  .tile-thumb {
    position: relative;
    display: block;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-md);
    overflow: hidden;
    background:
      linear-gradient(
        135deg,
        color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 14%, var(--color-surface-secondary)),
        var(--color-surface-secondary)
      );
    box-shadow:
      0 var(--space-1) var(--space-3) color-mix(in srgb, var(--color-text) 4%, transparent);
  }

  .thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .thumb-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 55%, var(--color-text-muted));
  }

  /* Overlays share chip styling */
  .thumb-ordinal,
  .thumb-type-chip,
  .thumb-duration {
    position: absolute;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    background: color-mix(in srgb, var(--color-surface) 82%, transparent);
    backdrop-filter: blur(var(--blur-lg));
    -webkit-backdrop-filter: blur(var(--blur-lg));
    border: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-border) 60%, transparent);
    border-radius: var(--radius-full);
    pointer-events: none;
  }

  .thumb-ordinal {
    top: var(--space-2);
    left: var(--space-2);
    padding: 2px var(--space-2);
    letter-spacing: var(--tracking-wider);
    font-size: 0.625rem; /* slightly tighter than --text-xs for ordinal presence */
  }

  .thumb-type-chip {
    top: var(--space-2);
    right: var(--space-2);
    padding: 2px var(--space-2);
    font-family: var(--font-sans);
    font-feature-settings: normal;
    font-variant-numeric: normal;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  .thumb-duration {
    bottom: var(--space-2);
    right: var(--space-2);
    padding: 2px var(--space-2);
  }

  /* Transcoding progress overlay */
  .thumb-progress {
    position: absolute;
    left: var(--space-2);
    right: var(--space-2);
    bottom: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-2-5);
    background: color-mix(in srgb, var(--color-surface) 86%, transparent);
    backdrop-filter: blur(var(--blur-lg));
    -webkit-backdrop-filter: blur(var(--blur-lg));
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-border) 60%, transparent);
  }

  .thumb-progress-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .thumb-progress-step {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    font-weight: var(--font-semibold);
    color: var(--progress-ink, var(--color-status-warning-text));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .thumb-progress-pct {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    color: var(--color-text);
    font-weight: var(--font-semibold);
    flex-shrink: 0;
  }

  .thumb-progress-bar {
    height: var(--space-1);
    background-color: color-mix(in srgb, var(--color-text) 8%, transparent);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .thumb-progress-fill {
    height: 100%;
    background-color: var(--progress-fill, var(--color-warning));
    border-radius: var(--radius-full);
    transition: width var(--duration-slower) var(--ease-default);
  }

  /* An upload or a wait is informational; encoding keeps the warning ink. */
  .tile[data-status='uploading'] .thumb-progress,
  .tile[data-status='waiting'] .thumb-progress {
    --progress-ink: var(--color-status-info-text);
    --progress-fill: var(--color-info);
  }

  /* No % to show (starting, waiting, an upload not yet reported). */
  .thumb-progress-fill.indeterminate {
    width: 30%;
  }

  @media (prefers-reduced-motion: no-preference) {
    .thumb-progress-fill.indeterminate {
      animation: thumb-progress-slide 1.4s var(--ease-default) infinite;
    }
  }

  @keyframes thumb-progress-slide {
    from { transform: translateX(-100%); }
    to { transform: translateX(340%); }
  }

  /* A stopped upload: the thumbnail fades back behind its reason. */
  .thumb-dim {
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--color-surface) 35%, transparent);
  }

  .thumb-failed {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-status-error-text);
    background: color-mix(in srgb, var(--color-status-error-surface) 80%, transparent);
  }

  /* Hover action bar */
  .thumb-actions {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    display: inline-flex;
    gap: var(--space-1);
    opacity: 0;
    transform: translateY(calc(-1 * var(--space-1)));
    transition:
      opacity var(--duration-fast) var(--ease-out),
      transform var(--duration-fast) var(--ease-out);
    pointer-events: none;
  }

  .tile:hover .thumb-actions,
  .tile:focus-within .thumb-actions {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }

  /* If the type chip sits at top-right, hover-actions override it — hide the
     chip on hover so they don't stack. */
  .tile:hover .thumb-type-chip,
  .tile:focus-within .thumb-type-chip {
    opacity: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .thumb-actions { transform: none; transition: opacity var(--duration-fast) linear; }
  }

  .tile-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    border: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-border) 60%, transparent);
    background: color-mix(in srgb, var(--color-surface) 88%, transparent);
    backdrop-filter: blur(var(--blur-lg));
    -webkit-backdrop-filter: blur(var(--blur-lg));
    color: var(--color-text);
    border-radius: var(--radius-full);
    cursor: pointer;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .tile-action:hover {
    background: var(--color-surface);
    color: var(--color-interactive);
  }

  .tile-action--danger:hover {
    color: var(--color-error-700);
    background: var(--color-error-50);
  }

  .tile-action:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* ── Body (title + meta) ──────────────────────────────── */
  .tile-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 var(--space-1);
    min-width: 0;
  }

  .tile-header {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .tile-title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    line-height: var(--leading-snug);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    min-width: 0;
  }

  .tile-status-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 2px var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    flex-shrink: 0;
    line-height: var(--leading-none);
  }

  .tile-status-dot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-1-5);
    height: var(--space-1-5);
    border-radius: var(--radius-full);
    background-color: currentColor;
  }

  .tile-status-pill[data-status='ready'] {
    color: var(--color-status-success-text);
    background: var(--color-status-success-surface);
    border-color: var(--color-status-success-border);
  }

  .tile-status-pill[data-status='processing'],
  .tile-status-pill[data-status='stopped'] {
    color: var(--color-status-warning-text);
    background: var(--color-status-warning-surface);
    border-color: var(--color-status-warning-border);
  }

  .tile-status-pill[data-status='failed'] {
    color: var(--color-status-error-text);
    background: var(--color-status-error-surface);
    border-color: var(--color-status-error-border);
  }

  .tile-status-pill[data-status='waiting'] {
    color: var(--color-status-info-text);
    background: var(--color-status-info-surface);
    border-color: var(--color-status-info-border);
  }

  /* Neutral: the base pill's text-secondary ink (muted read 2.3:1 here). */
  .tile-status-pill[data-status='uploading'] {
    background: var(--color-surface-secondary);
  }

  /* ── Reason + Try again ───────────────────────────────── */
  /* Its colour comes from the tile's state, below: every reason has one. */
  .tile-reason {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
  }

  .tile[data-status='failed'] .tile-reason { color: var(--color-status-error-text); }
  .tile[data-status='waiting'] .tile-reason { color: var(--color-status-info-text); }
  .tile[data-status='stopped'] .tile-reason { color: var(--color-status-warning-text); }

  .tile-cta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .tile-cta-note {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  /* ── Meta row (labelled like slab) ────────────────────── */
  .tile-meta {
    margin: 0;
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-3);
    row-gap: var(--space-1);
  }

  .meta-item {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-1);
    min-width: 0;
  }

  .meta-label {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-muted);
  }

  .meta-value {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text);
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
  }
</style>

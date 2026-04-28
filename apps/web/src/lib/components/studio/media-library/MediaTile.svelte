<!--
  @component MediaTile

  Editorial media tile for the Studio media library grid. 16:9 thumbnail
  (or branded placeholder when thumbnailUrl is absent) with duration
  overlay bottom-right, mono ordinal top-left, status pill inline,
  inline media-type chip. Transcoding progress renders as an overlaid
  bar on the thumbnail with a step label. Hover reveals edit/delete
  overlay actions.

  Polls transcoding status every 5s when media.status === 'transcoding'
  (lifted from MediaCard.svelte) — behaviour preserved verbatim.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { getTranscodingStatus } from '$lib/remote/media.remote';
  import { logger } from '$lib/observability';
  import type { MediaItemWithRelations } from '$lib/types';
  import {
    FilmIcon,
    MusicIcon,
    EditIcon,
    TrashIcon,
    PlayIcon,
    AlertTriangleIcon,
    CheckIcon,
  } from '$lib/components/ui/Icon';
  import { formatDuration, formatFileSize, formatRelativeTime } from '$lib/utils/format';
  import * as m from '$paraglide/messages';

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

  // ── Polling (lifted verbatim from MediaCard for transcoding items) ──────
  let progress = $state<{ progress: number | null; step: string | null; status: string } | null>(null);
  const effectiveStatus = $derived(progress?.status ?? media.status);
  const isTranscoding = $derived(effectiveStatus === 'transcoding');

  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let pollErrors = 0;
  let visible = true;
  const MAX_CONSECUTIVE_ERRORS = 3;

  function stopPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = null;
    if (browser) document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  async function pollProgress() {
    if (!visible) return;
    try {
      const q = getTranscodingStatus(media.id);
      await q.refresh();
      const result = q.current;
      if (!result) return;
      pollErrors = 0;
      progress = {
        progress: result.transcodingProgress ?? null,
        step: result.transcodingStep ?? null,
        status: result.status,
      };
      if (result.status === 'ready' || result.status === 'failed') {
        stopPolling();
      }
    } catch (error) {
      pollErrors++;
      if (pollErrors >= MAX_CONSECUTIVE_ERRORS) {
        logger.warn('MediaTile: stopping poll after consecutive failures', {
          error: error instanceof Error ? error.message : String(error),
        });
        stopPolling();
      }
    }
  }

  function onVisibilityChange() {
    visible = browser && document.visibilityState === 'visible';
    if (visible) pollProgress();
  }

  onMount(() => {
    if (media.status === 'transcoding') {
      pollProgress();
      pollInterval = setInterval(pollProgress, 5000);
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
  });

  onDestroy(() => stopPolling());

  // ── Derived meta ────────────────────────────────────────────────────────
  const isVideo = $derived(media.mediaType === 'video');
  const typeMeta = $derived(
    isVideo
      ? { label: m.media_type_video(), icon: FilmIcon }
      : { label: m.media_type_audio(), icon: MusicIcon }
  );

  type StatusKey = 'ready' | 'transcoding' | 'failed' | 'uploading' | 'uploaded';
  const statusKey = $derived<StatusKey>(effectiveStatus as StatusKey);

  const statusMeta = $derived.by(() => {
    switch (statusKey) {
      case 'ready':
        return { label: m.media_status_ready(), variant: 'ready' as const };
      case 'transcoding':
        return { label: m.media_status_processing(), variant: 'transcoding' as const };
      case 'failed':
        return { label: m.media_status_failed(), variant: 'failed' as const };
      case 'uploaded':
        return { label: m.media_status_uploaded(), variant: 'uploading' as const };
      default:
        return { label: m.media_status_uploading(), variant: 'uploading' as const };
    }
  });

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

<article class="tile" data-status={statusMeta.variant}>
  <div class="tile-thumb">
    {#if media.thumbnailUrl}
      <img src={media.thumbnailUrl} alt="" class="thumb-img" loading="lazy" />
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
    {#if durationText && statusKey === 'ready'}
      <span class="thumb-duration" aria-hidden="true">
        {#if isVideo}
          <PlayIcon size={10} />
        {/if}
        <span>{durationText}</span>
      </span>
    {/if}

    <!-- Transcoding progress overlay -->
    {#if isTranscoding}
      <div class="thumb-progress" role="progressbar"
        aria-valuenow={progress?.progress ?? 0}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div class="thumb-progress-meta">
          <span class="thumb-progress-step">
            {progress?.step ? getStepLabel(progress.step) : m.media_status_processing()}
          </span>
          {#if progress?.progress != null}
            <span class="thumb-progress-pct">{progress.progress}%</span>
          {/if}
        </div>
        <div class="thumb-progress-bar">
          <div
            class="thumb-progress-fill"
            style="width: {progress?.progress ?? 0}%"
          ></div>
        </div>
      </div>
    {/if}

    <!-- Failed overlay -->
    {#if statusKey === 'failed'}
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
      <span class="tile-status-pill" data-status={statusMeta.variant}>
        <span class="tile-status-dot" aria-hidden="true">
          {#if statusKey === 'ready'}
            <CheckIcon size={8} />
          {/if}
        </span>
        {statusMeta.label}
      </span>
    </div>

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
    .tile:hover { transform: translateY(-2px); }
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
    backdrop-filter: blur(var(--blur-lg, 12px));
    -webkit-backdrop-filter: blur(var(--blur-lg, 12px));
    border: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-border) 60%, transparent);
    border-radius: var(--radius-full, 9999px);
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
    backdrop-filter: blur(var(--blur-lg, 12px));
    -webkit-backdrop-filter: blur(var(--blur-lg, 12px));
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
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    font-weight: var(--font-semibold);
    color: var(--color-warning-700);
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
    border-radius: var(--radius-full, 9999px);
    overflow: hidden;
  }

  .thumb-progress-fill {
    height: 100%;
    background-color: var(--color-warning-500, var(--color-warning));
    border-radius: var(--radius-full, 9999px);
    transition: width var(--duration-slower) var(--ease-default);
  }

  .thumb-failed {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-error-700);
    background: color-mix(in srgb, var(--color-error-50) 80%, transparent);
  }

  /* Hover action bar */
  .thumb-actions {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    display: inline-flex;
    gap: var(--space-1);
    opacity: 0;
    transform: translateY(-4px);
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
    backdrop-filter: blur(var(--blur-lg, 12px));
    -webkit-backdrop-filter: blur(var(--blur-lg, 12px));
    color: var(--color-text);
    border-radius: var(--radius-full, 9999px);
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
    border-radius: var(--radius-full, 9999px);
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
    border-radius: var(--radius-full, 9999px);
    background-color: currentColor;
  }

  .tile-status-pill[data-status='ready'] {
    color: var(--color-success-700);
    background: var(--color-success-50);
    border-color: color-mix(in srgb, var(--color-success) 30%, transparent);
  }

  .tile-status-pill[data-status='transcoding'] {
    color: var(--color-warning-700);
    background: var(--color-warning-50);
    border-color: color-mix(in srgb, var(--color-warning) 30%, transparent);
  }

  .tile-status-pill[data-status='failed'] {
    color: var(--color-error-700);
    background: var(--color-error-50);
    border-color: color-mix(in srgb, var(--color-error) 30%, transparent);
  }

  .tile-status-pill[data-status='uploading'] {
    color: var(--color-text-muted);
    background: var(--color-surface-secondary);
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

<!--
  @component MediaFeatureSlab

  Editorial hero slab for the most-recently-added, ready media item in
  the Studio media library. Takes the visual oxygen the old icon-tile
  grid lacked: 16:9 hero thumbnail on the left, ordinal "01" + narrative
  meta on the right, primary edit/delete actions.

  Only rendered on page 1 with no filters/search active — a true feature
  tile, not a repeating row. Falls back to a branded placeholder when the
  item has no thumbnail.
-->
<script lang="ts">
  import type { MediaItemWithRelations } from '$lib/types';
  import {
    FilmIcon,
    MusicIcon,
    EditIcon,
    TrashIcon,
    PlayIcon,
    CheckIcon,
  } from '$lib/components/ui/Icon';
  import { formatDuration, formatFileSize, formatRelativeTime } from '$lib/utils/format';
  import * as m from '$paraglide/messages';

  type MediaSlabItem = MediaItemWithRelations & { thumbnailUrl?: string | null };

  interface Props {
    media: MediaSlabItem;
    onEdit?: (id: string) => void;
    onDelete?: (id: string) => void;
  }

  const { media, onEdit, onDelete }: Props = $props();

  const isVideo = $derived(media.mediaType === 'video');
  const typeMeta = $derived(
    isVideo
      ? { label: m.media_type_video(), icon: FilmIcon }
      : { label: m.media_type_audio(), icon: MusicIcon }
  );

  const durationText = $derived(formatDuration(media.durationSeconds));
  const sizeText = $derived(formatFileSize(media.fileSizeBytes));
  const dateText = $derived(media.createdAt ? formatRelativeTime(media.createdAt) : '');

  const statusVariant = $derived(
    media.status === 'ready'
      ? 'ready'
      : media.status === 'transcoding'
        ? 'transcoding'
        : media.status === 'failed'
          ? 'failed'
          : 'uploading'
  );

  const statusLabel = $derived.by(() => {
    switch (media.status) {
      case 'ready':
        return m.media_status_ready();
      case 'transcoding':
        return m.media_status_processing();
      case 'failed':
        return m.media_status_failed();
      default:
        return m.media_status_uploaded();
    }
  });

  // TODO i18n — studio_media_slab_eyebrow = "Latest add"
  const eyebrow = 'Latest add';

  // TODO i18n — studio_media_slab_no_desc
  const strap = $derived(
    media.description && media.description.trim().length > 0
      ? media.description.slice(0, 180)
      : 'Add a description to help teammates find this media when assigning it to content.'
  );
</script>

<article class="slab" data-status={statusVariant}>
  <div class="slab-thumb">
    {#if media.thumbnailUrl}
      <img src={media.thumbnailUrl} alt="" class="thumb-img" loading="lazy" />
    {:else}
      <span class="thumb-placeholder" aria-hidden="true">
        <typeMeta.icon size={44} />
      </span>
    {/if}

    <span class="thumb-type-chip" aria-hidden="true">
      <typeMeta.icon size={14} />
      <span>{typeMeta.label}</span>
    </span>

    {#if durationText && media.status === 'ready'}
      <span class="thumb-duration" aria-hidden="true">
        {#if isVideo}
          <PlayIcon size={12} />
        {/if}
        <span>{durationText}</span>
      </span>
    {/if}
  </div>

  <div class="slab-body">
    <header class="slab-header">
      <span class="slab-ordinal" aria-hidden="true">01</span>
      <span class="slab-eyebrow">{eyebrow}</span>
      <span class="slab-status-pill" data-status={statusVariant}>
        <span class="slab-status-dot" aria-hidden="true">
          {#if statusVariant === 'ready'}
            <CheckIcon size={10} />
          {/if}
        </span>
        {statusLabel}
      </span>
    </header>

    <h2 class="slab-title" title={media.title}>{media.title}</h2>

    <p class="slab-strap">{strap}</p>

    <dl class="slab-meta">
      <div class="meta-item">
        <dt class="meta-label">Type</dt>
        <dd class="meta-value">{typeMeta.label}</dd>
      </div>
      {#if durationText}
        <div class="meta-item">
          <dt class="meta-label">Duration</dt>
          <dd class="meta-value">{durationText}</dd>
        </div>
      {/if}
      {#if sizeText}
        <div class="meta-item">
          <dt class="meta-label">Size</dt>
          <dd class="meta-value">{sizeText}</dd>
        </div>
      {/if}
      {#if dateText}
        <div class="meta-item">
          <dt class="meta-label">Added</dt>
          <dd class="meta-value">{dateText}</dd>
        </div>
      {/if}
    </dl>

    <div class="slab-actions">
      {#if onEdit}
        <button
          type="button"
          class="action-btn action-btn--primary"
          onclick={() => onEdit(media.id)}
        >
          <EditIcon size={14} />
          {m.media_edit_title()}
        </button>
      {/if}
      {#if onDelete}
        <button
          type="button"
          class="action-btn action-btn--muted"
          onclick={() => onDelete(media.id)}
        >
          <TrashIcon size={14} />
          {m.media_delete_title()}
        </button>
      {/if}
    </div>
  </div>
</article>

<style>
  .slab {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    gap: var(--space-6);
    padding: var(--space-5);
    border-radius: var(--radius-lg);
    background:
      radial-gradient(
        140% 90% at 100% 0%,
        color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 6%, transparent),
        transparent 60%
      ),
      var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    position: relative;
    overflow: hidden;
  }

  @media (--below-md) {
    .slab {
      grid-template-columns: 1fr;
      gap: var(--space-4);
      padding: var(--space-4);
    }
  }

  /* ── Thumbnail ──────────────────────────────────────────── */
  .slab-thumb {
    position: relative;
    display: block;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-md);
    overflow: hidden;
    background:
      linear-gradient(
        135deg,
        color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 20%, var(--color-surface-secondary)),
        var(--color-surface-secondary)
      );
    box-shadow:
      0 var(--space-1) var(--space-3) color-mix(in srgb, var(--color-text) 6%, transparent);
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
    color: color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 60%, var(--color-text-muted));
  }

  .thumb-type-chip,
  .thumb-duration {
    position: absolute;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2-5);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text);
    background: color-mix(in srgb, var(--color-surface) 86%, transparent);
    backdrop-filter: blur(var(--blur-2xl, 24px));
    -webkit-backdrop-filter: blur(var(--blur-2xl, 24px));
    border-radius: var(--radius-full, 9999px);
    border: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-border) 60%, transparent);
  }

  .thumb-type-chip {
    top: var(--space-3);
    left: var(--space-3);
  }

  .thumb-duration {
    bottom: var(--space-3);
    right: var(--space-3);
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    text-transform: none;
    letter-spacing: normal;
  }

  /* ── Body ───────────────────────────────────────────────── */
  .slab-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .slab-header {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .slab-ordinal {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    line-height: var(--leading-none);
    padding-right: var(--space-3);
    border-right: var(--border-width) var(--border-style) var(--color-border);
  }

  .slab-eyebrow {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-brand-primary, var(--color-interactive));
  }

  .slab-status-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-0-5) var(--space-2);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    border-radius: var(--radius-full, 9999px);
    border: var(--border-width) var(--border-style) var(--color-border);
    background: var(--color-surface-secondary);
    color: var(--color-text-secondary);
  }

  .slab-status-dot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full, 9999px);
    background-color: currentColor;
    color: var(--color-text-inverse, var(--color-surface));
  }

  .slab-status-pill[data-status='ready'] {
    color: var(--color-success-700);
    background: var(--color-success-50);
    border-color: color-mix(in srgb, var(--color-success) 30%, transparent);
  }

  .slab-status-pill[data-status='transcoding'] {
    color: var(--color-warning-700);
    background: var(--color-warning-50);
    border-color: color-mix(in srgb, var(--color-warning) 30%, transparent);
  }

  .slab-status-pill[data-status='failed'] {
    color: var(--color-error-700);
    background: var(--color-error-50);
    border-color: color-mix(in srgb, var(--color-error) 30%, transparent);
  }

  /* ── Title + strap ──────────────────────────────────────── */
  .slab-title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: clamp(var(--text-xl), 1.6vw + 1rem, var(--text-3xl));
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    line-height: var(--leading-tight);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .slab-strap {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Meta row ───────────────────────────────────────────── */
  .slab-meta {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(6rem, 1fr));
    gap: var(--space-4);
    padding: var(--space-3) 0;
    border-top: var(--border-width) var(--border-style) var(--color-border);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .meta-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
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
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  /* ── Actions ────────────────────────────────────────────── */
  .slab-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: calc(var(--space-8) + var(--space-1));
    padding: 0 var(--space-4);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    border-radius: var(--radius-full, 9999px);
    border: var(--border-width) var(--border-style) transparent;
    cursor: pointer;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out);
  }

  .action-btn--primary {
    background: var(--color-interactive);
    color: var(--color-text-on-brand, var(--color-background));
    border-color: var(--color-interactive);
  }

  .action-btn--primary:hover {
    background: var(--color-interactive-hover);
    border-color: var(--color-interactive-hover);
  }

  .action-btn--muted {
    background: transparent;
    color: var(--color-text-secondary);
    border-color: var(--color-border);
  }

  .action-btn--muted:hover {
    background: var(--color-error-50);
    color: var(--color-error-700);
    border-color: color-mix(in srgb, var(--color-error) 30%, transparent);
  }

  .action-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }
</style>

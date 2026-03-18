<!--
  @component MediaCard

  Displays a single media item as a card with thumbnail, metadata, and status badge.
  Supports edit and delete actions.

  @prop {MediaItemWithRelations} media - The media item to display
  @prop {(id: string) => void} [onEdit] - Callback when edit is triggered
  @prop {(id: string) => void} [onDelete] - Callback when delete is triggered
-->
<script lang="ts">
  import type { MediaItemWithRelations } from '$lib/types';
  import { Badge } from '$lib/components/ui/Badge';
  import * as m from '$paraglide/messages';

  interface Props {
    media: MediaItemWithRelations;
    onEdit?: (id: string) => void;
    onDelete?: (id: string) => void;
  }

  const { media, onEdit, onDelete }: Props = $props();

  /**
   * Map media status to badge variant
   */
  const statusVariant = $derived.by(() => {
    switch (media.status) {
      case 'uploading':
      case 'uploaded':
        return 'warning' as const;
      case 'transcoding':
        return 'neutral' as const;
      case 'ready':
        return 'success' as const;
      case 'failed':
        return 'error' as const;
      default:
        return 'neutral' as const;
    }
  });

  /**
   * Get the i18n label for a media status
   */
  const statusLabel = $derived.by(() => {
    switch (media.status) {
      case 'uploading':
        return m.media_status_uploading();
      case 'uploaded':
        return m.media_status_uploaded();
      case 'transcoding':
        return m.media_status_processing();
      case 'ready':
        return m.media_status_ready();
      case 'failed':
        return m.media_status_failed();
      default:
        return media.status;
    }
  });

  /**
   * Format file size to human-readable string
   */
  function formatFileSize(bytes: number | null): string {
    if (!bytes) return '--';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  /**
   * Format date to locale string
   */
  function formatDate(date: string | Date | null): string {
    if (!date) return '--';
    return new Date(date).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  const isVideo = $derived(media.mediaType === 'video');
</script>

<article class="media-card">
  <div class="media-thumbnail">
    {#if isVideo}
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
    {:else}
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 18V5l12-2v13"></path>
        <circle cx="6" cy="18" r="3"></circle>
        <circle cx="18" cy="16" r="3"></circle>
      </svg>
    {/if}
  </div>

  <div class="media-info">
    <div class="media-header">
      <h3 class="media-title">{media.title}</h3>
      <Badge variant={statusVariant}>{statusLabel}</Badge>
    </div>

    <div class="media-meta">
      <span class="media-type">
        {isVideo ? m.media_type_video() : m.media_type_audio()}
      </span>
      <span class="meta-separator" aria-hidden="true">·</span>
      <span>{formatFileSize(media.fileSizeBytes)}</span>
      <span class="meta-separator" aria-hidden="true">·</span>
      <span>{formatDate(media.createdAt)}</span>
    </div>
  </div>

  <div class="media-actions">
    {#if onEdit}
      <button
        class="action-btn"
        aria-label={m.media_edit_title()}
        onclick={() => onEdit(media.id)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
      </button>
    {/if}
    {#if onDelete}
      <button
        class="action-btn action-btn--danger"
        aria-label={m.media_delete_title()}
        onclick={() => onDelete(media.id)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    {/if}
  </div>
</article>

<style>
  .media-card {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    transition: var(--transition-colors);
  }

  .media-card:hover {
    border-color: var(--color-border-hover, var(--color-primary-200));
  }

  .media-thumbnail {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    min-width: 64px;
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
  }

  .media-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .media-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .media-title {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .media-meta {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    flex-wrap: wrap;
  }

  .meta-separator {
    color: var(--color-text-muted);
  }

  .media-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    background: none;
    color: var(--color-text-secondary);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .action-btn:hover {
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .action-btn--danger:hover {
    background-color: var(--color-error-50);
    color: var(--color-error-700);
  }

  /* Dark mode */
  [data-theme='dark'] .media-card {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
  }

  [data-theme='dark'] .media-card:hover {
    border-color: var(--color-primary-400);
  }

  [data-theme='dark'] .media-thumbnail {
    background-color: var(--color-surface-variant);
    color: var(--color-text-muted-dark);
  }

  [data-theme='dark'] .media-title {
    color: var(--color-text-dark);
  }

  [data-theme='dark'] .media-meta {
    color: var(--color-text-secondary-dark);
  }

  [data-theme='dark'] .action-btn {
    color: var(--color-text-secondary-dark);
  }

  [data-theme='dark'] .action-btn:hover {
    background-color: var(--color-surface-variant);
    color: var(--color-text-dark);
  }
</style>

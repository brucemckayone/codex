<!--
  @component MediaSection

  Media picker with selected media preview card.
  Only shown for video/audio content types.

  @prop {any} form - The active form instance
  @prop {MediaItemOption[]} mediaItems - Available media items
  @prop {string | null} orgSlug - Org slug for media library link (null for personal content)
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import MediaPicker from '../MediaPicker.svelte';
  import { Badge } from '$lib/components/ui';
  import { VideoIcon, MusicIcon } from '$lib/components/ui/Icon';

  interface MediaItemOption {
    id: string;
    title: string;
    mediaType: string;
    durationSeconds?: number | null;
    fileSizeBytes?: number | null;
    status?: string;
    thumbnailKey?: string | null;
  }

  interface Props {
    form: any;
    mediaItems: MediaItemOption[];
    orgSlug: string | null;
  }

  const { form, mediaItems, orgSlug }: Props = $props();

  let selectedMediaId = $state<string | null>(form.fields.mediaItemId?.value() ?? null);

  const selectedMedia = $derived(
    selectedMediaId ? mediaItems.find((m) => m.id === selectedMediaId) : null
  );

  function handleMediaChange(id: string | null) {
    selectedMediaId = id;
    form.fields.mediaItemId.set(id ?? '');
  }

  function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
</script>

<section class="form-card">
  <h3 class="card-title">{m.studio_content_form_section_media()}</h3>
  <p class="card-description">{m.studio_content_form_section_media_desc()}</p>

  <div class="form-fields">
    <div class="form-field">
      <MediaPicker
        {mediaItems}
        value={selectedMediaId}
        onchange={handleMediaChange}
        name="mediaItemId"
        showLibraryLink={!!orgSlug}
      />
      {#each form.fields.mediaItemId.issues() as issue}
        <p class="field-error">{issue.message}</p>
      {/each}
    </div>

    <!-- Selected media preview -->
    {#if selectedMedia}
      <div class="media-preview">
        <div class="media-preview-icon">
          {#if selectedMedia.mediaType === 'video'}
            <VideoIcon size={32} />
          {:else}
            <MusicIcon size={32} />
          {/if}
        </div>
        <div class="media-preview-info">
          <span class="media-preview-title">{selectedMedia.title}</span>
          <div class="media-preview-meta">
            <Badge>{selectedMedia.mediaType}</Badge>
            {#if selectedMedia.durationSeconds}
              <span class="meta-item">{formatDuration(selectedMedia.durationSeconds)}</span>
            {/if}
            {#if selectedMedia.fileSizeBytes}
              <span class="meta-item">{formatFileSize(selectedMedia.fileSizeBytes)}</span>
            {/if}
            {#if selectedMedia.status && selectedMedia.status !== 'ready'}
              <Badge>Processing</Badge>
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>
</section>

<style>
  .form-card {
    padding: var(--space-6);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .card-title {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0 0 var(--space-4) 0;
  }

  .card-description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: calc(-1 * var(--space-2)) 0 var(--space-4) 0;
  }

  .form-fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-error {
    font-size: var(--text-xs);
    color: var(--color-error-600);
    margin: 0;
  }

  .media-preview {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary, var(--color-surface));
  }

  .media-preview-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-12);
    height: var(--space-12);
    border-radius: var(--radius-md);
    background-color: var(--color-interactive-subtle);
    color: var(--color-interactive-hover);
    flex-shrink: 0;
  }

  .media-preview-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .media-preview-title {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .media-preview-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .meta-item {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  :global([data-theme='dark']) .form-card {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .media-preview {
    background-color: var(--color-background-dark);
    border-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .media-preview-icon {
    background-color: color-mix(in srgb, var(--color-interactive) 15%, var(--color-surface-dark));
    color: var(--color-interactive);
  }
</style>

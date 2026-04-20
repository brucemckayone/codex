<!--
  @component MediaSection

  Media picker with selected media preview. When a ready media item is
  selected AND we have a published content context, renders the
  VideoPlayer / AudioPlayer inline so the creator can sanity-check the
  actual file before publishing. Otherwise falls back to a metadata-only
  preview card.

  Streaming-URL caveat: @codex/access' `getStreamingUrl` only resolves for
  **published** content — it treats drafts as NotFound. That means the
  full inline player is available in edit mode once the content has been
  published at least once. For unpublished / new-mode content we intentionally
  fall back to the metadata card rather than bolting on a creator-preview
  endpoint in this iteration. See follow-up note in the iter-11 report.

  @prop {ContentForm} form - The active form instance
  @prop {MediaItemOption[]} mediaItems - Available media items
  @prop {string | null} orgSlug - Org slug for media library link (null for personal content)
  @prop {string | null} [contentId] - Content UUID (edit mode only)
  @prop {string | null} [contentStatus] - Content status — preview is only available when 'published'
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import MediaPicker from '../MediaPicker.svelte';
  import { Badge } from '$lib/components/ui';
  import { VideoIcon, MusicIcon } from '$lib/components/ui/Icon';
  import { formatDuration, formatFileSize } from '$lib/utils/format';
  import { getStreamingUrl } from '$lib/remote/library.remote';
  import { VideoPlayer } from '$lib/components/VideoPlayer';
  import { AudioPlayer } from '$lib/components/AudioPlayer';
  import type { createContentForm, updateContentForm } from '$lib/remote/content.remote';

  type ContentForm = typeof createContentForm | typeof updateContentForm;

  interface MediaItemOption {
    id: string;
    title: string;
    mediaType: string;
    durationSeconds?: number | null;
    fileSizeBytes?: number | null;
    status?: string;
    thumbnailKey?: string | null;
    thumbnailUrl?: string | null;
  }

  interface Props {
    form: ContentForm;
    mediaItems: MediaItemOption[];
    orgSlug: string | null;
    contentId?: string | null;
    contentStatus?: string | null;
    class?: string;
  }

  const {
    form,
    mediaItems,
    orgSlug,
    contentId = null,
    contentStatus = null,
    class: className = '',
  }: Props = $props();

  const selectedMediaId = $derived<string | null>(form.fields.mediaItemId?.value() ?? null);

  const selectedMedia = $derived(
    selectedMediaId ? mediaItems.find((m) => m.id === selectedMediaId) : null
  );

  const mediaItemIssues = $derived(form.fields.mediaItemId.issues() ?? []);
  const mediaItemErrorText = $derived(
    mediaItemIssues.map((issue) => issue.message).join(' '),
  );

  const canPreview = $derived(
    !!contentId &&
    contentStatus === 'published' &&
    !!selectedMedia &&
    selectedMedia.status === 'ready'
  );

  const streamQuery = $derived(canPreview && contentId ? getStreamingUrl(contentId) : null);

  function handleMediaChange(id: string | null) {
    form.fields.mediaItemId.set(id ?? '');
  }
</script>

<section class="form-card {className}">
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
      {#if mediaItemIssues.length > 0}
        <p class="field-error">{mediaItemErrorText}</p>
      {/if}
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
              <Badge variant="warning">Processing</Badge>
            {/if}
          </div>
        </div>
      </div>

      <!-- Inline player: only available once content is published.
           Wrapped in an aria-live="polite" region so state transitions
           (loading → error / ready) are announced to screen-reader users
           without the assertiveness of role="alert". -->
      {#if canPreview && streamQuery}
        <div
          class="media-player-wrap"
          data-media-type={selectedMedia.mediaType}
          aria-live="polite"
          aria-busy={streamQuery.loading}
        >
          {#if streamQuery.loading}
            <div class="player-skeleton" role="status" aria-label="Loading preview">
              <span class="sr-only">Loading preview</span>
            </div>
          {:else if streamQuery.error || !streamQuery.current}
            <p class="player-note" role="status">Preview unavailable. Try reloading.</p>
          {:else if selectedMedia.mediaType === 'video' && contentId}
            <VideoPlayer
              src={streamQuery.current.streamingUrl}
              contentId={contentId}
              contentTitle={selectedMedia.title}
              poster={selectedMedia.thumbnailUrl ?? undefined}
              expiresAt={streamQuery.current.expiresAt ?? null}
            />
          {:else if selectedMedia.mediaType === 'audio' && contentId}
            <AudioPlayer
              src={streamQuery.current.streamingUrl}
              contentId={contentId}
              title={selectedMedia.title}
              poster={selectedMedia.thumbnailUrl ?? null}
              waveformUrl={streamQuery.current.waveformUrl ?? null}
              expiresAt={streamQuery.current.expiresAt ?? null}
            />
          {/if}
        </div>
      {:else if selectedMedia && contentStatus && contentStatus !== 'published'}
        <p class="player-note">
          Inline playback becomes available after this content is published.
        </p>
      {/if}
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

  /* Dark-mode dim of the interactive colour for the icon chip. The 15% mix is
     intentionally inline: this pattern only appears once in this file and a
     bespoke --color-interactive-hover-surface token is not justified until we
     see the same tint ≥3 times in the repo. */
  :global([data-theme='dark']) .media-preview-icon {
    background-color: color-mix(in srgb, var(--color-interactive) 15%, var(--color-surface));
    color: var(--color-interactive);
  }

  /* ── Inline player ───────────────────────────────────────────────
     Wrap lets VideoPlayer / AudioPlayer slot in without fighting for
     layout. Width is the form-card's content width; each player
     controls its own aspect ratio internally. */
  .media-player-wrap {
    width: 100%;
    border-radius: var(--radius-md);
    overflow: hidden;
    background-color: var(--color-surface-secondary, var(--color-surface));
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .media-player-wrap[data-media-type='video'] {
    /* Keep a 16:9 placeholder height until the player paints; avoids CLS. */
    aspect-ratio: 16 / 9;
  }

  .player-skeleton {
    width: 100%;
    height: 100%;
    /* --space-24 = 96px * density; largest defined spacing token. Audio-player
       stand-in height — previously referenced --space-32, which is not defined
       in tokens/spacing.css (would resolve to `initial` = no min-height). */
    min-height: var(--space-24);
    background: linear-gradient(
      90deg,
      var(--color-surface-secondary) 25%,
      var(--color-surface-tertiary, var(--color-surface)) 50%,
      var(--color-surface-secondary) 75%
    );
    background-size: 200% 100%;
    animation: media-preview-shimmer 1.5s infinite linear;
  }

  @keyframes media-preview-shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .player-skeleton {
      animation: none;
      background: var(--color-surface-secondary);
    }
  }

  .player-note {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    background: var(--color-surface-secondary, var(--color-surface));
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>

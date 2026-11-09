<!--
  @component MediaSection

  The content's media, chosen with the shared `MediaPickerDialog`
  (Codex-a6ofh.1.8). The chosen item is read BY ID, so a saved item past the
  library's first page is never shown as empty, and a draft may hold an item
  still processing: publishing waits for it. Live content may not: the
  service refuses a non-ready item for it, so its picker offers ready only. When the content is published
  and its media ready, the VideoPlayer / AudioPlayer play it inline so the
  creator can sanity-check the actual file.

  Streaming-URL caveat: @codex/access' `getStreamingUrl` only resolves for
  **published** content — it treats drafts as NotFound — so the inline player
  appears once the content has been published at least once.

  @prop {ContentForm} form - The active form instance
  @prop {'video' | 'audio'} mediaType - The content's type: what the picker offers
  @prop {boolean} [live] - Published, or ever released: the picker offers ready media only
  @prop {string | null} [contentId] - Content UUID (edit mode only)
  @prop {string | null} [contentStatus] - Content status — preview is only available when 'published'
  @prop {object | null} [deletedMedia] - The picked media, when it was deleted from the library: the section says "media missing"
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import MediaPickerDialog from '../media-library/MediaPickerDialog.svelte';
  import DeletedVideoNotice from './DeletedVideoNotice.svelte';
  import { getStreamingUrl } from '$lib/remote/library.remote';
  import { getMediaItem } from '$lib/remote/media.remote';
  import { VideoPlayer } from '$lib/components/VideoPlayer';
  import { AudioPlayer } from '$lib/components/AudioPlayer';
  import type { createContentForm, updateContentForm } from '$lib/remote/content.remote';

  type ContentForm = typeof createContentForm | typeof updateContentForm;

  interface Props {
    form: ContentForm;
    /** The content's type: the picker offers only this. */
    mediaType: 'video' | 'audio';
    /**
     * Live, or ever released: its media must be ready (the service refuses a
     * processing item), so the picker offers ready only and no upload.
     */
    live?: boolean;
    contentId?: string | null;
    contentStatus?: string | null;
    /**
     * The saved media item, when it was deleted from the library and is still
     * the one picked (Codex-6sbn1). The draft keeps its link, so a support
     * restore heals it; until then the section says so instead of showing an
     * empty picker with no reason.
     */
    deletedMedia?: { title: string; deletedAt: string | Date } | null;
    class?: string;
  }

  const {
    form,
    mediaType,
    live = false,
    contentId = null,
    contentStatus = null,
    deletedMedia = null,
    class: className = '',
  }: Props = $props();

  // The form holds '' for no media.
  const selectedMediaId = $derived<string | null>(form.fields.mediaItemId?.value() || null);

  /** The chosen item, read by id: the same query the picker's field reads. */
  const selectedMedia = $derived(selectedMediaId ? (getMediaItem(selectedMediaId).current ?? null) : null);

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
    {#if deletedMedia}
      <DeletedVideoNotice
        title={m.studio_content_form_media_deleted_title()}
        body={m.studio_content_form_media_deleted_body()}
        video={deletedMedia}
      />
    {/if}

    <div class="form-field">
      <MediaPickerDialog
        value={selectedMediaId}
        onchange={handleMediaChange}
        mediaTypes={[mediaType]}
        allowProcessing={!live}
        name="mediaItemId"
        ariaLabel={m.studio_content_form_section_media()}
      />
      {#if mediaItemIssues.length > 0}
        <p class="field-error">{mediaItemErrorText}</p>
      {/if}
    </div>

    <!-- The picker's field shows the chosen item; this plays it. -->
    {#if selectedMedia}
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
    /* Audio-player stand-in height: 96px * density. */
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

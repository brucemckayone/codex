<!--
  @component FirstPieceEmpty

  The content list with nothing in it and nothing narrowing it
  (Codex-a6ofh.3.6, mockup L3 "First piece, with uploads waiting", owner
  2026-11-13). When the creator has uploads no piece uses yet, up to three of
  them, each starting a piece with its file, and the media library's unused
  ones for the rest. Media is personal (decision 1A), so both studios offer
  the same uploads.

  The uploads are a nudge, never the state: read once, on mount, and a read
  that fails or finds none leaves the plain first-piece words (a failure is
  logged, never shown).

  @prop studio  Which studio's list, for the failure log
-->
<script lang="ts">
  import { MEDIA_STATUS } from '@codex/constants';
  import { EmptyState, FallbackImage } from '$lib/components/ui';
  import { FileIcon, FilmIcon, MusicIcon } from '$lib/components/ui/Icon';
  import { listMedia } from '$lib/remote/media.remote';
  import { getThumbnailSrcset } from '$lib/utils/image';
  import * as m from '$paraglide/messages';
  import ActionLink from '../ActionLink.svelte';
  import { newContentHref as newPieceHref } from '../editor/editor-url';
  import { newContentHref } from '../media-library/library-url';
  import { logReadFailure } from '../media-library/log-read-failure';

  interface Props {
    studio: 'org' | 'personal';
  }

  const { studio }: Props = $props();

  /** The most it offers; the media library lists the rest. */
  const OFFERED = 3;
  const UNUSED_LIBRARY_HREF = '/studio/media?usage=unused';
  const TILE_SIZES = '(max-width: 39.9375rem) 30vw, 9rem';

  // Ready ones: a piece can start from one now. Newest first, as the library.
  const uploadsQuery = listMedia({
    page: 1,
    limit: OFFERED,
    usage: 'unused',
    status: MEDIA_STATUS.READY,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });
  const uploads = $derived(uploadsQuery.current?.items ?? []);
  const unusedTotal = $derived(uploadsQuery.current?.pagination.total ?? 0);

  $effect(() => {
    if (uploadsQuery.error != null) {
      logReadFailure('studio_content.first_piece_uploads_unread', uploadsQuery.error, {
        studio,
      });
    }
  });
</script>

<EmptyState
  title={m.studio_content_empty_title()}
  description={uploads.length > 0
    ? unusedTotal === 1
      ? m.studio_content_first_uploads_one()
      : m.studio_content_first_uploads({ count: unusedTotal })
    : m.studio_content_empty_how()}
  icon={FileIcon}
>
  {#snippet action()}
    {#if uploads.length > 0}
      <ul class="first-uploads">
        {#each uploads as media (media.id)}
          <!-- Media is video or audio; the list types it a string, as the drawer reads it. -->
          {@const kind = media.mediaType === 'audio' ? 'audio' : 'video'}
          {@const Icon = kind === 'audio' ? MusicIcon : FilmIcon}
          <li>
            <a
              class="first-upload"
              href={newContentHref({ id: media.id, mediaType: kind })}
              aria-label={m.studio_content_first_from_this({ title: media.title })}
            >
              <span class="first-upload-thumb" aria-hidden="true">
                <FallbackImage
                  src={media.thumbnailUrl}
                  srcset={getThumbnailSrcset(media.thumbnailUrl) || undefined}
                  sizes={TILE_SIZES}
                  alt=""
                  loading="lazy"
                >
                  {#snippet fallback()}
                    <Icon size={20} />
                  {/snippet}
                </FallbackImage>
              </span>
              <span class="first-upload-title">{media.title}</span>
            </a>
          </li>
        {/each}
      </ul>
      <div class="first-actions">
        <ActionLink href={UNUSED_LIBRARY_HREF}>{m.studio_content_first_from_upload()}</ActionLink>
        <ActionLink href={newPieceHref('written')} variant="secondary">
          {m.studio_content_first_write_article()}
        </ActionLink>
      </div>
    {:else}
      <ActionLink href="/studio/content/new">{m.studio_content_create()}</ActionLink>
    {/if}
  {/snippet}
</EmptyState>

<style>
  /* A third of the measure each, centred: one or two uploads sit in the
     middle, as the words above them do. */
  .first-uploads {
    display: flex;
    justify-content: center;
    gap: var(--space-2);
    width: min(100%, var(--measure-narrow));
    margin: 0 auto var(--space-3);
    padding: 0;
    list-style: none;
  }

  .first-uploads > li {
    flex: 0 1 calc((100% - 2 * var(--space-2)) / 3);
    min-width: 0;
  }

  .first-upload {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    text-decoration: none;
    border-radius: var(--radius-sm);
  }

  .first-upload:hover .first-upload-title {
    color: var(--color-text);
    text-decoration: underline;
  }

  .first-upload:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .first-upload-thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-surface-secondary);
    color: var(--color-text-muted);
  }

  .first-upload-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .first-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2);
  }
</style>

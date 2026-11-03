<!--
  @component DeletedVideoNotice

  The warning a content editor section shows while it still holds a video
  that was deleted from the library: the alert, then a card naming the video
  and when it went. The Media section's for a deleted video (Codex-6sbn1),
  and the Thumbnail section's for a frame of one (Codex-tqvmx), so the two
  read alike.

  @prop {string} title - The alert's bold first sentence
  @prop {string} body - What to do about it
  @prop {{ title: string; deletedAt: string | Date }} video - The deleted video
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { Alert } from '$lib/components/ui';
  import { UnlinkIcon } from '$lib/components/ui/Icon';
  import { formatSentenceDate } from '$lib/utils/format';

  interface Props {
    title: string;
    body: string;
    video: { title: string; deletedAt: string | Date };
  }

  const { title, body, video }: Props = $props();
</script>

<Alert variant="warning">
  <p class="missing-alert">
    <UnlinkIcon size={16} />
    <span>
      <b>{title}</b>
      {body}
    </span>
  </p>
</Alert>
<div class="missing-card">
  <span class="missing-card__thumb" aria-hidden="true"><UnlinkIcon size={16} /></span>
  <span class="missing-card__text">
    <span class="missing-card__title">{video.title}</span>
    <span class="missing-card__meta">
      {m.studio_content_form_media_deleted_on({
        date: formatSentenceDate(video.deletedAt),
      })}
    </span>
  </span>
</div>

<style>
  .missing-alert {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0;
    line-height: var(--leading-normal);
  }

  .missing-alert > :global(svg) {
    flex-shrink: 0;
    margin-top: var(--space-0-5);
  }

  .missing-alert b {
    font-weight: var(--font-semibold);
  }

  .missing-card {
    display: grid;
    grid-template-columns: var(--space-16) minmax(0, 1fr);
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-2);
    border: var(--border-width) dashed var(--color-status-warning-border);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-status-warning-surface) 55%, var(--color-surface));
  }

  .missing-card__thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-sm);
    color: var(--color-status-warning-text);
    background: repeating-linear-gradient(
      135deg,
      var(--color-surface-secondary) 0 var(--space-1-5),
      var(--color-surface) var(--space-1-5) var(--space-3)
    );
  }

  .missing-card__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .missing-card__title {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--color-text) 40%, transparent);
    overflow-wrap: anywhere;
  }

  .missing-card__meta {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-status-warning-text);
  }
</style>

<!--
  @component ContentPreview

  The creator's own piece as visitors will see it (Codex-a6ofh.2.11, mockup
  w4's "Preview as a visitor"), a draft too: the public page reads published
  pieces only, so the studio shows it. Owner decisions (2026-11-08): it sits
  inside the studio, with a thin bar above the visitor page that says it is
  a preview and goes back to editing; and it shows the piece as someone who
  can watch it, the whole piece, never the locked page.

  The visitor page is the public one's own (ContentDetailView) in its
  preview mode: no reading progress, nothing for search engines, and the
  creator's own player (MediaPreviewPlayer: a 15-minute token minted on
  Play), never the content players or the public stream. Each visit reads
  the piece afresh, so it shows what the editor last saved (the editor saves
  before it lets the creator leave).

  @prop {string} contentId - The piece
  @prop {string} titleSuffix - After the title in the tab: the org, or the studio
  @prop {string} authorName - The author's name, when the read names none
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import { page } from '$app/state';
  import { ContentDetailView } from '$lib/components/content';
  import { EyeIcon } from '$lib/components/ui/Icon';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import { getContentPreview } from '$lib/remote/content.remote';
  import { readFreshQuery } from '$lib/remote/query-result';
  import { getDisplayThumbnail } from '$lib/utils/thumbnail';
  import * as m from '$paraglide/messages';
  import MediaPreviewPlayer from '../media-library/MediaPreviewPlayer.svelte';
  import { logReadFailure } from '../media-library/log-read-failure';
  import { tileReason } from '../media-library/tile-copy';
  import { describeTile } from '../media-library/tile-state';
  import { CANVAS_POSTER_SIZES, TYPE_WORD } from './canvas-text';
  import EditorBarLink from './EditorBarLink.svelte';
  import { editHref, publishStepHref, readEditorStep } from './editor-url';
  import PieceReadProblem, { readProblem } from './PieceReadProblem.svelte';

  interface Props {
    contentId: string;
    titleSuffix: string;
    authorName: string;
  }

  const { contentId, titleSuffix, authorName }: Props = $props();

  /** Bumped by Try again on a piece never read: kit drops a query whose first read failed. */
  let attempt = $state(0);
  const previewQuery = $derived.by(() => {
    void attempt;
    return getContentPreview(contentId);
  });

  /** The query this visit's read answered on: an answer from an earlier visit is never shown. */
  let freshOn = $state.raw<typeof previewQuery | null>(null);
  /** The latest read's failure, and the query it was on. */
  let failure = $state.raw<{ on: typeof previewQuery; error: unknown } | null>(null);
  /** Try again was pressed: if that read fails too, focus goes back to it. */
  let refocusOnFail = false;

  function read(query: typeof previewQuery, run: () => Promise<unknown>) {
    failure = null;
    const fail = (error: unknown) => {
      failure = { on: query, error };
      logReadFailure('studio_content_preview.read_failed', error, { contentId: untrack(() => contentId) });
    };
    run().then(
      () => {
        // Kit answers a superseded read when a later one settles: only the
        // query's own outcome says which this was.
        if (query.error != null) return fail(query.error);
        freshOn = query;
        refocusOnFail = false;
      },
      fail
    );
  }

  // Each query is read fresh once: a held one (an earlier visit's) refreshes.
  $effect(() => {
    const query = previewQuery;
    untrack(() => read(query, () => readFreshQuery(query)));
  });

  const preview = $derived(freshOn === previewQuery ? (previewQuery.current ?? null) : null);
  /** The latest read's problem, if it failed. */
  const problem = $derived(failure?.on === previewQuery ? readProblem(failure.error) : null);

  function tryAgain() {
    refocusOnFail = true;
    const query = previewQuery;
    // Never answered: kit drops such a query, so it is asked for anew and the
    // read above runs on the new one. Still held: read it here.
    if (!query.ready) {
      attempt += 1;
      if (previewQuery !== query) return;
    }
    read(query, () => query.refresh());
  }

  /** On the alert's Try again, as it mounts: a retry that failed again hands focus back to it. */
  const refocusHere: Attachment<HTMLElement> = (node) => {
    if (!refocusOnFail) return;
    refocusOnFail = false;
    const active = document.activeElement;
    if (active === null || active === document.body) node.focus();
  };

  /** Back to the step the preview was opened from. */
  const backHref = $derived(
    readEditorStep(page.url) === 'publish' ? publishStepHref(contentId) : editHref(contentId)
  );
  const signInHref = $derived(`/login?redirect=${encodeURIComponent(page.url.pathname + page.url.search)}`);

  const content = $derived(preview?.content ?? null);
  const live = $derived(content?.status === 'published');
  /** Video and audio play in the creator's own player; an article has none. */
  const mediaType = $derived(
    content?.contentType === 'video' || content?.contentType === 'audio' ? content.contentType : null
  );
  const media = $derived(content?.mediaItem ?? null);
  /**
   * What the player's place says when there is nothing it can play yet: in
   * the library's words for a stopped, waiting or failed file (one rule for
   * every surface, `describeTile`), else that it is still on its way.
   */
  const mediaNote = $derived.by(() => {
    if (!mediaType) return null;
    const type = TYPE_WORD[mediaType]();
    if (!media) return m.studio_preview_media_none({ type });
    if (media.deletedAt) return m.studio_publish_gap_media_deleted({ type });
    const view = describeTile(media, undefined, 0);
    if (view.kind === 'ready') return null;
    return tileReason(view) ?? m.studio_preview_media_preparing({ type });
  });
</script>

{#snippet player()}
  {#if mediaType && media && !mediaNote}
    <MediaPreviewPlayer
      mediaId={media.id}
      {mediaType}
      title={content?.title ?? ''}
      poster={getDisplayThumbnail(content)}
      sizes={CANVAS_POSTER_SIZES}
    />
  {:else}
    <p class="preview-media-note" data-type={mediaType}>{mediaNote}</p>
  {/if}
{/snippet}

<div class="preview-bar" role="region" aria-label={m.studio_preview_region()}>
  <EditorBarLink href={backHref} label={m.studio_preview_back()} />
  <p class="preview-status">
    <EyeIcon size={16} />
    <!-- Whether it is live is the read's to say: until then, only that it is a preview. -->
    <span>{content === null ? m.studio_preview_region() : live ? m.studio_preview_live() : m.studio_preview_draft()}</span>
  </p>
</div>

{#if preview && content}
  {#key content.id}
    <ContentDetailView
      {content}
      contentBodyHtml={preview.contentBodyHtml}
      contentBodyUnavailable={preview.contentBodyUnavailable}
      hasAccess={true}
      streamingUrl={null}
      progress={null}
      isAuthenticated={true}
      formResult={null}
      creatorName={content.creator?.name ?? authorName}
      {titleSuffix}
      preview
      player={mediaType ? player : undefined}
    />
  {/key}
{:else}
  <div class="preview-state">
    {#if problem}
      <PieceReadProblem
        {problem}
        {signInHref}
        ontryagain={tryAgain}
        refocus={refocusHere}
      />
    {:else}
      <!-- The visitor page's shape (its column): the player, the title, the words. -->
      <div class="preview-skeleton" aria-hidden="true">
        <Skeleton width="100%" height="var(--space-32)" />
        <Skeleton width="60%" height="var(--space-10)" />
        <Skeleton width="100%" height="var(--space-24)" />
      </div>
    {/if}
  </div>
{/if}

<svelte:head>
  {#if !preview}
    <title>{m.studio_preview_title_suffix()} | {titleSuffix}</title>
    <meta name="robots" content="noindex" />
  {/if}
</svelte:head>

<style>
  .preview-bar {
    position: sticky;
    inset-block-start: 0;
    z-index: var(--z-sticky);
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border-block-end: var(--border-width) var(--border-style) var(--color-border);
    background: var(--color-surface);
  }

  .preview-status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .preview-media-note {
    display: grid;
    place-items: center;
    margin: 0;
    aspect-ratio: 16 / 9;
    padding: var(--space-6);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-secondary);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-align: center;
  }

  /* Audio's place is a card, not a screen. */
  .preview-media-note[data-type='audio'] {
    aspect-ratio: auto;
  }

  .preview-state {
    inline-size: 100%;
    max-inline-size: var(--container-content);
    margin-inline: auto;
    padding: var(--space-6) var(--space-4);
  }

  .preview-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
</style>

<!--
  @component CoverLine

  The Write canvas's cover (Codex-a6ofh.2.3, mockup W6): an article's image
  in lists, or what an audio piece's listeners see in place of the waveform.
  On the Publish step it is any piece's, a video's too (mockup W4), whose
  card shows the video's own poster until an image is chosen, so removing
  one there reads "Use the video's poster". It needs the row to upload to, so
  until the draft exists it says what to do first. A draft's upload writes
  the row itself. A piece that has been live (`onstaged`) keeps its cover for
  Update (Codex-a6ofh.2.5): its host holds the cover, a new one is readied
  without touching the row, and removing one only clears it there, for
  Update to send.

  @prop {string | null} contentId - The draft's row; null until its first save
  @prop {EditorContentType} contentType - Which copy it says
  @prop {string | null} thumbnailUrl - The saved cover; a staging host's own
  @prop {boolean} [image] - Show the cover here; false where the host shows it (the Publish step's card)
  @prop {(next: string | null) => void} [onstaged] - A piece that has been live: nothing here writes the row, and each cover readied (its URL) or removed (null) goes to the host, which shows it as `thumbnailUrl`
  @prop {string | null | undefined} [changed] - Bindable: a draft's cover set (its URL) or removed (null) here; undefined until then
  @prop {(busy: boolean, failed: boolean) => void} [onbusy] - A cover is being readied, sent or removed, from the moment one is picked; failed once that ended in a problem, said here
-->
<script lang="ts">
  import {
    CONTENT_THUMBNAIL_MAX_BYTES,
    CONTENT_THUMBNAIL_MAX_MB,
    CONTENT_THUMBNAIL_MIME_TYPES,
  } from '@codex/validation';
  import { tick } from 'svelte';
  import { Button } from '$lib/components/ui';
  import { ImageIcon, PlusIcon } from '$lib/components/ui/Icon';
  import { deleteThumbnailCommand, stageThumbnailForm, uploadThumbnailForm } from '$lib/remote/content.remote';
  import { isReadOutage } from '$lib/remote/query-result';
  import { getThumbnailSrcset } from '$lib/utils/image';
  import { shrinkPhotoInput } from '$lib/utils/shrink-photo';
  import { logger } from '$lib/observability';
  import { describeThrown } from '$lib/client-log';
  import * as m from '$paraglide/messages';
  import type { EditorContentType } from './editor-url';

  interface Props {
    contentId: string | null;
    contentType: EditorContentType;
    thumbnailUrl: string | null;
    image?: boolean;
    onstaged?: (next: string | null) => void;
    changed?: string | null | undefined;
    onbusy?: (busy: boolean, failed: boolean) => void;
  }

  let {
    contentId,
    contentType,
    thumbnailUrl,
    image = true,
    onstaged,
    changed = $bindable(undefined),
    onbusy,
  }: Props = $props();

  /** A cover set or removed here: the staging host's to hold, else held here (and by a binding host). */
  function setCover(next: string | null) {
    if (onstaged) onstaged(next);
    else changed = next;
  }

  /** What the upload takes (`uploadThumbnailSchema`). */
  const COVER_TYPES: readonly string[] = CONTENT_THUMBNAIL_MIME_TYPES;

  const ADD = {
    video: m.studio_editor_cover_add_video,
    audio: m.studio_editor_cover_add_audio,
    written: m.studio_editor_cover_add_article,
  };
  const HINT = {
    video: m.studio_editor_cover_hint_video,
    audio: m.studio_editor_cover_hint_audio,
    written: m.studio_editor_cover_hint_article,
  };
  /** A video's card falls back to its poster, so that is what removing one gives. */
  const REMOVE = {
    video: m.studio_editor_cover_use_poster,
    audio: m.studio_editor_cover_remove,
    written: m.studio_editor_cover_remove,
  };

  /** The saved one until a cover is set or removed here. */
  const cover = $derived(changed === undefined ? thumbnailUrl : changed);
  /** A picked photo being made smaller before it goes. */
  let preparing = $state(false);
  let uploading = $state(false);
  let removing = $state(false);
  const busy = $derived(preparing || uploading || removing);
  let problem = $state<string | null>(null);
  $effect(() => onbusy?.(busy, !busy && problem !== null));
  // Gone (a host started its fields again): nothing here is on its way any
  // more, so its host is not left waiting.
  $effect(() => () => onbusy?.(false, false));
  let fileInput = $state<HTMLInputElement | null>(null);
  let coverEl = $state<HTMLElement | null>(null);
  /** Focus was on the cover when the creator started this change. */
  let focusWasHere = false;

  function noteFocus() {
    focusWasHere = coverEl?.contains(document.activeElement) ?? false;
  }

  /**
   * A change disables or swaps the focused button: focus goes to the one
   * there now. Only when it was dropped: a creator who went on writing
   * meanwhile keeps their place (the picker's `handsFocusOn` rule).
   */
  async function keepFocus() {
    if (!focusWasHere) return;
    await tick();
    const active = document.activeElement;
    if (active === null || active === document.body) {
      coverEl?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
  }

  const hintId = $props.id();
  const whyId = `${hintId}-why`;

  /**
   * One upload form per cover line (`.for`), never the module-wide one, whose
   * last result outlives the page. Keyed by this line, not by the piece: kit
   * hands one instance per key, which only one `<form>` may take, and a live
   * piece shows two lines at once (its page and its Settings). A line made
   * again (Discard) gets a form of its own, so no earlier result replays
   * here; each submission is read in its own callback too. A stage answers
   * as an upload does.
   */
  const coverForm = $derived(
    contentId ? (onstaged ? stageThumbnailForm : uploadThumbnailForm).for(`${contentId}:${hintId}`) : null
  );
  const coverAttrs = $derived(
    coverForm?.enhance(async ({ form, submit }) => {
      uploading = true;
      preparing = false;
      problem = null;
      try {
        await submit();
        const result = coverForm.result;
        if (result?.success && result.thumbnailUrl) {
          setCover(result.thumbnailUrl);
        } else {
          // A refusal's reason is written for the creator (the remote sends
          // one only for a 4xx); an outage is logged as one. No result is a
          // submission kit refused.
          const status = result && !result.success ? result.status : undefined;
          // No result: kit refused the submission itself (its schema), a
          // refusal. Otherwise the media surfaces' one rule: a timeout or a
          // rate limit is an outage too.
          const refused = result === undefined || !isReadOutage({ status });
          const fields = { contentId, status, answered: result !== undefined };
          if (refused) logger.warn('studio_editor.cover_upload_refused', fields);
          else logger.error('studio_editor.cover_upload_failed', fields);
          // `||`: an empty reason would drop a held move with nothing said.
          problem = (refused && result && !result.success ? result.error : null) || m.studio_editor_cover_failed();
        }
      } catch (err) {
        logger.error('studio_editor.cover_upload_failed', { contentId, ...describeThrown(err) });
        problem = m.studio_editor_cover_failed();
      } finally {
        uploading = false;
        form.reset();
        void keepFocus();
      }
    })
  );

  async function picked(event: Event & { currentTarget: HTMLInputElement }) {
    const input = event.currentTarget;
    noteFocus();
    preparing = true;
    /** Handed on: `uploading` takes over from `preparing` as kit starts the submission, a tick on. */
    let sent = false;
    try {
      const file = await shrinkPhotoInput(input);
      if (!file) return;
      if (!COVER_TYPES.includes(file.type)) {
        problem = m.studio_editor_cover_type();
        input.value = '';
        return;
      }
      if (file.size > CONTENT_THUMBNAIL_MAX_BYTES) {
        problem = m.studio_editor_cover_too_big({ size: CONTENT_THUMBNAIL_MAX_MB });
        input.value = '';
        return;
      }
      if (!input.form) return;
      sent = true;
      input.form.requestSubmit();
    } finally {
      if (!sent) preparing = false;
    }
  }

  async function removeCover() {
    if (!contentId) return;
    noteFocus();
    if (onstaged) {
      // Update sends it; the saved cover stays until then.
      onstaged(null);
      problem = null;
      void keepFocus();
      return;
    }
    removing = true;
    problem = null;
    try {
      await deleteThumbnailCommand(contentId);
      setCover(null);
    } catch (err) {
      logger.error('studio_editor.cover_remove_failed', { contentId, ...describeThrown(err) });
      problem = m.studio_editor_cover_remove_failed();
    } finally {
      removing = false;
      void keepFocus();
    }
  }
</script>

<div class="cover" bind:this={coverEl}>
  {#if cover}
    {#if image}
      <img
        class="cover-image"
        src={cover}
        srcset={getThumbnailSrcset(cover) || undefined}
        sizes="10rem"
        alt={m.studio_editor_cover_alt()}
      />
    {/if}
    <div class="cover-actions">
      <Button type="button" size="sm" variant="secondary" disabled={busy} onclick={() => fileInput?.click()}>
        {m.studio_editor_cover_change()}
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy} onclick={removeCover}>
        {REMOVE[contentType]()}
      </Button>
    </div>
  {:else}
    <Button
      type="button"
      variant="ghost"
      size="sm"
      class="cover-add"
      disabled={!contentId || busy}
      aria-describedby={contentId ? whyId : `${whyId} ${hintId}`}
      onclick={() => fileInput?.click()}
    >
      {#if contentId}<PlusIcon size={16} />{:else}<ImageIcon size={16} />{/if}
      {ADD[contentType]()}
    </Button>
    <!-- Beside the button, not in it: a long hint wraps under it on a phone. -->
    <span id={whyId} class="cover-hint">{HINT[contentType]()}</span>
    {#if !contentId}
      <span id={hintId} class="cover-hint">{m.studio_editor_cover_needs_draft()}</span>
    {/if}
  {/if}

  <span class="cover-hint" role="status">{uploading ? m.studio_editor_cover_uploading() : ''}</span>
  {#if problem}<p class="cover-problem" role="alert">{problem}</p>{/if}

  {#if coverForm && coverAttrs && contentId}
    <form class="sr-only" {...coverAttrs} enctype="multipart/form-data" aria-hidden="true">
      <input type="hidden" name="contentId" value={contentId} />
      <input
        bind:this={fileInput}
        type="file"
        name="thumbnail"
        tabindex="-1"
        accept={COVER_TYPES.join(',')}
        onchange={picked}
      />
    </form>
  {/if}
</div>

<style>
  .cover {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }

  .cover-image {
    inline-size: var(--space-32);
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: var(--radius-md);
    background: var(--color-surface-secondary);
  }

  .cover-actions {
    display: flex;
    gap: var(--space-2);
  }

  /* Its words in line with the canvas column's, as the fields' are. */
  .cover :global(.cover-add) {
    margin-inline-start: calc(-1 * var(--space-3));
  }

  .cover-hint {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .cover-problem {
    flex-basis: 100%;
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-status-error-text);
  }
</style>

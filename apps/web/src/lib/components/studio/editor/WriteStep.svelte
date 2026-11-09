<!--
  @component WriteStep

  Step 1, Write, for one visit (Codex-a6ofh.2.3): starts the draft session,
  which saves the piece a moment after each change (owner 3A), and lays out
  the bar, the canvas and, on a phone, the button at its foot. Mounted by
  `ContentEditor`, which gives each visit its own.

  Opening it makes no row: the first save does, and the address then becomes
  the piece's edit page, swapped in place (`replaceState`), since a
  navigation would remount the page and drop the session. The swap carries
  the draft's id (`page.state.editorDraftId`), so Back to that entry opens
  the draft (`ContentEditor`).

  @prop {ContentWithRelations | null} content - The saved piece, or null for a new one
  @prop {EditorContentType} contentType - The piece's type
  @prop {string | null} organizationId - The org it is filed in; null in the personal studio
  @prop {string | null} [initialMediaId] - A new piece's media, from "Create content from this"
  @prop {string} authorName - Who it is by, on the meta line
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { beforeNavigate, goto, replaceState } from '$app/navigation';
  import { uploadQueue } from '$lib/client/upload-queue.svelte';
  import { Button } from '$lib/components/ui';
  import { getMediaItem } from '$lib/remote/media.remote';
  import { isReadOutage } from '$lib/remote/query-result';
  import type { ContentWithRelations } from '$lib/types';
  import * as m from '$paraglide/messages';
  import { logReadFailure } from '../media-library/log-read-failure';
  import { savedDraftValues } from './canvas-text';
  import { askToLeaveByConfirm, createDraftSession, type LeaveAnswer, settleWithin } from './draft-session.svelte';
  import {
    CONTENT_LIST_HREF,
    editHref,
    type EditorContentType,
    previewHref,
    publishStepHref,
    readEditorStep,
  } from './editor-url';
  import WentLiveNotice from './WentLiveNotice.svelte';
  import WriteBar from './WriteBar.svelte';
  import WriteCanvas from './WriteCanvas.svelte';

  interface Props {
    content: ContentWithRelations | null;
    contentType: EditorContentType;
    organizationId: string | null;
    initialMediaId?: string | null;
    authorName: string;
  }

  const { content, contentType, organizationId, initialMediaId = null, authorName }: Props = $props();

  // One session per mount (ContentEditor keys it per visit): the props it is
  // started from are this visit's piece.
  const session = untrack(() =>
    createDraftSession({
      saved: content ? { id: content.id, values: savedDraftValues(content) } : null,
      publication: () => ({ status: content?.status ?? 'draft', publishedAt: content?.publishedAt ?? null }),
      contentType,
      organizationId,
      workingTitle,
      onCreated: (id, { editorOpen }) => {
        if (editorOpen) replaceState(editHref(id), { editorDraftId: id });
      },
      askToLeave: (reason) => {
        const answer = askToLeaveByConfirm(reason);
        // The creator's answer stands for a move held here too: Stay drops
        // it, and Leave lets the move the session sends through, never held
        // to be asked about again. Stay holds for the move asked about only,
        // whose guard here runs next when the session asked at once.
        heldMove = null;
        answered = answer;
        if (answer === 'stay') {
          queueMicrotask(() => {
            if (answered === 'stay') answered = null;
          });
        }
        return answer;
      },
    })
  );

  /** The chosen media as read: its title names a new row, its length fills the meta line. */
  const chosenMedia = $derived.by(() => {
    const id = session.values.mediaItemId;
    return id ? (getMediaItem(id).current ?? null) : null;
  });

  /**
   * A new row's name when no title is typed: the media's own. An upload's is
   * its queue row's (the file's name), which is there before the media can
   * be read; a draft made without a title is refused.
   */
  function workingTitle(): string | undefined {
    const id = session.values.mediaItemId;
    return chosenMedia?.title ?? uploadQueue.items.find((row) => row.id !== null && row.id === id)?.title;
  }

  // "Create content from this": the media is the creator's first act, so the
  // draft is made with it, once it is read and so has its name. A link to
  // media gone or not theirs starts a blank piece, as a hand-edited one does.
  // An outage is not a refusal: the media is still chosen, and the slot,
  // which reads it again itself, says so and offers Try again. Offered once
  // per visit, and read untracked (the query's `then` is reactive): a later
  // refresh of that media must never put back what the creator removed.
  let initialOffered = false;
  /** The link's media was gone or not theirs: said above the canvas until something is chosen. */
  let initialRefused = $state(false);
  $effect(() => {
    if (content || !initialMediaId || initialOffered) return;
    initialOffered = true;
    const id = initialMediaId;
    let current = true;
    const attach = () => {
      if (current && session.values.mediaItemId === null) session.set('mediaItemId', id);
    };
    untrack(() =>
      getMediaItem(id).then(attach, (err: unknown) => {
        logReadFailure('studio_editor.initial_media_unread', err, { mediaId: id });
        if (isReadOutage(err)) attach();
        else if (current) initialRefused = true;
      })
    );
    return () => {
      current = false;
    };
  });
  const showRefused = $derived(initialRefused && session.values.mediaItemId === null);

  // A new piece named by its media waits for that name: a first save made
  // before the media was read is refused for want of a title, and goes again
  // once it is there. Once per item, so a save failing for another reason
  // never loops.
  let rearmedFor: string | null = null;
  $effect(() => {
    const media = chosenMedia;
    if (session.contentId !== null || session.status !== 'error' || !media?.title || rearmedFor === media.id) return;
    rearmedFor = media.id;
    untrack(() => session.retry());
  });

  let advancing = $state(false);
  /** A cover is going up, or coming off: Next waits, or step 2 would read the piece without it. */
  let coverBusy = $state(false);
  /**
   * A file in the slot has no media row yet (the queue runs two at a time):
   * Next waits, as only this page would attach its id when it comes.
   */
  let mediaPending = $state(false);
  /** Why Next can't go yet, said to a screen reader at both of its buttons; null when it can. */
  const nextHint = $derived(
    session.contentId === null
      ? m.studio_editor_next_needs_draft()
      : coverBusy
        ? m.studio_editor_next_needs_cover()
        : mediaPending
          ? m.studio_editor_next_needs_upload()
          : null
  );
  const footHintId = $props.id();

  /**
   * Back or Forward into step 2 waits for the same things Next does: step 2
   * reads the piece as it arrives, so a cover saved after that read would be
   * put back by its form, which saves every field, and a file's media would
   * never be attached. The move is held, said in the bar, and sent on once
   * both are done. If either ends without what the move waited for (a cover
   * or an upload that failed, a file cancelled before its row), it is
   * dropped: the creator stays where that is said. Leaving the editor is
   * never held: an upload carries on in the tray. The draft session's own
   * hold, for unsaved words, runs beside this one, and when it asks, the
   * creator's answer decides this one too (`askToLeave`).
   */
  let heldMove = $state.raw<{ url: URL; delta: number | null } | null>(null);
  /** The creator's last answer to the session, until the move it decides comes by. */
  let answered: LeaveAnswer | null = null;
  beforeNavigate((navigation) => {
    if (answered !== null) {
      answered = null;
      return;
    }
    const to = navigation.to?.url;
    const id = session.contentId;
    if (!to || id === null || (!coverBusy && !mediaPending)) return;
    if (to.pathname !== editHref(id) || readEditorStep(to) !== 'publish') return;
    navigation.cancel();
    heldMove = { url: to, delta: navigation.type === 'popstate' ? (navigation.delta ?? null) : null };
  });
  $effect(() => {
    const move = heldMove;
    if (!move || coverBusy || mediaPending) return;
    heldMove = null;
    untrack(() => {
      // A Back or Forward goes on as one; anything else by its address.
      if (move.delta !== null) history.go(move.delta);
      else void goto(move.url.pathname + move.url.search);
    });
  });
  let editorEl = $state<HTMLElement | null>(null);

  /**
   * On to Publish, once what is typed has saved. The canvas is held still
   * meanwhile, so nothing typed misses the move. Step 2 reads the piece again
   * on arriving (each edit route owns that read), so its form never seeds
   * from a read older than these saves. A move inside the app keeps an
   * upload going in the tray. Refused for an emptied title, it goes to the
   * title, which the bar says is needed.
   */
  async function next() {
    const id = session.contentId;
    if (id === null || advancing || nextHint !== null) return;
    advancing = true;
    let refused = false;
    try {
      // Bounded, as a move is: a save with no answer stops Next after 10 s,
      // and the bar still says "Saving…" (it is), so nothing moves.
      const saved = await settleWithin(session.flush());
      if (saved.ok) await goto(publishStepHref(id));
      else refused = saved.code !== 'SAVE_SLOW';
    } finally {
      advancing = false;
    }
    if (!refused) return;
    // Focus goes once the canvas is live again (an inert field takes none):
    // to the title it needs, or to the bar's words saying why it failed.
    await tick();
    const target = session.status === 'error' ? '.write-words' : '.canvas-title';
    editorEl?.querySelector<HTMLElement>(target)?.focus();
  }
</script>

<div class="editor" bind:this={editorEl}>
  <WriteBar
    {session}
    {contentType}
    backHref={CONTENT_LIST_HREF}
    onnext={next}
    {advancing}
    {nextHint}
    holding={heldMove !== null}
    previewHref={session.contentId === null ? null : previewHref(session.contentId)}
  />
  <!-- A cover or file still on its way would miss the hand-off: Open waits for it. -->
  <WentLiveNotice
    {session}
    waitFor={coverBusy ? m.studio_editor_next_needs_cover() : mediaPending ? m.studio_editor_next_needs_upload() : null}
  />
  <!-- Live by another way (owner, 2026-11-09): frozen, so nothing here can
       touch the live piece; the notice is the way on, its changes carried. -->
  <div class="editor-canvas" inert={advancing || session.wentLiveElsewhere}>
    {#if showRefused}
      <p class="editor-note" role="status">{m.media_picker_chosen_gone()}</p>
    {/if}
    <!-- Live by another way (Codex-a6ofh.2): the canvas reads as a live
         piece's, its address locked as the live one keeps it. -->
    <WriteCanvas
      {session}
      {contentType}
      {authorName}
      durationSeconds={chosenMedia?.durationSeconds ?? null}
      live={session.wentLiveElsewhere}
      oncoverbusy={(busy, failed) => {
        coverBusy = busy;
        if (failed) heldMove = null;
      }}
      onmediapending={(pending, failed) => {
        mediaPending = pending;
        if (failed) heldMove = null;
      }}
    />
  </div>
  <!-- Phone (W8a): one button at the foot always says what's next; none once
       it went live by another way (the notice says what is). -->
  {#if !session.wentLiveElsewhere}
    <div class="editor-foot">
      <Button
        type="button"
        disabled={nextHint !== null}
        loading={advancing}
        aria-describedby={nextHint === null ? undefined : footHintId}
        onclick={next}
      >
        {m.studio_editor_next_phone()}
      </Button>
      {#if nextHint !== null}
        <span id={footHintId} class="sr-only">{nextHint}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    min-block-size: 100%;
  }

  /* In the canvas column (WriteCanvas's 960px), over the slot. */
  .editor-note {
    max-inline-size: var(--container-content);
    margin: var(--space-6) auto 0;
    padding-inline: var(--space-4);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .editor-foot {
    display: none;
  }

  @media (--below-md) {
    .editor-foot {
      position: sticky;
      inset-block-end: 0;
      z-index: var(--z-sticky);
      display: flex;
      justify-content: stretch;
      padding: var(--space-3) var(--space-4) calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
      border-block-start: var(--border-width) var(--border-style) var(--color-border);
      background: var(--color-surface);
    }

    .editor-foot > :global(*) {
      flex: 1;
    }
  }
</style>

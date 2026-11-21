<!--
  @component LiveEditor

  Editing a piece that has been live (Codex-a6ofh.2.5, mockup W5): the two
  steps become two tabs, Page (the Write canvas) and Settings (the Publish
  step's sections, and what only a live piece has), since there is no "next"
  any more. One draft session sits above both, so a tab switch keeps every
  change. That includes an unpublished piece: its buyers keep it (owner,
  2026-11-05).

  Its changes wait for Update (owner 3A): nothing half-finished goes out.
  Discard puts them all back. Leaving with changes not live yet asks Update,
  Discard or Stay, in the editor's own dialog (`LeaveDialog`). A cover is
  staged and goes with Update; only media ready to play is offered; the link
  is locked, and changes only from Settings, with a warning.

  The tab is in the address (`?tab=settings`), swapped in place, so a reload
  opens where the creator was. Mounted by `ContentEditor`, once per visit.

  A piece leaving (Codex-a6ofh.6, mockup LN4): the bar says when it goes,
  with Keep it, and its edits still go with Update. A Delete of a piece
  people own leaves the editor where it is, on it leaving; Keep it, from the
  bar or Settings, puts it back off sale. A leave only the org's delete
  holds offers Delete it too instead, from the bar or Settings: the
  creator's delete beside the org's, its owners not emailed again; then
  Keep it withdraws only theirs (owner 2026-11-20). The Delete dialog and
  the publish toggle are this editor's, so the bar and Settings share them.

  @prop {ContentWithRelations} content - The piece, read on arriving
  @prop {EditorContentType} contentType - The piece's type
  @prop {string | null} organizationId - The org it is filed in; null in the personal studio
  @prop {string | null} orgSlug - The org's slug, for its address
  @prop {string | null} [creatorUsername] - A personal piece's address
  @prop {string} authorName - Who it is by
  @prop {LiveTab} [tab] - The tab the address asks for
-->
<script lang="ts">
  import { CONTENT_STATUS, ERROR_CODES } from '@codex/constants';
  import { untrack } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import * as Tabs from '$lib/components/ui/Tabs';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import { describeThrown } from '$lib/client-log';
  import { logger } from '$lib/observability';
  import { remoteErrorMessage } from '$lib/page-builder/builder-save';
  import { deleteContent, keepContent, readLeaveState } from '$lib/remote/content.remote';
  import { getMediaItem } from '$lib/remote/media.remote';
  import {
    isReadOutage,
    queryErrorMessage,
    remoteErrorCode,
    remoteErrorStatus,
  } from '$lib/remote/query-result';
  import type { ContentDeleteOutcome, ContentWithRelations } from '$lib/types';
  import { formatSentenceDate } from '$lib/utils/format';
  import * as m from '$paraglide/messages';
  import DeleteContentDialog, { type DeleteTarget } from '../content-list/DeleteContentDialog.svelte';
  import { deletedWords } from '../content-list/delete-words';
  import {
    canKeep,
    downloadLockedWords,
    keepRefusalWords,
    type Leave,
    leaveOf,
    tooSoonWords,
  } from '../content-list/leaving-words';
  import { logReadFailure } from '../media-library/log-read-failure';
  import { togglePublishStatus } from '../publish-toggle';
  import { savedDraftValues } from './canvas-text';
  import { createDraftSession, type LeaveAnswer, type LeaveReason } from './draft-session.svelte';
  import {
    CONTENT_LIST_HREF,
    type EditorContentType,
    LIVE_TAB_PARAM,
    type LiveTab,
  } from './editor-url';
  import LeaveDialog from './LeaveDialog.svelte';
  import LiveBar from './LiveBar.svelte';
  import LiveSettings from './LiveSettings.svelte';
  import { takeLiveHandoff } from './live-handoff';
  import WriteCanvas from './WriteCanvas.svelte';

  interface Props {
    content: ContentWithRelations;
    contentType: EditorContentType;
    organizationId: string | null;
    orgSlug: string | null;
    creatorUsername?: string | null;
    authorName: string;
    tab?: LiveTab;
  }

  const {
    content,
    contentType,
    organizationId,
    orgSlug,
    creatorUsername = null,
    authorName,
    tab: initialTab = 'page',
  }: Props = $props();

  /** On sale now, until Unpublish here (and back with Publish again). */
  let published = $state(untrack(() => content.status === 'published'));

  // ── Its leave (Codex-a6ofh.6) ──────────────────────────────────────────
  /** As read, then as a Delete or a Keep here leaves it; null when it isn't leaving. */
  let leavesOn = $state<Leave | null>(untrack(() => leaveOf(content)));
  /** Bumped by every change of the leave here, so a read sent before one is dropped. */
  let leaveChanges = 0;
  function setLeave(next: Leave | null) {
    leavesOn = next;
    leaveChanges += 1;
  }
  /**
   * How many people own it: the read's, then a delete's own count. Null when
   * the read did not say (a content-api older than this editor): not known,
   * never "nobody", so the Delete dialog says what a delete does either way.
   */
  let owners = $state<number | null>(untrack(() => content.holderCount ?? null));
  let keeping = $state(false);

  /**
   * Keep it: the creator's delete withdrawn, the piece off sale. When an org
   * admin deleted it too, it still leaves, now on the org's delete alone (a
   * note and Delete it too again), and a Keep refused as not theirs says so.
   */
  async function keep() {
    const leave = leavesOn;
    if (keeping || leave === null) return;
    keeping = true;
    try {
      const outcome = await keepContent(content.id);
      if (outcome.stillLeavingBy === 'org') {
        setLeave({ ...leave, heldBy: 'org' });
        toast.success(
          m.studio_leaving_kept_here_org_stands({ date: formatSentenceDate(leave.leavesAt) })
        );
      } else {
        setLeave(null);
        toast.success(m.studio_leaving_kept_here());
      }
    } catch (err) {
      logReadFailure('studio_live.keep_failed', err, { contentId: content.id });
      toast.error(keepRefused(err, leave));
    } finally {
      keeping = false;
    }
  }

  /**
   * A refused Keep in words, the leave set as the refusal says it stands: an
   * org admin's (403), a lapsed sign-in, the piece already gone (the day-30
   * delete or a takedown finished while this tab was open: no Keep is left),
   * or the refusal's own words, as the content list's Keep says them. An
   * outage names the piece.
   */
  function keepRefused(err: unknown, leave: Leave): string {
    const notYours = keepRefusalWords(err, content.title);
    if (notYours) {
      setLeave({ ...leave, heldBy: 'org' });
      return notYours;
    }
    if (remoteErrorStatus(err) === 401) return m.studio_content_draft_signed_out();
    if (remoteErrorCode(err) === ERROR_CODES.CONTENT_NOT_FOUND) {
      setLeave(null);
      return m.studio_leaving_keep_gone({ title: content.title });
    }
    return (
      (isReadOutage(err) ? null : remoteErrorMessage(err)) ??
      m.studio_leaving_keep_failed({ title: content.title })
    );
  }

  // ── Unpublish, or publish again ────────────────────────────────────────
  let toggling = $state(false);
  /** The toggle says how it went (a toast either way); a failure leaves it as it was. */
  async function togglePublished(): Promise<void> {
    toggling = true;
    try {
      const next = await togglePublishStatus(content.id, published ? 'published' : 'draft');
      published = next === 'published';
    } catch (err) {
      // Said in the toggle's own toast, which keeps a refusal's words; the
      // toggle logs nothing, so it is logged here, by the studio's one rule.
      logReadFailure('studio_live.publish_toggle_failed', err, { contentId: content.id, published });
    } finally {
      toggling = false;
    }
  }

  // ── Delete (Codex-a6ofh.6, mockup LN1) ─────────────────────────────────
  let confirmingDelete = $state(false);
  let deleting = $state(false);
  /** Why the dialog's last Delete was refused (too soon), said in it. */
  let deleteRefusal = $state<string | null>(null);
  /**
   * The piece as the dialog weighs it: on sale as this visit has it, owned
   * by `owners` (not known: absent). A leave only the org's delete holds is
   * Delete it too.
   */
  const deleteTarget = $derived.by((): DeleteTarget | null => {
    if (!confirmingDelete) return null;
    const piece = {
      ...content,
      status: published ? CONTENT_STATUS.PUBLISHED : CONTENT_STATUS.DRAFT,
      holderCount: owners ?? undefined,
      ownersCanDownload: savedDownload,
    };
    return leavesOn && !canKeep(leavesOn)
      ? { mode: 'too', piece, leavesAt: leavesOn.leavesAt }
      : { mode: 'one', piece };
  });
  /** Said in the dialog while the switch's change is unsaved and someone may own it. */
  const deleteNote = $derived.by(() =>
    deleteTarget?.mode === 'one' && downloadUnsaved && owners !== 0
      ? m.studio_leaving_delete_download_unsaved()
      : null
  );

  function closeDelete() {
    confirmingDelete = false;
    deleteRefusal = null;
  }

  /** Unpublish instead (LN1): its owners keep it for good. */
  async function unpublishInstead() {
    closeDelete();
    await togglePublished();
  }

  async function deletePiece() {
    deleting = true;
    deleteRefusal = null;
    let outcome: ContentDeleteOutcome | null = null;
    try {
      outcome = await deleteContent(content.id);
    } catch (err) {
      // Gone already (deleted in another tab): what this delete was for. By
      // the piece's own code: any other 404 (a route, a stale build) is not.
      if (remoteErrorCode(err) === ERROR_CODES.CONTENT_NOT_FOUND) {
        logger.warn('studio_live.delete_already_gone', { contentId: content.id });
      } else {
        logReadFailure('studio_live.delete_failed', err, { contentId: content.id });
        // Too soon after its last notice: said in the dialog, which stays.
        deleteRefusal = tooSoonWords(err);
        if (deleteRefusal === null) {
          const status = remoteErrorStatus(err);
          // A lapsed sign-in says what to do, as Update's does; a refusal (a
          // rule) keeps its words. Any 404 but the piece's own is the
          // platform's, not the creator's to read.
          const refused = status !== undefined && status >= 400 && status < 500 && status !== 404;
          toast.error(
            status === 401
              ? m.studio_content_draft_signed_out()
              : (refused && queryErrorMessage(err)) || m.studio_content_form_delete_error()
          );
        }
        deleting = false;
        return;
      }
    }
    if (outcome?.outcome === 'leaving') {
      // Its owners keep it until then: the editor stays, on it leaving (LN4),
      // held by the sides the delete answered with.
      toast.success(deletedWords(content.title, outcome));
      closeDelete();
      deleting = false;
      setLeave(leaveOf(outcome));
      owners = outcome.holders;
      published = false;
      // The switch holds as they were told until a Keep: a change not sent
      // can't go now, so it goes back to what is saved.
      if (downloadUnsaved) session.set('ownersCanDownload', savedDownload);
      return;
    }
    // Nothing is left to update: the move away neither asks nor waits.
    toast.success(m.studio_content_form_delete_success());
    await session
      .leave(CONTENT_LIST_HREF)
      .catch((err) => logger.warn('studio_live.leave_after_delete_failed', describeThrown(err)));
    deleting = false;
  }

  /**
   * Its leave, read fresh: an Update refused as leaving says it started
   * elsewhere (an org admin, another tab), so the bar, the lock and Keep (or
   * not) follow what is read. A Keep or a delete here while the read is out
   * is newer: the read is dropped. Answers the leave as it then stands, or
   * undefined when the read failed (logged), which is not "not leaving".
   */
  async function readSides(): Promise<Leave | null | undefined> {
    const asked = leaveChanges;
    try {
      const read = leaveOf(await readLeaveState(content.id));
      if (leaveChanges === asked) setLeave(read);
    } catch (err) {
      logReadFailure('studio_live.leave_sides_read_failed', err, { contentId: content.id });
      return undefined;
    }
    return leavesOn;
  }

  /**
   * An Update refused because it started leaving elsewhere while the switch
   * was changed here (owner 2026-11-21): its leave is read, so the bar, the
   * lock and Keep show. Leaving, the switch goes back to what its owners were
   * told, and the bar's refusal goes with it ("Keep it first" is no way out
   * of a leave only the org's delete holds); the words follow whose it is:
   * only the creator's own waits for their Keep. Unread, the screen can't
   * say: a reload can. Not leaving after all (kept meanwhile), the change
   * stays, for the next Update.
   */
  async function downloadRefused() {
    const leave = await readSides();
    if (leave === null) {
      toast.error(m.studio_content_draft_save_failed());
      return;
    }
    session.set('ownersCanDownload', savedDownload);
    session.dismissRefusal();
    toast.error(
      leave === undefined
        ? m.studio_editor_failed()
        : leave.heldBy === 'creator'
          ? m.studio_leaving_download_refused()
          : downloadLockedWords(leave.heldBy)
    );
  }

  // ── Leaving ────────────────────────────────────────────────────────────
  /** The question the session is asking; null when none is. */
  let asked = $state<LeaveReason | null>(null);
  /** Answers the question once: a close after an answer (the dialog's own) changes nothing. */
  let answer: ((given: LeaveAnswer) => void) | null = null;
  function askToLeave(reason: LeaveReason): Promise<LeaveAnswer> {
    // A second move while one is asked about (Back, behind the dialog):
    // the first stays put, and the newer one is asked.
    answer?.('stay');
    asked = reason;
    return new Promise((resolve) => {
      answer = (given) => {
        answer = null;
        asked = null;
        resolve(given);
      };
    });
  }

  /**
   * Changes carried from writing: the piece went live under its draft's
   * editor, and "Open it to update" brought them here (Codex-a6ofh.2). They
   * start as changes waiting for Update. Taken once, as this visit mounts;
   * ones that came too late are said instead (`live-handoff`).
   */
  const handoff = untrack(() => takeLiveHandoff(content.id));
  const carried = handoff && 'changes' in handoff ? handoff.changes : null;
  const carriedLost = handoff !== null && 'expired' in handoff;
  /**
   * What the line under the bar says. Its words come once it is mounted (a
   * status region put in with its words is not read out). It says the
   * carried changes until an Update lands or Discard ends them, and that they
   * came too late until an Update lands (from then on the screen is not the
   * piece as it was live); never about edits made here after. An Update out
   * ends nothing: refused, its changes still wait.
   */
  let carriedSaid = $state<'waiting' | 'lost' | null>(null);
  let carriedEnded = false;
  $effect(() => {
    if (carriedEnded || session.status === 'saving') return;
    if (carriedLost) {
      if (session.lastSavedAt === null) {
        carriedSaid = 'lost';
        return;
      }
    } else if (!carried) {
      return;
    } else if (session.isDirty) {
      carriedSaid = 'waiting';
      return;
    }
    // Updated, discarded, or nothing carried differed from what is live.
    carriedSaid = null;
    carriedEnded = true;
  });
  const carriedWords = $derived(
    carriedSaid === 'lost'
      ? m.studio_live_carried_lost()
      : carriedSaid === 'waiting'
        ? published
          ? m.studio_live_carried()
          : m.studio_live_carried_off_sale()
        : ''
  );

  // One session per mount (ContentEditor keys it per visit): the props it is
  // started from are this visit's read. Mounted only for a piece that has
  // been live, so it reads as one throughout: an older row with no publish
  // stamp would read as a never-live draft once unpublished, and autosave.
  const session = untrack(() =>
    createDraftSession({
      saved: { id: content.id, values: savedDraftValues(content) },
      carried,
      publication: () => ({
        status: published ? 'published' : 'draft',
        publishedAt: content.publishedAt ?? content.createdAt,
      }),
      contentType,
      organizationId,
      askToLeave,
      holdWhile: () => waiting,
    })
  );

  /**
   * Whether its owners can download it, as saved: what a delete tells them.
   * The switch's unsaved change goes only with Update (the review's M2).
   */
  const savedDownload = $derived(session.savedValues.ownersCanDownload);
  const downloadUnsaved = $derived(session.changedKeys.includes('ownersCanDownload'));

  // ── The tabs ───────────────────────────────────────────────────────────
  let tab = $state<string>(untrack(() => initialTab));
  /** Settings mounts the first time it opens, and stays, so its reads wait for that. */
  let settingsOpened = $state(untrack(() => initialTab === 'settings'));
  function switchTab(next: string | undefined) {
    if (next === undefined) return;
    tab = next;
    if (next === 'settings') settingsOpened = true;
    // In place: a navigation would remount the editor and drop the session.
    const url = new URL(page.url);
    const wanted = next === 'settings' ? 'settings' : null;
    if (url.searchParams.get(LIVE_TAB_PARAM) === wanted) return;
    if (wanted) url.searchParams.set(LIVE_TAB_PARAM, wanted);
    else url.searchParams.delete(LIVE_TAB_PARAM);
    replaceState(url, page.state);
  }

  /** Bumped by Discard: both tabs start again from the session's values, the body's editor too. */
  let discards = $state(0);
  function discard() {
    if (waiting) return;
    session.discard();
    discards += 1;
  }

  // ── Update ─────────────────────────────────────────────────────────────
  /** A cover is being readied on the page, or on Settings: each says its own. */
  let pageCoverBusy = $state(false);
  let settingsCoverBusy = $state(false);
  let mediaPending = $state(false);
  let categoryBusy = $state(false);
  let slugInvalid = $state(false);
  /**
   * What is on its way (a cover, an upload or a category), said as why
   * Update waits; null when nothing is. Discard waits for it too, or it
   * would land after and put back a change just discarded.
   */
  const waitingFor = $derived(
    pageCoverBusy || settingsCoverBusy
      ? m.studio_editor_next_needs_cover()
      : mediaPending
        ? m.studio_editor_next_needs_upload()
        : categoryBusy
          ? m.studio_publish_wait_category()
          : null
  );
  const waiting = $derived(waitingFor !== null);
  /** Why Update can't go yet: it would send without what is on its way, or a link that isn't one. */
  const updateHint = $derived(waitingFor ?? (slugInvalid ? m.studio_publish_gap_slug() : null));

  let updating = $state(false);
  async function update() {
    if (updating || updateHint !== null) return;
    updating = true;
    try {
      const result = await session.flush();
      // A refusal is the bar's to say: its words stay until fixed or discarded.
      if (result.ok) toast.success(published ? m.studio_live_updated() : m.studio_live_updated_unpublished());
      // It started leaving elsewhere (another tab, an org admin).
      else if (result.code === ERROR_CODES.CONTENT_LEAVING && downloadUnsaved) {
        void downloadRefused();
      }
    } finally {
      updating = false;
    }
  }

  /** The chosen media as read: its length fills the canvas's meta line. */
  const chosenMedia = $derived.by(() => {
    const id = session.values.mediaItemId;
    return id ? (getMediaItem(id).current ?? null) : null;
  });
</script>

<div class="editor">
  <Tabs.Root bind:value={() => tab, switchTab} defaultValue={initialTab}>
    <LiveBar
      {session}
      {published}
      onupdate={update}
      ondiscard={discard}
      {updating}
      {updateHint}
      {waiting}
      {leavesOn}
      owners={owners ?? 0}
      ownersCanDownload={savedDownload}
      {keeping}
      onkeep={keep}
      ondeletetoo={() => (confirmingDelete = true)}
      {deleting}
    />
    <!-- Said while the carried changes still wait: Update or Discard ends it. -->
    <p class="live-carried" role="status" data-type={contentType}>{carriedWords}</p>
    <div class="editor-body" inert={updating}>
      <Tabs.Content value="page">
        {#key discards}
          <WriteCanvas
            {session}
            {contentType}
            {authorName}
            durationSeconds={chosenMedia?.durationSeconds ?? null}
            live
            oncoverbusy={(busy, failed) => {
              pageCoverBusy = busy;
              if (failed) session.stay();
            }}
            onmediapending={(pending) => (mediaPending = pending)}
          />
        {/key}
      </Tabs.Content>
      <Tabs.Content value="settings">
        {#if settingsOpened}
          {#key discards}
            <LiveSettings
              {session}
              {content}
              {contentType}
              {organizationId}
              {orgSlug}
              {creatorUsername}
              {authorName}
              {published}
              {toggling}
              ontoggle={togglePublished}
              {leavesOn}
              {keeping}
              onkeep={keep}
              {deleting}
              ondelete={() => (confirmingDelete = true)}
              oncoverbusy={(busy, failed) => {
                settingsCoverBusy = busy;
                if (failed) session.stay();
              }}
              oncategorybusy={(busy) => (categoryBusy = busy)}
              onslugcheck={(invalid) => (slugInvalid = invalid)}
            />
          {/key}
        {/if}
      </Tabs.Content>
    </div>
  </Tabs.Root>
</div>

<LeaveDialog reason={asked} changes={session.changeCount} onanswer={(given) => answer?.(given)} />

<DeleteContentDialog
  target={deleteTarget}
  busy={deleting || toggling}
  refusal={deleteRefusal}
  note={deleteNote}
  onDelete={deletePiece}
  onUnpublish={unpublishInstead}
  onClose={closeDelete}
/>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    min-block-size: 100%;
  }

  /* No box of its own: the tabs' panels lay out as the editor's children. */
  .editor-body {
    display: contents;
  }

  /* On the canvas's column (WriteCanvas `.canvas`), so it starts where the page does. */
  .live-carried {
    inline-size: 100%;
    max-inline-size: var(--container-content);
    margin: var(--space-3) auto 0;
    padding-inline: var(--space-4);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .live-carried[data-type='written'] {
    max-inline-size: var(--container-article);
  }

  /* Empty, out of the flow but still in the tree, so its words are heard when they come. */
  .live-carried:empty {
    position: absolute;
    margin: 0;
    padding: 0;
  }
</style>

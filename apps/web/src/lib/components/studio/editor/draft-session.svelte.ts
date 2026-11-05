/**
 * One content editing session (Codex-a6ofh.2.2): the fields the editor
 * changes, saved by {@link createAutosave} a moment after the creator stops
 * typing (owner 3A). A piece that has been live never autosaves: its changes
 * wait for Update, which calls {@link DraftSession.flush}. That includes an
 * unpublished piece, which its buyers still hold (owner, 2026-11-05; see
 * `hasBeenLive` in @codex/constants).
 *
 * NEW PIECES. Opening the editor makes no row. The first save creates it
 * (owner 4A): "Video" then leaving leaves nothing behind. A draft needs a
 * title, so when the first thing added is a file or a sentence, the row is
 * made with a working title the creator can change (owner, 2026-11-05): the
 * media's own title from `workingTitle`, or the first words written.
 *
 * WHAT IS SENT. Only the fields that differ from `baseline`, which is what the
 * server holds: the values last SENT, not the ones on screen. A creator who
 * types while a save is out keeps those words unsaved, and the save the
 * controller queues behind it sends exactly them. There is no `updatedAt`
 * race guard (data-design 3.2): a draft has one author, and the last write
 * wins. A saved piece whose title field is emptied keeps its saved title
 * until a new one is typed (`needsTitle`): a draft's other fields still save,
 * while Update sends nothing until the title is back.
 *
 * LEAVING. A move inside the app waits for the save instead of asking, as the
 * page builder's does; if the save fails, the creator is asked. A piece that
 * has been live asks before its changes are dropped. Closing the tab asks
 * while anything is unsaved, which for a draft is the moment between a
 * keystroke and its save landing (the mockup's "no leave warning while
 * drafting, because nothing can be lost"). Closing the editor in place saves what is
 * left, and says so if that fails.
 *
 * Call it during a component's initialisation: it registers a navigation
 * guard and its own teardown.
 */

import { hasBeenLive, type PublicationState } from '@codex/constants';
import { type CreateContentInput, extractPlainText } from '@codex/validation';
import { untrack } from 'svelte';
import { beforeNavigate, goto } from '$app/navigation';
import { describeThrown } from '$lib/client-log';
import { toast } from '$lib/components/ui/Toast/toast-store';
import { logger } from '$lib/observability';
import {
  type AutosaveSaveResult,
  type AutosaveStatus,
  createAutosave,
  guardUnload,
} from '$lib/page-builder/autosave.svelte';
import { createContentDraft, saveContent } from '$lib/remote/content.remote';
import {
  queryErrorMessage,
  remoteErrorCode,
  remoteErrorStatus,
} from '$lib/remote/query-result';
import * as m from '$paraglide/messages';

/** The fields a session edits. Each is compared by value, so keep them flat. */
export interface DraftValues {
  title: string;
  description: string | null;
  contentBody: string | null;
  mediaItemId: string | null;
}

export interface DraftSessionOptions {
  /** The saved piece, or null for a new one that its first save creates. */
  saved: { id: string; values: DraftValues } | null;
  /**
   * The piece's status and publishedAt, read each time they matter, so a
   * Publish or Unpublish while the editor is open changes what it does. A
   * new piece is `{ status: 'draft', publishedAt: null }`. Report the piece
   * as published from the moment Publish is sent, and back if it fails, as
   * the page builder's setLive does: a save armed before then is dropped,
   * not sent to a piece going live. Never flip it and close the editor in
   * the same synchronous block: the session goes by what it last saw while
   * mounted.
   */
  publication: () => PublicationState;
  contentType: CreateContentInput['contentType'];
  organizationId: string | null;
  /** A title for a new row when none is typed yet: the chosen media's own. */
  workingTitle?: () => string | null | undefined;
  /**
   * The first save made the row. With the editor open, the page swaps its
   * URL (replaceState). Closed (the last save made it), the page can still
   * list the piece or keep its id, so it is never made twice.
   */
  onCreated?: (id: string, context: { editorOpen: boolean }) => void;
}

export interface DraftSession {
  /** Read here; change through {@link DraftSession.set}, which saves. */
  readonly values: Readonly<DraftValues>;
  /** Null until the first save creates the row. */
  readonly contentId: string | null;
  /** Something a save would send. An emptied title is not (`needsTitle`). */
  readonly isDirty: boolean;
  /** A saved piece's title field is empty: it keeps its saved title. */
  readonly needsTitle: boolean;
  readonly status: AutosaveStatus;
  readonly lastSavedAt: Date | null;
  readonly errorMessage: string | undefined;
  /** A piece that has been live, with changes waiting for Update. */
  readonly hasUnpublishedChanges: boolean;
  set<K extends keyof DraftValues>(key: K, value: DraftValues[K]): void;
  /** Save now: Update, or Publish's save before it publishes. */
  flush(): Promise<AutosaveSaveResult>;
  retry(): void;
}

const EMPTY: DraftValues = {
  title: '',
  description: null,
  contentBody: null,
  mediaItemId: null,
};

/** How long a move waits for a save before asking instead. */
const LEAVE_WAIT_MS = 10_000;

/** A working title taken from an article stops at a word, about this long. */
const WORKING_TITLE_LENGTH = 60;

function firstWords(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= WORKING_TITLE_LENGTH) return flat;
  const cut = flat.lastIndexOf(' ', WORKING_TITLE_LENGTH);
  return flat.slice(0, cut > 0 ? cut : WORKING_TITLE_LENGTH);
}

/** A save that has not settled by then reads as failed: links never go dead. */
function settleWithin(
  save: Promise<AutosaveSaveResult>
): Promise<AutosaveSaveResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<AutosaveSaveResult>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          ok: false,
          code: 'SAVE_SLOW',
          message: m.studio_content_draft_save_failed(),
        }),
      LEAVE_WAIT_MS
    );
  });
  return Promise.race([save, late]).finally(() => clearTimeout(timer));
}

function titleNeeded(): AutosaveSaveResult {
  return {
    ok: false,
    code: 'TITLE_NEEDED',
    message: m.studio_content_draft_title_needed(),
  };
}

export function createDraftSession(options: DraftSessionOptions): DraftSession {
  const { contentType, organizationId } = options;
  /** A throwing page getter reads as live: nothing autosaves, leaving asks. */
  function readLive(): boolean {
    try {
      return hasBeenLive(options.publication());
    } catch (err) {
      logger.error('studio_editor.publication_failed', describeThrown(err));
      return true;
    }
  }
  /** As last seen while mounted. After a move, the page's state is the next route's. */
  let lastLive = readLive();
  const isLive = (): boolean => (unmounted ? lastLive : readLive());
  const initial = options.saved?.values ?? EMPTY;
  const values = $state<DraftValues>({ ...initial });
  let baseline = $state.raw<DraftValues>(initial);
  let contentId = $state<string | null>(options.saved?.id ?? null);
  /** The save that is out, until it settles. */
  let sending = $state.raw<Partial<DraftValues> | null>(null);
  /** That save is an Update (the piece read as live when it went). */
  let sendingUpdate = false;
  /** What the server will hold once the save that is out lands. */
  const landing = (): DraftValues =>
    sending ? { ...baseline, ...sending } : baseline;
  /** Our own goto is under way: the guard lets it through. */
  let leaving = false;
  /** The creator chose to leave unsaved changes behind. */
  let abandoned = false;
  /** Where a move that is waiting for the save goes; a second click moves it. */
  let pendingLeave: URL | null = null;
  let unmounted = false;
  /** Unmounted and its last save done: the controller is disposed. */
  let closed = false;

  const needsTitle = $derived(
    contentId !== null &&
      values.title.trim() === '' &&
      values.title !== landing().title
  );
  /**
   * What is still to send: every field that differs from what the server
   * will hold, but an emptied title. Against `landing()`, so a change put
   * back while a save is out still counts: that save carries the old words.
   */
  const sendableKeys = (): (keyof DraftValues)[] => {
    const held = landing();
    return (Object.keys(values) as (keyof DraftValues)[]).filter(
      (key) => values[key] !== held[key] && !(key === 'title' && needsTitle)
    );
  };
  const isDirty = $derived(sendableKeys().length > 0);
  /** Not yet held by the server: still to send, or sent and not landed. */
  const unsaved = (): boolean => isDirty || sending !== null;

  /** The page's getter, kept apart: its failure is not the save's. */
  function mediaTitle(): string | undefined {
    try {
      return options.workingTitle?.()?.trim() || undefined;
    } catch (err) {
      logger.error('studio_editor.working_title_failed', describeThrown(err));
      return undefined;
    }
  }

  function workingTitle(): string {
    return (
      mediaTitle() ||
      firstWords(extractPlainText(values.contentBody)) ||
      firstWords(extractPlainText(values.description))
    );
  }

  /**
   * Logged, and put into words. A refusal (4xx) keeps the worker's words,
   * except a lapsed sign-in, which says what to do; an outage, a 5xx or
   * anything else reads as the plain sentence, never as "Failed to fetch".
   */
  function failure(err: unknown): AutosaveSaveResult {
    const status = remoteErrorStatus(err);
    const refused = status !== undefined && status >= 400 && status < 500;
    // The creator's own network: theirs to fix, not a platform fault.
    const offline = status === undefined && err instanceof TypeError;
    const context = { contentId, ...describeThrown(err) };
    if (refused) logger.warn('studio_editor.save_refused', context);
    else if (offline) logger.warn('studio_editor.save_offline', context);
    else logger.error('studio_editor.save_failed', context);
    const failed = m.studio_content_draft_save_failed();
    let message = failed;
    if (status === 401) message = m.studio_content_draft_signed_out();
    else if (refused) message = queryErrorMessage(err, failed) ?? failed;
    return { ok: false, message, code: remoteErrorCode(err) };
  }

  /** The page's own step: a failure there is not the save's. */
  function announceCreated(id: string): void {
    try {
      options.onCreated?.(id, { editorOpen: !unmounted });
    } catch (err) {
      logger.error('studio_editor.on_created_failed', {
        contentId: id,
        ...describeThrown(err),
      });
    }
  }

  async function save(): Promise<AutosaveSaveResult> {
    const keys = sendableKeys();
    if (keys.length === 0) return { ok: true };
    // Update puts every field live at once: none goes without its title.
    if (needsTitle && isLive()) return titleNeeded();
    // Taken before the first await: whatever is typed from here on is the
    // next save's.
    const sent: Partial<DraftValues> = Object.fromEntries(
      keys.map((key) => [key, values[key]])
    );
    const title =
      contentId === null ? values.title.trim() || workingTitle() : '';
    if (contentId === null && !title) return titleNeeded();
    let createdId: string | null = null;
    sending = sent;
    sendingUpdate = isLive();
    try {
      if (contentId === null) {
        const created = await createContentDraft({
          contentType,
          organizationId,
          ...sent,
          title,
        });
        createdId = created.id;
        contentId = created.id;
        // The working title shows in the field, unless the creator has
        // started typing one meanwhile, which the next save then sends.
        if (!values.title.trim()) values.title = title;
        baseline = { ...baseline, ...sent, title };
      } else {
        await saveContent({ id: contentId, patch: sent });
        baseline = { ...baseline, ...sent };
      }
    } catch (err) {
      return failure(err);
    } finally {
      sending = null;
    }
    if (createdId !== null) announceCreated(createdId);
    return { ok: true };
  }

  const autosave = createAutosave({
    isDirty: () => isDirty,
    isPublished: isLive,
    save,
  });

  beforeNavigate((navigation) => {
    // Closing the tab is the unload guard's.
    if (leaving || navigation.willUnload) return;
    // Its unsent changes are Update's to keep, so ask before dropping them,
    // as the page builder does (Codex-a6ofh.2.5 brings the editor's own
    // dialog). An Update still on the wire is waited for, like a save.
    if (isLive() && sending === null) {
      if (isDirty && !confirm(m.studio_content_draft_confirm_leave_live())) {
        navigation.cancel();
      }
      return;
    }
    if (!unsaved()) return;
    const target = navigation.to?.url;
    if (!target) return;
    navigation.cancel();
    const waiting = pendingLeave !== null;
    pendingLeave = target;
    if (waiting) return;
    void settleWithin(autosave.flush())
      .then((result) => {
        const to = pendingLeave;
        pendingLeave = null;
        // Closed in place while the save was out: no move to make.
        if (unmounted || !to) return;
        // Saved, but still dirty: the piece went live while the save was out,
        // and what was queued behind it waits for Update.
        // A slow Update is still going, but what was typed during it is not.
        const leftForUpdate =
          (result.ok || result.code === 'SAVE_SLOW') && isDirty && isLive();
        if (!result.ok || leftForUpdate) {
          let ask = m.studio_content_draft_confirm_leave();
          if (leftForUpdate) ask = m.studio_content_draft_confirm_leave_live();
          else if (result.code === 'TITLE_NEEDED') {
            ask = m.studio_content_draft_confirm_leave_untitled();
          } else if (result.code === 'SAVE_SLOW') {
            // Still out, not refused: the bar behind says "Saving…".
            ask = m.studio_content_draft_confirm_leave_slow();
          }
          if (!confirm(ask)) return;
          // A slow save is left running, not given up: its failure is still
          // told, and closing the tab still asks while it is out.
          if (result.code !== 'SAVE_SLOW') abandoned = true;
        }
        leaving = true;
        void goto(to)
          .catch((err) =>
            logger.warn('studio_editor.leave_failed', describeThrown(err))
          )
          .finally(() => {
            // Still mounted: something else stopped the move, so guard again.
            // Checked, not assumed: the teardown reads `abandoned`.
            if (unmounted) return;
            leaving = false;
            abandoned = false;
          });
      })
      .catch((err) => {
        pendingLeave = null;
        logger.error('studio_editor.leave_save_failed', describeThrown(err));
      });
  });
  const stopUnloadGuard = guardUnload(() => unsaved() && !abandoned);

  // Publish failed and the page reports a draft again. What was typed during
  // it waited (a live piece schedules nothing), so schedule it now: on that
  // change only, not on every re-read of the page's state.
  $effect(() => {
    const live = readLive();
    const backToDraft = lastLive && !live;
    lastLive = live;
    if (!backToDraft) return;
    untrack(() => {
      // The save that is out now has a draft's follow-up behind it, so a
      // Publish that rides it has joined.
      if (sending !== null) sendingUpdate = false;
      if (isDirty) autosave.notifyChange();
    });
  });

  /** Set after unmount while a draft's save was out: decided when it settles. */
  const lateKeys = new Set<keyof DraftValues>();

  /** What the last chain left, once it has settled. */
  function reportClose(ok: boolean): void {
    for (const key of sendableKeys()) {
      if (!lateKeys.has(key)) continue;
      logger.error('studio_editor.set_after_close_dropped', { contentId, key });
      // A change the creator never saw, so never theirs to abandon.
      toastClosedUnsaved();
    }
    if (!ok) tellClosedUnsaved();
    else if (isDirty && isLive()) {
      logger.warn('studio_editor.closed_with_unsent_changes', {
        contentId,
        keys: sendableKeys(),
        abandoned,
      });
    }
  }

  let toldClosed = false;
  /** The save bar went with the editor: this stays until read. Once. */
  function toastClosedUnsaved(): void {
    if (toldClosed) return;
    toldClosed = true;
    toast.add(
      { variant: 'error', title: m.studio_content_draft_closed_unsaved() },
      { closeDelay: 0 }
    );
  }
  function tellClosedUnsaved(): void {
    // "Leave anyway" was the creator's own choice.
    if (!abandoned) toastClosedUnsaved();
  }

  /** Every chain still to settle, a joined flush's second one included. */
  async function drain(): Promise<AutosaveSaveResult> {
    let result = await autosave.flush();
    while (result.ok && sending !== null) result = await autosave.flush();
    return result;
  }

  $effect(() => () => {
    unmounted = true;
    // Unmounted, by a move or with the editor closed in place: save what is
    // left (words typed while the next page loaded, or never saved), just
    // after the teardown rather than in it. A teardown in the same batch as
    // the last change reads that change's OLD value (Svelte 5.55; a proxied
    // field reads null), so a save sent from here could carry the words
    // before it. The microtask runs before any timer, so the debounced save
    // cannot slip in first. The unload guard and dispose() wait for the whole
    // chain, so a change queued behind a save already out still goes, and
    // closing the tab meanwhile still asks. After "Leave anyway" it still
    // tries once, quietly: the creator has already been told. A piece that
    // has been live keeps its changes for Update: closing it is the page's to
    // guard.
    queueMicrotask(() => {
      const finish = () => {
        closed = true;
        stopUnloadGuard();
        autosave.dispose();
      };
      try {
        // A piece that has been live starts no save here, but one already
        // on the wire (its Update) is seen through.
        if (!unsaved() || (isLive() && sending === null)) {
          // The page's to guard (Codex-a6ofh.2.5); a trace if it did not.
          if (isDirty) {
            logger.warn('studio_editor.closed_with_unsent_changes', {
              contentId,
              keys: sendableKeys(),
              abandoned,
            });
          }
          finish();
          return;
        }
        void drain()
          .then((result) => reportClose(result.ok))
          .catch((err) => {
            logger.error(
              'studio_editor.close_save_failed',
              describeThrown(err)
            );
            tellClosedUnsaved();
          })
          .finally(finish);
      } catch (err) {
        logger.error('studio_editor.close_save_failed', describeThrown(err));
        tellClosedUnsaved();
        finish();
      }
    });
  });

  return {
    get values() {
      return values;
    },
    get contentId() {
      return contentId;
    },
    get isDirty() {
      return isDirty;
    },
    get needsTitle() {
      return needsTitle;
    },
    get status() {
      return autosave.status;
    },
    get lastSavedAt() {
      return autosave.lastSavedAt;
    },
    get errorMessage() {
      return autosave.errorMessage;
    },
    get hasUnpublishedChanges() {
      return autosave.hasUnpublishedChanges;
    },
    set(key, value) {
      // A page's late callback (an upload finishing) once nothing will save
      // it: the editor has closed and its last save is done, or the piece
      // has been live and only an Update (or nothing) is out. A draft's
      // change while its last save is still out is queued behind it as
      // usual; on a piece gone live with a draft's save out, a Publish may
      // still send it, so that is decided once the save settles.
      if (
        unmounted &&
        !closed &&
        isLive() &&
        sending !== null &&
        !sendingUpdate
      ) {
        values[key] = value;
        lateKeys.add(key);
        return;
      }
      if (closed || (unmounted && isLive())) {
        const fresh = value !== values[key] && value !== landing()[key];
        values[key] = value;
        if (fresh) {
          logger.error('studio_editor.set_after_close_dropped', {
            contentId,
            key,
          });
          // A change the creator never saw, so never theirs to abandon.
          toastClosedUnsaved();
        }
        return;
      }
      values[key] = value;
      autosave.notifyChange();
    },
    async flush() {
      // Joined a draft's autosave already out (Publish after it): its queued
      // follow-up stops once the piece reads as live, so send what that
      // left. An Update, or a second click riding one, sends no more: words
      // typed during it wait for the next Update.
      const joined = sending !== null && !sendingUpdate;
      let result = await autosave.flush();
      // Ride a second send another joined flush has already started, too.
      if (joined && result.ok && (isDirty || sending !== null)) {
        result = await autosave.flush();
      }
      // Publish and Update are told the field is empty; the save itself has
      // kept the saved title and sent the rest.
      return result.ok && needsTitle ? titleNeeded() : result;
    },
    retry: autosave.retry,
  };
}

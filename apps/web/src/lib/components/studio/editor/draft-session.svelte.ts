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
 * THE SLUG. Until the piece goes live, its slug follows its title, as long as
 * it is the title's own (or that one made free by a save, `-2`): the first
 * save makes it from the title, and a slug the creator types stops it. Once
 * live, it never moves under its links (Codex-a6ofh.2.4).
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
  isReadOutage,
  queryErrorMessage,
  remoteErrorCode,
  remoteErrorStatus,
} from '$lib/remote/query-result';
import {
  accessGroupToFlags,
  type ContentAccessKind,
} from '$lib/utils/content-access';
import { contentSlugFromTitle, isTitleSlug } from '$lib/utils/content-slug';
import * as m from '$paraglide/messages';

/**
 * Who can watch, and at what price: one value, sent as one group, as the
 * schema checks the flags together (`accessGroupToFlags`).
 */
export interface DraftAccess {
  kind: ContentAccessKind;
  /** In pence; 0 when not for sale. */
  priceCents: number;
  /**
   * The plans ticked; null when never read (the row did not say), so the
   * set is left out and the server keeps its ticks.
   */
  tierIds: string[] | null;
}

/**
 * The fields a session edits: the Write step's and the Publish step's
 * (Codex-a6ofh.2.4). Each is compared by value, a list or the access group by
 * what it holds, so set a new one rather than changing one in place.
 */
export interface DraftValues {
  title: string;
  description: string | null;
  contentBody: string | null;
  mediaItemId: string | null;
  slug: string;
  categoryIds: string[];
  tags: string[];
  featured: boolean;
  access: DraftAccess;
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

/** What Publish came to. `unsent`: it stopped at its save, and nothing was sent to publish. */
export interface PublishResult extends AutosaveSaveResult {
  unsent?: boolean;
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
  /**
   * Put the piece live (owner, 2026-11-05: the session owns it). It reads as
   * live from this moment, so a save armed before is dropped, never sent to
   * a piece going live; then it saves what is on screen, riding any save
   * already out, and calls `send`. If either fails it is a draft again, and
   * what was typed meanwhile saves as a draft's does. A second call while
   * one runs joins it.
   */
  publish(send: (id: string) => Promise<unknown>): Promise<PublishResult>;
  /**
   * Where a move asked for while Publish was out was going: it waits for the
   * publish, and the caller sends it on (or not) once that settles. Taken
   * once; null when none was asked.
   */
  takeHeldMove(): URL | null;
  /** A move is waiting for Publish (`takeHeldMove`). */
  readonly holdingMove: boolean;
  retry(): void;
}

const EMPTY: DraftValues = {
  title: '',
  description: null,
  contentBody: null,
  mediaItemId: null,
  slug: '',
  categoryIds: [],
  tags: [],
  featured: false,
  access: { kind: 'free', priceCents: 0, tierIds: null },
};

/** Two values of a field are the same: a list or a group by what it holds. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => same(item, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => same(left[key], right[key]))
    );
  }
  return false;
}

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

/**
 * A save that has not settled by then reads as failed: links never go dead,
 * and Next and Publish never wait without an end (Codex-a6ofh.2.4).
 */
export function settleWithin(
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
  /** This session's own Publish is out, or it put the piece live. */
  let publishing = false;
  let wentLive = false;
  const isLive = (): boolean =>
    publishing || wentLive || (unmounted ? lastLive : readLive());
  const initial = options.saved?.values ?? EMPTY;
  // A copy: the baseline must never share a list the screen changes.
  const values = $state<DraftValues>(structuredClone(initial));
  let baseline = $state.raw<DraftValues>(initial);
  let contentId = $state<string | null>(options.saved?.id ?? null);

  /** The slug still follows the title: it is the title's own, and the piece has never been live. */
  let slugFollows =
    !lastLive &&
    (initial.slug === '' ||
      isTitleSlug(initial.slug, initial.title, contentType));
  /**
   * The title changed from `from`: a slug that follows it moves with it. A
   * new piece's waits for its first save, which makes it; a title that gives
   * no slug (an emptied one), or the same one (a capital, a "!"), leaves it
   * where it is, so a slug the server made free is not tried again.
   */
  function followTitle(from: string): void {
    if (!slugFollows || contentId === null || isLive()) return;
    const next = contentSlugFromTitle(values.title, '');
    if (
      next &&
      next !== contentSlugFromTitle(from, '') &&
      !isTitleSlug(values.slug, values.title, contentType)
    ) {
      values.slug = next;
    }
  }
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
  /** Where a move asked for while Publish was out goes, once its caller says. */
  let heldMove = $state.raw<URL | null>(null);
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
      (key) => !same(values[key], held[key]) && !(key === 'title' && needsTitle)
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
  function failure(
    err: unknown,
    action: 'save' | 'publish' = 'save'
  ): AutosaveSaveResult {
    const status = remoteErrorStatus(err);
    const refused = status !== undefined && status >= 400 && status < 500;
    // The creator's own network, when the browser says so: theirs to fix,
    // not a platform fault. Anything else takes the studio's one outage
    // rule, so a timeout or a rate limit alerts as it does elsewhere.
    const offline =
      typeof navigator !== 'undefined' && navigator.onLine === false;
    const context = {
      contentId,
      code: remoteErrorCode(err),
      ...describeThrown(err),
    };
    if (offline) logger.warn(`studio_editor.${action}_offline`, context);
    else if (isReadOutage(err)) {
      logger.error(`studio_editor.${action}_failed`, context);
    } else logger.warn(`studio_editor.${action}_refused`, context);
    const failed =
      action === 'publish'
        ? m.studio_editor_publish_failed()
        : m.studio_content_draft_save_failed();
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

  /** The PATCH a set of changes is: the access group as the flags the API reads. */
  function toPatch({ access, ...rest }: Partial<DraftValues>) {
    if (!access) return rest;
    return { ...rest, ...accessGroupToFlags(access, organizationId) };
  }

  async function save(): Promise<AutosaveSaveResult> {
    const keys = sendableKeys();
    if (keys.length === 0) return { ok: true };
    // Update puts every field live at once: none goes without its title.
    if (needsTitle && isLive()) return titleNeeded();
    // Taken before the first await: whatever is typed from here on is the
    // next save's.
    const sent: Partial<DraftValues> = Object.fromEntries(
      keys.map((key) => [key, $state.snapshot(values[key])])
    );
    const title =
      contentId === null ? values.title.trim() || workingTitle() : '';
    if (contentId === null && !title) return titleNeeded();
    let createdId: string | null = null;
    // Made free if another piece holds it: no one chose it.
    const slugFollowsTitle = sent.slug !== undefined && slugFollows;
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
        baseline = { ...baseline, ...sent, title, slug: created.slug };
        if (values.slug === '') values.slug = created.slug;
        followTitle(title);
      } else {
        const saved = await saveContent({
          id: contentId,
          patch: toPatch(sent),
          ...(slugFollowsTitle && { slugFollowsTitle }),
        });
        // The slug the save made free, in place of the one sent.
        const freed = saved?.slug;
        baseline = { ...baseline, ...sent, ...(freed && { slug: freed }) };
        if (freed && values.slug === sent.slug) values.slug = freed;
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
    // Publish holds the screen still: a move asked meanwhile waits for it,
    // or the next page could read the piece as a draft and autosave into it
    // once it is live. Its caller sends the move on (`takeHeldMove`).
    if (publishRun !== null) {
      navigation.cancel();
      heldMove = navigation.to?.url ?? heldMove;
      return;
    }
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
        // Publish started while this save was out: the move waits for it
        // too, or the next page could read the piece as a draft.
        if (publishRun !== null) {
          heldMove ??= to;
          return;
        }
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
  // Closing the tab while Publish is out asks too: a reload could read the
  // piece as a draft before the publish lands.
  const stopUnloadGuard = guardUnload(
    () => (unsaved() && !abandoned) || publishRun !== null
  );

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

  let publishRun: Promise<PublishResult> | null = null;
  async function runPublish(
    send: (id: string) => Promise<unknown>
  ): Promise<PublishResult> {
    const id = contentId;
    if (id === null) {
      return {
        ok: false,
        message: m.studio_editor_next_needs_draft(),
        unsent: true,
      };
    }
    publishing = true;
    try {
      // What is on screen: the save that is out, then what its follow-up
      // left (that stops once the piece reads as live). Bounded, as a move is.
      let saved = await settleWithin(autosave.flush());
      for (let round = 0; saved.ok && round < 2 && unsaved(); round += 1) {
        saved = await settleWithin(autosave.flush());
      }
      if (saved.ok && needsTitle) saved = titleNeeded();
      if (saved.code === 'SAVE_SLOW') {
        // Still out, not refused: the bar says "Saving…" meanwhile.
        logger.warn('studio_editor.publish_save_slow', { contentId: id });
        return {
          ...saved,
          message: m.studio_editor_publish_save_slow(),
          unsent: true,
        };
      }
      if (!saved.ok) return { ...saved, unsent: true };
      await send(id);
      wentLive = true;
      lastLive = true;
      return { ok: true };
    } catch (err) {
      return failure(err, 'publish');
    } finally {
      publishing = false;
      // A draft again: what was typed meanwhile saves as a draft's does.
      if (!wentLive && isDirty) autosave.notifyChange();
    }
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
        const fresh = !same(value, values[key]) && !same(value, landing()[key]);
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
      const before = values.title;
      values[key] = value;
      if (key === 'slug') slugFollows = false;
      else if (key === 'title') followTitle(before);
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
    publish(send) {
      if (publishRun) return publishRun;
      heldMove = null;
      const run = runPublish(send);
      publishRun = run;
      // Cleared once it settles, never before it is set: a run with no draft
      // settles before its first await.
      void run.finally(() => {
        if (publishRun === run) publishRun = null;
      });
      return run;
    },
    takeHeldMove() {
      const to = heldMove;
      heldMove = null;
      return to;
    },
    get holdingMove() {
      return heldMove !== null;
    },
    retry: autosave.retry,
  };
}

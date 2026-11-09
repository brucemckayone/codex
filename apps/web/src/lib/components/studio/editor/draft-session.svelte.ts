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
 * has been live asks before its changes are dropped: Update them, discard
 * them, or stay. The page may ask in its own dialog (`askToLeave`); the
 * browser's confirm() asks otherwise. Closing the tab asks
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

import {
  CONTENT_STATUS,
  ERROR_CODES,
  hasBeenLive,
  type PublicationState,
} from '@codex/constants';
import { type CreateContentInput, extractPlainText } from '@codex/validation';
import { untrack } from 'svelte';
import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
import { describeThrown } from '$lib/client-log';
import { logReadFailure } from '$lib/components/studio/media-library/log-read-failure';
import { toast } from '$lib/components/ui/Toast/toast-store';
import { logger } from '$lib/observability';
import {
  type AutosaveSaveResult,
  type AutosaveStatus,
  createAutosave,
  guardUnload,
} from '$lib/page-builder/autosave.svelte';
import {
  createContentDraft,
  readPublishState,
  saveContent,
} from '$lib/remote/content.remote';
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
import { editHref, readEditorStep } from './editor-url';
import { handOffToLive, withdrawLiveHandoff } from './live-handoff';
import { type ReadProblem, readProblem } from './read-problem';

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
  /**
   * The cover. A draft's upload writes the row itself, so only a piece that
   * has been live sets it here: a cover staged for Update, or null to remove
   * it (Codex-a6ofh.2.5).
   */
  thumbnailUrl: string | null;
  /** An audio piece's immersive shader; null for the default. */
  shaderPreset: string | null;
}

/**
 * Why leaving asks: a piece that has been live has changes not updated, or a
 * draft's save failed, needs a title, or has not finished.
 */
export type LeaveReason = 'live' | 'failed' | 'untitled' | 'slow';

/** `update`: send the changes first, then go (asked for `live` only). */
export type LeaveAnswer = 'update' | 'leave' | 'stay';

/** The browser's own question for each reason; the editor's dialog asks a draft's in them too. */
export const LEAVE_WORDS: Record<LeaveReason, () => string> = {
  live: m.studio_content_draft_confirm_leave_live,
  failed: m.studio_content_draft_confirm_leave,
  untitled: m.studio_content_draft_confirm_leave_untitled,
  slow: m.studio_content_draft_confirm_leave_slow,
};

/** The browser's confirm(), as a page with no dialog of its own asks. */
export function askToLeaveByConfirm(reason: LeaveReason): LeaveAnswer {
  return confirm(LEAVE_WORDS[reason]()) ? 'leave' : 'stay';
}

export interface DraftSessionOptions {
  /** The saved piece, or null for a new one that its first save creates. */
  saved: { id: string; values: DraftValues } | null;
  /**
   * Changes carried from the piece's draft editor, which it went live under
   * ("Open it to update", Codex-a6ofh.2): on no row yet, so they start
   * unsaved, waiting for Update. A piece that has been live only.
   */
  carried?: Partial<DraftValues> | null;
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
  /**
   * Ask before a move drops what is unsaved. An answer given at once lets a
   * Leave go as it was; a promise holds the move, which goes on (by its
   * address, or as the Back or Forward it was) once answered. Defaults to
   * the browser's confirm(), which never answers `update`.
   */
  askToLeave?: (reason: LeaveReason) => LeaveAnswer | Promise<LeaveAnswer>;
  /**
   * Something the page is still sending that the session would set when it
   * lands (a live piece's staged cover, a category): while true, a move
   * waits for it and then goes on, and closing the tab asks. Read in a
   * reactive scope, so the move goes on as it turns false. If it fails, the
   * page calls {@link DraftSession.stay}: the creator stays where that is
   * said. While it waits the page says so, with Stay and Leave now
   * ({@link DraftSession.leaveNow}).
   */
  holdWhile?: () => boolean;
}

/** What Publish came to. `unsent`: it stopped at its save, and nothing was sent to publish. */
export interface PublishResult extends AutosaveSaveResult {
  unsent?: boolean;
  /**
   * Sent and accepted: whether it went live. A publish when ready whose media
   * is still on its way is accepted as a draft, scheduled (Codex-a6ofh.2.9).
   */
  live?: boolean;
  /** The row the publish answered with, when it was sent and accepted. */
  row?: unknown;
}

/**
 * Whether a publish's answer is the piece live: anything but a draft. An
 * answer with no row reads as live, as every publish did before a schedule
 * could answer a draft.
 */
export function answeredLive(row: unknown): boolean {
  return !(
    typeof row === 'object' &&
    row !== null &&
    'status' in row &&
    row.status === CONTENT_STATUS.DRAFT
  );
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
  /** How many fields a save would send: the live bar's "2 changes not live yet". */
  readonly changeCount: number;
  /**
   * It went live by a way this editor did not see (its schedule fired, an
   * admin, another tab), as a draft's save found (Codex-a6ofh.2). From then
   * on nothing is sent from here: its changes wait, for the live editor
   * ({@link DraftSession.openLive}).
   */
  readonly wentLiveElsewhere: boolean;
  /** The title the server holds: what the piece is called where it is live. */
  readonly savedTitle: string;
  /**
   * Open the piece in the live editor, carrying every change not on its row
   * (but its address: a live piece keeps its own), to wait for Update
   * (owner, 2026-11-09). Only once it {@link DraftSession.wentLiveElsewhere}.
   * It reads where the piece stands first, and moves only once the page
   * reads it live too; if either fails, the creator stays, changes and all,
   * and {@link DraftSession.openLiveProblem} says why.
   */
  openLive(): Promise<void>;
  /**
   * Why the last "Open it to update" could not open it, said by the notice
   * until the next try: signed out, the piece gone, or a failure a try
   * again can help (`readProblem`); null when it did not fail.
   */
  readonly openLiveProblem: ReadProblem | null;
  set<K extends keyof DraftValues>(key: K, value: DraftValues[K]): void;
  /**
   * Put every field back as the server holds it (an Update still on the
   * wire counts as held). A piece that has been live only: a draft's
   * changes are saved as they come.
   */
  discard(): void;
  /**
   * Go, with nothing left to keep (the piece was deleted): every field put
   * back, and the move neither asks nor waits for what is on its way.
   */
  leave(to: string): Promise<void>;
  /** Save now: Update, or Publish's save before it publishes. */
  flush(): Promise<AutosaveSaveResult>;
  /**
   * Put the piece live (owner, 2026-11-05: the session owns it). It reads as
   * live from this moment, so a save armed before is dropped, never sent to
   * a piece going live; then it saves what is on screen, riding any save
   * already out, and calls `send`. If either fails it is a draft again, and
   * what was typed meanwhile saves as a draft's does; so it is too when
   * `send` answers a draft (scheduled, publish when ready: `live` false). A
   * second call while one runs joins it.
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
  /** A move is waiting for what the page is still sending (`holdWhile`). */
  readonly leavingWhenSent: boolean;
  /** That move is dropped: what it waited for failed, or the creator stays. */
  stay(): void;
  /**
   * That move goes now, without what it waited for: past the hold, asking
   * about any other changes as a move does; a value landing once the editor
   * has closed is the creator's to have left.
   */
  leaveNow(): Promise<void>;
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
  thumbnailUrl: null,
  shaderPreset: null,
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
  const ask = options.askToLeave ?? askToLeaveByConfirm;
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
  /**
   * Opened on a piece that has been live: its saves are Updates. A draft's
   * are never, but its own Publish's: a page read that says live is not the
   * creator asking for an Update, so the server judges (the round-3 review).
   */
  const startedLive = lastLive;
  /** This session's own Publish is out, or it put the piece live. */
  let publishing = false;
  let wentLive = false;
  /** A draft's save found it live: see {@link DraftSession.wentLiveElsewhere}. */
  let liveElsewhere = $state(false);
  /** See {@link DraftSession.openLiveProblem}. */
  let openProblem = $state<ReadProblem | null>(null);
  /** Its changes went to the live editor: closing this one drops nothing. */
  let handedOff = false;
  /** The creator answered the live question with Leave: its changes are theirs to have dropped. */
  let leftChanges = false;
  const isLive = (): boolean =>
    publishing ||
    wentLive ||
    liveElsewhere ||
    (unmounted ? lastLive : readLive());
  const initial = options.saved?.values ?? EMPTY;
  // A copy: the baseline must never share a list the screen changes. Changes
  // carried from the draft editor start unsaved, against the row.
  const values = $state<DraftValues>(
    structuredClone({ ...initial, ...options.carried })
  );
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
  /** That save is an Update: the piece opened live, or this editor's own Publish sent it. */
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
  /** A move asked for while the page was still sending something (`holdWhile`). */
  let busyMove = $state.raw<{ to: URL; delta: number | null } | null>(null);
  /**
   * Where the creator is going without what is on its way (Leave now, or
   * the piece deleted); null when they are not. Only a move there passes
   * the hold, the one a question about the other changes sends on too.
   * Every way of staying clears it, and so does nothing being on its way any
   * more, so no later move, nor a later upload, inherits it. A value landing
   * once the editor has closed is theirs to have left, never news.
   */
  let goingWithout: string | null = null;
  const stayAfterAll = (): void => {
    goingWithout = null;
  };
  /** Leave questions asked so far: an answer knows whether a newer one took over. */
  let questions = 0;
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
  /** Read once per change, however many count it (the bar, the dialog, the autosave). */
  const toSend = $derived(sendableKeys());
  const isDirty = $derived(toSend.length > 0);
  /** Not yet held by the server: still to send, or sent and not landed. */
  const unsaved = (): boolean => isDirty || sending !== null;

  /** The page's getter, kept apart: a throw lets moves go, never stops them. */
  function holding(): boolean {
    try {
      return options.holdWhile?.() ?? false;
    } catch (err) {
      logger.error('studio_editor.hold_while_failed', describeThrown(err));
      return false;
    }
  }

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

  /** What a save comes to once it went live elsewhere: nothing sent. */
  const leftForLive = (): AutosaveSaveResult => ({
    ok: false,
    code: ERROR_CODES.CONTENT_ALREADY_LIVE,
    message: m.studio_editor_went_live_elsewhere({
      title: baseline.title.trim(),
    }),
  });

  /**
   * The server refused a draft's save: the piece went live meanwhile, by a
   * way this editor did not see. It reads as live from here, so nothing
   * autosaves, and its address stays the live one the row holds.
   */
  function wentLiveElsewhere(): void {
    liveElsewhere = true;
    slugFollows = false;
    values.slug = baseline.slug;
    logger.warn('studio_editor.went_live_elsewhere', { contentId });
  }

  async function save(): Promise<AutosaveSaveResult> {
    const keys = sendableKeys();
    if (keys.length === 0) return { ok: true };
    // Live by another way: an Update is not this editor's to send, whatever
    // asks (Try again, Next, a move's save). Its changes go to the live one.
    if (liveElsewhere) return leftForLive();
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
    sendingUpdate = startedLive || publishing || wentLive;
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
          // A draft's save says so: refused once it has been live, by
          // whatever way it went (the server is the judge, never a read).
          // Update, and Publish's own save before it publishes, send without
          // it: each is the creator asking for these values to go live, so a
          // piece live already takes them.
          ...(!sendingUpdate && { asDraft: true }),
        });
        // The slug the save made free, in place of the one sent.
        const freed = saved?.slug;
        // The cover the row kept, when not the one sent: a staged cover too
        // old to take (Codex-a6ofh.2.5). Shown as kept, and said, never
        // taken for live.
        const kept =
          saved?.thumbnailUrl !== undefined &&
          saved.thumbnailUrl !== sent.thumbnailUrl
            ? { thumbnailUrl: saved.thumbnailUrl }
            : null;
        baseline = {
          ...baseline,
          ...sent,
          ...(freed && { slug: freed }),
          ...kept,
        };
        if (freed && values.slug === sent.slug) values.slug = freed;
        if (kept) {
          if (values.thumbnailUrl === sent.thumbnailUrl) {
            values.thumbnailUrl = kept.thumbnailUrl;
          }
          logger.warn('studio_editor.cover_not_taken', { contentId });
          toast.warning(m.studio_live_cover_not_taken());
        }
      }
    } catch (err) {
      if (
        !sendingUpdate &&
        remoteErrorCode(err) === ERROR_CODES.CONTENT_ALREADY_LIVE
      ) {
        wentLiveElsewhere();
        return leftForLive();
      }
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
    // Something the page is still sending would land after the editor closed
    // and be lost: the move waits for it, then goes on, asking as any does.
    // Unless the creator has said to go without it.
    const passing =
      goingWithout !== null && navigation.to?.url.href === goingWithout;
    if (!passing && holding()) {
      const to = navigation.to?.url;
      if (!to) return;
      navigation.cancel();
      busyMove = {
        to,
        delta:
          navigation.type === 'popstate' ? (navigation.delta ?? null) : null,
      };
      return;
    }
    // Its unsent changes are Update's to keep, so ask before dropping them:
    // Update them, discard them, or stay (Codex-a6ofh.2.5). Leave at once
    // lets the move go as it was. An Update still on the wire is waited
    // for, like a save.
    if (isLive() && sending === null) {
      const to = navigation.to?.url;
      if (!isDirty || !to) return;
      const asked = ++questions;
      const answer = ask('live');
      // Answered at once (the browser's confirm()): Leave lets it go as it was.
      if (answer === 'leave') {
        leftChanges = true;
        return;
      }
      navigation.cancel();
      if (answer === 'stay') {
        stayAfterAll();
        return;
      }
      const delta =
        navigation.type === 'popstate' ? (navigation.delta ?? null) : null;
      void answerLiveLeave(answer, { to, delta }, asked).catch((err) => {
        if (asked === questions) stayAfterAll();
        logger.error('studio_editor.leave_answer_failed', describeThrown(err));
      });
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
      .then(async (result) => {
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
        // Or the save found it live, here or before: its changes wait too.
        const refusedAsLive =
          !result.ok && result.code === ERROR_CODES.CONTENT_ALREADY_LIVE;
        if (!result.ok || leftForUpdate) {
          let reason: LeaveReason = 'failed';
          if (leftForUpdate || refusedAsLive) reason = 'live';
          else if (result.code === 'TITLE_NEEDED') reason = 'untitled';
          // Still out, not refused: the bar behind says "Saving…".
          else if (result.code === 'SAVE_SLOW') reason = 'slow';
          const asked = ++questions;
          const answer = await ask(reason);
          if (!(await goesOn(answer))) {
            if (asked === questions) stayAfterAll();
            return;
          }
          if (answer === 'leave') {
            // The live dialog's Discard, as when nothing was out.
            if (reason === 'live') discardChanges();
            // A slow save is left running, not given up: its failure is
            // still told, and closing the tab still asks while it is out.
            else if (result.code !== 'SAVE_SLOW') abandoned = true;
          }
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
            stayAfterAll();
          });
      })
      .catch((err) => {
        pendingLeave = null;
        stayAfterAll();
        logger.error('studio_editor.leave_save_failed', describeThrown(err));
      });
  });
  // Closing the tab while Publish is out asks too: a reload could read the
  // piece as a draft before the publish lands. So does closing it while the
  // page is still sending something.
  const stopUnloadGuard = guardUnload(
    () => (unsaved() && !abandoned) || publishRun !== null || holding()
  );

  // A move held for what the page was sending goes on once it has landed. If
  // it failed, the page has dropped the move (`stay`), so this never sends
  // the creator away from where that is said.
  $effect(() => {
    const move = busyMove;
    if (!move || holding()) return;
    busyMove = null;
    untrack(() => {
      void sendOn(move);
    });
  });
  // Nothing left on its way: nothing to go without, so a later upload holds
  // a move again, even one to where Leave now was going.
  $effect(() => {
    if (!holding()) stayAfterAll();
  });
  /** A held move, as it was: a Back or Forward as one, anything else by its address. */
  async function sendOn(move: {
    to: URL;
    delta: number | null;
  }): Promise<void> {
    if (move.delta !== null) {
      history.go(move.delta);
      return;
    }
    await goto(move.to).catch((err) =>
      logger.warn('studio_editor.leave_failed', describeThrown(err))
    );
  }

  /**
   * Whether a held move goes on, as the creator answered. Update goes once
   * it is sent and nothing new was typed meanwhile; a refusal is the bar's
   * to say, and the creator stays.
   */
  async function goesOn(answer: LeaveAnswer): Promise<boolean> {
    if (answer === 'stay' || unmounted) return false;
    if (answer === 'leave') return true;
    const result = await settleWithin(autosave.flush());
    return result.ok && !isDirty && !unmounted;
  }

  /**
   * A move held while a piece that has been live asked, sent on as
   * answered: Update first, or discard (the dialog's word, so the changes
   * go whether or not the move then does). Once nothing is unsent the guard
   * lets it through, so a Back or Forward goes on as one, without a flag
   * that could outlive it. `asked` is the question's number: a Stay given
   * after a newer question was asked is the page closing the old one, not
   * the creator staying, so the move the newer one asks about keeps its pass.
   */
  async function answerLiveLeave(
    answer: LeaveAnswer | Promise<LeaveAnswer>,
    move: { to: URL; delta: number | null },
    asked: number
  ): Promise<void> {
    const given = await answer;
    if (!(await goesOn(given))) {
      if (asked === questions) stayAfterAll();
      return;
    }
    if (given === 'leave') discardChanges();
    await sendOn(move);
  }

  /**
   * Each field back as the server will hold it, a list or a group copied
   * anew. Every one that differs: an emptied title too, which Update never
   * sends.
   */
  function discardChanges(): void {
    const held = landing();
    for (const key of Object.keys(values) as (keyof DraftValues)[]) {
      if (!same(values[key], held[key])) restore(key, held[key]);
    }
  }
  function restore<K extends keyof DraftValues>(
    key: K,
    value: DraftValues[K]
  ): void {
    values[key] = structuredClone(value);
  }

  // Publish failed and the page reports a draft again. What was typed during
  // it waited (a live piece schedules nothing), so schedule it now: on that
  // change only, not on every re-read of the page's state.
  $effect(() => {
    const live = readLive();
    const backToDraft = lastLive && !live;
    const cameLive = !lastLive && live;
    lastLive = live;
    // A draft's own read saw it go live (the schedule's on Publish, the
    // page's on Write) with changes not sent: it went live under the editor,
    // as a refused save would say, so they go to the live editor, never left
    // here with no Update to send them (the round-3 review). Its own Publish
    // is not that, nor is a read made while it was out.
    if (cameLive) {
      untrack(() => {
        if (!publishing && !wentLive && !liveElsewhere && isDirty) {
          wentLiveElsewhere();
        }
      });
      return;
    }
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
      const row = await send(id);
      // Scheduled, it is still a draft: edits go on saving into it.
      if (!answeredLive(row)) return { ok: true, live: false, row };
      wentLive = true;
      lastLive = true;
      return { ok: true, live: true, row };
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
    // A Publish still out sends what is on screen itself, behind the save it
    // joined: wait for it, or the autosave is disposed under its last save
    // (the round-3 review). What it could not send is what is left.
    if (publishRun !== null) {
      const published = await publishRun;
      if (!published.ok && published.unsent && published.code !== 'SAVE_SLOW') {
        return published;
      }
    }
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
          // Changes carried to the live editor were not dropped.
          if (isDirty && !handedOff) {
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
    get changeCount() {
      return toSend.length;
    },
    get wentLiveElsewhere() {
      return liveElsewhere;
    },
    get savedTitle() {
      return baseline.title.trim();
    },
    get openLiveProblem() {
      return openProblem;
    },
    async openLive() {
      if (!liveElsewhere || contentId === null) return;
      const id = contentId;
      openProblem = null;
      leftChanges = false;
      // Where it stands, by a read whose failure is seen. kit's
      // invalidateAll() resolves even when a refresh in it fails (2.55), so
      // it cannot say the piece is live.
      try {
        const state = await readPublishState(id);
        if (!hasBeenLive(state)) {
          // Refused as live, read as never live: our own contract broken.
          logger.error('studio_editor.open_live_reread_failed', {
            contentId: id,
            status: state.status,
            neverLive: true,
          });
          openProblem = 'outage';
          return;
        }
      } catch (err) {
        // Signed out or gone is a refusal (a warning), and no try again
        // helps; an outage is an error.
        logReadFailure('studio_editor.open_live_reread_failed', err, {
          contentId: id,
        });
        openProblem = readProblem(err) ?? 'outage';
        return;
      }
      // Closed while it read (Back, the rail): no move of its own to make.
      if (unmounted) return;
      handOffToLive(
        id,
        Object.fromEntries(
          sendableKeys()
            .filter((key) => key !== 'slug')
            .map((key) => [key, $state.snapshot(values[key])])
        )
      );
      try {
        // The route's own read (a query, or a load) takes that answer: a move
        // to the same address reads nothing new of itself.
        await invalidateAll();
        if (unmounted) {
          // The creator left without them: theirs to have dropped.
          if (leftChanges || !isDirty) {
            withdrawLiveHandoff(id);
            return;
          }
          // Something else took the screen (an error page, as a load
          // failed): the changes wait for the live editor's next mount, or
          // are said as too late after their window, never dropped unsaid.
          logger.warn('studio_editor.open_live_page_replaced', {
            contentId: id,
            keys: sendableKeys(),
          });
          return;
        }
        // The next editor is built from the page's read, and invalidateAll
        // resolves even when its refresh failed: a move on a read still a
        // draft's would open the draft editor again, the changes gone.
        if (!readLive()) {
          withdrawLiveHandoff(id);
          openProblem = 'outage';
          logger.error('studio_editor.open_live_reread_failed', {
            contentId: id,
            stage: 'page',
          });
          return;
        }
        handedOff = true;
        // Passed by the guard: the changes are carried, not dropped.
        leaving = true;
        // From Write, the address is the one it is on: replaced, so Back
        // never lands on a same-address entry kit would rebuild from a read
        // older than an Update since. From Publish the step changes, which
        // reads again, so it is a move of its own.
        await goto(editHref(id), {
          replaceState: readEditorStep(new URL(location.href)) === 'write',
        });
      } catch (err) {
        // The creator stays, the notice and its button with them.
        handedOff = false;
        withdrawLiveHandoff(id);
        openProblem = 'outage';
        logger.error('studio_editor.open_live_failed', {
          contentId: id,
          ...describeThrown(err),
        });
      } finally {
        // Still mounted: the move did not happen, so guard again.
        if (!unmounted) leaving = false;
      }
    },
    discard() {
      if (!isLive()) return;
      discardChanges();
    },
    async leave(to) {
      discardChanges();
      leaving = true;
      goingWithout = to;
      try {
        await goto(to);
      } finally {
        // Still mounted: something else stopped the move, so guard again.
        if (!unmounted) {
          leaving = false;
          stayAfterAll();
        }
      }
    },
    set(key, value) {
      // Landed after the creator went without it: theirs to have left.
      if (unmounted && goingWithout !== null) {
        values[key] = value;
        logger.info('studio_editor.set_after_leave_dropped', {
          contentId,
          key,
        });
        return;
      }
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
    get leavingWhenSent() {
      return busyMove !== null;
    },
    stay() {
      busyMove = null;
      stayAfterAll();
    },
    async leaveNow() {
      const move = busyMove;
      if (!move) return;
      busyMove = null;
      goingWithout = move.to.href;
      await sendOn(move);
    },
    retry: autosave.retry,
  };
}

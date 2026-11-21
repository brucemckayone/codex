/**
 * The leaving notice (Codex-a6ofh.6): what a creator's delete of a piece
 * people own gives them instead of an end to their playback. The story is in
 * `@codex/database`'s `schema/content-leaving.ts`.
 */

/**
 * How long owners keep a deleted piece they own (owner D1, 2026-11-17): its
 * `leaves_at` is the delete plus this many days, and that date is the
 * notice period's `round`. Keep's "newest email" order reads rounds as only
 * going forward, so shortening this while a kept piece is still inside its
 * old window can make its next delete tie or precede an earlier round. The
 * delete refuses such a round (an error, rolled back) rather than write it.
 */
export const LEAVING_NOTICE_DAYS = 30;

/**
 * How long a piece waits after its last notice period that emailed anyone
 * started before a delete may start another (owner 2026-11-19). Each delete
 * emails every owner and each Keep emails who may have heard, so without a
 * gap a delete and a Keep, repeated, would email them every hour. A delete
 * inside it is refused (409 `CONTENT_LEAVING_TOO_SOON`), and nothing is
 * written. A period kept before any email was tried starts no gap, so a
 * silent delete and Keep cannot hold off the other side's delete.
 */
export const LEAVING_ROUND_GAP_HOURS = 24;

/**
 * The emails an owner can be sent about a piece (one
 * `content_leaving_notices` row each):
 * - `leaving`: on the delete, naming the date and, where allowed, the download;
 * - `reminder`: a few days before it leaves;
 * - `staying`: the creator kept it. Sent to whoever may last have been told
 *   it leaves: everyone whose newest email that counts (a tried `leaving` or
 *   `reminder`, or a SENT `staying`, by round) says it leaves. The schema has
 *   the full rule;
 * - `removed`: a platform admin removed it at once (a takedown).
 */
export const CONTENT_LEAVING_NOTICE_KINDS = [
  'leaving',
  'reminder',
  'staying',
  'removed',
] as const;

export type ContentLeavingNoticeKind =
  (typeof CONTENT_LEAVING_NOTICE_KINDS)[number];

/**
 * Where a notice is:
 * - `due`: waiting for the sweep;
 * - `sent`: the email went;
 * - `failed`: the last try was answered without sending (a refusal or a
 *   skip), and the sweep tries again;
 * - `unknown`: the last try got no usable answer, so the email may have gone
 *   (`EmailSendResult`'s 5xx and no-answer cases). The sweep tries again;
 * - `cancelled`: no longer needed. The creator kept the piece while its
 *   `leaving` or `reminder` email was still open, tried or not; any delete,
 *   the creator's or an admin's, landed while its `staying` email was open;
 *   or a takedown landed while its `leaving` or `reminder` email was. Or the
 *   sweep found the email no longer true before it went (the schema lists
 *   the rule per kind), which it logs. A `removed` notice, a takedown's only
 *   email, is never cancelled;
 * - `abandoned`: it used up its tries, or the person has no address (an
 *   erased account), and the sweep stops.
 * Whether a `leaving` or `reminder` email may have told its person is read
 * from `attempts`, never from the state: a try that ended `failed` may
 * follow one that went. A `staying` email counts as told only once `sent`.
 */
export const CONTENT_LEAVING_NOTICE_STATES = [
  'due',
  'sent',
  'failed',
  'unknown',
  'cancelled',
  'abandoned',
] as const;

export type ContentLeavingNoticeState =
  (typeof CONTENT_LEAVING_NOTICE_STATES)[number];

/**
 * The states the sweep still has to send, and so the only ones its claim
 * takes. `unknown` is retried, as the fee notices' is: a person may get a
 * second email over never getting one.
 */
export const CONTENT_LEAVING_NOTICE_OPEN_STATES = [
  'due',
  'failed',
  'unknown',
] as const satisfies readonly ContentLeavingNoticeState[];

/**
 * The states a try that did not send leaves, each with a reason. NOT the
 * test of who may have been told: that is `attempts > 0`, which counts
 * `sent` too.
 */
export const CONTENT_LEAVING_NOTICE_UNSENT_TRY_STATES = [
  'failed',
  'unknown',
  'abandoned',
] as const satisfies readonly ContentLeavingNoticeState[];

/**
 * Why the last try did not send, kept on the row so support can tell a
 * refusal from a skip. A code, never the sender's message, so no address
 * can reach the table. The classes `fee_change_notices` uses:
 * - `refused`: notifications-api answered 4xx;
 * - `skipped`: it answered 2xx without sending (an opt-out, say);
 * - `no_address`: the person's account was erased after the row was written.
 *   Erasure leaves a tombstone address, not a null one, so the send reads
 *   `users.deleted_at`, as the fee sweep does;
 * - `unknown`: a 5xx or no usable answer, so it may have gone.
 * A `failed` row carries `refused` or `skipped`, and an `unknown` row
 * `unknown` (a CHECK). `no_address` ends a row `abandoned` at once.
 * Otherwise an `abandoned` row carries the answer of the try that ended it,
 * or `unknown` when that try was cut off before an answer: a cut-off send
 * may have gone, whatever an earlier try was told.
 */
export const CONTENT_LEAVING_NOTICE_REASONS = [
  'refused',
  'skipped',
  'no_address',
  'unknown',
] as const;

export type ContentLeavingNoticeReason =
  (typeof CONTENT_LEAVING_NOTICE_REASONS)[number];

// ─── WP-4: the sweep and its emails (Codex-a6ofh.6.4) ───────────────────────
//
// media-api's hourly maintenance run calls content-api's
// `POST /internal/content/leaving-sweep`, which sends the notices due, adds
// the reminders and finishes the deletes whose day has come
// (`ContentLeavingNoticeService`, `@codex/content`).

/**
 * A notice is tried at most this many times. The fifth try's own answer ends
 * it (`abandoned`, with that answer's reason), and a row still open with
 * this many tries, its last one cut off before an answer, is abandoned as
 * `unknown`: a cut-off send may have gone.
 */
export const LEAVING_NOTICE_MAX_TRIES = 5;

/**
 * The lease between tries (owner): a notice claimed less than this long ago
 * is left alone, so a send in flight, or one cut off after it went, is never
 * taken by the next tick. The claim counts the try and stamps its time.
 */
export const LEAVING_NOTICE_LEASE_MS = 6 * 60 * 60 * 1000;

/** The day-27 reminder: added once a piece leaves within this many days. */
export const LEAVING_REMINDER_DAYS = 3;

/** Notices one tick claims at most; the next tick takes the rest. */
export const LEAVING_SWEEP_NOTICES_PER_TICK = 1000;

/** Sends one tick has in flight at once. */
export const LEAVING_SWEEP_SEND_BATCH = 8;

/**
 * Pieces one tick finishes deleting (their day has come), and pieces it
 * adds reminders for.
 */
export const LEAVING_SWEEP_PIECES_PER_TICK = 50;

/**
 * Owners' libraries one tick bumps for the `leaving` notices it claims
 * (owner: the bump goes with the claim, no cursor), and so the `leaving`
 * notices it claims at most: as many as the tick claims. A delete bumps 500
 * owners inline (`DEFAULT_MAX_LIBRARY_FANOUT`); these reach the rest.
 *
 * Sized to the tick's subrequest budget: content-api's one invocation, which
 * a paid-plan Worker gives 10,000 subrequests by default, KV and R2 included
 * (developers.cloudflare.com/workers/platform/limits; content-api sets no
 * `limits`). The database is one connection, so its queries don't count. A
 * heavy tick spends at most:
 * - the sends: 1,000 notifications-api calls (LEAVING_SWEEP_NOTICES_PER_TICK);
 * - these bumps: 1,000 KV writes;
 * - the day-30 owners' bumps: 5,000 (LEAVING_SWEEP_COMPLETION_BUMPS_PER_TICK);
 * - the day-30 refresh of the rest: 1 catalogue key, about 6 keys an org for
 *   up to 50 orgs (300), and their subscribers and team, up to 500;
 * - the 50 deleted covers' R2 files: about 4 each (200).
 * About 8,000 in all, leaving 2,000 to spare.
 */
export const LEAVING_SWEEP_LIBRARY_BUMPS_PER_TICK =
  LEAVING_SWEEP_NOTICES_PER_TICK;

/**
 * Owners' libraries one tick bumps for the pieces it deletes on their day
 * (design §5 step 3: every owner, no 500 cap), within the budget above.
 * Owners past it are logged, not bumped: a library page refetches on mount,
 * so a missed bump only keeps a card in a tab already open.
 */
export const LEAVING_SWEEP_COMPLETION_BUMPS_PER_TICK = 5000;

/** Those owners are read this many at a time. */
export const LEAVING_SWEEP_HOLDERS_PAGE = 500;

/**
 * And bumped this many at once, the deadline checked between chunks: a
 * Worker has 6 calls waiting at once, so a whole page of 500 writes, queued
 * behind the day-30 refresh's own, could outrun the route's time.
 */
export const LEAVING_SWEEP_BUMP_CHUNK = 50;

/**
 * No send starts after this, counted from the tick's start (owner: the route
 * is synchronous). Claims left unsent are given back as they were.
 */
export const LEAVING_SWEEP_SEND_BUDGET_MS = 4 * 60 * 1000;

/**
 * How long media-api waits for a tick: the send budget, the last batch, the
 * reminders and the completions after it.
 */
export const LEAVING_SWEEP_CALL_TIMEOUT_MS =
  LEAVING_SWEEP_SEND_BUDGET_MS + 2 * 60 * 1000;

/**
 * The route's own time, counted from its start: no chunk of day-30 owners'
 * bumps starts after it, so the tick answers before media-api gives up
 * (LEAVING_SWEEP_CALL_TIMEOUT_MS). The 30 s margin covers what may still
 * run past it: the chunk in flight (up to LEAVING_SWEEP_BUMP_CHUNK KV
 * writes, 6 at a time, queued behind the refresh's ~800), the count read
 * for the not-bumped warn, and the answer's way back to media-api.
 */
export const LEAVING_SWEEP_ROUTE_DEADLINE_MS =
  LEAVING_SWEEP_CALL_TIMEOUT_MS - 30 * 1000;

/** The email each kind of notice sends: a global, transactional template. */
export const CONTENT_LEAVING_NOTICE_TEMPLATES = {
  leaving: 'content-leaving',
  reminder: 'content-leaving-reminder',
  staying: 'content-staying',
  removed: 'content-removed',
} as const satisfies Record<ContentLeavingNoticeKind, string>;

export type ContentLeavingNoticeTemplate =
  (typeof CONTENT_LEAVING_NOTICE_TEMPLATES)[ContentLeavingNoticeKind];

/**
 * The leaving email's button, and what it says to do before the date (owner,
 * D8): the templates can't branch, so the sender picks one. With the
 * creator's download on, a video or audio owner keeps the original ("Download
 * it") and an article's saves it ("Save it as a PDF"); with it off they
 * watch, listen or read it while they can.
 */
export const CONTENT_LEAVING_ACTION_LABELS = [
  'Download it',
  'Save it as a PDF',
  'Watch it',
  'Listen to it',
  'Read it',
] as const;

export type ContentLeavingActionLabel =
  (typeof CONTENT_LEAVING_ACTION_LABELS)[number];

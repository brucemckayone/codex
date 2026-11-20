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

/**
 * The leaving notice (Codex-a6ofh.6): what a creator's delete of a piece
 * people own gives them instead of an end to their playback. The story is in
 * `@codex/database`'s `schema/content-leaving.ts`.
 */

/**
 * The emails an owner can be sent about a piece (one
 * `content_leaving_notices` row each):
 * - `leaving`: on the delete, naming the date and, where allowed, the download;
 * - `reminder`: a few days before it leaves;
 * - `staying`: the creator kept it. Sent to everyone a `leaving` or
 *   `reminder` email of that round was tried for, since any try may have
 *   told them (see `attempts` in the schema);
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
 *   `leaving` or `reminder` email was still open, tried or not, or deleted
 *   it again while its `staying` email was. Or the sweep found the piece no
 *   longer leaves on that round (kept, completed or taken down) before a
 *   `leaving` or `reminder` email went, which it logs. A `removed` notice, a
 *   takedown's only email, is never cancelled;
 * - `abandoned`: it used up its tries, or the person has no address (an
 *   erased account), and the sweep stops.
 * Whether a person may have been told is read from `attempts`, never from
 * the state: a try that ended `failed` may follow one that went.
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

/** The states a try that did not send leaves, each with a reason. */
export const CONTENT_LEAVING_NOTICE_TRIED_STATES = [
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
 * `unknown` (a CHECK). `no_address` ends a row `abandoned` at once. An
 * `abandoned` row otherwise keeps its last try's reason, and one whose tries
 * were all cut off before an answer is abandoned as `unknown`.
 */
export const CONTENT_LEAVING_NOTICE_REASONS = [
  'refused',
  'skipped',
  'no_address',
  'unknown',
] as const;

export type ContentLeavingNoticeReason =
  (typeof CONTENT_LEAVING_NOTICE_REASONS)[number];

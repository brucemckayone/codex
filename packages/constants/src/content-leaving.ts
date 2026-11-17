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
 * - `staying`: the creator kept it, sent only to people already told;
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
 * - `failed`: the last try was refused, and the sweep tries again;
 * - `unknown`: the last try got no usable answer, so the email may have gone
 *   (`EmailSendResult`'s 5xx and no-answer cases). The sweep tries again,
 *   and anything that asks whether a person was told counts this as maybe;
 * - `cancelled`: no longer needed. The creator kept the piece before its
 *   `leaving` or `reminder` email went, or deleted it again before its
 *   `staying` email went. A `removed` notice, a takedown's only email, is
 *   never cancelled;
 * - `abandoned`: it used up its tries, and the sweep stops.
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
 * Why the last try did not send, kept on the row so support can tell a
 * refusal from a skip. A code, never the sender's message, so no address
 * can reach the table. The classes `fee_change_notices` uses:
 * - `refused`: notifications-api answered 4xx;
 * - `skipped`: it answered 2xx without sending (an opt-out, say);
 * - `no_address`: the person has no address to send to;
 * - `unknown`: a 5xx or no usable answer, so it may have gone.
 */
export const CONTENT_LEAVING_NOTICE_REASONS = [
  'refused',
  'skipped',
  'no_address',
  'unknown',
] as const;

export type ContentLeavingNoticeReason =
  (typeof CONTENT_LEAVING_NOTICE_REASONS)[number];

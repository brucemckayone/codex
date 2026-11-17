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
 * - `failed`: the last try failed, and the sweep tries again;
 * - `cancelled`: no longer needed, because the creator kept the piece before
 *   a `leaving` or `reminder` email went out;
 * - `abandoned`: it used up its tries, and the sweep stops.
 */
export const CONTENT_LEAVING_NOTICE_STATES = [
  'due',
  'sent',
  'failed',
  'cancelled',
  'abandoned',
] as const;

export type ContentLeavingNoticeState =
  (typeof CONTENT_LEAVING_NOTICE_STATES)[number];

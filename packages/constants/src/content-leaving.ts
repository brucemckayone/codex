/**
 * The leaving notice (Codex-a6ofh.6, owner 2026-11-17). A creator who deletes
 * a piece people own gives them notice instead of ending their playback at
 * once:
 * - the piece goes off sale and out of every listing straight away;
 * - its owners keep playing it until `content.leaves_at`, the date it leaves;
 * - they are emailed, and reminded a few days before;
 * - they can download it if its creator allowed that when selling
 *   (`content.owners_can_download`);
 * - a sweep finishes the delete on that date.
 * The creator can keep the piece at any time before then.
 *
 * The waiting state is "off sale with a leave date", never `deleted_at`: the
 * access check drops a deleted row before it reads anyone's purchase, so a
 * deleted piece is gone for its owners too. A platform admin's delete, for a
 * legal or policy takedown, stays immediate.
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
 *   a `leaving` or `reminder` email went out.
 */
export const CONTENT_LEAVING_NOTICE_STATES = [
  'due',
  'sent',
  'failed',
  'cancelled',
] as const;

export type ContentLeavingNoticeState =
  (typeof CONTENT_LEAVING_NOTICE_STATES)[number];

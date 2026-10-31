/**
 * The media_items columns a response may carry (Codex-l2c48, owner decision).
 *
 * `transcoding_error` holds the transcoder's raw detail: ffmpeg stderr, a
 * storage endpoint's text. The owner diagnoses from it in the database and
 * the failure email; no API serves it. A creator sees the sentence for
 * `transcoding_error_code` instead.
 *
 * `files_purge_after` and `files_purged_at` are the delete's file-purge
 * bookkeeping (Codex-6sbn1): support's and the purge's, never a creator's.
 */

/** `columns` for any relational query whose media row may reach a response. */
export const MEDIA_ITEM_RESPONSE_COLUMNS = {
  transcodingError: false,
  filesPurgeAfter: false,
  filesPurgedAt: false,
} as const;

/** The columns {@link MEDIA_ITEM_RESPONSE_COLUMNS} leaves out. */
type UnservedMediaColumn =
  | 'transcodingError'
  | 'filesPurgeAfter'
  | 'filesPurgedAt';

/** A written row (`.returning()`) without the columns no response carries. */
export function withoutTranscodingDetail<
  T extends Partial<Record<UnservedMediaColumn, unknown>>,
>(row: T): Omit<T, UnservedMediaColumn> {
  const {
    transcodingError: _detail,
    filesPurgeAfter: _purgeAfter,
    filesPurgedAt: _purgedAt,
    ...served
  } = row;
  return served;
}

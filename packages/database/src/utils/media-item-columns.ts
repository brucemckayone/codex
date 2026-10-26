/**
 * The media_items columns a response may carry (Codex-l2c48, owner decision).
 *
 * `transcoding_error` holds the transcoder's raw detail: ffmpeg stderr, a
 * storage endpoint's text. The owner diagnoses from it in the database and
 * the failure email; no API serves it. A creator sees the sentence for
 * `transcoding_error_code` instead.
 */

/** `columns` for any relational query whose media row may reach a response. */
export const MEDIA_ITEM_RESPONSE_COLUMNS = { transcodingError: false } as const;

/** A written row (`.returning()`) without the transcoder's raw detail. */
export function withoutTranscodingDetail<
  T extends { transcodingError?: unknown },
>(row: T): Omit<T, 'transcodingError'> {
  const { transcodingError: _detail, ...served } = row;
  return served;
}

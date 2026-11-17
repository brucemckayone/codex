/**
 * The SETs of the moves to `failed` and back to waiting, shared by the
 * dispatch state machine (TranscodingService) and the hourly maintenance run
 * (TranscodingMaintenance). Internal to the package.
 *
 * Neither touches transcoding_progress / transcoding_step: progress lives in
 * the studio's status object now (Codex-l2c48.9), and the columns are
 * dropped once no deployed code writes them.
 */

import {
  MAX_TRANSCODING_ATTEMPTS,
  MEDIA_STATUS,
  NON_RETRYABLE_TRANSCODING_ERROR_CODES,
  TRANSCODING_ERROR_MAX_LENGTH,
  type TranscodingErrorCode,
} from '@codex/constants';
import { mediaItems } from '@codex/database/schema';
import { isNull, lt, notInArray, type SQL, sql } from 'drizzle-orm';

/**
 * An item that may be transcoded again: attempts left, and no code that no
 * attempt can cure. The SQL twin of `isTerminalTranscodeFailure`'s
 * attempt-and-code half (@codex/constants): dispatch claims only these, and
 * the maintenance run settles a failed item that is not one (Codex-a6ofh.2.8).
 * Plain SQL, never `or()`, which is typed `SQL | undefined`; never NULL either
 * (the attempts column is NOT NULL, the code's NULL is tested), so a NOT of it
 * is safe.
 */
export function mayRetryTranscode(): SQL {
  return sql`(${lt(mediaItems.transcodingAttempts, MAX_TRANSCODING_ATTEMPTS)} and (${isNull(mediaItems.transcodingErrorCode)} or ${notInArray(mediaItems.transcodingErrorCode, [...NON_RETRYABLE_TRANSCODING_ERROR_CODES])}))`;
}

/** The SET of every move to `failed`; the detail is cut to fit the column. */
/**
 * Progress lives in the status object now (Codex-l2c48.9). Until the columns
 * are dropped (Codex-32sym), every lifecycle write clears them, so a read of
 * the row reports no progress rather than a stale %.
 */
export const NO_PROGRESS = {
  transcodingProgress: null,
  transcodingStep: null,
} as const;

export function failedFields(code: TranscodingErrorCode, detail: string) {
  return {
    ...NO_PROGRESS,
    status: MEDIA_STATUS.FAILED,
    transcodingError: detail.slice(0, TRANSCODING_ERROR_MAX_LENGTH),
    transcodingErrorCode: code,
    updatedAt: new Date(),
  };
}

/**
 * The SET of every move back to waiting (`uploaded` with a code): RunPod ran
 * nothing, so the attempt the claim counted is given back.
 */
export function waitingFields(code: TranscodingErrorCode, detail: string) {
  return {
    ...NO_PROGRESS,
    status: MEDIA_STATUS.UPLOADED,
    transcodingError: detail.slice(0, TRANSCODING_ERROR_MAX_LENGTH),
    transcodingErrorCode: code,
    transcodingAttempts: sql`GREATEST(${mediaItems.transcodingAttempts} - 1, 0)`,
    updatedAt: new Date(),
  };
}

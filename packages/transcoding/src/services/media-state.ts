/**
 * The SETs of the moves to `failed` and back to waiting, shared by the
 * dispatch state machine (TranscodingService) and the hourly maintenance run
 * (TranscodingMaintenance). Internal to the package.
 */

import {
  MEDIA_STATUS,
  TRANSCODING_ERROR_MAX_LENGTH,
  type TranscodingErrorCode,
} from '@codex/constants';
import { mediaItems } from '@codex/database/schema';
import { sql } from 'drizzle-orm';

/** The SET of every move to `failed`; the detail is cut to fit the column. */
export function failedFields(code: TranscodingErrorCode, detail: string) {
  return {
    status: MEDIA_STATUS.FAILED,
    transcodingError: detail.slice(0, TRANSCODING_ERROR_MAX_LENGTH),
    transcodingErrorCode: code,
    transcodingProgress: null,
    transcodingStep: null,
    updatedAt: new Date(),
  };
}

/**
 * The SET of every move back to waiting (`uploaded` with a code): RunPod ran
 * nothing, so the attempt the claim counted is given back.
 */
export function waitingFields(code: TranscodingErrorCode, detail: string) {
  return {
    status: MEDIA_STATUS.UPLOADED,
    transcodingError: detail.slice(0, TRANSCODING_ERROR_MAX_LENGTH),
    transcodingErrorCode: code,
    transcodingAttempts: sql`GREATEST(${mediaItems.transcodingAttempts} - 1, 0)`,
    transcodingProgress: null,
    transcodingStep: null,
    updatedAt: new Date(),
  };
}

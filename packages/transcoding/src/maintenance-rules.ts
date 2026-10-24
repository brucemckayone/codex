/**
 * Pure rules of the hourly maintenance run (Codex-l2c48.5). No I/O:
 * TranscodingMaintenance applies them, so each rule is unit-tested without a
 * database or RunPod.
 */

import {
  MAX_TRANSCODING_ATTEMPTS,
  TRANSCODING_ERROR_CODES,
  type TranscodingErrorCode,
  toTranscodingErrorCode,
} from '@codex/constants';
import { MIN_EXECUTION_TIMEOUT_MS, transcodingJobPolicy } from './dispatch';
import type { JobStatusResult } from './runpod-api';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Slack past RunPod's own limits before a job counts as lost. */
export const RECONCILE_MARGIN_MS = 15 * MINUTE_MS;
/** No row falls due sooner: the shortest job policy plus the margin. */
export const MIN_RECONCILE_AGE_MS =
  MIN_EXECUTION_TIMEOUT_MS + RECONCILE_MARGIN_MS;
/** A waiting (or stranded) `uploaded` row is retried once it is this idle. */
export const WAITING_IDLE_MS = 10 * MINUTE_MS;
/** An upload that cannot start transcoding within this long is given up. */
export const GIVE_UP_AFTER_MS = 24 * HOUR_MS;
/**
 * A lost job still unresolved this long past its due time is failed, whatever
 * RunPod says (or cannot): without a ceiling a row RunPod never answers about
 * stays `transcoding`, which a creator cannot retry.
 */
export const LOST_JOB_CEILING_MS = 24 * HOUR_MS;
/** An `uploading` row untouched this long is checked against R2. */
export const STALLED_UPLOAD_MS = 24 * HOUR_MS;
/** The run whose UTC hour this is sends the daily keep-alive ping. */
export const PING_HOUR_UTC = 3;

/**
 * When a `transcoding` row should be asked about. With a job id RunPod can be
 * asked, so once its execution timeout has passed. Without one (the /run
 * answer was lost) nothing can be asked, so only once RunPod would have
 * dropped the job anyway: queued time (ttl) included.
 */
export function reconcileDueAt(row: {
  updatedAt: Date;
  durationSeconds: number | null;
  runpodJobId: string | null;
}): number {
  const policy = transcodingJobPolicy(row.durationSeconds);
  const allowed = row.runpodJobId ? policy.executionTimeout : policy.ttl;
  return row.updatedAt.getTime() + allowed + RECONCILE_MARGIN_MS;
}

/**
 * What to do with an overdue `transcoding` row. `ceiling`: failed only
 * because LOST_JOB_CEILING_MS passed, which someone should look at.
 */
export type LostJobAction =
  | { kind: 'leave' }
  | {
      kind: 'fail';
      code: TranscodingErrorCode;
      detail: string;
      ceiling?: true;
    }
  | { kind: 'wait'; detail: string };

/**
 * What RunPod said about a job; `no_job` when the row holds none to ask
 * about; `unanswered` when RunPod could not say.
 */
export type JobAnswer =
  | Extract<JobStatusResult, { ok: true }>
  | 'no_job'
  | 'unanswered';

/**
 * `no_job`: back to waiting, attempt given back: RunPod never confirmed a
 * job, and none can be asked after. A job still running, or one RunPod cannot
 * answer about, is left until LOST_JOB_CEILING_MS past due.
 *
 * GONE (RunPod keeps a result 30 min, and a row is asked about 15 min past a
 * timeout that is far longer than most jobs take) is the usual answer for a
 * job whose webhook was lost, so it is WEBHOOK_LOST, as COMPLETED is.
 */
export function lostJobAction(
  answer: JobAnswer,
  overdueMs: number
): LostJobAction {
  if (answer === 'no_job') {
    return { kind: 'wait', detail: 'RunPod never confirmed the job' };
  }
  const leave: LostJobAction =
    overdueMs >= LOST_JOB_CEILING_MS
      ? {
          kind: 'fail',
          code: TRANSCODING_ERROR_CODES.TIMED_OUT,
          detail: 'RunPod never reported what became of the job',
          ceiling: true,
        }
      : { kind: 'leave' };
  if (answer === 'unanswered') return leave;

  switch (answer.state) {
    case 'IN_QUEUE':
    case 'IN_PROGRESS':
      return leave;
    case 'COMPLETED':
      return {
        kind: 'fail',
        code: TRANSCODING_ERROR_CODES.WEBHOOK_LOST,
        detail: 'The transcoder finished, but its result never arrived',
      };
    case 'GONE':
      return {
        kind: 'fail',
        code: TRANSCODING_ERROR_CODES.WEBHOOK_LOST,
        detail: 'RunPod no longer has the job, and its result never arrived',
      };
    case 'FAILED':
      return {
        kind: 'fail',
        code: TRANSCODING_ERROR_CODES.INFRA_ERROR,
        detail: 'The transcoder failed, and its report never arrived',
      };
    case 'CANCELLED':
    case 'TIMED_OUT':
      return {
        kind: 'fail',
        code: TRANSCODING_ERROR_CODES.TIMED_OUT,
        detail: 'The transcoder did not finish in time',
      };
  }
}

/** What to do with an idle `uploaded` row. */
export type WaitingAction =
  | { kind: 'retry' }
  | { kind: 'give_up'; code: TranscodingErrorCode; detail: string };

/**
 * Give up when the file has waited 24 h, or no attempts are left; otherwise
 * retry. The clock is uploaded_at, falling back to created_at: uploads that
 * finished on the old upload-complete code during the deploy have none. A
 * given-up row keeps the reason it was waiting.
 */
export function waitingAction(
  row: {
    transcodingErrorCode: string | null;
    transcodingAttempts: number;
    uploadedAt: Date | null;
    createdAt: Date;
  },
  now: Date
): WaitingAction {
  const code = row.transcodingErrorCode
    ? toTranscodingErrorCode(row.transcodingErrorCode)
    : TRANSCODING_ERROR_CODES.TRANSCODER_UNAVAILABLE;
  const since = (row.uploadedAt ?? row.createdAt).getTime();
  if (now.getTime() - since >= GIVE_UP_AFTER_MS) {
    return {
      kind: 'give_up',
      code,
      detail: 'Gave up after 24 hours waiting for the transcoder',
    };
  }
  if (row.transcodingAttempts >= MAX_TRANSCODING_ATTEMPTS) {
    return { kind: 'give_up', code, detail: 'No transcoding attempts left' };
  }
  return { kind: 'retry' };
}

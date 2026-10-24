/**
 * Transcoding constants (epic Codex-l2c48).
 *
 * A media row records WHY transcoding stopped as one of these codes, in
 * `media_items.transcoding_error_code`. The code, not the free-text
 * `transcoding_error`, is what decides the row's next state, who is emailed,
 * whether the creator may retry, and which sentence the studio shows.
 */

/**
 * Every reason a transcode can stop. Grouped by who detects it:
 *
 * - dispatch (media-api, from RunPod's `/run` reply): `TRANSCODER_*`
 * - the job itself (the RunPod handler's failure webhook): `CORRUPT_INPUT` …
 *   `INFRA_ERROR`
 * - reconciliation (the hourly cron and the webhook route): `TIMED_OUT` …
 *   `UPLOAD_INCOMPLETE`
 */
export const TRANSCODING_ERROR_CODES = {
  /** RunPod answered `409 ENDPOINT_PAUSED`: the endpoint sat idle 7 days. */
  TRANSCODER_PAUSED: 'TRANSCODER_PAUSED',
  /** RunPod answered 429. */
  TRANSCODER_BUSY: 'TRANSCODER_BUSY',
  /** RunPod answered 5xx. */
  TRANSCODER_UNAVAILABLE: 'TRANSCODER_UNAVAILABLE',
  /** RunPod answered 401/403/404: a key or endpoint id is wrong. */
  TRANSCODER_MISCONFIGURED: 'TRANSCODER_MISCONFIGURED',
  CORRUPT_INPUT: 'CORRUPT_INPUT',
  UNSUPPORTED_CODEC: 'UNSUPPORTED_CODEC',
  INVALID_DURATION: 'INVALID_DURATION',
  MISSING_STREAM: 'MISSING_STREAM',
  OUTPUT_VALIDATION_FAILED: 'OUTPUT_VALIDATION_FAILED',
  /** Anything else the handler raised, and any code this side does not know. */
  INFRA_ERROR: 'INFRA_ERROR',
  /** RunPod killed the job at its execution timeout; no webhook came. */
  TIMED_OUT: 'TIMED_OUT',
  /** RunPod reports the job COMPLETED but its completion webhook never landed. */
  WEBHOOK_LOST: 'WEBHOOK_LOST',
  /** The completion webhook arrived but failed schema validation. */
  OUTPUT_REJECTED: 'OUTPUT_REJECTED',
  /** The row stayed `uploading` past the cutoff and no original is in R2. */
  UPLOAD_INCOMPLETE: 'UPLOAD_INCOMPLETE',
} as const;

export type TranscodingErrorCode =
  (typeof TRANSCODING_ERROR_CODES)[keyof typeof TRANSCODING_ERROR_CODES];

/** The longest code; `media_items.transcoding_error_code` is this wide. */
export const TRANSCODING_ERROR_CODE_MAX_LENGTH = 50;

/**
 * The longest detail; `media_items.transcoding_error` is this wide, and a
 * longer write is a Postgres error, not a truncation.
 */
export const TRANSCODING_ERROR_MAX_LENGTH = 2000;

/**
 * The `error.details.code`s media-api's upload trigger answers when the
 * answer is about the ITEM (gone or not the caller's, still uploading, no
 * attempts left). content-api records nothing for these. Anything else (a
 * 5xx, worker auth's 401/403, a router 404 from a wrong URL) failed the hop,
 * and the item is marked waiting. @codex/transcoding's errors carry these
 * codes; a test there pins them.
 */
export const TRANSCODING_TRIGGER_ITEM_ANSWER_CODES = [
  'TRANSCODING_MEDIA_NOT_FOUND',
  'INVALID_MEDIA_STATE',
  'MAX_RETRIES_EXCEEDED',
] as const;

/** Which sentence the studio shows; one per category, not per code. */
export type TranscodingErrorCategory =
  | 'service' // the transcoder was unavailable
  | 'config' // the transcoder is set up wrong; waits for the owner's fix
  | 'file' // the file itself cannot be transcoded
  | 'timeout' // processing took too long
  | 'upload' // the upload never finished
  | 'internal'; // our side broke

/** What a code means for the row; every field follows from its category. */
export interface TranscodingErrorCodeInfo {
  category: TranscodingErrorCategory;
  /**
   * While a row holds this code it WAITS (`status = 'uploaded'`) for the cron
   * to dispatch it again, rather than failing. Past the give-up cutoff it
   * fails with the same code.
   */
  transient: boolean;
  /** A terminal failure with this code emails the creator AND the owner. */
  notify: boolean;
  /**
   * The owner is emailed as soon as a row ENTERS this code, not only when it
   * finally fails: nothing recovers until they act.
   */
  alertOwnerOnEntry: boolean;
  /**
   * The creator may retry. False where a retry would fail identically: the
   * file is the problem, or there is no file.
   */
  retryable: boolean;
}

const CODE_CATEGORY: Readonly<
  Record<TranscodingErrorCode, TranscodingErrorCategory>
> = {
  TRANSCODER_PAUSED: 'service',
  TRANSCODER_BUSY: 'service',
  TRANSCODER_UNAVAILABLE: 'service',
  TRANSCODER_MISCONFIGURED: 'config',
  CORRUPT_INPUT: 'file',
  UNSUPPORTED_CODEC: 'file',
  INVALID_DURATION: 'file',
  MISSING_STREAM: 'file',
  OUTPUT_VALIDATION_FAILED: 'internal',
  INFRA_ERROR: 'internal',
  TIMED_OUT: 'timeout',
  WEBHOOK_LOST: 'internal',
  OUTPUT_REJECTED: 'internal',
  UPLOAD_INCOMPLETE: 'upload',
};

const CATEGORY_POLICY: Readonly<
  Record<TranscodingErrorCategory, Omit<TranscodingErrorCodeInfo, 'category'>>
> = {
  service: {
    transient: true,
    notify: true,
    alertOwnerOnEntry: false,
    retryable: true,
  },
  // Every upload fails the same way until a secret is fixed, so rows wait (the
  // next cron run after the fix dispatches them) and the owner hears at once.
  config: {
    transient: true,
    notify: true,
    alertOwnerOnEntry: true,
    retryable: true,
  },
  file: {
    transient: false,
    notify: true,
    alertOwnerOnEntry: false,
    retryable: false,
  },
  timeout: {
    transient: false,
    notify: true,
    alertOwnerOnEntry: false,
    retryable: true,
  },
  // An abandoned upload is normal, not an incident, and there is no file.
  upload: {
    transient: false,
    notify: false,
    alertOwnerOnEntry: false,
    retryable: false,
  },
  internal: {
    transient: false,
    notify: true,
    alertOwnerOnEntry: false,
    retryable: true,
  },
};

export function isTranscodingErrorCode(
  value: unknown
): value is TranscodingErrorCode {
  return typeof value === 'string' && Object.hasOwn(CODE_CATEGORY, value);
}

/**
 * A code as this side records it. The handler is deployed separately and may
 * send a code this build has never heard of; that becomes `INFRA_ERROR`
 * rather than a rejected webhook. Callers holding a raw value from outside
 * should log it when {@link isTranscodingErrorCode} is false, because this
 * mapping discards it.
 */
export function toTranscodingErrorCode(value: unknown): TranscodingErrorCode {
  return isTranscodingErrorCode(value)
    ? value
    : TRANSCODING_ERROR_CODES.INFRA_ERROR;
}

/**
 * What a stored code means. Takes any string because it reads a varchar
 * column or API JSON: a code this build does not know (written by a newer
 * build, then read after a rollback) gets INFRA_ERROR's policy, which emails
 * and allows a retry, never a policy of undefined flags.
 */
export function transcodingErrorInfo(
  code: string | null | undefined
): TranscodingErrorCodeInfo {
  const category = CODE_CATEGORY[toTranscodingErrorCode(code)];
  return { category, ...CATEGORY_POLICY[category] };
}

/**
 * The codes the transcoding JOB can report about itself. The dispatch and
 * reconciliation codes describe what this side saw; a failure webhook
 * claiming one (a transient TRANSCODER_* would put a failed job back to
 * waiting; UPLOAD_INCOMPLETE would silence every email) is not believed.
 */
const JOB_ERROR_CODES: ReadonlySet<TranscodingErrorCode> = new Set([
  'CORRUPT_INPUT',
  'UNSUPPORTED_CODEC',
  'INVALID_DURATION',
  'MISSING_STREAM',
  'OUTPUT_VALIDATION_FAILED',
  'INFRA_ERROR',
] as const);

/** A failure webhook's `errorCode`: a job-side code, else INFRA_ERROR. */
export function toJobErrorCode(value: unknown): TranscodingErrorCode {
  const code = toTranscodingErrorCode(value);
  return JOB_ERROR_CODES.has(code) ? code : TRANSCODING_ERROR_CODES.INFRA_ERROR;
}

/**
 * Accepted RunPod jobs per media item; `media_items` CHECKs the same bound.
 * An attempt is counted when a job is CLAIMED for dispatch, once.
 */
export const MAX_TRANSCODING_ATTEMPTS = 3;

/**
 * The job-input contract this build sends the handler (`input.contract`).
 * 2 = posters in the sized image layout. The handler keeps the old layout for
 * any job without it, so a newer image never breaks an older worker.
 */
export const TRANSCODING_JOB_CONTRACT = 2;

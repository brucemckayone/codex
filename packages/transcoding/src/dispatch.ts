/**
 * Pure rules of the transcoding dispatch state machine (Codex-l2c48.4).
 *
 * No I/O: TranscodingService applies these. Kept apart so every rule is
 * unit-tested without a database or a network.
 */

import {
  TRANSCODING_ERROR_CODES,
  type TranscodingErrorCode,
  toJobErrorCode,
} from '@codex/constants';
import { runpodWebhookUnionSchema, uuidSchema } from '@codex/validation';
import type { RunPodWebhookUnionPayload } from './types';

// ============================================================================
// RunPod /run answers
// ============================================================================

/**
 * What a `/run` answer means for the claimed row.
 *
 * - accepted: RunPod queued a job; store its id.
 * - rejected: RunPod definitely did not queue one. The row waits in
 *   `uploaded` with `code`, and the attempt is given back.
 * - ambiguous: RunPod may have queued one (timeout, network error, a 2xx we
 *   cannot read). The row stays `transcoding`; the maintenance cron asks
 *   RunPod (Codex-l2c48.5).
 */
export type RunPodDispatchOutcome =
  | { kind: 'accepted'; jobId: string }
  | { kind: 'rejected'; code: TranscodingErrorCode; detail: string }
  | { kind: 'ambiguous'; detail: string };

const MISCONFIGURED_STATUSES: ReadonlySet<number> = new Set([
  400, 401, 403, 404, 422,
]);

/**
 * A gateway's own error after it reached RunPod (bad or no response, a
 * timeout): RunPod may have queued the job before the gateway gave up.
 * Cloudflare's 521-523 never reached RunPod, so they stay refusals.
 */
const MAYBE_QUEUED_STATUSES: ReadonlySet<number> = new Set([
  502, 504, 520, 524,
]);

/** The body as a JSON object, or undefined when it is not one. */
export function parseObject(body: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function rawString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** RunPod's short machine code from an error body, e.g. ENDPOINT_PAUSED. */
function apiCodeOf(body: string): string | undefined {
  const code = parseObject(body)?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,49}$/.test(code)
    ? code
    : undefined;
}

function rejectionCode(
  status: number,
  apiCode: string | undefined
): TranscodingErrorCode {
  if (status === 409 && apiCode === 'ENDPOINT_PAUSED') {
    return TRANSCODING_ERROR_CODES.TRANSCODER_PAUSED;
  }
  if (status === 429) return TRANSCODING_ERROR_CODES.TRANSCODER_BUSY;
  if (MISCONFIGURED_STATUSES.has(status)) {
    return TRANSCODING_ERROR_CODES.TRANSCODER_MISCONFIGURED;
  }
  return TRANSCODING_ERROR_CODES.TRANSCODER_UNAVAILABLE;
}

/**
 * Classify a `/run` HTTP answer.
 *
 * `detail` becomes `transcodingError`, which only the logs and the owner's
 * failure email read (no API serves it; the creator sees the sentence for the
 * code). It names the status and RunPod's machine code only; the body belongs
 * in the logs.
 */
export function classifyRunPodAnswer(
  status: number,
  body: string
): RunPodDispatchOutcome {
  if (status >= 200 && status < 300) {
    const jobId = rawString(parseObject(body)?.id);
    // A 2xx we cannot read may still have queued a job.
    return jobId
      ? { kind: 'accepted', jobId }
      : {
          kind: 'ambiguous',
          detail: `RunPod answered ${status} without a job id`,
        };
  }

  const apiCode = apiCodeOf(body);
  const detail = `RunPod answered ${status}${apiCode ? ` (${apiCode})` : ''}`;
  if (MAYBE_QUEUED_STATUSES.has(status)) {
    return { kind: 'ambiguous', detail };
  }
  return { kind: 'rejected', code: rejectionCode(status, apiCode), detail };
}

// ============================================================================
// Per-job policy
// ============================================================================

const MINUTE_MS = 60 * 1000;
export const MIN_EXECUTION_TIMEOUT_MS = 30 * MINUTE_MS;
const MAX_EXECUTION_TIMEOUT_MS = 6 * 60 * MINUTE_MS;
/**
 * The length is unknown exactly when the browser could not read the file
 * (an iPhone HEVC .mov, say), and those can be long. Owner, 2026-10-24.
 */
const UNKNOWN_DURATION_TIMEOUT_MS = 2 * 60 * MINUTE_MS;
/** Time a queued job may wait for a worker before RunPod drops it. */
const QUEUE_ALLOWANCE_MS = 60 * MINUTE_MS;

/**
 * RunPod's per-request `policy` (milliseconds). The maintenance cron treats a
 * `transcoding` row as lost only past `executionTimeout`, so it reads the
 * same function.
 */
export function transcodingJobPolicy(durationSeconds: number | null): {
  executionTimeout: number;
  ttl: number;
} {
  const executionTimeout =
    durationSeconds && durationSeconds > 0
      ? Math.min(
          MAX_EXECUTION_TIMEOUT_MS,
          Math.max(
            MIN_EXECUTION_TIMEOUT_MS,
            15 * MINUTE_MS + 5 * durationSeconds * 1000
          )
        )
      : UNKNOWN_DURATION_TIMEOUT_MS;
  return { executionTimeout, ttl: executionTimeout + QUEUE_ALLOWANCE_MS };
}

// ============================================================================
// Failure webhooks
// ============================================================================

/**
 * The code and detail a failure webhook records.
 *
 * A job can only claim a job-side code (toJobErrorCode): a job claiming
 * TRANSCODER_PAUSED would send the row back to waiting. A raw value we do not
 * recognise stays visible in the detail, and `unrecognisedCode` tells the
 * caller to log it. The write cuts the detail to the column.
 */
export function jobFailureFromWebhook(
  rawCode: unknown,
  message: string | undefined
): {
  code: TranscodingErrorCode;
  detail: string;
  unrecognisedCode?: string;
} {
  const code = toJobErrorCode(rawCode);
  const text = message || 'Unknown transcoding error';
  // Missing is an older handler; anything else that did not survive as sent
  // (an unknown code, one only our side may set, a non-string) is drift.
  if (
    rawCode !== undefined &&
    rawCode !== null &&
    rawCode !== '' &&
    rawCode !== code
  ) {
    const unrecognisedCode = String(rawCode).slice(0, 100);
    return {
      code,
      detail: `[raw:${unrecognisedCode}] ${text}`,
      unrecognisedCode,
    };
  }
  return { code, detail: text };
}

// ============================================================================
// Webhook payloads
// ============================================================================

/**
 * What the webhook route does with a signed payload.
 *
 * - valid: process it.
 * - rejected-terminal: a completion or failure our schema rejects. The job is
 *   over, so the row must not wait 2 h for the cron: mark it failed
 *   (OUTPUT_REJECTED) via the ids the raw payload carries.
 * - rejected-progress: a progress update we cannot read; nothing to do.
 * - unreadable: not a webhook at all.
 */
export type WebhookPayloadClass =
  | { kind: 'valid'; payload: RunPodWebhookUnionPayload }
  | {
      kind: 'rejected-terminal';
      jobId: string | null;
      mediaId: string | null;
      issues: string;
    }
  | { kind: 'rejected-progress'; issues: string }
  | { kind: 'unreadable'; issues: string };

function rawUuid(value: unknown): string | null {
  const parsed = uuidSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function classifyWebhookPayload(raw: unknown): WebhookPayloadClass {
  const parsed = runpodWebhookUnionSchema.safeParse(raw);
  if (parsed.success) {
    return { kind: 'valid', payload: parsed.data };
  }

  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ')
    .slice(0, 1000);

  if (!raw || typeof raw !== 'object') {
    return { kind: 'unreadable', issues };
  }
  const body = raw as Record<string, unknown>;

  if (body.status === 'completed' || body.status === 'failed') {
    const output =
      body.output && typeof body.output === 'object'
        ? (body.output as Record<string, unknown>)
        : undefined;
    return {
      kind: 'rejected-terminal',
      jobId: rawString(body.jobId),
      mediaId: rawUuid(body.mediaId) ?? rawUuid(output?.mediaId),
      issues,
    };
  }
  if (body.status === 'progress') {
    return { kind: 'rejected-progress', issues };
  }
  return { kind: 'unreadable', issues };
}

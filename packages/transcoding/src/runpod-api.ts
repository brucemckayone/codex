/**
 * RunPod's API beyond /run: read and raise the endpoint's max workers, ask
 * after a job, and keep the endpoint awake (Codex-l2c48.5).
 *
 * RunPod "pauses" an idle endpoint by setting its max workers to 0 (2 after
 * three idle days, 0 after seven); there is no paused flag, and the 409
 * ENDPOINT_PAUSED that /run answers is undocumented. So "is it paused" is
 * always read from `workers.max`.
 *
 * Management calls use REST v2 (api.runpod.io/v2/serverless): REST v1
 * (rest.runpod.io/v1) is retired on 2026-11-15. Job calls use the serverless
 * API that /run lives on.
 *
 * Every call takes a deadline and NEVER throws: callers run in a cron or after
 * a response, where a throw is only a lost log line. With `directUrl` set
 * (a local container, which implements /run only) every call is `unsupported`.
 */

import { HEADERS, MIME_TYPES } from '@codex/constants';
import { parseObject } from './dispatch';

/** The serverless API /run and /status live on. */
export const RUNPOD_SERVERLESS_API_URL = 'https://api.runpod.ai/v2';
/** REST v2, where an endpoint's settings live. */
const RUNPOD_MANAGEMENT_API_URL = 'https://api.runpod.io/v2';

/** Why a call produced no answer. */
export type RunPodApiFailureReason =
  | 'not_permitted' // 401/403: the key may not do this (a read-only key)
  | 'not_found' // 404
  | 'unavailable' // 5xx, 429, network error, timeout
  | 'unreadable' // a 2xx whose body we cannot read
  | 'out_of_time' // the deadline passed, before or during the call
  | 'unsupported'; // a local container: no management API

/** A failure that says nothing about the setup: try again later. */
export function isPassingFailure(reason: string): boolean {
  return reason === 'unavailable' || reason === 'out_of_time';
}

interface RunPodApiFailure {
  ok: false;
  reason: RunPodApiFailureReason;
  status?: number;
}

/** RunPod's job states (docs.runpod.io/serverless/endpoints/job-states). */
const RUNPOD_JOB_STATES = [
  'IN_QUEUE',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
] as const;
type RunPodJobState = (typeof RUNPOD_JOB_STATES)[number];

export type EndpointWorkersResult =
  | { ok: true; max: number }
  | RunPodApiFailure;

export type JobStatusResult =
  /** GONE: 404. Results are kept 30 min after a job ends, and a TTL expiry deletes the job. */
  { ok: true; state: RunPodJobState | 'GONE' } | RunPodApiFailure;

type PingResult = { ok: true } | RunPodApiFailure;

export interface RunPodApiConfig {
  apiKey: string;
  endpointId: string;
  /** Default RUNPOD_SERVERLESS_API_URL. Management calls always use REST v2. */
  serverlessBaseUrl?: string;
  /** A local container: management calls are unsupported. */
  directUrl?: string;
}

/** The longest any one call may take, whatever the deadline. */
const CALL_CAP_MS = 8000;

export function failureFromStatus(status: number): RunPodApiFailure {
  if (status === 401 || status === 403) {
    return { ok: false, reason: 'not_permitted', status };
  }
  if (status === 404) return { ok: false, reason: 'not_found', status };
  return { ok: false, reason: 'unavailable', status };
}

/** `workers.max` from a REST v2 endpoint body. */
export function workersMaxOf(text: string): number | undefined {
  const workers = parseObject(text)?.workers;
  const max =
    workers && typeof workers === 'object'
      ? (workers as { max?: unknown }).max
      : undefined;
  return typeof max === 'number' && Number.isInteger(max) && max >= 0
    ? max
    : undefined;
}

/**
 * A /status body's state, or undefined for one we do not recognise. Its
 * `error` text is not read: RunPod's words never reach a creator.
 */
export function jobStateOf(text: string): RunPodJobState | undefined {
  const status = parseObject(text)?.status;
  return typeof status === 'string' &&
    (RUNPOD_JOB_STATES as readonly string[]).includes(status)
    ? (status as RunPodJobState)
    : undefined;
}

export class RunPodApi {
  private readonly apiKey: string;
  private readonly endpointId: string;
  private readonly serverlessBaseUrl: string;
  private readonly unsupported: boolean;

  constructor(config: RunPodApiConfig) {
    this.apiKey = config.apiKey;
    this.endpointId = config.endpointId;
    this.serverlessBaseUrl =
      config.serverlessBaseUrl || RUNPOD_SERVERLESS_API_URL;
    this.unsupported = Boolean(config.directUrl);
  }

  /** The endpoint's max workers: 0 means paused. */
  async endpointWorkers(deadline: number): Promise<EndpointWorkersResult> {
    const answer = await this.call(
      `${RUNPOD_MANAGEMENT_API_URL}/serverless/${this.endpointId}`,
      { method: 'GET' },
      deadline
    );
    if (!answer.ok) return answer;
    const max = workersMaxOf(answer.text);
    return max === undefined
      ? { ok: false, reason: 'unreadable', status: answer.status }
      : { ok: true, max };
  }

  /** Raise (or set) max workers: the only way to un-pause an endpoint. */
  async setWorkersMax(
    max: number,
    deadline: number
  ): Promise<EndpointWorkersResult> {
    const answer = await this.call(
      `${RUNPOD_MANAGEMENT_API_URL}/serverless/${this.endpointId}`,
      // A partial update: only `workers.max` changes.
      { method: 'PATCH', body: JSON.stringify({ workers: { max } }) },
      deadline
    );
    if (!answer.ok) return answer;
    const confirmed = workersMaxOf(answer.text);
    return confirmed === undefined
      ? { ok: false, reason: 'unreadable', status: answer.status }
      : { ok: true, max: confirmed };
  }

  async jobStatus(jobId: string, deadline: number): Promise<JobStatusResult> {
    const answer = await this.call(
      `${this.serverlessBaseUrl}/${this.endpointId}/status/${encodeURIComponent(jobId)}`,
      { method: 'GET' },
      deadline
    );
    if (!answer.ok) {
      return answer.reason === 'not_found'
        ? { ok: true, state: 'GONE' }
        : answer;
    }
    const state = jobStateOf(answer.text);
    return state
      ? { ok: true, state }
      : { ok: false, reason: 'unreadable', status: answer.status };
  }

  /**
   * Keep the endpoint from auto-pausing: any incoming request resets RunPod's
   * idle clock. A low-priority job with a 10 s TTL "won't trigger worker
   * scaling", so it expires without starting (and billing) a GPU worker. An
   * accepted ping is the whole signal: what the job does after is not.
   */
  async ping(contract: number, deadline: number): Promise<PingResult> {
    const answer = await this.call(
      `${this.serverlessBaseUrl}/${this.endpointId}/run`,
      {
        method: 'POST',
        body: JSON.stringify({
          input: { ping: true, contract },
          policy: { lowPriority: true, ttl: 10_000, executionTimeout: 60_000 },
        }),
      },
      deadline
    );
    return answer.ok ? { ok: true } : answer;
  }

  private async call(
    url: string,
    init: { method: string; body?: string },
    deadline: number
  ): Promise<{ ok: true; status: number; text: string } | RunPodApiFailure> {
    if (this.unsupported) return { ok: false, reason: 'unsupported' };
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { ok: false, reason: 'out_of_time' };

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          [HEADERS.AUTHORIZATION]: `Bearer ${this.apiKey}`,
          ...(init.body && {
            [HEADERS.CONTENT_TYPE]: MIME_TYPES.APPLICATION.JSON,
          }),
        },
        signal: AbortSignal.timeout(Math.min(remaining, CALL_CAP_MS)),
      });
      const text = await response.text();
      return response.ok
        ? { ok: true, status: response.status, text }
        : failureFromStatus(response.status);
    } catch (error) {
      // AbortSignal.timeout: the deadline (or the per-call cap) ran out.
      return error instanceof Error && error.name === 'TimeoutError'
        ? { ok: false, reason: 'out_of_time' }
        : { ok: false, reason: 'unavailable' };
    }
  }
}

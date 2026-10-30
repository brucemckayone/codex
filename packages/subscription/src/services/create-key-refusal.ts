/**
 * Stripe's refusals of a create under keys that survive a retry
 * (Codex-2hxff.66): a tier's keys carry the dialog's submissionId, a course
 * plan's its course, plan generation and UTC hour. A deterministic key can be
 * refused where a random one never was, and each refusal tells the caller
 * something different, so each is a typed error with a code. The context holds
 * ids only: it is sent to the client.
 */

import {
  ConflictError,
  type ServiceError,
  ServiceUnavailableError,
} from '@codex/service-errors';

/** Stripe SDK error types for Stripe failing, not refusing what was sent. */
const STRIPE_UNAVAILABLE_TYPES = new Set([
  'StripeAPIError',
  'StripeConnectionError',
  'StripeRateLimitError',
]);

const HOUR_MS = 3_600_000;

/** What is being created, and the codes its refusals carry. */
export interface CreateKeySubject {
  noun: string;
  /** The same key with different parameters. */
  reusedCode: string;
  /** The same key while its first request still runs. */
  inProgressCode: string;
}

/**
 * The typed error for a Stripe refusal of a create, or null for any other
 * error (left to `handleError`).
 *
 * - The same key with different parameters: `reusedCode`, 409. The key is
 *   spent on other values; a tier's dialog mints a new submissionId.
 * - The same key while its first request still runs, past the SDK's own
 *   retries: `inProgressCode`, 409. Retry the same key in a moment.
 * - Stripe failing: `STRIPE_UNAVAILABLE`, 503, with Stripe's error as its
 *   `cause`. Nothing was saved, because the row is written only after every
 *   Stripe create. Stripe replays a failure it saved under a key for 24
 *   hours, so a tier's dialog mints a new id.
 *
 * `keyedAt` is for keys that carry the UTC hour (course plans): the instant
 * that hour was read from. A reused key and a failure Stripe stored under it
 * both hold until the key changes, which is when the hour turns, so those two
 * refusals say so and carry `retryAfter`, the start of the next hour as an
 * ISO-8601 UTC string. It is the key's own instant, never the clock now: a
 * refusal that lands after the hour turned still names the key's next hour.
 */
export function createKeyRefusal(
  error: unknown,
  subject: CreateKeySubject,
  context: Record<string, string>,
  keyedAt?: number
): ServiceError | null {
  if (!(error instanceof Error)) return null;
  const { type, code } = error as { type?: unknown; code?: unknown };
  const untilTheHour =
    keyedAt === undefined
      ? undefined
      : {
          message: `Stripe couldn't save this ${subject.noun}, and nothing was saved. You can try again after the top of the hour.`,
          retryAfter: new Date(
            (Math.floor(keyedAt / HOUR_MS) + 1) * HOUR_MS
          ).toISOString(),
        };
  const retryAfter = untilTheHour && { retryAfter: untilTheHour.retryAfter };

  if (code === 'idempotency_key_in_use') {
    return new ConflictError(
      `This ${subject.noun} is still being created. Try again in a moment.`,
      { ...context, code: subject.inProgressCode },
      { cause: error }
    );
  }
  if (type === 'StripeIdempotencyError') {
    return new ConflictError(
      untilTheHour?.message ??
        `This ${subject.noun} was already being created with different details. Refresh and try again.`,
      { ...context, code: subject.reusedCode, ...retryAfter },
      { cause: error }
    );
  }
  if (typeof type === 'string' && STRIPE_UNAVAILABLE_TYPES.has(type)) {
    return new ServiceUnavailableError(
      untilTheHour?.message ??
        `Stripe could not create the ${subject.noun}, so nothing was saved. Try again.`,
      { ...context, code: 'STRIPE_UNAVAILABLE', ...retryAfter },
      // The pages act on details.code and retryAfter: a new key, a retry time.
      { cause: error, publicContext: true }
    );
  }
  return null;
}

/**
 * Stripe's own account of a refused create, for the log line only: its
 * message is Stripe's text, and its request id is what Stripe's request log
 * and support are searched by. Never put these in a refusal's context.
 */
export function stripeRefusalDetail(error: unknown) {
  const { type, code, message, requestId, statusCode } = error as {
    type?: unknown;
    code?: unknown;
    message?: unknown;
    requestId?: unknown;
    statusCode?: unknown;
  };
  return {
    stripeType: type,
    stripeCode: code,
    stripeMessage: message,
    stripeRequestId: requestId,
    statusCode,
  };
}

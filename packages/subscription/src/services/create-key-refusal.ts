/**
 * Stripe's refusals of a create under keys that survive a retry
 * (Codex-2hxff.66): a tier's keys carry the dialog's submissionId, a course
 * plan's its course and plan generation. A deterministic key can be refused
 * where a random one never was, and each refusal tells the caller something
 * different, so each is a typed error with a code. The context holds ids only:
 * it is sent to the client.
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
 * - Stripe failing: `STRIPE_UNAVAILABLE`, 503. Nothing was saved, because the
 *   row is written only after every Stripe create. Stripe replays a failure it
 *   saved under a key for 24 hours, so a tier's dialog mints a new id.
 */
export function createKeyRefusal(
  error: unknown,
  subject: CreateKeySubject,
  context: Record<string, string>
): ServiceError | null {
  if (!(error instanceof Error)) return null;
  const { type, code } = error as { type?: unknown; code?: unknown };
  if (code === 'idempotency_key_in_use') {
    return new ConflictError(
      `This ${subject.noun} is still being created. Try again in a moment.`,
      { ...context, code: subject.inProgressCode },
      { cause: error }
    );
  }
  if (type === 'StripeIdempotencyError') {
    return new ConflictError(
      `This ${subject.noun} was already being created with different details. Refresh and try again.`,
      { ...context, code: subject.reusedCode },
      { cause: error }
    );
  }
  if (typeof type === 'string' && STRIPE_UNAVAILABLE_TYPES.has(type)) {
    return new ServiceUnavailableError(
      `Stripe could not create the ${subject.noun}, so nothing was saved. Try again.`,
      { ...context, code: 'STRIPE_UNAVAILABLE' }
    );
  }
  return null;
}

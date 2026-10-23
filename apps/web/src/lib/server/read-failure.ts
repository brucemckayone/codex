/**
 * Logging for a failed read that a page survives: a creator's content on their
 * public pages (Codex-osuqt), a detail page's related strip, its journey
 * cross-link. The page still renders, with an error state or without the
 * section, so this log is the only trace of the failure.
 */
import { ApiError } from '$lib/api/errors';
import { logger } from '$lib/observability';

/**
 * The log fields of a failed worker call, shared by every log of one.
 *
 * A 4xx other than 408 or 429 means OUR request was malformed: a contract bug
 * (a schema change, a renamed parameter, deploy skew). Its log carries the
 * worker's `details` (each issue's path and static message, never an input
 * value) naming the field it refused, because the message alone is always
 * "Invalid request data". That is how a uuid-only creatorId refused every real
 * creator while the profile said they had published nothing. Anything else (a
 * 5xx, a timeout, a rate limit, a network failure) is an outage.
 */
export function apiErrorFields(error: unknown): {
  ourRequestWasWrong: boolean;
  fields: { status?: number; code?: string; details?: unknown };
} {
  const apiError = error instanceof ApiError ? error : undefined;
  const status = apiError?.status;
  const ourRequestWasWrong =
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429;
  return {
    ourRequestWasWrong,
    fields: {
      status,
      code: apiError?.code,
      details: ourRequestWasWrong ? apiError?.details : undefined,
    },
  };
}

/** Logs a survived read failure: our contract bug as an error, an outage as a warning. */
export function logReadFailure(
  message: string,
  context: Record<string, unknown>,
  error: unknown
): void {
  const { ourRequestWasWrong, fields } = apiErrorFields(error);
  const level = ourRequestWasWrong ? 'error' : 'warn';
  logger[level](message, {
    ...context,
    ...fields,
    error: error instanceof Error ? error.message : String(error),
  });
}

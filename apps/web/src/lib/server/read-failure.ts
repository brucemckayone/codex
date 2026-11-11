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

/** The events a signed-in read logs a forwarded 4xx under, named in full so a log line greps back to its read. */
export interface RefusedReadEvents {
  /** The worker said no: the session, a role, a rate limit, or our request. */
  refused: string;
  /** The worker did not answer in time: the api client's own abort (408). */
  unavailable: string;
}

/**
 * Runs a SIGNED-IN read whose 4xx goes on to the page (`forwardClientErrors`),
 * logging that 4xx first. Kit skips `handleError`, and so its server log, for
 * an `HttpError`, so a forwarded 4xx was logged nowhere unless every page that
 * reads it logged its own (Codex-a6ofh.3.1 review). A 5xx is left to escape to
 * `handleError`, which logs it.
 *
 * Its levels are a signed-in route's, not `apiErrorFields`' public-page rule,
 * where any 4xx but 408 and 429 is our bug. Behind a session:
 *
 * - 401, 403: the session ended (a sign-out in another tab) or the caller
 *   lacks the role. A refusal: warn. As an error, every sign-out would page.
 * - 429: the caller's rate limit. Warn: anyone can raise it at will, so it
 *   never reaches an error alert (Codex-osuqt's class). The page's own log
 *   says what the creator saw.
 * - 408: the worker did not answer. An outage: error, as the studio's client
 *   logs call one, under `unavailable`, never a "refusal".
 * - Any other 4xx: our request was wrong, a contract bug. Error, with the
 *   worker's `details` naming the field it refused (`logReadFailure`).
 *
 * `context` must never carry what the creator typed (a search, a slug).
 */
export async function logRefusedRead<T>(
  events: RefusedReadEvents,
  context: Record<string, unknown>,
  read: () => Promise<T>
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (
      ApiError.isApiError(error) &&
      error.status >= 400 &&
      error.status < 500
    ) {
      logRefusal(events, context, error);
    }
    throw error;
  }
}

function logRefusal(
  events: RefusedReadEvents,
  context: Record<string, unknown>,
  error: ApiError
): void {
  const fields = {
    ...context,
    status: error.status,
    code: error.code,
    error: error.message,
  };
  switch (error.status) {
    case 401:
    case 403:
    case 429:
      logger.warn(events.refused, fields);
      return;
    case 408:
      logger.error(events.unavailable, fields);
      return;
    default:
      logReadFailure(events.refused, context, error);
  }
}

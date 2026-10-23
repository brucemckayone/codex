/**
 * Logging for a failed read that a page survives: a creator's content on their
 * public pages (Codex-osuqt), a detail page's related strip, its journey
 * cross-link. The page still renders, with an error state or without the
 * section, so this log is the only trace of the failure.
 */
import { ApiError } from '$lib/api/errors';
import { logger } from '$lib/observability';

/**
 * A 4xx other than 408 or 429 means OUR request was malformed: a contract bug
 * (a schema change, a renamed parameter, deploy skew), so it logs as an error,
 * with the worker's `details` (each issue's path and static message, never an
 * input value) naming the field it refused. That is how a uuid-only creatorId
 * refused every real creator while the profile said they had published
 * nothing. Anything else (5xx, a timeout, a network failure) is an outage and
 * logs as a warning.
 */
export function logReadFailure(
  message: string,
  context: Record<string, unknown>,
  error: unknown
): void {
  const apiError = error instanceof ApiError ? error : undefined;
  const status = apiError?.status;
  const ourRequestWasWrong =
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429;
  const level = ourRequestWasWrong ? 'error' : 'warn';
  logger[level](message, {
    ...context,
    status,
    code: apiError?.code,
    details: ourRequestWasWrong ? apiError?.details : undefined,
    error: error instanceof Error ? error.message : String(error),
  });
}

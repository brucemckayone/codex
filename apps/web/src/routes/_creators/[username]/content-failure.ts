/**
 * Logging for a failed read of a creator's content on their public pages
 * (Codex-osuqt). The page still renders, with an error state rather than its
 * "hasn't published" empty state.
 */
import { ApiError } from '$lib/api/errors';
import { logger } from '$lib/observability';

/**
 * A 4xx other than 408 or 429 means OUR request was malformed: a contract bug
 * (a schema change, a renamed parameter, deploy skew), so it logs as an error.
 * That is how a uuid-only creatorId refused every real creator while the
 * profile said they had published nothing. Anything else (5xx, a timeout, a
 * network failure) is an outage and logs as a warning.
 */
export function logCreatorContentFailure(
  message: string,
  creatorId: string,
  error: unknown
): void {
  const status = error instanceof ApiError ? error.status : undefined;
  const ourRequestWasWrong =
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429;
  const level = ourRequestWasWrong ? 'error' : 'warn';
  logger[level](message, {
    creatorId,
    status,
    code: error instanceof ApiError ? error.code : undefined,
    error: error instanceof Error ? error.message : String(error),
  });
}

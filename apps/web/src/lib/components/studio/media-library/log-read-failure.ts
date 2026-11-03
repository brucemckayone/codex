/**
 * How the media surfaces log a failed read or write (the library, its drawer,
 * the picker): an outage as an error, a refusal as a warning. One rule, so an
 * alert on `logger.error` sees the same failures from every surface. A
 * timeout (408) and a rate limit (429) are outages here, as the library's
 * `listRefused` reads them: they pass, and a Try again can help.
 */
import { logger } from '$lib/observability';
import { queryErrorMessage, remoteErrorStatus } from '$lib/remote/query-result';

export function logReadFailure(
  event: string,
  error: unknown,
  extra: Record<string, unknown> = {}
): void {
  const status = remoteErrorStatus(error);
  const fields = { ...extra, status, error: queryErrorMessage(error) };
  // No status: it never reached the worker, which is an outage too.
  const outage =
    status === undefined || status >= 500 || status === 408 || status === 429;
  if (outage) logger.error(event, fields);
  else logger.warn(event, fields);
}

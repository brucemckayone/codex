/**
 * What `handleError` logs about a request whose load threw (Codex-osuqt).
 *
 * Both content detail pages let a failed worker read through as a 500, so this
 * is the only log of it. A worker's status, code and (for our own malformed
 * request) `details` are what tell an outage from a contract 400 or a timeout:
 * without them, a Cloudflare 5xx (an HTML body, so the message falls back to
 * "API Error") read the same as any other failure. `method` used to be handed
 * the query string. The host and path, not the href, keep query strings (a
 * checkout `session_id`, a search) out of logs; the host is kept because an
 * org's slug lives only there.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import { apiErrorFields } from './read-failure';

type LoggedEvent = Pick<RequestEvent, 'request' | 'url' | 'locals'>;

export function errorLogContext(
  error: unknown,
  event: LoggedEvent,
  responseStatus?: number
): Record<string, unknown> {
  return {
    requestId: event.locals.requestId,
    host: event.url.host,
    url: event.url.pathname,
    method: event.request.method,
    responseStatus,
    ...apiErrorFields(error).fields,
  };
}

/**
 * Logs an error SvelteKit hands `handleError`. It is also called for every
 * unmatched route, with a 404: a crawler's miss is a warning, not a crash, so
 * only a response status of 500 or more is tracked as an error.
 */
export function logUnhandledError(
  error: unknown,
  event: LoggedEvent,
  responseStatus: number
): void {
  const context = errorLogContext(error, event, responseStatus);
  if (responseStatus < 500) {
    logger.warn(
      error instanceof Error ? error.message : String(error),
      context
    );
    return;
  }
  logger.trackError(
    error instanceof Error ? error : new Error(String(error)),
    context
  );
}

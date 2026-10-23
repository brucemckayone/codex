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
 * SvelteKit's own 404 for a URL no route matches (`Not found: /path`), the
 * one error it hands `handleError` that a crawler, not our code, causes.
 */
function isUnmatchedRoute(error: unknown, responseStatus: number): boolean {
  return (
    responseStatus === 404 &&
    error instanceof Error &&
    error.message.startsWith('Not found:')
  );
}

/**
 * Logs an error SvelteKit hands `handleError`. It is also called for every
 * unmatched route: a crawler's miss is a warning, not a crash. Every other
 * error is tracked, including Kit's own sub-500 refusals of a form action (a
 * 404 for a renamed action, a 405), which a deploy of ours can cause.
 */
export function logUnhandledError(
  error: unknown,
  event: LoggedEvent,
  responseStatus: number
): void {
  const context = errorLogContext(error, event, responseStatus);
  if (isUnmatchedRoute(error, responseStatus)) {
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

/**
 * The body a status below 500 shows: SvelteKit's own refusal (an unmatched
 * route, a missing form action, a wrong method), whose `message` ("Not Found")
 * is safe to show. "An unexpected error occurred" told a visitor with a
 * mistyped URL the opposite of what happened. Null at 500 and above, which
 * keep the sanitised body.
 */
export function clientErrorBody(
  status: number,
  message: string
): App.Error | null {
  if (status >= 500) return null;
  return { message, code: status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST' };
}

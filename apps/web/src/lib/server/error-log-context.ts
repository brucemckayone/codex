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
 * SvelteKit's own refusals that a crawler or a scanner, not our code, causes:
 * the 404 for a URL no route matches (`Not found: /path`), and the 405 for a
 * POST to a page with no form actions at all (`… No form actions exist for
 * this page`). A renamed action's 404 (`No action with name …`) is a deploy
 * of ours, so it is not noise.
 */
function isCrawlerNoise(error: unknown, responseStatus: number): boolean {
  if (!(error instanceof Error)) return false;
  if (responseStatus === 404) return error.message.startsWith('Not found:');
  if (responseStatus === 405) {
    return error.message.includes('No form actions exist');
  }
  return false;
}

/**
 * Logs an error SvelteKit hands `handleError`. It is also called for every
 * unmatched route and every POST to a page without actions: a crawler's
 * noise is a warning, not a crash. Every other error is tracked, including a
 * renamed form action's 404.
 */
export function logUnhandledError(
  error: unknown,
  event: LoggedEvent,
  responseStatus: number
): void {
  const context = errorLogContext(error, event, responseStatus);
  if (isCrawlerNoise(error, responseStatus)) {
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

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
import { issuePaths, type ValidationIssue } from './validation-error';

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
 * True for a POST Kit handled as a remote `form()` submit: it does so only
 * when `?/remote=` has a value. Kit refuses a native submit to a remote form a
 * deploy renamed or moved with the same "no form actions" 405 a scanner gets.
 * The client chooses that param, so the 405 cannot be tracked (any script
 * could raise error-level alarms); it is a warning flagged `staleRemoteForm`,
 * whose rate after a deploy is the signal.
 */
function isRemoteFormPost(event: LoggedEvent): boolean {
  return Boolean(event.url.searchParams.get('/remote'));
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
    const staleRemoteForm = responseStatus === 405 && isRemoteFormPost(event);
    logger.warn(error instanceof Error ? error.message : String(error), {
      ...context,
      ...(staleRemoteForm && { staleRemoteForm }),
    });
    return;
  }
  logger.trackError(
    error instanceof Error ? error : new Error(String(error)),
    context
  );
}

/**
 * Logs a remote function's refused input (Codex-osuqt). Kit refuses it with
 * an HttpError, which never reaches `handleError`, so a page of ours sending
 * what a schema refuses (contract drift) left no trace. A warning, not
 * tracked: a remote function is a public endpoint any visitor can call. The
 * issue paths only, never the values.
 *
 * For a remote call Kit sets `event.url` to the page that made it, so the
 * function is named from the request's own path (`/_app/remote/<id>`), without
 * its `?payload=`, which carries the refused values.
 */
export function logRefusedRemoteInput(
  issues: readonly ValidationIssue[],
  event: LoggedEvent
): void {
  logger.warn('Remote function input refused', {
    requestId: event.locals.requestId,
    host: event.url.host,
    url: event.url.pathname,
    remote: new URL(event.request.url).pathname,
    method: event.request.method,
    issues: issuePaths(issues),
  });
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

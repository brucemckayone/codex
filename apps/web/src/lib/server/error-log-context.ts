/**
 * What the web server logs about a request it failed or refused (Codex-osuqt):
 * an error SvelteKit hands `handleError`, and a remote function's input that
 * its schema refused.
 *
 * Both content detail pages let a failed worker read through as a 500, so
 * `handleError` is the only log of it. A worker's status, code and (for our
 * own malformed request) `details` are what tell an outage from a contract 400
 * or a timeout: without them, a Cloudflare 5xx (an HTML body, so the message
 * falls back to "API Error") read the same as any other failure. `method` used
 * to be handed the query string. The host and path, not the href, keep query
 * strings (a checkout `session_id`, a search, a remote `?payload=`) out of
 * logs; the host is kept because an org's slug lives only there.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { logger } from '$lib/observability';
import { apiErrorFields } from './read-failure';
import { issuePaths, type ValidationIssue } from './validation-error';

type LoggedEvent = Pick<RequestEvent, 'request' | 'url' | 'locals'>;
type RemoteInputEvent = LoggedEvent & Pick<RequestEvent, 'isRemoteRequest'>;

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
 * True for an error that is SvelteKit refusing the request, which the
 * request, not our code, caused. Below 500 it always is: an HttpError never
 * reaches `handleError`, so a status below 500 there is one of Kit's own
 * refusals (an unmatched route, a missing form action, a wrong method or
 * content type), and the client chose everything that decided it. So is the
 * 500 for a POST naming Kit's reserved `default` action. They are warnings,
 * never tracked, so no script can raise error-level alarms with them.
 */
function isRequestRefusal(error: unknown, responseStatus: number): boolean {
  if (responseStatus < 500) return true;
  return (
    error instanceof Error &&
    error.message === 'Cannot use reserved action name "default"'
  );
}

/**
 * The refusals that can also mean a deploy of ours broke a page, flagged so
 * their rate after a deploy is the signal: a POST to a form action that no
 * longer exists, and a native POST to a remote `form()` that was renamed or
 * moved, which Kit refuses with the 405 a page without actions gets. Kit takes
 * a POST as a remote-form submit only when `?/remote=` has a value.
 */
function deployFlags(
  error: unknown,
  event: LoggedEvent,
  responseStatus: number
): { staleAction?: true; staleRemoteForm?: true } {
  const message = error instanceof Error ? error.message : '';
  if (responseStatus === 404 && message.startsWith('No action with name')) {
    return { staleAction: true };
  }
  if (
    responseStatus === 405 &&
    message.includes('No form actions exist') &&
    event.url.searchParams.get('/remote')
  ) {
    return { staleRemoteForm: true };
  }
  return {};
}

/**
 * Logs an error SvelteKit hands `handleError`: Kit's refusal of the request
 * as a warning (see {@link isRequestRefusal}), anything else tracked.
 */
export function logUnhandledError(
  error: unknown,
  event: LoggedEvent,
  responseStatus: number
): void {
  const context = errorLogContext(error, event, responseStatus);
  if (isRequestRefusal(error, responseStatus)) {
    logger.warn(error instanceof Error ? error.message : String(error), {
      ...context,
      ...deployFlags(error, event, responseStatus),
    });
    return;
  }
  logger.trackError(
    error instanceof Error ? error : new Error(String(error)),
    context
  );
}

/** How many issue paths one refusal log names; `issueCount` carries the rest. */
const MAX_LOGGED_ISSUES = 10;

/**
 * Requests whose refused input is already logged. A `query.batch` validates
 * every payload of one request, so without this one request wrote one line
 * per payload.
 */
const refusalsLogged = new WeakSet<Request>();

/**
 * Logs a remote function's refused input, once per request. Kit refuses it
 * with an HttpError, which never reaches `handleError`, so without this a
 * refusal left no trace. The issue paths only (at most
 * {@link MAX_LOGGED_ISSUES}), never the values: Zod checks every element of an
 * array before its length, so one oversized payload carried tens of thousands.
 *
 * A browser call (`isRemoteRequest`) can come from any client, so it is a
 * warning. Kit sets its `event.url` to the page that made it, so the function
 * is named from the request's own path (`/_app/remote/<id>`), without the
 * `?payload=` that carries the refused values. A call from one of our server
 * loads runs with the page's own event, so it names no function, and our code
 * built the arguments: contract drift, logged as an error.
 */
export function logRefusedRemoteInput(
  issues: readonly ValidationIssue[],
  event: RemoteInputEvent
): void {
  if (refusalsLogged.has(event.request)) return;
  refusalsLogged.add(event.request);

  const context = {
    ...errorLogContext(undefined, event, 400),
    issueCount: issues.length,
    issues: issuePaths(issues.slice(0, MAX_LOGGED_ISSUES)),
  };
  if (event.isRemoteRequest) {
    logger.warn('Remote function input refused', {
      ...context,
      remote: new URL(event.request.url).pathname,
    });
    return;
  }
  logger.error('Remote function input refused by our own server load', context);
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

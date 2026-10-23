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

/** The form action a request names, as Kit reads it: the first `?/<name>` key. */
function namedAction(event: LoggedEvent): string | undefined {
  for (const [key] of event.url.searchParams) {
    if (key.startsWith('/')) return key.slice(1);
  }
  return undefined;
}

/** A native POST to a remote `form()`: Kit takes one only when `?/remote=` has a value. */
function isRemoteFormPost(event: LoggedEvent): boolean {
  return Boolean(event.url.searchParams.get('/remote'));
}

/**
 * True for an error that is SvelteKit refusing the request, which the
 * request, not our code, caused. Below 500 it always is: an HttpError never
 * reaches `handleError`, so a status below 500 there is one of Kit's own
 * refusals (an unmatched route, a missing form action, a wrong method or
 * content type), and the client chose everything that decided it. So is a 500
 * for a POST naming Kit's reserved `default` action or a member of
 * `Object.prototype` (`?/valueOf`, `?/__proto__`): Kit looks an action up on a
 * plain object, so those resolve to something that throws. They are warnings,
 * never tracked, so no script can raise error-level alarms with them.
 */
function isRequestRefusal(event: LoggedEvent, responseStatus: number): boolean {
  if (responseStatus < 500) return true;
  const action = namedAction(event);
  return (
    event.request.method === 'POST' &&
    action !== undefined &&
    !isRemoteFormPost(event) &&
    (action === 'default' || action in Object.prototype)
  );
}

/**
 * The refusals that can also mean a deploy of ours broke a page, flagged so
 * their rate after a deploy is the signal. `staleRemoteForm`: a native POST to
 * a remote `form()` that was renamed or moved, which Kit refuses with the 405
 * a page without actions gets. `staleAction`: a POST that named a form action
 * the page no longer has, which Kit refuses with a 404 while the page has
 * other actions and with that 405 once it has none. A POST naming no action
 * (Kit then looks for `default`) is a scanner's, so it is not flagged.
 */
function deployFlags(
  error: unknown,
  event: LoggedEvent,
  responseStatus: number
): { staleAction?: true; staleRemoteForm?: true } {
  const message = error instanceof Error ? error.message : '';
  const noActions =
    responseStatus === 405 && message.includes('No form actions exist');
  if (noActions && isRemoteFormPost(event)) return { staleRemoteForm: true };

  const action = namedAction(event);
  const namedPageAction = action !== undefined && action !== 'remote';
  const noSuchAction =
    responseStatus === 404 && message.startsWith('No action with name');
  if (namedPageAction && (noSuchAction || noActions)) {
    return { staleAction: true };
  }
  return {};
}

/** How much of Kit's own message a refusal log keeps. */
const MAX_KIT_MESSAGE = 200;

/**
 * Logs an error SvelteKit hands `handleError`: Kit's refusal of the request
 * as a warning (see {@link isRequestRefusal}), anything else tracked. A
 * refusal's message is constant: Kit's own text embeds what the client sent
 * (a path, an action name, a content type), so it goes in the metadata, which
 * the logger redacts, cut to {@link MAX_KIT_MESSAGE} characters.
 */
export function logUnhandledError(
  error: unknown,
  event: LoggedEvent,
  responseStatus: number
): void {
  const context = errorLogContext(error, event, responseStatus);
  if (isRequestRefusal(event, responseStatus)) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Request refused by SvelteKit', {
      ...context,
      kitMessage: message.slice(0, MAX_KIT_MESSAGE),
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
 * Each request's refusals already logged. A browser call logs once per
 * request: a `query.batch` validates every payload of one request, so it
 * wrote one line per payload. A server load's calls log once per distinct set
 * of refused fields, so a second call's drift is not hidden behind the first.
 */
const refusalsLogged = new WeakMap<Request, Set<string>>();

/** Whether this request's refusal, by `key`, is already logged; records it if not. */
function alreadyLogged(request: Request, key: string): boolean {
  const logged = refusalsLogged.get(request) ?? new Set<string>();
  if (logged.has(key)) return true;
  logged.add(key);
  refusalsLogged.set(request, logged);
  return false;
}

/** A remote call's function, `/_app/remote/<hash>/<name>`: no payload, no extra segments. */
function remoteFunctionPath(event: LoggedEvent): string {
  return new URL(event.request.url).pathname.split('/').slice(0, 5).join('/');
}

/**
 * Logs a remote function's refused input as a warning. Kit refuses it with an
 * HttpError, which never reaches `handleError`, so without this a refusal left
 * no trace. The issue paths only (at most {@link MAX_LOGGED_ISSUES}), never
 * the values: Zod checks every element of an array before its length, so one
 * oversized payload carried tens of thousands.
 *
 * A browser call (`isRemoteRequest`) can come from any client. Kit sets its
 * `event.url` to the page that made it, so the function is named from the
 * request's own path, without the `?payload=` that carries the refused values.
 * A refresh our own command or form issues runs under that call's event, so
 * it reads as that call. A call from one of our server loads runs with the
 * page's own event, so it names no function. Its arguments are ours, but a
 * load usually builds them from the page's URL, so a visitor can cause one by
 * editing it: a warning flagged `ownServerLoad`, never an error, so contract
 * drift stays queryable without any URL edit raising an alarm.
 */
export function logRefusedRemoteInput(
  issues: readonly ValidationIssue[],
  event: RemoteInputEvent
): void {
  const paths = issuePaths(issues.slice(0, MAX_LOGGED_ISSUES));
  const key = event.isRemoteRequest ? 'browser' : paths.join(',');
  if (alreadyLogged(event.request, key)) return;

  const refusal = { issueCount: issues.length, issues: paths };
  if (event.isRemoteRequest) {
    logger.warn('Remote function input refused', {
      ...errorLogContext(undefined, event, 400),
      remote: remoteFunctionPath(event),
      ...refusal,
    });
    return;
  }
  logger.warn('Remote function input refused', {
    ...errorLogContext(undefined, event),
    ownServerLoad: true,
    ...refusal,
  });
}

/**
 * The body a status below 500 shows: SvelteKit's own refusal (an unmatched
 * route, a missing form action, a wrong method), whose `message` ("Not Found")
 * is safe to show. "An unexpected error occurred" told a visitor with a
 * mistyped URL the opposite of what happened. Null at 500 and above, which
 * keep the sanitised body. That includes the 500s {@link isRequestRefusal}
 * counts as refusals, on purpose: Kit's message there is internal text
 * ("action is not a function"), not a reason a visitor can act on.
 */
export function clientErrorBody(
  status: number,
  message: string
): App.Error | null {
  if (status >= 500) return null;
  return { message, code: status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST' };
}

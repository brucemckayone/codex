/**
 * What `handleError` logs about a request whose load threw (Codex-osuqt).
 *
 * Both content detail pages let a failed worker read through as a 500, so this
 * is the only log of it. A worker's status and code are what tell an outage
 * from a contract 400 or a timeout: without them, a Cloudflare 5xx (an HTML
 * body, so the message falls back to "API Error") read the same as any other
 * failure. `method` used to be handed the query string; the path, not the
 * href, keeps query strings (a checkout `session_id`, a search) out of logs.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { ApiError } from '$lib/api/errors';

export function errorLogContext(
  error: unknown,
  event: Pick<RequestEvent, 'request' | 'url' | 'locals'>
): Record<string, unknown> {
  const apiError = error instanceof ApiError ? error : undefined;
  return {
    requestId: event.locals.requestId,
    url: event.url.pathname,
    method: event.request.method,
    status: apiError?.status,
    code: apiError?.code,
  };
}

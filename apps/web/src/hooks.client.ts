/**
 * Client hooks (Codex-l2c48.7): a failure in the browser reaches the logs.
 *
 * Three ways a browser fails without anyone hearing: a load or render throws
 * (SvelteKit's `handleError`), code outside SvelteKit throws (`error`), or a
 * promise nobody awaited rejects (`unhandledrejection`). Each is logged
 * through `$lib/observability`, whose production browser branch forwards
 * warnings and errors to POST /api/client-log (`$lib/client-log`), throttled
 * and redacted. In dev they print to the console as usual.
 *
 * What the visitor sees is unchanged: `handleError` returns SvelteKit's own
 * message.
 */

import type { ClientInit, HandleClientError } from '@sveltejs/kit';
import { describeThrown } from '$lib/client-log';
import { logger } from '$lib/observability';

export const handleError: HandleClientError = ({
  error,
  event,
  status,
  message,
}) => {
  // A 404 is a wrong link, not a fault.
  if (status !== 404) {
    logger.error('client.unhandled_error', {
      status,
      route: event.route.id,
      ...describeThrown(error),
    });
  }
  return { message };
};

export const init: ClientInit = () => {
  window.addEventListener('error', (event) => {
    // A cross-origin script (an extension, an embed) reports no error and
    // no detail: nothing anyone here could act on.
    if (!event.error) return;
    logger.error('client.uncaught_error', {
      source: event.filename?.split('?')[0],
      line: event.lineno,
      ...describeThrown(event.error),
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    logger.error('client.unhandled_rejection', describeThrown(event.reason));
  });
};

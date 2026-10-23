/**
 * What the web server logs about a request it failed or refused (Codex-osuqt
 * review). `handleError` used to log the href and hand the query string to
 * `method`, and never a worker's status, code or refused field, so an outage
 * read the same as a contract 400 or a timeout. It also tracked every one of
 * SvelteKit's refusals, so any script could raise error-level alarms with a
 * URL: they are warnings now, flagged where a deploy of ours could be the
 * cause. A remote function's refused input never reached it at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  trackError: vi.fn(),
}));
vi.mock('$lib/observability', () => ({ logger: mockLogger }));

import {
  clientErrorBody,
  errorLogContext,
  logRefusedRemoteInput,
  logUnhandledError,
} from './error-log-context';

const event = (href: string, method = 'GET') =>
  ({
    request: new Request(href, { method }),
    url: new URL(href),
    locals: { requestId: 'req-1' },
  }) as Parameters<typeof errorLogContext>[1];

describe('errorLogContext', () => {
  it("carries a worker failure's status and code, and the org's host", () => {
    expect(
      errorLogContext(
        new ApiError(503, 'API Error', 'SERVICE_UNAVAILABLE'),
        event('http://studio-alpha.lvh.me:3000/content/first'),
        500
      )
    ).toEqual({
      requestId: 'req-1',
      host: 'studio-alpha.lvh.me:3000',
      url: '/content/first',
      method: 'GET',
      responseStatus: 500,
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      details: undefined,
    });
  });

  // Neither detail page catches its by-slug read, so for a contract 400 this
  // is the only log: without the details it names no field.
  it('names the field a contract 400 refused', () => {
    const details = [{ path: 'query.creatorId', message: 'Invalid user id' }];

    expect(
      errorLogContext(
        new ApiError(400, 'Invalid request data', 'VALIDATION_ERROR', details),
        event('http://creators.lvh.me:3000/@alex/content/first'),
        500
      )
    ).toMatchObject({ status: 400, details });
  });

  it('logs the HTTP method and the path, never the query string', () => {
    const context = errorLogContext(
      new Error('boom'),
      event('http://lvh.me:3000/checkout/success?session_id=cs_secret', 'POST'),
      500
    );

    expect(context).toMatchObject({
      url: '/checkout/success',
      method: 'POST',
      status: undefined,
    });
    expect(JSON.stringify(context)).not.toContain('cs_secret');
  });
});

describe('logUnhandledError', () => {
  beforeEach(() => vi.clearAllMocks());

  const refusal = (fields: Record<string, unknown>) =>
    expect.objectContaining(fields);

  it("logs an unmatched route's 404 as a warning, not a tracked error", () => {
    logUnhandledError(
      new Error('Not found: /wp-admin'),
      event('http://lvh.me:3000/wp-admin'),
      404
    );

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Request refused by SvelteKit',
      refusal({
        responseStatus: 404,
        url: '/wp-admin',
        kitMessage: 'Not found: /wp-admin',
      })
    );
    expect(mockLogger.trackError).not.toHaveBeenCalled();
  });

  it('tracks a 500 as an error', () => {
    const error = new Error('boom');

    logUnhandledError(error, event('http://lvh.me:3000/content/first'), 500);

    expect(mockLogger.trackError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ responseStatus: 500 })
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  // Below 500 handleError only ever sees Kit refusing the request (an
  // HttpError never reaches it), and the client chose what decided it.
  it.each([
    [415, 'Unsupported Media Type'],
    [405, '`form` functions must be invoked via POST'],
    [400, 'Bad Request'],
  ])('logs a %i refusal as a warning, never tracks it', (status, message) => {
    logUnhandledError(
      new Error(message),
      event('http://lvh.me:3000/login', 'POST'),
      status
    );

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Request refused by SvelteKit',
      refusal({ responseStatus: status, kitMessage: message })
    );
    expect(mockLogger.trackError).not.toHaveBeenCalled();
  });

  // Kit's message embeds what the client sent; the logger redacts metadata,
  // not the message, so the text goes there, bounded.
  it("keeps Kit's text out of the message and bounds it", () => {
    logUnhandledError(
      new Error(`No action with name '${'x'.repeat(5000)}' found`),
      event('http://lvh.me:3000/login?/x', 'POST'),
      404
    );

    const [message, context] = mockLogger.warn.mock.calls[0];
    expect(message).toBe('Request refused by SvelteKit');
    expect(context.kitMessage).toHaveLength(200);
  });

  // Kit looks an action up on a plain object and refuses `default` by name,
  // so these resolve to something that throws: a 500 the client chose.
  it.each([
    'default',
    'valueOf',
    '__proto__',
    'constructor',
    'hasOwnProperty',
  ])('logs the 500 for a POST naming ?/%s as a warning', (name) => {
    logUnhandledError(
      new Error('action is not a function'),
      event(`http://lvh.me:3000/content/first?/${name}`, 'POST'),
      500
    );

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(mockLogger.trackError).not.toHaveBeenCalled();
  });

  // A real action that throws is a bug of ours.
  it("still tracks a real action's 500", () => {
    logUnhandledError(
      new Error('boom'),
      event('http://lvh.me:3000/content/first?/purchase', 'POST'),
      500
    );

    expect(mockLogger.trackError).toHaveBeenCalled();
  });

  // The action name is the client's `?/<name>`, so any script could raise
  // this; a deploy that drops an action shows as the flag's rate.
  it("flags a missing form action's 404 on a warning, never tracks it", () => {
    logUnhandledError(
      new Error("No action with name 'purchase' found"),
      event('http://lvh.me:3000/content/first?/purchase', 'POST'),
      404
    );

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Request refused by SvelteKit',
      refusal({ staleAction: true })
    );
    expect(mockLogger.trackError).not.toHaveBeenCalled();
  });

  // Once a page has no actions left, a stale tab's `?/purchase` gets the 405
  // a scanner's bare POST gets: it named an action, so it is flagged.
  it('flags a named action refused with the no-actions 405', () => {
    logUnhandledError(
      new Error('POST method not allowed. No form actions exist for this page'),
      event('http://lvh.me:3000/content/first?/purchase', 'POST'),
      405
    );

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Request refused by SvelteKit',
      refusal({ staleAction: true })
    );
  });

  // A POST naming no action makes Kit look for `default`: a scanner's, so
  // it must not count toward the stale-action rate.
  it.each([
    [404, "No action with name 'default' found"],
    [405, 'POST method not allowed. No form actions exist for this page'],
  ])('does not flag a POST that named no action (%i)', (status, message) => {
    logUnhandledError(
      new Error(message),
      event('http://lvh.me:3000/content/first', 'POST'),
      status
    );

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Request refused by SvelteKit',
      expect.not.objectContaining({ staleAction: true })
    );
    expect(mockLogger.trackError).not.toHaveBeenCalled();
  });

  // Kit refuses a native POST to a renamed or moved remote form() with the
  // same 405 text; its `?/remote=` param is the client's, so a warning,
  // flagged so a deploy's stale forms can be counted.
  it("flags a stale remote form's 405 on a warning, never tracks it", () => {
    logUnhandledError(
      new Error('POST method not allowed. No form actions exist for this page'),
      event(
        'http://lvh.me:3000/forgot-password?/remote=a1b2c3/requestReset',
        'POST'
      ),
      405
    );

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Request refused by SvelteKit',
      refusal({ staleRemoteForm: true })
    );
    expect(mockLogger.trackError).not.toHaveBeenCalled();
  });

  // Kit takes a POST as a remote-form submit only when the param has a value.
  it('does not flag an empty ?/remote= as either', () => {
    logUnhandledError(
      new Error('POST method not allowed. No form actions exist for this page'),
      event('http://lvh.me:3000/?/remote=', 'POST'),
      405
    );

    const [, context] = mockLogger.warn.mock.calls[0];
    expect(context).not.toHaveProperty('staleRemoteForm');
    expect(context).not.toHaveProperty('staleAction');
  });
});

describe('logRefusedRemoteInput', () => {
  beforeEach(() => vi.clearAllMocks());

  type RefusalEvent = Parameters<typeof logRefusedRemoteInput>[1];

  // For a browser call Kit sets `event.url` to the calling page; the request
  // keeps the function's own URL and its payload.
  const browserCall = (
    path = '/_app/remote/1wvwy0x/getPublicContent'
  ): RefusalEvent =>
    ({
      request: new Request(
        `http://studio-alpha.lvh.me:3000${path}?payload=c2VjcmV0`
      ),
      url: new URL('http://studio-alpha.lvh.me:3000/explore'),
      locals: { requestId: 'req-1' },
      isRemoteRequest: true,
    }) as RefusalEvent;

  // A server load's call runs with the page's own event.
  const serverLoadCall = (): RefusalEvent =>
    ({
      request: new Request('http://studio-alpha.lvh.me:3000/explore'),
      url: new URL('http://studio-alpha.lvh.me:3000/explore'),
      locals: { requestId: 'req-2' },
      isRemoteRequest: false,
    }) as RefusalEvent;

  // Kit refuses a remote function's input with an HttpError that never
  // reaches handleError: without this a refusal left no trace.
  it('warns on a browser call, naming the page, the function and the fields, never their values', () => {
    logRefusedRemoteInput(
      [
        { message: 'Slug must not contain NUL', path: ['slug'] },
        { message: 'Too big', path: [{ key: 'page' }] },
      ],
      browserCall()
    );

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Remote function input refused',
      expect.objectContaining({
        url: '/explore',
        remote: '/_app/remote/1wvwy0x/getPublicContent',
        issues: ['slug', 'page'],
        issueCount: 2,
      })
    );
    expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain(
      'c2VjcmV0'
    );
    expect(mockLogger.trackError).not.toHaveBeenCalled();
  });

  it('names the function without any segment a client appended', () => {
    logRefusedRemoteInput(
      [{ message: 'x', path: ['slug'] }],
      browserCall('/_app/remote/1wvwy0x/getPublicContent/jane@example.com')
    );

    const [, context] = mockLogger.warn.mock.calls[0];
    expect(context.remote).toBe('/_app/remote/1wvwy0x/getPublicContent');
  });

  // Our own load built the arguments, but usually from the page's URL, so a
  // visitor can cause one: flagged, never an error.
  it("flags a server load's refused call on a warning, naming the page", () => {
    logRefusedRemoteInput(
      [{ message: 'Too big', path: ['page'] }],
      serverLoadCall()
    );

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Remote function input refused',
      expect.objectContaining({
        url: '/explore',
        ownServerLoad: true,
        issues: ['page'],
      })
    );
    const [, context] = mockLogger.warn.mock.calls[0];
    expect(context).not.toHaveProperty('remote');
    expect(context.responseStatus).toBeUndefined();
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.trackError).not.toHaveBeenCalled();
  });

  // A query.batch validates every payload of one request.
  it('logs one line per browser request, however many payloads it refused', () => {
    const call = browserCall();

    logRefusedRemoteInput([{ message: 'x', path: [0] }], call);
    logRefusedRemoteInput([{ message: 'x', path: [1] }], call);
    logRefusedRemoteInput([{ message: 'x', path: [2] }], call);

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });

  // One page load makes several remote calls with the page's Request: a
  // second call's drift must not hide behind the first's.
  it("logs each distinct drift of one page load's calls once", () => {
    const call = serverLoadCall();

    logRefusedRemoteInput([{ message: 'x', path: ['page'] }], call);
    logRefusedRemoteInput([{ message: 'x', path: ['page'] }], call);
    logRefusedRemoteInput([{ message: 'x', path: ['category'] }], call);

    expect(mockLogger.warn).toHaveBeenCalledTimes(2);
  });

  // Zod checks every element of an array before its length.
  it('names at most 10 fields and counts the rest', () => {
    const issues = Array.from({ length: 50_000 }, (_, i) => ({
      message: 'Invalid UUID',
      path: ['orderedIds', i],
    }));

    logRefusedRemoteInput(issues, browserCall());

    const [, context] = mockLogger.warn.mock.calls[0];
    expect(context.issues).toHaveLength(10);
    expect(context.issueCount).toBe(50_000);
  });
});

describe('clientErrorBody', () => {
  it("shows Kit's own message for a 404, not 'An unexpected error'", () => {
    expect(clientErrorBody(404, 'Not Found')).toEqual({
      message: 'Not Found',
      code: 'NOT_FOUND',
    });
  });

  it('marks any other status below 500 a bad request', () => {
    expect(clientErrorBody(405, 'Method Not Allowed')).toEqual({
      message: 'Method Not Allowed',
      code: 'BAD_REQUEST',
    });
  });

  it('leaves a 500 to the sanitised body', () => {
    expect(clientErrorBody(500, 'Internal Error')).toBeNull();
  });
});

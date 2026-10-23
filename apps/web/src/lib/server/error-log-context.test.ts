/**
 * What `handleError` logs about a request whose load threw (Codex-osuqt
 * review). It used to log the href and hand the query string to `method`, and
 * never a worker's status or code, so an outage read the same as a contract
 * 400 or a timeout.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '$lib/api/errors';
import { errorLogContext } from './error-log-context';

const event = (href: string, method = 'GET') =>
  ({
    request: new Request(href, { method }),
    url: new URL(href),
    locals: { requestId: 'req-1' },
  }) as Parameters<typeof errorLogContext>[1];

describe('errorLogContext', () => {
  it("carries a worker failure's status and code", () => {
    expect(
      errorLogContext(
        new ApiError(503, 'API Error', 'SERVICE_UNAVAILABLE'),
        event('http://lvh.me:3000/@alex/content/first')
      )
    ).toEqual({
      requestId: 'req-1',
      url: '/@alex/content/first',
      method: 'GET',
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('logs the HTTP method and the path, never the query string', () => {
    const context = errorLogContext(
      new Error('boom'),
      event('http://lvh.me:3000/checkout/success?session_id=cs_secret', 'POST')
    );

    expect(context).toMatchObject({
      url: '/checkout/success',
      method: 'POST',
      status: undefined,
    });
    expect(JSON.stringify(context)).not.toContain('cs_secret');
  });
});

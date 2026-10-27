import { describe, expect, it } from 'vitest';
import { isFailedQuery, messageForLog, stackForLog } from '../db-errors';

/**
 * drizzle's failed-query shape, built by hand here; media-api's orphan sweep
 * test pins the real prefix by running a failed query (Codex-kk9nv.13).
 */
function failedQuery(params: string, cause?: unknown): Error {
  return Object.assign(
    new Error(`Failed query: select "id" from "users"\nparams: ${params}`),
    { cause }
  );
}

const AVATAR_PARAM =
  'avatars/abcdefghijklmnopqrstuvwxyz012345/300x300-aaaaaaaa/';

describe('messageForLog', () => {
  it("logs a failed query's driver error, not the query and its params", () => {
    // The params can hold a folder with a 32-character user id, and production
    // redaction would hash the whole message for it.
    const failed = failedQuery(
      AVATAR_PARAM,
      new Error('Error connecting to database: fetch failed')
    );
    expect(messageForLog(failed)).toBe(
      'Error connecting to database: fetch failed'
    );
  });

  it('unwraps a failed query wrapped in another failed query, to the driver', () => {
    const driver = new Error('connection terminated');
    expect(messageForLog(failedQuery('…', failedQuery('…', driver)))).toBe(
      'connection terminated'
    );
  });

  it("logs a driver's reason that is not an Error: neon's WebSocket shim rejects with an Event", () => {
    const event = { type: 'error', message: 'WebSocket was closed' };
    expect(messageForLog(failedQuery(AVATAR_PARAM, event))).toBe(
      'WebSocket was closed'
    );
    const bare = new Event('error');
    expect(messageForLog(failedQuery(AVATAR_PARAM, bare))).toBe(
      '[object Event]'
    );
  });

  it('never logs the query itself, even when nothing else says what went wrong', () => {
    const noReason = 'Query failed; the driver gave no reason';
    expect(messageForLog(failedQuery(AVATAR_PARAM))).toBe(noReason);
    expect(
      messageForLog(failedQuery(AVATAR_PARAM, failedQuery(AVATAR_PARAM)))
    ).toBe(noReason);
    expect(messageForLog(failedQuery(AVATAR_PARAM, null))).toBe(noReason);
    expect(messageForLog(failedQuery(AVATAR_PARAM, ''))).toBe(noReason);
  });

  it('withholds a query found inside other text: the error stringified, its stack, a wrapper', () => {
    // Nothing in that text says whether the driver gave a reason, so it is
    // withheld, not reported as having none.
    const withheld = 'Message withheld: it holds a failed query';
    const failed = failedQuery(
      AVATAR_PARAM,
      new Error('connection terminated')
    );
    expect(messageForLog(failed.message)).toBe(withheld);
    expect(messageForLog(String(failed))).toBe(withheld);
    expect(messageForLog(failed.stack)).toBe(withheld);
    expect(
      messageForLog(new Error(`Avatar not saved: ${failed.message}`))
    ).toBe(withheld);
  });

  it('reads only a string message, and names the error as a string: an array holding a query is neither', () => {
    const query = failedQuery(AVATAR_PARAM).message;
    expect(
      messageForLog(Object.assign(new Error(), { message: [query] }))
    ).toBe('Error');
    // Its name, read as a string, holds a query, so it is withheld.
    expect(messageForLog(Object.assign(new Error(''), { name: [query] }))).toBe(
      'Message withheld: it holds a failed query'
    );
  });

  it('ends on a chain that loops back on itself', () => {
    const looped = failedQuery(AVATAR_PARAM);
    looped.cause = looped;
    expect(messageForLog(looped)).toBe(
      'Query failed; the driver gave no reason'
    );
  });

  it('never throws from the catch block it runs in', () => {
    const unreadable = Object.defineProperty(new Error(), 'message', {
      get() {
        throw new Error('no message');
      },
    });
    expect(messageForLog(unreadable)).toBe(
      'An error that could not be printed'
    );
    expect(messageForLog(Object.create(null))).toBe(
      'An error that could not be printed'
    );
  });

  it('names an error that has no message', () => {
    expect(messageForLog(new TypeError(''))).toBe('TypeError');
  });

  it('logs any other error as it is, even one with a cause: its own message is the specific one', () => {
    expect(messageForLog(new Error('R2 unavailable'))).toBe('R2 unavailable');
    expect(
      messageForLog(
        Object.assign(new Error('ASSETS_BUCKET not bound'), {
          cause: new Error('binding missing'),
        })
      )
    ).toBe('ASSETS_BUCKET not bound');
    expect(messageForLog('not an error')).toBe('not an error');
  });
});

describe('isFailedQuery', () => {
  it("is drizzle's wrapper, by its message's prefix", () => {
    expect(isFailedQuery(failedQuery(AVATAR_PARAM))).toBe(true);
    expect(isFailedQuery(new Error('connection terminated'))).toBe(false);
    expect(isFailedQuery(failedQuery(AVATAR_PARAM).message)).toBe(false);
  });

  it('is false, never a throw, for an error it cannot read', () => {
    const numbered = Object.assign(new Error(), { message: 42 });
    const unreadable = Object.defineProperty(new Error(), 'message', {
      get() {
        throw new Error('no message');
      },
    });
    expect(isFailedQuery(numbered)).toBe(false);
    expect(isFailedQuery(unreadable)).toBe(false);
  });
});

describe('stackForLog', () => {
  it("is any other error's stack", () => {
    const error = new Error('R2 unavailable');
    expect(stackForLog(error)).toBe(error.stack);
  });

  it("is nothing for a stack that holds a failed query, its own or a wrapper's", () => {
    const failed = failedQuery(
      AVATAR_PARAM,
      new Error('connection terminated')
    );
    expect(stackForLog(failed)).toBeUndefined();
    expect(
      stackForLog(new Error(`Avatar not saved: ${failed.message}`))
    ).toBeUndefined();
  });

  it('is nothing for a non-Error, or one it cannot read', () => {
    const unreadable = Object.defineProperty(new Error(), 'stack', {
      get() {
        throw new Error('no stack');
      },
    });
    expect(stackForLog('Failed query: select 1')).toBeUndefined();
    expect(
      stackForLog(
        Object.assign(new Error('x'), {
          stack: [failedQuery(AVATAR_PARAM).message],
        })
      )
    ).toBeUndefined();
    expect(stackForLog(unreadable)).toBeUndefined();
  });
});

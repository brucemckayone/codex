import { describe, expect, it } from 'vitest';
import { messageForLog } from '../db-errors';

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
    expect(messageForLog(failedQuery(AVATAR_PARAM).message)).toBe(noReason);
    expect(
      messageForLog(failedQuery(AVATAR_PARAM, failedQuery(AVATAR_PARAM)))
    ).toBe(noReason);
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

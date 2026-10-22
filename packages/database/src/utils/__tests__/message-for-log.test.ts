import { describe, expect, it } from 'vitest';
import { messageForLog } from '../db-errors';

/**
 * drizzle's failed-query shape, built by hand here; media-api's orphan sweep
 * test pins the real prefix by running a failed query (Codex-kk9nv.13).
 */
function failedQuery(params: string, cause: Error): Error {
  return Object.assign(
    new Error(`Failed query: select "id" from "users"\nparams: ${params}`),
    { cause }
  );
}

describe('messageForLog', () => {
  it("logs a failed query's driver error, not the query and its params", () => {
    // The params can hold a folder with a 32-character user id, and production
    // redaction would hash the whole message for it.
    const failed = failedQuery(
      'avatars/abcdefghijklmnopqrstuvwxyz012345/300x300-aaaaaaaa/',
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

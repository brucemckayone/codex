import { describe, expect, it } from 'vitest';
import { describeThrown } from '../describe-thrown';

// drizzle-orm's DrizzleQueryError, as 0.44.7 builds it: no `name` of its
// own, and the bound params at the end of its message.
function queryError(params: unknown[], cause?: unknown): Error {
  const error = new Error(
    `Failed query: select * from users where email = $1\nparams: ${params}`
  );
  Object.assign(error, { query: 'select …', params });
  if (cause !== undefined) error.cause = cause;
  return error;
}

describe('describeThrown', () => {
  it('names an Error by its name and message', () => {
    expect(describeThrown(new TypeError('connection refused'))).toBe(
      'TypeError: connection refused'
    );
  });

  it('keeps a string as it is', () => {
    expect(describeThrown('quota exceeded')).toBe('quota exceeded');
  });

  it('writes a plain object as JSON, not [object Object]', () => {
    expect(describeThrown({ statusCode: 500 })).toBe('{"statusCode":500}');
  });

  it('falls back to String() for a value JSON cannot write', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(describeThrown(circular)).toBe('[object Object]');
    expect(describeThrown(undefined)).toBe('undefined');
  });

  it("names a query error's driver error, never its params", () => {
    const pg = Object.assign(new Error('duplicate key value'), {
      name: 'NeonDbError',
    });
    const line = describeThrown(queryError(['a@x.com'], pg));

    expect(line).toBe('Failed query: NeonDbError: duplicate key value');
    expect(line).not.toContain('a@x.com');
  });

  it('says only that a query failed when it has no driver error', () => {
    expect(describeThrown(queryError(['tok_secret']))).toBe('Failed query');
  });
});

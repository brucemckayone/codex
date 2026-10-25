/**
 * "The session ended" or "no such record" (Codex-2hxff.28 review, R2-M1).
 *
 * The worker's 404 carries `code: 'NOT_FOUND'`; the remote guard's has no
 * code. Only the first is "not found".
 */

import { describe, expect, test } from 'vitest';
import { isRecordNotFound, isSessionEnded } from '../session';

const rejection = (status: number, code?: string) => ({
  status,
  body: code === undefined ? { message: 'x' } : { message: 'x', code },
});

describe('isRecordNotFound / isSessionEnded', () => {
  test.each([
    ['the worker’s 404', rejection(404, 'NOT_FOUND'), true, false],
    ['the guard’s 404 (no code)', rejection(404), false, true],
    ['a 404 with another code', rejection(404, 'SOMETHING'), false, true],
    ['a 401', rejection(401, 'UNAUTHORIZED'), false, true],
    ['a 403', rejection(403, 'FORBIDDEN'), false, true],
    ['a 500', rejection(500), false, false],
    ['a 400', rejection(400, 'VALIDATION_ERROR'), false, false],
    ['nothing', undefined, false, false],
    ['a bare Error', new Error('Failed to execute batch query'), false, false],
  ])('%s', (_what, error, notFound, ended) => {
    expect(isRecordNotFound(error)).toBe(notFound);
    expect(isSessionEnded(error)).toBe(ended);
  });
});

import { describe, expect, it } from 'vitest';
import { publishContentQuerySchema } from '../content/content-schemas';

/** Publish when ready's flag (Codex-a6ofh.2.7), as a query string sends it. */
describe('publishContentQuerySchema', () => {
  it.each([
    ['true', true],
    ['false', false],
  ])('whenReady=%s reads as %s', (sent, read) => {
    expect(publishContentQuerySchema.parse({ whenReady: sent })).toEqual({
      whenReady: read,
    });
  });

  it('absent publishes now', () => {
    expect(publishContentQuerySchema.parse({})).toEqual({ whenReady: false });
  });

  // `z.coerce.boolean()` would read any non-empty string, "no" included, as
  // true: a mistyped flag must be refused, never schedule. `1` is not this
  // codebase's spelling of a query flag (`queryFlagSchema`).
  it.each([
    'yes',
    'no',
    '',
    'TRUE',
    '1',
    '0',
  ])('whenReady=%j is refused', (sent) => {
    expect(
      publishContentQuerySchema.safeParse({ whenReady: sent }).success
    ).toBe(false);
  });
});

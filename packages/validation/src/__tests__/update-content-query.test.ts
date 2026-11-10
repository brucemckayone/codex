import { describe, expect, it } from 'vitest';
import { updateContentQuerySchema } from '../content/content-schemas';

/** A draft's autosave flag (Codex-a6ofh.2), as a query string sends it. */
describe('updateContentQuerySchema', () => {
  it.each([
    ['true', true],
    ['false', false],
  ])('asDraft=%s reads as %s', (sent, read) => {
    expect(updateContentQuerySchema.parse({ asDraft: sent })).toEqual({
      asDraft: read,
    });
  });

  it('absent is an ordinary save', () => {
    expect(updateContentQuerySchema.parse({})).toEqual({ asDraft: false });
  });

  // A mistyped flag is refused, never read as true or as false: as false, a
  // draft's autosave would write to a live piece.
  it.each(['yes', 'no', '', 'TRUE', '1'])('asDraft=%j is refused', (sent) => {
    expect(updateContentQuerySchema.safeParse({ asDraft: sent }).success).toBe(
      false
    );
  });
});

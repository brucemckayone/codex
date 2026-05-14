import { describe, expect, it } from 'vitest';
import { toIso } from '../iso-date';

describe('toIso', () => {
  it('serialises a Date to an ISO-8601 string', () => {
    expect(toIso(new Date('2026-05-14T10:00:00Z'))).toBe(
      '2026-05-14T10:00:00.000Z'
    );
  });

  it('returns an already-serialised ISO string unchanged (pass-through)', () => {
    expect(toIso('2026-05-14T10:00:00.000Z')).toBe('2026-05-14T10:00:00.000Z');
  });

  it('returns null when the input is null', () => {
    expect(toIso(null)).toBeNull();
  });

  it('returns null when the input is undefined', () => {
    expect(toIso(undefined)).toBeNull();
  });
});

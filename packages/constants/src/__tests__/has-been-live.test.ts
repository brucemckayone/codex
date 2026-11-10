import { describe, expect, it } from 'vitest';
// Through the package index, as the service and the editor import it.
import { hasBeenLive } from '../index';

describe('hasBeenLive', () => {
  it('is false only for a draft that was never published', () => {
    expect(hasBeenLive({ status: 'draft', publishedAt: null })).toBe(false);
  });

  it.each([
    ['a live piece', { status: 'published', publishedAt: new Date() }],
    // Unpublishing keeps publishedAt.
    ['an unpublished piece', { status: 'draft', publishedAt: new Date() }],
    // The web's copy of the row, from JSON.
    [
      'an unpublished piece read by the web',
      { status: 'draft', publishedAt: '2026-11-05T09:00:00.000Z' },
    ],
    // A legacy live row can lack publishedAt; its status still says it is out.
    [
      'a live row with no publishedAt',
      { status: 'published', publishedAt: null },
    ],
    ['an archived piece', { status: 'archived', publishedAt: null }],
  ])('is true for %s', (_label, piece) => {
    expect(hasBeenLive(piece)).toBe(true);
  });
});

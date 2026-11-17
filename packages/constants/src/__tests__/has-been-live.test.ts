import { describe, expect, it } from 'vitest';
// Through the package index, as the service and the editor import it.
import { CONTENT_LIFECYCLE, contentLifecycle, hasBeenLive } from '../index';

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

describe('contentLifecycle', () => {
  it.each([
    [
      'a draft never published',
      { status: 'draft', publishedAt: null },
      CONTENT_LIFECYCLE.DRAFT,
    ],
    [
      'a live piece',
      { status: 'published', publishedAt: new Date() },
      CONTENT_LIFECYCLE.PUBLISHED,
    ],
    [
      'a live row with no publishedAt',
      { status: 'published', publishedAt: null },
      CONTENT_LIFECYCLE.PUBLISHED,
    ],
    // Unpublishing keeps publishedAt: its buyers keep it, so it is off sale.
    [
      'an unpublished piece',
      { status: 'draft', publishedAt: '2026-11-05T09:00:00.000Z' },
      CONTENT_LIFECYCLE.OFF_SALE,
    ],
    [
      'an archived piece',
      { status: 'archived', publishedAt: null },
      CONTENT_LIFECYCLE.OFF_SALE,
    ],
  ])('reads %s', (_label, piece, lifecycle) => {
    expect(contentLifecycle(piece)).toBe(lifecycle);
  });

  it('is off sale exactly when it has been live and is not on sale', () => {
    for (const status of ['draft', 'published', 'archived']) {
      for (const publishedAt of [null, new Date()]) {
        const piece = { status, publishedAt };
        expect(contentLifecycle(piece) === CONTENT_LIFECYCLE.OFF_SALE).toBe(
          hasBeenLive(piece) && status !== 'published'
        );
      }
    }
  });
});

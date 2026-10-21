/**
 * Thumbnail size swapping. Only a URL that ends in one of the stored sizes
 * (`{dir}/sm|md|lg.webp`) has siblings to swap to (Codex-kk9nv.4).
 */
import { describe, expect, it } from 'vitest';
import { getThumbnailSrcset, getThumbnailUrl } from './image';

const SIZED = 'https://cdn.example.test/u1/avatar/md.webp';

describe('getThumbnailUrl', () => {
  it('swaps a stored size for its sibling', () => {
    expect(getThumbnailUrl(SIZED, 'lg')).toBe(
      'https://cdn.example.test/u1/avatar/lg.webp'
    );
    expect(getThumbnailUrl(SIZED, 'sm')).toBe(
      'https://cdn.example.test/u1/avatar/sm.webp'
    );
  });

  it.each([
    [
      'an OAuth provider avatar',
      'https://lh3.googleusercontent.com/a/abc123=s96-c',
    ],
    ['a legacy seed image', 'https://cdn.example.test/seed/thumb.jpg'],
    ['an external picture', 'https://images.example.org/photo.png'],
    ['a page image’s 1600px size', 'https://cdn.example.test/p1/hero/xl.webp'],
  ])('leaves %s unchanged, which has no sized siblings', (_what, url) => {
    expect(getThumbnailUrl(url, 'lg')).toBe(url);
  });
});

describe('getThumbnailSrcset', () => {
  it('offers the three stored sizes of a sized URL', () => {
    expect(getThumbnailSrcset(SIZED)).toBe(
      [
        'https://cdn.example.test/u1/avatar/sm.webp 200w',
        'https://cdn.example.test/u1/avatar/md.webp 400w',
        'https://cdn.example.test/u1/avatar/lg.webp 800w',
      ].join(', ')
    );
  });

  it('offers nothing for a URL with no sized siblings', () => {
    expect(getThumbnailSrcset('https://cdn.example.test/seed/thumb.jpg')).toBe(
      ''
    );
  });
});

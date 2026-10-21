/**
 * Thumbnail size swapping. Only a URL that ends in one of the stored sizes
 * (`{dir}/sm|md|lg|xl.webp`) has siblings to swap to (Codex-kk9nv.4). A
 * directory named for the picture's size (`{w}x{h}-{nonce}`, Codex-kk9nv.5)
 * also has `xl`, and its files are never wider than the picture.
 */
import { describe, expect, it } from 'vitest';
import {
  coverCropSizes,
  getShareImage,
  getThumbnailDimensions,
  getThumbnailSrcset,
  getThumbnailUrl,
} from './image';

const SIZED = 'https://cdn.example.test/u1/avatar/md.webp';
/** A 1600x900 upload's folder (sizes in the address since kk9nv.5). */
const FOLDER =
  'https://cdn.example.test/u1/content-thumbnails/c1/1600x900-0a1b2c3d';

describe('getThumbnailUrl', () => {
  it('swaps a stored size for its sibling', () => {
    expect(getThumbnailUrl(SIZED, 'lg')).toBe(
      'https://cdn.example.test/u1/avatar/lg.webp'
    );
    expect(getThumbnailUrl(SIZED, 'sm')).toBe(
      'https://cdn.example.test/u1/avatar/sm.webp'
    );
  });

  it('swaps from an xl URL too: its directory has every size', () => {
    expect(
      getThumbnailUrl('https://cdn.example.test/p1/hero/xl.webp', 'lg')
    ).toBe('https://cdn.example.test/p1/hero/lg.webp');
  });

  it('answers xl only where the directory has one', () => {
    expect(getThumbnailUrl(`${FOLDER}/lg.webp`, 'xl')).toBe(
      `${FOLDER}/xl.webp`
    );
    // An older upload has sm/md/lg only, so its largest is lg.
    expect(getThumbnailUrl(SIZED, 'xl')).toBe(
      'https://cdn.example.test/u1/avatar/lg.webp'
    );
  });

  it.each([
    [
      'an OAuth provider avatar',
      'https://lh3.googleusercontent.com/a/abc123=s96-c',
    ],
    ['a legacy seed image', 'https://cdn.example.test/seed/thumb.jpg'],
    ['an external picture', 'https://images.example.org/photo.png'],
  ])('leaves %s unchanged, which has no sized siblings', (_what, url) => {
    expect(getThumbnailUrl(url, 'lg')).toBe(url);
  });
});

describe('getThumbnailSrcset', () => {
  it('offers the three stored sizes of an older upload', () => {
    expect(getThumbnailSrcset(SIZED)).toBe(
      [
        'https://cdn.example.test/u1/avatar/sm.webp 200w',
        'https://cdn.example.test/u1/avatar/md.webp 400w',
        'https://cdn.example.test/u1/avatar/lg.webp 800w',
      ].join(', ')
    );
  });

  it('offers all four sizes of a folder that records its size', () => {
    expect(getThumbnailSrcset(`${FOLDER}/lg.webp`)).toBe(
      [
        `${FOLDER}/sm.webp 200w`,
        `${FOLDER}/md.webp 400w`,
        `${FOLDER}/lg.webp 800w`,
        `${FOLDER}/xl.webp 1600w`,
      ].join(', ')
    );
  });

  it('never offers a file as wider than the picture, and lists a width once', () => {
    // A 300px upload: md, lg and xl were all written 300 wide.
    const small = 'https://cdn.example.test/avatars/u2/300x200-ffffffff';
    expect(getThumbnailSrcset(`${small}/lg.webp`)).toBe(
      [`${small}/sm.webp 200w`, `${small}/md.webp 300w`].join(', ')
    );
  });

  it('offers nothing for a URL with no sized siblings', () => {
    expect(getThumbnailSrcset('https://cdn.example.test/seed/thumb.jpg')).toBe(
      ''
    );
  });
});

describe('getThumbnailDimensions', () => {
  it('reads the picture size a folder records', () => {
    expect(getThumbnailDimensions(`${FOLDER}/md.webp`)).toEqual({
      width: 1600,
      height: 900,
    });
  });

  it.each([
    ['an older upload', SIZED],
    ['an external picture', 'https://images.example.org/1600x900-0a1b2c3d.png'],
    ['nothing', null],
  ])('is null for %s', (_what, url) => {
    expect(getThumbnailDimensions(url)).toBeNull();
  });
});

describe('coverCropSizes', () => {
  it('scales the slot by how much wider than the frame the picture is drawn', () => {
    // 16:9 into 3:4 is (16/9) / (3/4) = 2.37x the tile's width.
    expect(coverCropSizes('min(15rem, 82vw)', 3 / 4, `${FOLDER}/md.webp`)).toBe(
      'calc(min(15rem, 82vw) * 2.37)'
    );
  });

  it('keeps the slot when the picture is no wider than its frame', () => {
    expect(coverCropSizes('20rem', 16 / 9, `${FOLDER}/md.webp`)).toBe('20rem');
    expect(
      coverCropSizes(
        '20rem',
        16 / 9,
        'https://cdn.example.test/a/900x1600-0a1b2c3d/md.webp'
      )
    ).toBe('20rem');
  });

  it('keeps the slot when the size is unknown', () => {
    expect(coverCropSizes('20rem', 3 / 4, SIZED)).toBe('20rem');
  });

  it('scales every length of a sizes list and keeps its media conditions', () => {
    // A condition cannot sit inside calc(), and commas inside min() are not
    // entry separators.
    expect(
      coverCropSizes(
        '(min-width: 64rem) min(calc((100vw - 6rem) / 3), 25rem), (min-width: 40rem) 50vw, calc(100vw - 2rem)',
        3 / 4,
        `${FOLDER}/md.webp`
      )
    ).toBe(
      '(min-width: 64rem) calc(min(calc((100vw - 6rem) / 3), 25rem) * 2.37), (min-width: 40rem) calc(50vw * 2.37), calc(calc(100vw - 2rem) * 2.37)'
    );
  });
});

describe('getShareImage', () => {
  it('is the xl file, with its own size, when the folder records the picture', () => {
    expect(getShareImage(`${FOLDER}/md.webp`)).toEqual({
      url: `${FOLDER}/xl.webp`,
      width: 1600,
      height: 900,
    });
    // xl is never wider than the picture.
    const small =
      'https://cdn.example.test/c/courses/k/cover/1200x630-0a1b2c3d';
    expect(getShareImage(`${small}/md.webp`)).toEqual({
      url: `${small}/xl.webp`,
      width: 1200,
      height: 630,
    });
  });

  it('is the lg file, with no size, for an older upload', () => {
    expect(getShareImage(SIZED)).toEqual({
      url: 'https://cdn.example.test/u1/avatar/lg.webp',
    });
  });
});

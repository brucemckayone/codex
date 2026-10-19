import { describe, expect, it } from 'vitest';
import {
  type ImageRef,
  isImageRef,
  pageImageSrcset,
  readFocus,
  readSize,
  resolvePageImageUrl,
  storedFocus,
} from './page-images';

describe('isImageRef', () => {
  it('accepts a key-only ref', () => {
    expect(isImageRef({ key: 'landing-pages/p1/images/i1' })).toBe(true);
  });

  it('accepts a key + alt ref', () => {
    expect(
      isImageRef({ key: 'landing-pages/p1/images/i1', alt: 'A hero shot' })
    ).toBe(true);
  });

  it.each([
    null,
    undefined,
    'a string',
    42,
    true,
    [],
    {},
  ])('rejects %p', (value) => {
    expect(isImageRef(value)).toBe(false);
  });

  it('rejects an empty key', () => {
    expect(isImageRef({ key: '' })).toBe(false);
  });

  it('rejects a non-string key', () => {
    expect(isImageRef({ key: 123 })).toBe(false);
  });

  it('rejects a non-string alt', () => {
    expect(isImageRef({ key: 'landing-pages/p1/images/i1', alt: 7 })).toBe(
      false
    );
  });

  it('narrows the type for TypeScript (compile-time check via usage)', () => {
    const value: unknown = { key: 'landing-pages/p1/images/i1' };
    if (isImageRef(value)) {
      // If this compiles, the guard narrowed `value` to `ImageRef`.
      const ref: ImageRef = value;
      expect(ref.key).toBe('landing-pages/p1/images/i1');
    } else {
      throw new Error('expected isImageRef to accept this value');
    }
  });
});

describe('resolvePageImageUrl', () => {
  const cdnBase = 'https://cdn-assets.example.com';
  const key = 'landing-pages/page-1/images/image-1';

  it('builds the sm/md/lg variant URL from a valid ref', () => {
    expect(resolvePageImageUrl({ key }, 'sm', cdnBase)).toBe(
      `${cdnBase}/${key}/sm.webp`
    );
    expect(resolvePageImageUrl({ key }, 'md', cdnBase)).toBe(
      `${cdnBase}/${key}/md.webp`
    );
    expect(resolvePageImageUrl({ key }, 'lg', cdnBase)).toBe(
      `${cdnBase}/${key}/lg.webp`
    );
  });

  it('ignores alt — it plays no part in the URL', () => {
    expect(resolvePageImageUrl({ key, alt: 'ignored' }, 'md', cdnBase)).toBe(
      `${cdnBase}/${key}/md.webp`
    );
  });

  it('returns null for a value that is not an ImageRef', () => {
    expect(resolvePageImageUrl(null, 'md', cdnBase)).toBeNull();
    expect(resolvePageImageUrl(undefined, 'md', cdnBase)).toBeNull();
    expect(resolvePageImageUrl('a raw string', 'md', cdnBase)).toBeNull();
    expect(resolvePageImageUrl({}, 'md', cdnBase)).toBeNull();
  });

  it('returns null when no cdnBase is supplied — never a half-formed URL', () => {
    expect(resolvePageImageUrl({ key }, 'md', undefined)).toBeNull();
    expect(resolvePageImageUrl({ key }, 'md', null)).toBeNull();
    expect(resolvePageImageUrl({ key }, 'md', '')).toBeNull();
  });

  it('never crashes on a stray string that merely LOOKS like a key', () => {
    // Deep-scan on the server matches by string prefix; the web resolver's
    // job is narrower — it only ever receives already-typed props, so a bare
    // string (not wrapped in `{ key }`) is not an ImageRef and resolves to
    // null rather than being treated as a key itself.
    expect(resolvePageImageUrl(key, 'md', cdnBase)).toBeNull();
  });
});

describe('the xl variant (Codex-61zsk.13) and the size that unlocks it', () => {
  const cdnBase = 'https://cdn-assets.example.com';
  const key = 'landing-pages/page-1/images/image-1';

  it('resolves xl for a reference that carries its size', () => {
    expect(resolvePageImageUrl({ key, w: 2400, h: 1600 }, 'xl', cdnBase)).toBe(
      `${cdnBase}/${key}/xl.webp`
    );
  });

  it('answers lg for xl when the reference has no size: it predates xl, so has no such file', () => {
    expect(resolvePageImageUrl({ key }, 'xl', cdnBase)).toBe(
      `${cdnBase}/${key}/lg.webp`
    );
  });

  it('lists every written width, xl included, never wider than the picture', () => {
    expect(pageImageSrcset({ key, w: 2400, h: 1600 }, cdnBase)).toBe(
      [
        `${cdnBase}/${key}/sm.webp 200w`,
        `${cdnBase}/${key}/md.webp 400w`,
        `${cdnBase}/${key}/lg.webp 800w`,
        `${cdnBase}/${key}/xl.webp 1600w`,
      ].join(', ')
    );
    // A 600px picture: lg and xl are both 600 wide, so only one is listed.
    expect(pageImageSrcset({ key, w: 600, h: 400 }, cdnBase)).toBe(
      [
        `${cdnBase}/${key}/sm.webp 200w`,
        `${cdnBase}/${key}/md.webp 400w`,
        `${cdnBase}/${key}/lg.webp 600w`,
      ].join(', ')
    );
  });

  it('never offers xl to a reference without its size', () => {
    expect(pageImageSrcset({ key }, cdnBase)).not.toContain('xl.webp');
    expect(pageImageSrcset({ key }, null)).toBe('');
    expect(pageImageSrcset('not a ref', cdnBase)).toBe('');
  });

  it.each([
    [{ key, w: 0, h: 10 }],
    [{ key, w: 10.5, h: 10 }],
    [{ key, w: '100', h: 100 }],
    [{ key, w: 100 }],
  ])('reads no size from %p', (ref) => {
    expect(readSize(ref)).toBeNull();
  });
});

describe('readFocus — the focal point (Codex-61zsk.53)', () => {
  const key = 'landing-pages/page-1/images/image-1';

  it('reads a stored point', () => {
    expect(readFocus({ key, focus: { x: 64, y: 36 } })).toEqual({
      x: 64,
      y: 36,
    });
  });

  it('rounds to whole percent and clamps to the frame', () => {
    expect(readFocus({ key, focus: { x: 64.4, y: 120 } })).toEqual({
      x: 64,
      y: 100,
    });
    expect(readFocus({ key, focus: { x: -5, y: 0.6 } })).toEqual({
      x: 0,
      y: 1,
    });
  });

  it.each([
    [{ key }],
    [{ key, focus: null }],
    [{ key, focus: { x: '50', y: 20 } }],
    [{ key, focus: { x: Number.NaN, y: 20 } }],
    [{ key, focus: { y: 20 } }],
    [null],
  ])('falls back to the centre for %p', (ref) => {
    expect(readFocus(ref)).toEqual({ x: 50, y: 50 });
  });
});

describe('storedFocus — what a block steers by (Codex-61zsk.58)', () => {
  const key = 'landing-pages/page-1/images/image-1';

  it('is the point the creator placed, read as readFocus reads it', () => {
    expect(storedFocus({ key, focus: { x: 64.4, y: 120 } })).toEqual({
      x: 64,
      y: 100,
    });
  });

  // Nothing to steer by draws as before focal points: no `object-position`.
  it.each([
    [{ key }],
    [{ key, focus: { x: 50, y: 50 } }],
    [{ key, focus: { x: 49.6, y: 50.4 } }],
    [{ key, focus: { x: '50', y: 20 } }],
    [{ key, focus: { y: 20 } }],
    [null],
  ])('is nothing for %p', (ref) => {
    expect(storedFocus(ref)).toBeUndefined();
  });
});

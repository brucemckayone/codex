import { describe, expect, it } from 'vitest';
import { type ImageRef, isImageRef, resolvePageImageUrl } from './page-images';

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

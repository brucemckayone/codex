import { describe, expect, it } from 'vitest';
import { resolvePracticeThumbnail } from '../practice-thumbnail';

const BASE = 'https://cdn-assets.example.test';
const KEY = 'creator-1/media-thumbnails/media-1/lg.webp';
const CUSTOM = `${BASE}/creator-1/content-thumbnails/content-1/lg.webp`;

describe('resolvePracticeThumbnail', () => {
  it("prefers the creator's own thumbnail over the transcode's frame", () => {
    expect(resolvePracticeThumbnail(CUSTOM, KEY, BASE)).toBe(CUSTOM);
  });

  it('resolves a bare media key against the CDN base, never returning the key', () => {
    expect(resolvePracticeThumbnail(null, KEY, BASE)).toBe(`${BASE}/${KEY}`);
  });

  it('joins a base with a trailing slash without doubling it', () => {
    expect(resolvePracticeThumbnail(null, KEY, `${BASE}/`)).toBe(
      `${BASE}/${KEY}`
    );
  });

  it('has nothing to show when there is neither', () => {
    expect(resolvePracticeThumbnail(null, null, BASE)).toBeNull();
    expect(resolvePracticeThumbnail(undefined, undefined, BASE)).toBeNull();
  });

  it('gives null, not a raw key, when no CDN base is configured', () => {
    expect(resolvePracticeThumbnail(null, KEY, undefined)).toBeNull();
    expect(resolvePracticeThumbnail(null, KEY, '')).toBeNull();
  });

  it('still returns a custom thumbnail with no base (it is already a full URL)', () => {
    expect(resolvePracticeThumbnail(CUSTOM, KEY, undefined)).toBe(CUSTOM);
  });
});

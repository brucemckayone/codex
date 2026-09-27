import { describe, expect, it } from 'vitest';
import {
  pageIdOfPageImageKey,
  pageImageKey,
  pageImageKeyOfObject,
  pageImageObjectKeys,
} from '../page-image-keys';

const PAGE = '4b0c8a52-9d1e-4f3a-8a6b-2c5d7e9f0a1b';
const IMAGE = 'f0e1d2c3-b4a5-4968-8776-655443322110';
const BASE = `landing-pages/${PAGE}/images/${IMAGE}`;

describe('page-image keys', () => {
  it('builds the base key a block stores', () => {
    expect(pageImageKey(PAGE, IMAGE)).toBe(BASE);
  });

  it('names the three objects that actually hold the bytes', () => {
    expect(pageImageObjectKeys(BASE)).toEqual([
      `${BASE}/sm.webp`,
      `${BASE}/md.webp`,
      `${BASE}/lg.webp`,
    ]);
  });

  it('maps every object back to its base key', () => {
    for (const objectKey of pageImageObjectKeys(BASE)) {
      expect(pageImageKeyOfObject(objectKey)).toBe(BASE);
    }
  });

  it('reads the owning page from a minted key', () => {
    expect(pageIdOfPageImageKey(BASE)).toBe(PAGE);
  });

  it.each([
    ['an object key', `${BASE}/lg.webp`],
    ['a prefix with a made-up image id', `landing-pages/${PAGE}/images/hero`],
    ['a trailing segment', `${BASE}/extra`],
    ['an uppercase uuid', BASE.toUpperCase()],
    ['a course still', `courses/${PAGE}/hero`],
    ['page copy', 'Six calm weeks'],
  ])('refuses %s as a base key', (_label, value) => {
    expect(pageIdOfPageImageKey(value)).toBeNull();
  });

  it.each([
    ['the base key itself', BASE],
    ['another size', `${BASE}/xl.webp`],
    ['a course still variant', `courses/${PAGE}/hero/lg.webp`],
  ])('refuses %s as an object key', (_label, value) => {
    expect(pageImageKeyOfObject(value)).toBeNull();
  });
});

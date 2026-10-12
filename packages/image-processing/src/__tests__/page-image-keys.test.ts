import { describe, expect, it } from 'vitest';
import {
  droppedPageImageKeys,
  pageIdOfPageImageKey,
  pageImageKey,
  pageImageKeyOfObject,
  pageImageKeysIn,
  pageImageObjectKeys,
  pageImageVariantKeys,
} from '../page-image-keys';

const PAGE = '4b0c8a52-9d1e-4f3a-8a6b-2c5d7e9f0a1b';
const IMAGE = 'f0e1d2c3-b4a5-4968-8776-655443322110';
const BASE = `landing-pages/${PAGE}/images/${IMAGE}`;

describe('page-image keys', () => {
  it('builds the base key a block stores', () => {
    expect(pageImageKey(PAGE, IMAGE)).toBe(BASE);
  });

  it('names the four objects that actually hold the bytes, xl included (Codex-61zsk.13)', () => {
    // The upload records this list and the save nominates it, so an object
    // missing here is written and never swept.
    expect(pageImageObjectKeys(BASE)).toEqual([
      `${BASE}/sm.webp`,
      `${BASE}/md.webp`,
      `${BASE}/lg.webp`,
      `${BASE}/xl.webp`,
    ]);
    expect(pageImageVariantKeys(BASE)).toEqual({
      sm: `${BASE}/sm.webp`,
      md: `${BASE}/md.webp`,
      lg: `${BASE}/lg.webp`,
      xl: `${BASE}/xl.webp`,
    });
  });

  it('still reads an image uploaded before xl existed: its three objects are page-image objects', () => {
    for (const size of ['sm', 'md', 'lg']) {
      expect(pageImageKeyOfObject(`${BASE}/${size}.webp`)).toBe(BASE);
    }
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
    ['a size no upload writes', `${BASE}/xxl.webp`],
    ['a size in another format', `${BASE}/xl.png`],
    ['a course still variant', `courses/${PAGE}/hero/lg.webp`],
  ])('refuses %s as an object key', (_label, value) => {
    expect(pageImageKeyOfObject(value)).toBeNull();
  });
});

/**
 * The save diff behind a Picture section (03 X64, Codex-61zsk.53): pictures
 * come from uploads only, so replacing or removing one must go through this
 * diff to the sweep, and nothing the page still shows may be nominated.
 */
describe('droppedPageImageKeys: what a save nominates for the sweep', () => {
  const OTHER = `landing-pages/${PAGE}/images/0a1b2c3d-4e5f-4061-8293-a4b5c6d7e8f9`;
  /** A Picture section as the kit stores it: focal point and size included. */
  const picture = (id: string, key?: string) => ({
    id,
    type: 'picture',
    enabled: true,
    props: key
      ? {
          image: {
            key,
            alt: 'Dawn',
            focus: { x: 30, y: 70 },
            w: 1600,
            h: 1067,
          },
          caption: key,
        }
      : {},
  });

  it('finds a Picture’s key inside its full reference, and only exact keys', () => {
    expect([...pageImageKeysIn([picture('p', BASE)])]).toEqual([BASE]);
    expect([
      ...pageImageKeysIn({
        caption: `See ${BASE}`,
        href: `https://cdn.example/${BASE}/lg.webp`,
      }),
    ]).toEqual([]);
  });

  it('replace: the picture it had is nominated, the new one is not', () => {
    expect(
      droppedPageImageKeys([picture('p', BASE)], [picture('p', OTHER)])
    ).toEqual([BASE]);
  });

  it('remove: clearing the picture, or deleting the section, nominates it', () => {
    expect(droppedPageImageKeys([picture('p', BASE)], [picture('p')])).toEqual([
      BASE,
    ]);
    expect(
      droppedPageImageKeys([picture('p', BASE), picture('q')], [picture('q')])
    ).toEqual([BASE]);
  });

  it('undo: putting the picture back nominates nothing, and the earlier nomination is for the sweep to refuse', () => {
    const before = [picture('p', BASE)];
    const removed = [picture('p')];
    expect(droppedPageImageKeys(before, removed)).toEqual([BASE]);
    // The undo's own save drops nothing: the key is back on the page, which
    // is what the sweep reads (`isPageImageReferenced`) before deleting.
    expect(droppedPageImageKeys(removed, before)).toEqual([]);
    expect(pageImageKeysIn(before).has(BASE)).toBe(true);
  });

  it('the same picture twice on one page: removing one keeps it, removing both nominates it once', () => {
    const both = [picture('p', BASE), picture('q', BASE)];
    expect(
      droppedPageImageKeys(both, [picture('p', BASE), picture('q')])
    ).toEqual([]);
    expect(droppedPageImageKeys(both, [picture('q', BASE)])).toEqual([]);
    expect(droppedPageImageKeys(both, [picture('p'), picture('q')])).toEqual([
      BASE,
    ]);
  });

  it('a picture moving between sections, or a Picture taking a gallery’s picture, nominates nothing', () => {
    const gallery = {
      id: 'g',
      type: 'gallery',
      props: { items: [{ image: { key: BASE } }] },
    };
    expect(
      droppedPageImageKeys(
        [gallery, picture('p')],
        [{ ...gallery, props: { items: [] } }, picture('p', BASE)]
      )
    ).toEqual([]);
  });

  it('every nomination names the four objects the sweep deletes, xl included', () => {
    const objects = droppedPageImageKeys([picture('p', BASE)], []).flatMap(
      pageImageObjectKeys
    );
    expect(objects).toEqual(
      ['sm', 'md', 'lg', 'xl'].map((v) => `${BASE}/${v}.webp`)
    );
  });
});

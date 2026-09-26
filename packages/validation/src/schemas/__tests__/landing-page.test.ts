/**
 * `landing-page.ts` — the page kit's v2 vocabulary. Its enum-array equality
 * against `apps/web/src/lib/page-builder/kit/model/ids.ts` is checked in
 * that file's `ids.parity.test.ts` (a `@codex/validation` package test
 * cannot import an apps/web `$lib` module the other direction). These tests
 * cover this package's OWN write-boundary behaviour: the two schemas degrade
 * rather than reject, exactly like the legacy `designAxis` idiom they mirror.
 */
import { describe, expect, it } from 'vitest';
import {
  COLOUR_SCHEME_IDS,
  PAGE_STYLE_IDS,
  pageDesignSchema,
  SECTION_LAYOUTS,
  SECTION_SPACING_IDS,
  SECTION_TYPE_IDS,
  sectionStyleSchema,
} from '../landing-page';

describe('SECTION_LAYOUTS / SECTION_TYPE_IDS', () => {
  it('derives the type ids from the layout record keys, in declaration order', () => {
    expect(SECTION_TYPE_IDS).toEqual(Object.keys(SECTION_LAYOUTS));
    expect(SECTION_TYPE_IDS).toHaveLength(14);
  });

  it("every type's layout list is non-empty", () => {
    for (const type of SECTION_TYPE_IDS) {
      expect(SECTION_LAYOUTS[type].length).toBeGreaterThan(0);
    }
  });
});

describe('sectionStyleSchema', () => {
  it('accepts every declared scheme and spacing value', () => {
    for (const scheme of COLOUR_SCHEME_IDS) {
      expect(sectionStyleSchema.parse({ scheme }).scheme).toBe(scheme);
    }
    for (const spacing of SECTION_SPACING_IDS) {
      expect(sectionStyleSchema.parse({ spacing }).spacing).toBe(spacing);
    }
  });

  it('accepts an empty bag', () => {
    expect(sectionStyleSchema.parse({})).toEqual({});
  });

  it('DEGRADES an unknown value to undefined rather than rejecting', () => {
    const parsed = sectionStyleSchema.parse({
      scheme: 'ultra-brand',
      spacing: 'huge',
    });
    expect(parsed.scheme).toBeUndefined();
    expect(parsed.spacing).toBeUndefined();
  });

  it('strips an unknown key instead of rejecting it', () => {
    expect(
      sectionStyleSchema.parse({ scheme: 'brand', bogus: 'x' } as never)
    ).toEqual({ scheme: 'brand' });
  });
});

describe('pageDesignSchema', () => {
  it('accepts every declared Style value', () => {
    for (const style of PAGE_STYLE_IDS) {
      expect(pageDesignSchema.parse({ style }).style).toBe(style);
    }
  });

  it('degrades an unknown Style to undefined rather than rejecting', () => {
    expect(
      pageDesignSchema.parse({ style: 'not-a-style' }).style
    ).toBeUndefined();
  });

  it('accepts an empty bag', () => {
    expect(pageDesignSchema.parse({})).toEqual({});
  });
});

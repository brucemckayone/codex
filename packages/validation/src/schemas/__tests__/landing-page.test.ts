/**
 * `landing-page.ts` — the page kit's v2 vocabulary. Its enum-array equality
 * against `apps/web/src/lib/page-builder/kit/model/ids.ts` is checked in
 * that file's `ids.parity.test.ts` (a `@codex/validation` package test
 * cannot import an apps/web `$lib` module the other direction). These tests
 * cover this package's OWN write-boundary behaviour: `sectionStyleSchema`
 * degrades an unknown value, exactly like the legacy `designAxis` idiom it
 * mirrors. `pageDesignSchema.style` is the one exception — it REJECTS an
 * unrecognised value instead (owner decision 2026-09-28, Codex-61zsk.29).
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
    // 14 from 01-contract §2, + story and gallery (03-expressive-contract §3).
    expect(SECTION_TYPE_IDS).toHaveLength(16);
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

  // Owner decision 2026-09-28 (Codex-61zsk.29): "Reject the save." Was:
  // 'degrades an unknown Style to undefined rather than rejecting' — kept in
  // sync with journeys.ts's `sectionDesignSchema.style`, its twin, which
  // rejects for the same reason (see that file's test for the rationale).
  it('REJECTS an unknown Style instead of degrading it', () => {
    const result = pageDesignSchema.safeParse({ style: 'not-a-style' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join('.') === 'style'
      );
      expect(issue?.message).toBe(
        'Unknown page Style. Refresh and choose a Style again.'
      );
    }
  });

  it('accepts an empty bag', () => {
    expect(pageDesignSchema.parse({})).toEqual({});
  });
});

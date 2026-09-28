/**
 * Journey studio query-schema tests (Codex-xo3bl).
 *
 * The insights query key is the LANDING-PAGE id, and the ONLY thing preventing
 * it being confused with the course id again is this field's name: both values
 * are UUIDs, so `uuidSchema` accepted the wrong one happily and the mistake
 * surfaced two layers away as `NotFoundError('Course not found')` on every
 * single request. These tests pin the name at the wire boundary.
 *
 * Success cases use `parse()` so a failure throws and takes the test with it;
 * rejection cases use `safeParse().success`. That keeps `data` narrowed without
 * a cast — `safeParse()` returns a discriminated union whose `data` only exists
 * on the success branch.
 */

import { describe, expect, it } from 'vitest';
import {
  journeyInsightsQuerySchema,
  orgJourneyRevenueQuerySchema,
  pageSectionSchema,
  saveJourneyPageBodySchema,
  sectionDesignSchema,
} from '../journeys';
import { PAGE_STYLE_IDS, SECTION_TYPE_IDS } from '../landing-page';

const ORG_ID = '32300000-0000-4000-8000-000000000002';
const PAGE_ID = '1a000000-0000-4000-8000-0000000000aa';

describe('journeyInsightsQuerySchema', () => {
  it('accepts a landing-page id under `pageId` and defaults the period to 30d', () => {
    const parsed = journeyInsightsQuerySchema.parse({
      organizationId: ORG_ID,
      pageId: PAGE_ID,
    });
    expect(parsed.pageId).toBe(PAGE_ID);
    expect(parsed.period).toBe('30d');
  });

  it('rejects a query keyed by the retired `courseId` instead of `pageId`', () => {
    // The regression guard. `pageId` is required, so a caller reverting to
    // `courseId` fails at the boundary (and `courseId` itself is stripped as an
    // unknown key) rather than sending a page id into a `courses.id` lookup.
    const parsed = journeyInsightsQuerySchema.safeParse({
      organizationId: ORG_ID,
      courseId: PAGE_ID,
    });
    expect(parsed.success).toBe(false);
  });

  it('does not carry a `courseId` through to the handler', () => {
    // Even when a caller sends both, the handler must resolve the course from
    // the page rather than trusting a client-supplied course id.
    const parsed = journeyInsightsQuerySchema.parse({
      organizationId: ORG_ID,
      pageId: PAGE_ID,
      courseId: '2c000000-0000-4000-8000-000000000001',
    });
    expect(parsed).not.toHaveProperty('courseId');
  });

  it('rejects a non-UUID pageId', () => {
    expect(
      journeyInsightsQuerySchema.safeParse({
        organizationId: ORG_ID,
        pageId: 'not-a-uuid',
      }).success
    ).toBe(false);
  });

  it('rejects an unknown period', () => {
    expect(
      journeyInsightsQuerySchema.safeParse({
        organizationId: ORG_ID,
        pageId: PAGE_ID,
        period: 'forever',
      }).success
    ).toBe(false);
  });

  it.each([
    '7d',
    '30d',
    '90d',
    'all',
  ] as const)('accepts the %s reporting window', (period) => {
    const parsed = journeyInsightsQuerySchema.parse({
      organizationId: ORG_ID,
      pageId: PAGE_ID,
      period,
    });
    expect(parsed.period).toBe(period);
  });
});

describe('orgJourneyRevenueQuerySchema', () => {
  it('is org-wide — it takes no journey key at all', () => {
    const parsed = orgJourneyRevenueQuerySchema.parse({
      organizationId: ORG_ID,
    });
    expect(parsed.period).toBe('30d');
    expect(parsed).not.toHaveProperty('pageId');
  });
});

// ── Section + design-axis structure (journey-sections contract A5) ────────────
//
// `pageSectionSchema` was `z.custom<PageSection>(v => typeof v === 'object')` — a
// type assertion with a predicate, validating nothing structural. The tests below
// pin the two properties that matter and pull in opposite directions: `design` is
// now really validated, and NOTHING that a real stored page contains is rejected.

const SECTION = {
  id: 'sec-1',
  type: 'problem',
  enabled: true,
  variant: 'statement',
  name: 'The problem',
  props: { kicker: 'K', heading: 'H', body: 'B' },
};

describe('sectionDesignSchema', () => {
  // WP-9b (contract §3: "the server ... validates writes (v2 keys added by
  // WP1, legacy keys pruned by WP9)"). The nine legacy design axes
  // (`width`/`density`/`surface`/`edge`/`align`/`type`/`accent`/`motion`/`media`)
  // are gone from this schema. Not REJECTED — an old client sending one still
  // saves; the axis KEY is silently stripped as unknown, same as a key this
  // schema never declared.

  it('strips every legacy axis KEY instead of persisting it', () => {
    const legacy = {
      width: 'narrow',
      density: 'vast',
      surface: 'invert',
      edge: 'offset',
      align: 'start',
      type: 'monumental',
      accent: 'glow',
      motion: 'drift',
      media: 'bleed',
    };
    expect(sectionDesignSchema.parse(legacy)).toEqual({});
  });

  it('accepts an empty bag and a partially-set v2 bag', () => {
    expect(sectionDesignSchema.parse({})).toEqual({});
    expect(sectionDesignSchema.parse({ scheme: 'brand' })).toMatchObject({
      scheme: 'brand',
    });
  });

  it('drops non-string garbage for scheme/spacing the same way (jsonb round-trips any shape)', () => {
    const parsed = sectionDesignSchema.parse({
      scheme: 42,
      spacing: null,
    });
    expect(parsed.scheme).toBeUndefined();
    expect(parsed.spacing).toBeUndefined();
  });

  // `style` is the exception (owner decision 2026-09-28, Codex-61zsk.29): it
  // REJECTS garbage instead of dropping it, same as any other wrong-typed value.
  it('rejects non-string garbage for style instead of dropping it', () => {
    expect(
      sectionDesignSchema.safeParse({ style: { nested: true } }).success
    ).toBe(false);
  });

  it('strips an unrelated unknown KEY the same way', () => {
    const parsed = sectionDesignSchema.parse({
      radius: 'pill',
      scheme: 'base',
    });
    expect(parsed).toEqual({ scheme: 'base' });
  });

  // ── Page-kit v2 keys (docs/design/landing-builder/01-contract.md §2/§3 —
  // BINDING). Before this, `scheme`/`spacing`/`style` were unknown KEYS and
  // silently stripped — `upgrade.ts`'s v2 output would round-trip through a
  // save and lose its own scheme/spacing/style on the very next load. These
  // pin the fix, and pin that the nine legacy axes above still work
  // unchanged (the old builder keeps saving them until WP9 prunes them).

  it('accepts every declared v2 scheme/spacing value', () => {
    for (const scheme of ['base', 'soft', 'contrast', 'brand', 'accent']) {
      expect(sectionDesignSchema.parse({ scheme }).scheme).toBe(scheme);
    }
    for (const spacing of ['compact', 'regular', 'spacious']) {
      expect(sectionDesignSchema.parse({ spacing }).spacing).toBe(spacing);
    }
  });

  it('accepts every declared PAGE_STYLE_IDS value for style', () => {
    for (const style of PAGE_STYLE_IDS) {
      expect(sectionDesignSchema.parse({ style }).style).toBe(style);
    }
  });

  it('accepts an absent style', () => {
    expect(
      sectionDesignSchema.parse({ scheme: 'brand' }).style
    ).toBeUndefined();
  });

  it('SURVIVES a parse instead of being silently stripped as an unknown key', () => {
    const v2 = { scheme: 'brand', spacing: 'compact', style: 'bold' };
    expect(sectionDesignSchema.parse(v2)).toEqual(v2);
  });

  it('degrades an unknown scheme/spacing value to undefined, same as a legacy axis', () => {
    const parsed = sectionDesignSchema.parse({
      scheme: 'ultra-brand',
      spacing: 'huge',
    });
    expect(parsed.scheme).toBeUndefined();
    expect(parsed.spacing).toBeUndefined();
  });

  // Owner decision 2026-09-28 (Codex-61zsk.29): "Reject the save." Was:
  // 'degrades an unknown v2 value to undefined, same as a legacy axis' — style
  // used to silently drop to `undefined` right alongside scheme/spacing. It now
  // REJECTS instead: a dropped Style would silently turn the whole page's look
  // into Bold, worse than a failed save the creator can retry and keep.
  it('rejects an unknown style value instead of degrading it', () => {
    const result = sectionDesignSchema.safeParse({ style: 'not-a-style' });
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

  it('PRUNES a legacy axis even mixed with v2 keys on the same bag', () => {
    // Before WP-9b this was the transitional shape: a legacy axis and a v2 key
    // survived side by side on one bag while the old builder still wrote the
    // former. WP-9b is that prune, so only the v2 keys remain.
    const mixed = {
      width: 'text',
      surface: 'invert',
      scheme: 'contrast',
      spacing: 'regular',
    };
    expect(sectionDesignSchema.parse(mixed)).toEqual({
      scheme: 'contrast',
      spacing: 'regular',
    });
  });
});

describe('pageSectionSchema', () => {
  it('accepts a real stored section unchanged', () => {
    expect(pageSectionSchema.parse(SECTION)).toEqual(SECTION);
  });

  it('accepts a section carrying a v2 design bag', () => {
    const parsed = pageSectionSchema.parse({
      ...SECTION,
      design: { scheme: 'brand', spacing: 'compact' },
    });
    expect(parsed.design).toEqual({ scheme: 'brand', spacing: 'compact' });
  });

  it('strips a legacy design axis on a section instead of persisting it', () => {
    const parsed = pageSectionSchema.parse({
      ...SECTION,
      design: { density: 'compact', accent: 'none' },
    });
    expect(parsed.design).toEqual({});
  });

  it('CLOSES `type` to the v2 vocabulary — a legacy or unknown type 400s on save', () => {
    // WP-9b (contract §3): v2 is the only vocabulary new work adds section
    // types to, so a save naming a type outside it is a client bug, not a
    // future template. `ache` is `problem`'s legacy name (contract Appendix
    // A.1) — a real value this platform has stored, and reads are unaffected
    // (it still renders); it just cannot be WRITTEN under its old name.
    expect(
      pageSectionSchema.safeParse({ ...SECTION, type: 'ache' }).success
    ).toBe(false);
    expect(
      pageSectionSchema.safeParse({ ...SECTION, type: 'retreat-schedule' })
        .success
    ).toBe(false);
  });

  it('accepts every v2 section type', () => {
    for (const type of SECTION_TYPE_IDS) {
      expect(pageSectionSchema.safeParse({ ...SECTION, type }).success).toBe(
        true
      );
    }
  });

  it('keeps `variant` an OPEN string', () => {
    // The seeded `studio-alpha` page stores `variant: "default"`, which is not a
    // declared variant of any type. An enum here would 400 a real page on save.
    expect(
      pageSectionSchema.safeParse({ ...SECTION, variant: 'default' }).success
    ).toBe(true);
  });

  it('keeps `props` a PASSTHROUGH record and defaults it when absent', () => {
    const weird = { a: 1, b: null, c: [1, 2], d: { e: 'f' } };
    expect(pageSectionSchema.parse({ ...SECTION, props: weird }).props).toEqual(
      weird
    );
    const { props: _omitted, ...noProps } = SECTION;
    expect(pageSectionSchema.parse(noProps).props).toEqual({});
  });

  it('rejects a section missing its identity or on/off state', () => {
    const { id: _id, ...noId } = SECTION;
    const { enabled: _enabled, ...noEnabled } = SECTION;
    expect(pageSectionSchema.safeParse(noId).success).toBe(false);
    expect(pageSectionSchema.safeParse(noEnabled).success).toBe(false);
    expect(pageSectionSchema.safeParse({ ...SECTION, type: '' }).success).toBe(
      false
    );
    expect(pageSectionSchema.safeParse(null).success).toBe(false);
    expect(pageSectionSchema.safeParse('a section').success).toBe(false);
  });
});

describe('saveJourneyPageBodySchema with structural sections', () => {
  const BODY = {
    id: PAGE_ID,
    pageType: 'course',
    slug: 'pricing-smoke-test',
    title: 'Of Blood & Bones',
    status: 'published' as const,
    subjectType: 'course',
    subjectId: ORG_ID,
    brandOverrides: null,
    sections: [
      SECTION,
      { ...SECTION, id: 'sec-2', design: { scheme: 'contrast' } },
    ],
  };

  it('accepts a body whose sections carry v2 design bags', () => {
    const parsed = saveJourneyPageBodySchema.parse(BODY);
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[1]!.design).toEqual({ scheme: 'contrast' });
  });

  describe('brandOverrides (bounded, where z.custom checked nothing)', () => {
    const withBrand = (brandOverrides: unknown) =>
      saveJourneyPageBodySchema.safeParse({ ...BODY, brandOverrides });

    it('round-trips what the brand controls write', () => {
      const brand = {
        primaryColor: '#A62B0C',
        fontHeading: 'Playfair Display',
        fontBody: 'Inter',
        radius: 0.5,
        tokenOverrides: { 'heading-weight': '400', 'shadow-color': null },
        darkOverrides: { primaryColor: '#F2B8A0' },
      };
      const parsed = withBrand(brand);
      expect(parsed.success).toBe(true);
      expect(parsed.data?.brandOverrides).toEqual(brand);
    });

    it('drops a key nothing reads instead of refusing the page', () => {
      const parsed = withBrand({ primaryColor: '#000000', legacyThing: 'x' });
      expect(parsed.success).toBe(true);
      expect(parsed.data?.brandOverrides).toEqual({ primaryColor: '#000000' });
    });

    it.each([
      ['an oversized value', { primaryColor: 'x'.repeat(201) }],
      [
        'a token name that is not a token',
        { tokenOverrides: { 'x; position: fixed': 'red' } },
      ],
      [
        'too many tokens',
        {
          tokenOverrides: Object.fromEntries(
            Array.from({ length: 101 }, (_, i) => [`t-${i}`, '1'])
          ),
        },
      ],
      ['a radius out of range', { radius: 1e9 }],
    ])('refuses %s', (_label, brand) => {
      expect(withBrand(brand).success).toBe(false);
    });
  });

  it('caps a section id', () => {
    expect(
      saveJourneyPageBodySchema.safeParse({
        ...BODY,
        sections: [{ ...SECTION, id: 'x'.repeat(101) }],
      }).success
    ).toBe(false);
  });

  it('does not fail the whole page save over one unknown v2 value', () => {
    const parsed = saveJourneyPageBodySchema.parse({
      ...BODY,
      sections: [{ ...SECTION, design: { scheme: 'from-the-future' } }],
    });
    const [section] = parsed.sections;
    expect(section).toBeDefined();
    expect(section!.design?.scheme).toBeUndefined();
    // The section's copy — everything the creator actually typed — survives.
    expect(section!.props).toEqual(SECTION.props);
  });

  it('PRUNES a legacy axis on a section instead of persisting it', () => {
    const parsed = saveJourneyPageBodySchema.parse({
      ...BODY,
      sections: [{ ...SECTION, design: { edge: 'soft' } }],
    });
    expect(parsed.sections[0]!.design).toEqual({});
  });

  it('accepts the PAGE-level v2 Style (F-B2 — the column now exists)', () => {
    // F-A left this key out on purpose: under `.strict()` a declared-but-
    // unpersistable field is worse than a rejected one, because the save accepts
    // it, drops it and reports "Page saved". The column, the service write and the
    // `SavePagePayload` field all landed in F-B2, so the key is now honourable.
    const parsed = saveJourneyPageBodySchema.parse({
      ...BODY,
      design: { style: 'cinematic' },
    });
    expect(parsed.design).toEqual({ style: 'cinematic' });
  });

  it('PRUNES a legacy PAGE design bundle instead of persisting it', () => {
    // WP-9b: the nine legacy axes are gone from `sectionDesignSchema`, so a
    // page-level bundle in the old shape now saves empty rather than intact.
    const parsed = saveJourneyPageBodySchema.parse({
      ...BODY,
      design: { width: 'narrow', density: 'airy', surface: 'media' },
    });
    expect(parsed.design).toEqual({});
  });

  it('accepts a body with NO page design — absence means "leave it alone"', () => {
    const parsed = saveJourneyPageBodySchema.parse(BODY);
    expect(parsed.design).toBeUndefined();
  });

  // Owner decision 2026-09-28 (Codex-61zsk.29): "Reject the save." Was:
  // 'degrades an unknown PAGE style value instead of 400ing the whole save' —
  // an unrecognised Style used to silently drop to `undefined`, and the page
  // would render as Bold, a look the creator never chose. The save now REJECTS
  // instead, so the editor keeps the creator's work and reports the failure
  // rather than silently changing what they see.
  it('REJECTS the whole save over an unknown PAGE style value', () => {
    const result = saveJourneyPageBodySchema.safeParse({
      ...BODY,
      design: { style: 'not-a-style' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join('.') === 'design.style'
      );
      expect(issue?.message).toBe(
        'Unknown page Style. Refresh and choose a Style again.'
      );
    }
  });

  it('accepts every PAGE_STYLE_IDS value and an absent style on the save body', () => {
    for (const style of PAGE_STYLE_IDS) {
      const parsed = saveJourneyPageBodySchema.parse({
        ...BODY,
        design: { style },
      });
      expect(parsed.design?.style).toBe(style);
    }
    expect(saveJourneyPageBodySchema.parse(BODY).design).toBeUndefined();
  });

  it('accepts a page seo bag and round-trips it', () => {
    // `seo` used to be the example of a key with no column, and this test
    // asserted it must 400. Migration 0090 added `landing_pages.seo` jsonb, the
    // service writes it and the builder's SEO panel is enabled again, so the
    // correct assertion inverted.
    const parsed = saveJourneyPageBodySchema.parse({
      ...BODY,
      seo: { title: 'Meta', description: 'Slow work, close to the bone.' },
    });
    expect(parsed.seo?.title).toBe('Meta');
    expect(parsed.seo?.description).toBe('Slow work, close to the bone.');
  });

  it('keeps an EMPTY seo string, because that is a creator clearing the field', () => {
    // A `.min(1)` anywhere on this bag would make a cleared meta description
    // unsaveable — the field would appear to revert instead of clearing. This is
    // the regression that assertion exists to catch.
    expect(
      saveJourneyPageBodySchema.parse({ ...BODY, seo: { description: '' } }).seo
        ?.description
    ).toBe('');
  });

  it('still rejects a key this endpoint cannot honour (`.strict()` holds)', () => {
    // Re-stated against a key that is still not this body's to set:
    // `landing_pages.featured` is a real column, owned by the studio index's
    // feature toggle rather than by the page-copy save. If this ever goes red,
    // the tempting wrong repair is to weaken `.strict()` — do not.
    expect(
      saveJourneyPageBodySchema.safeParse({ ...BODY, featured: true }).success
    ).toBe(false);
  });

  it('still rejects a section that is not an object at all', () => {
    expect(
      saveJourneyPageBodySchema.safeParse({ ...BODY, sections: [null] }).success
    ).toBe(false);
  });
});

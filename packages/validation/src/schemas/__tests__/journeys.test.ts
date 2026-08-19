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
  type: 'ache',
  enabled: true,
  variant: 'statement',
  name: 'The ache',
  props: { kicker: 'K', heading: 'H', body: 'B' },
};

describe('sectionDesignSchema', () => {
  it('accepts every declared axis value', () => {
    const design = {
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
    expect(sectionDesignSchema.parse(design)).toEqual(design);
  });

  it('accepts an empty bag and a partially-set bag', () => {
    expect(sectionDesignSchema.parse({})).toEqual({});
    expect(sectionDesignSchema.parse({ width: 'wide' })).toMatchObject({
      width: 'wide',
    });
  });

  it('DROPS an unknown axis value to undefined rather than failing the parse', () => {
    // The load-bearing behaviour: a future client sending a new axis value must
    // not make the whole page save 400. Losing every other edit on the page to
    // one unrecognised enum member is a far worse outcome than dropping it, and
    // `resolveDesign` then falls back to the axis default.
    const parsed = sectionDesignSchema.parse({
      width: 'ultra-wide',
      motion: 'explode',
      density: 'airy',
    });
    expect(parsed.width).toBeUndefined();
    expect(parsed.motion).toBeUndefined();
    // An axis alongside the unknown one still survives.
    expect(parsed.density).toBe('airy');
  });

  it('drops non-string garbage the same way (jsonb round-trips any shape)', () => {
    const parsed = sectionDesignSchema.parse({
      width: 42,
      align: null,
      surface: { nested: true },
      edge: ['heavy'],
    });
    expect(parsed.width).toBeUndefined();
    expect(parsed.align).toBeUndefined();
    expect(parsed.surface).toBeUndefined();
    expect(parsed.edge).toBeUndefined();
  });

  it('strips unknown axis KEYS instead of rejecting them', () => {
    const parsed = sectionDesignSchema.parse({ radius: 'pill', width: 'text' });
    expect(parsed).toEqual({ width: 'text' });
  });
});

describe('pageSectionSchema', () => {
  it('accepts a real stored section unchanged', () => {
    expect(pageSectionSchema.parse(SECTION)).toEqual(SECTION);
  });

  it('accepts a section carrying a design bag', () => {
    const parsed = pageSectionSchema.parse({
      ...SECTION,
      design: { density: 'compact', accent: 'none' },
    });
    expect(parsed.design).toEqual({ density: 'compact', accent: 'none' });
  });

  it('keeps `type` an OPEN string — the renderer skips unknown types', () => {
    expect(
      pageSectionSchema.safeParse({ ...SECTION, type: 'retreat-schedule' })
        .success
    ).toBe(true);
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
    sections: [SECTION, { ...SECTION, id: 'sec-2', design: { edge: 'soft' } }],
  };

  it('accepts a body whose sections carry design bags', () => {
    const parsed = saveJourneyPageBodySchema.parse(BODY);
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[1].design).toEqual({ edge: 'soft' });
  });

  it('does not fail the whole page save over one unknown axis value', () => {
    const parsed = saveJourneyPageBodySchema.parse({
      ...BODY,
      sections: [{ ...SECTION, design: { width: 'from-the-future' } }],
    });
    expect(parsed.sections[0].design?.width).toBeUndefined();
    // The section's copy — everything the creator actually typed — survives.
    expect(parsed.sections[0].props).toEqual(SECTION.props);
  });

  it('still rejects a section that is not an object at all', () => {
    expect(
      saveJourneyPageBodySchema.safeParse({ ...BODY, sections: [null] }).success
    ).toBe(false);
  });
});

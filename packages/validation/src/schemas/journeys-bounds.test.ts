/**
 * `landing_pages.sections` is a BOUNDED write (Codex-us9ay residual 1).
 *
 * Four of the bead's six asks were already done by the time this landed — `type`
 * bounded, `enabled` required, `variant`/`name` optional-and-bounded, the design
 * bag validated by nine closed per-axis enums. What was left, and what these
 * assertions pin, is SIZE: `sections` was an unbounded array and `props` an
 * unbounded passthrough record, both landing in one jsonb column, so a
 * management-role client could write an arbitrarily large document.
 *
 * Kept in its own file rather than appended to `__tests__/journeys.test.ts`
 * because these are the size bounds specifically, and their fixtures are large.
 *
 * `id` stays `z.string().min(1)` and is NOT tightened to a uuid here, deliberately:
 * every section id stored in this platform today IS a uuid (verified —
 * `select count(*) … where s->>'id' !~ '<uuid regex>'` returns 0), but the schema
 * file's own note records that seeded rows carry non-canonical values in
 * neighbouring fields, and 400ing a real page on save is a worse failure than a
 * loose id. Recorded as the open question rather than guessed at.
 */
import { describe, expect, it } from 'vitest';
import { pageSectionSchema, saveJourneyPageBodySchema } from './journeys';

const PAGE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const SUBJECT_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';

const SECTION = {
  id: 'sec-1',
  type: 'hero',
  enabled: true,
  variant: 'stage',
  props: { headline: 'A headline' },
};

function body(sections: unknown[]) {
  return {
    id: PAGE_ID,
    pageType: 'course',
    slug: 'bone-deep',
    title: 'Bone Deep',
    status: 'published' as const,
    subjectType: 'course',
    subjectId: SUBJECT_ID,
    brandOverrides: null,
    sections,
  };
}

/** `n` distinct sections — distinct ids, because a real page has distinct ids. */
function sections(n: number) {
  return Array.from({ length: n }, (_, i) => ({ ...SECTION, id: `sec-${i}` }));
}

describe('sections array is capped', () => {
  it('accepts 60 sections — ~5x the eleven-entry catalogue', () => {
    const parsed = saveJourneyPageBodySchema.safeParse(body(sections(60)));
    expect(parsed.success).toBe(true);
  });

  it('rejects 61', () => {
    expect(
      saveJourneyPageBodySchema.safeParse(body(sections(61))).success
    ).toBe(false);
  });

  it('rejects the 500-section document the bead describes', () => {
    // The falsification the bead asks for: this returned `success: true` before
    // the cap and persisted 500 sections into one jsonb column.
    expect(
      saveJourneyPageBodySchema.safeParse(body(sections(500))).success
    ).toBe(false);
  });

  it('still accepts a REAL page — the largest stored today has four sections', () => {
    const real = ['hero', 'ache', 'map', 'invite'].map((type, i) => ({
      ...SECTION,
      id: `sec-${i}`,
      type,
      variant: undefined,
    }));
    const parsed = saveJourneyPageBodySchema.safeParse(body(real));
    expect(parsed.success).toBe(true);
  });
});

describe('section props are size-bounded', () => {
  /** A props bag whose JSON serialises to about `bytes`. */
  function propsOfSize(bytes: number) {
    const overhead = JSON.stringify({ body: '' }).length;
    return { body: 'x'.repeat(Math.max(0, bytes - overhead)) };
  }

  it('accepts a props bag just under 16KB', () => {
    const props = propsOfSize(16_384);
    expect(JSON.stringify(props).length).toBe(16_384);
    expect(pageSectionSchema.safeParse({ ...SECTION, props }).success).toBe(
      true
    );
  });

  it('rejects one just over', () => {
    const props = propsOfSize(16_385);
    expect(pageSectionSchema.safeParse({ ...SECTION, props }).success).toBe(
      false
    );
  });

  it('bounds a DEEP bag too, not just a long string', () => {
    // A key count would miss this: one key, 40k of nested array.
    const props = { points: Array.from({ length: 4000 }, (_, i) => `p${i}`) };
    expect(JSON.stringify(props).length).toBeGreaterThan(16_384);
    expect(pageSectionSchema.safeParse({ ...SECTION, props }).success).toBe(
      false
    );
  });

  it('reports WHICH constraint failed, so a save error is actionable', () => {
    const parsed = pageSectionSchema.safeParse({
      ...SECTION,
      props: propsOfSize(20_000),
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((i) => i.message).join(' ')).toContain(
        '16KB'
      );
    }
  });

  it('leaves the absent-props default intact — the key is still optional in', () => {
    // The bound must not disturb the `.default({})` idiom the file relies on for
    // assignability to the service input.
    const { props: _omitted, ...noProps } = SECTION;
    expect(pageSectionSchema.parse(noProps).props).toEqual({});
  });

  it('leaves a real section untouched', () => {
    const parsed = pageSectionSchema.parse(SECTION);
    expect(parsed.props).toEqual({ headline: 'A headline' });
  });
});

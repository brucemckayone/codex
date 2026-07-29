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

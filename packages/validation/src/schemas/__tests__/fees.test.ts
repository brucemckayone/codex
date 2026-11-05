/**
 * The dated-fee schemas (Codex-2hxff.33; batch C1 Part B data design §3):
 * support's told-another-way note, the cancel route's id, and the Studio's
 * upcoming-fees filter.
 */

import { describe, expect, it } from 'vitest';
import { feeChangeIdParamsSchema, upcomingFeesQuerySchema } from '../fees';
import {
  supportFeeNoticeIdParamsSchema,
  supportToldAnotherWaySchema,
} from '../support';

const ID = '823e4567-e89b-12d3-a456-426614174007';

describe('supportToldAnotherWaySchema', () => {
  it('keeps the note trimmed, with any NUL dropped', () => {
    expect(
      supportToldAnotherWaySchema.parse({ note: '  Phoned\u0000 Jonah  ' })
    ).toEqual({ note: 'Phoned Jonah' });
  });

  it.each([
    ['no note', {}],
    ['a blank note', { note: ' \n ' }],
    ['a note of only a NUL', { note: '\u0000' }],
    ['a note over 500 characters', { note: 'x'.repeat(501) }],
    ['another field', { note: 'Phoned', toldAt: '2026-11-04T10:42:00Z' }],
  ])('refuses %s', (_label, body) => {
    expect(supportToldAnotherWaySchema.safeParse(body).success).toBe(false);
  });

  it('takes 500 characters exactly', () => {
    expect(
      supportToldAnotherWaySchema.safeParse({ note: 'x'.repeat(500) }).success
    ).toBe(true);
  });
});

describe('the fee ids and filter', () => {
  it('a notice id and a change id are uuids', () => {
    expect(
      supportFeeNoticeIdParamsSchema.safeParse({ noticeId: ID }).success
    ).toBe(true);
    expect(
      supportFeeNoticeIdParamsSchema.safeParse({ noticeId: 'x' }).success
    ).toBe(false);
    expect(feeChangeIdParamsSchema.safeParse({ changeId: ID }).success).toBe(
      true
    );
    expect(feeChangeIdParamsSchema.safeParse({ changeId: '1' }).success).toBe(
      false
    );
  });

  it('the upcoming filter is an optional organisation uuid', () => {
    expect(upcomingFeesQuerySchema.parse({})).toEqual({});
    expect(upcomingFeesQuerySchema.parse({ organizationId: ID })).toEqual({
      organizationId: ID,
    });
    expect(
      upcomingFeesQuerySchema.safeParse({ organizationId: 'nope' }).success
    ).toBe(false);
  });
});

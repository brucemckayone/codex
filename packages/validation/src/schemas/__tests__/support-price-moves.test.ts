/**
 * Support's Queue › Price moves schemas (Codex-2hxff.85, .86; batch C1 Part B
 * data design §3): Close's resolution and required note, and the two ids.
 */

import { describe, expect, it } from 'vitest';
import {
  supportClosePriceMoveSchema,
  supportPriceChangeIdParamsSchema,
  supportPriceMoveIdParamsSchema,
} from '../support';

const ID = '823e4567-e89b-12d3-a456-426614174007';

describe('supportClosePriceMoveSchema', () => {
  it('takes either resolution, with the note trimmed and any NUL dropped', () => {
    expect(
      supportClosePriceMoveSchema.parse({
        resolution: 'not_needed',
        note: '  Leah cancelled\u0000 Pro  ',
      })
    ).toEqual({ resolution: 'not_needed', note: 'Leah cancelled Pro' });
    expect(
      supportClosePriceMoveSchema.safeParse({
        resolution: 'moved_by_hand',
        note: 'Phoned, then moved in Stripe',
      }).success
    ).toBe(true);
  });

  it.each([
    ['no note', { resolution: 'not_needed' }],
    ['a blank note', { resolution: 'not_needed', note: ' \n ' }],
    ['a note of only a NUL', { resolution: 'not_needed', note: '\u0000' }],
    [
      'a note over 500 characters',
      { resolution: 'not_needed', note: 'x'.repeat(501) },
    ],
    ['no resolution', { note: 'Phoned' }],
    ['the run’s own resolution', { resolution: 'retried_ok', note: 'Phoned' }],
    [
      'another field',
      { resolution: 'not_needed', note: 'Phoned', state: 'scheduled' },
    ],
  ])('refuses %s', (_label, body) => {
    expect(supportClosePriceMoveSchema.safeParse(body).success).toBe(false);
  });
});

describe('the price-move ids', () => {
  it('take a uuid and nothing else', () => {
    expect(supportPriceMoveIdParamsSchema.parse({ moveId: ID })).toEqual({
      moveId: ID,
    });
    expect(supportPriceChangeIdParamsSchema.parse({ changeId: ID })).toEqual({
      changeId: ID,
    });
    expect(
      supportPriceMoveIdParamsSchema.safeParse({ moveId: 'not-a-uuid' }).success
    ).toBe(false);
    expect(
      supportPriceChangeIdParamsSchema.safeParse({ changeId: 'sub_123' })
        .success
    ).toBe(false);
  });
});

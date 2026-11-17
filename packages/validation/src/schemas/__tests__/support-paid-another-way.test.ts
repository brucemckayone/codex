/**
 * "Paid another way" (owner D60, D61, D63): the body of
 * POST /api/admin/support/charges/:chargeId/paid-another-way. What the page
 * showed: the dispute, the whole pence owed and which time it is owed
 * (`stage`, `short` when absent); nothing else.
 */

import { describe, expect, it } from 'vitest';
import { stripeDisputeIdSchema, supportPaidAnotherWaySchema } from '../support';

const BODY = { stripeDisputeId: 'du_1QjK7pXk9vRb88aQ', expectedOwedCents: 500 };

describe('stripeDisputeIdSchema', () => {
  it.each([
    'du_1QjK7pXk9vRb88aQ',
    'dp_1QjK7pXk9vRb88aQ',
  ])('takes a dispute: %s', (id) => {
    expect(stripeDisputeIdSchema.safeParse(id).success).toBe(true);
  });

  it.each([
    ['a charge', 'ch_1QjK7pXk9vRb88aQ'],
    ['a refund', 're_1QjK7pXk9vRb88aQ'],
    ['too short', 'du_1234'],
    ['a stray character', 'du_1QjK7pXk9vRb88a-'],
    ['blank', ''],
  ])('refuses %s', (_what, id) => {
    expect(stripeDisputeIdSchema.safeParse(id).success).toBe(false);
  });
});

describe('supportPaidAnotherWaySchema', () => {
  it('takes the dispute and what is owed, as the first time when no stage is sent', () => {
    expect(supportPaidAnotherWaySchema.parse(BODY)).toEqual({
      ...BODY,
      stage: 'short',
    });
  });

  it.each(['short', 'owed_again'] as const)('takes the stage %s', (stage) => {
    expect(supportPaidAnotherWaySchema.parse({ ...BODY, stage })).toEqual({
      ...BODY,
      stage,
    });
  });

  it.each([
    ['no dispute', { expectedOwedCents: 500 }],
    ['no amount', { stripeDisputeId: BODY.stripeDisputeId }],
    ['nothing owed', { ...BODY, expectedOwedCents: 0 }],
    ['a negative amount', { ...BODY, expectedOwedCents: -500 }],
    ['part of a penny', { ...BODY, expectedOwedCents: 12.5 }],
    ['an amount as text', { ...BODY, expectedOwedCents: '500' }],
    ['a note, which has no column', { ...BODY, note: 'Paid by transfer' }],
    ['an unknown stage', { ...BODY, stage: 'third' }],
    ['a blank stage', { ...BODY, stage: '' }],
  ])('refuses %s', (_what, body) => {
    expect(supportPaidAnotherWaySchema.safeParse(body).success).toBe(false);
  });
});

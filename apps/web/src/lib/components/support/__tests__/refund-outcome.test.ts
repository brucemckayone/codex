/**
 * The refund command's answer to the B3 state (Codex-2hxff.28; data design
 * §1's error table). Each support error is told apart by `details.code`,
 * which sits under a class code at the top level, so the mapping never
 * switches on `code` alone.
 */

import { describe, expect, test } from 'vitest';
import { preview } from '../__fixtures__/support-fixtures';
import { failure } from '../__fixtures__/support-remote.mock.svelte';
import {
  locksUntilReload,
  parsePounds,
  refreshesCounts,
  refundOutcomeOf,
  rejectedOutcome,
  reloadsCharge,
} from '../refund-outcome';

const context = { preview: preview(), seenRefundIds: ['re_old'] };
const REFUND = {
  id: 're_new',
  amountCents: 750,
  status: 'succeeded',
  createdAt: '2026-10-24T09:41:00.000Z',
};

describe('refundOutcomeOf', () => {
  test('a refund made is "made", with the preview it was reviewed against', () => {
    const outcome = refundOutcomeOf(
      { outcome: 'done', result: { refund: REFUND, replayed: false } },
      context
    );
    expect(outcome).toEqual({
      kind: 'made',
      refund: REFUND,
      preview: context.preview,
    });
  });

  test('a replay of the same decision is "replayed": nothing new was refunded', () => {
    const outcome = refundOutcomeOf(
      { outcome: 'done', result: { refund: REFUND, replayed: true } },
      context
    );
    expect(outcome).toEqual({ kind: 'replayed', refund: REFUND });
  });

  test.each([
    [
      'CHARGE_CHANGED',
      { status: 412, code: 'PRECONDITION_FAILED', refundCount: 2 },
      { kind: 'changed', seenRefundIds: ['re_old'] },
    ],
    [
      'STRIPE_REFUSED',
      { stripeCode: 'charge_disputed' },
      { kind: 'refused', stripeCode: 'charge_disputed' },
    ],
    [
      'REFUND_WINDOW_CLOSED',
      { closesAt: '2026-10-17T07:15:00.000Z' },
      { kind: 'window_closed', closesAt: '2026-10-17T07:15:00.000Z' },
    ],
    [
      'CHARGE_HAS_CHARGEBACK',
      { disputeStatus: 'needs_response' },
      { kind: 'chargeback', disputeStatus: 'needs_response' },
    ],
    ['NOTHING_LEFT_TO_REFUND', {}, { kind: 'nothing_left' }],
    [
      'REFUND_AMOUNT_TOO_LARGE',
      { status: 400, code: 'VALIDATION_ERROR', maxCents: 1500 },
      { kind: 'too_large', maxCents: 1500 },
    ],
    [
      'REFUND_KEY_SPENT',
      { status: 409, code: 'CONFLICT' },
      { kind: 'key_spent' },
    ],
    [
      'REFUND_IN_FLIGHT',
      { status: 409, code: 'CONFLICT' },
      { kind: 'in_flight' },
    ],
  ] as const)('details.code %s', (detailsCode, fields, expected) => {
    expect(
      refundOutcomeOf(failure({ detailsCode, ...fields }), context)
    ).toEqual(expected);
  });

  test('a class code without a support code is a plain failure, whatever its status', () => {
    expect(
      refundOutcomeOf(
        failure({ status: 412, code: 'PRECONDITION_FAILED' }),
        context
      )
    ).toEqual({ kind: 'failed' });
    expect(
      refundOutcomeOf(failure({ status: 500, code: null }), context)
    ).toEqual({
      kind: 'failed',
    });
  });

  test.each([
    [401, 'signed_out'],
    [403, 'signed_out'],
    [429, 'rate_limited'],
    [400, 'failed'],
    [503, 'failed'],
  ] as const)('a %i before the route ran is "%s"', (status, kind) => {
    expect(refundOutcomeOf(failure({ status, code: null }), context)).toEqual({
      kind,
    });
  });

  test('a rejected command: the guard’s 404 is a lost session, the transport a failure', () => {
    expect(
      rejectedOutcome({ status: 404, body: { message: 'Not Found' } })
    ).toEqual({
      kind: 'signed_out',
    });
    expect(rejectedOutcome({ status: 429 })).toEqual({ kind: 'rate_limited' });
    expect(rejectedOutcome(new TypeError('fetch failed'))).toEqual({
      kind: 'failed',
    });
  });

  test('a Stripe refusal with no code still shows as refused', () => {
    expect(
      refundOutcomeOf(failure({ detailsCode: 'STRIPE_REFUSED' }), context)
    ).toEqual({
      kind: 'refused',
      stripeCode: 'unknown',
    });
  });
});

describe('what reloads after an outcome', () => {
  test('the charge reloads when what it shows is out of date, not when nothing changed', () => {
    const kinds = [
      'made',
      'replayed',
      'changed',
      'window_closed',
      'chargeback',
      'nothing_left',
      'too_large',
    ] as const;
    for (const kind of kinds) {
      expect(reloadsCharge({ kind } as never), kind).toBe(true);
    }
    for (const kind of [
      'refused',
      'key_spent',
      'in_flight',
      'signed_out',
      'rate_limited',
      'failed',
    ] as const) {
      expect(reloadsCharge({ kind } as never), kind).toBe(false);
    }
  });

  test('only "in flight" and "key spent" lock the form until a reload lands', () => {
    for (const kind of ['in_flight', 'key_spent'] as const) {
      expect(locksUntilReload({ kind } as never), kind).toBe(true);
    }
    for (const kind of [
      'made',
      'replayed',
      'changed',
      'refused',
      'window_closed',
      'chargeback',
      'nothing_left',
      'too_large',
      'signed_out',
      'rate_limited',
      'failed',
    ] as const) {
      expect(locksUntilReload({ kind } as never), kind).toBe(false);
    }
  });

  test('the counts refresh only when a refund exists', () => {
    expect(refreshesCounts({ kind: 'made' } as never)).toBe(true);
    expect(refreshesCounts({ kind: 'replayed' } as never)).toBe(true);
    expect(refreshesCounts({ kind: 'changed' } as never)).toBe(false);
    expect(refreshesCounts({ kind: 'refused' } as never)).toBe(false);
  });
});

describe('parsePounds', () => {
  test.each([
    ['7.50', 750],
    ['7.5', 750],
    ['7', 700],
    // Not parseFloat: 4.35 * 100 is 434.99999999999994 in floating point.
    ['£4.35', 435],
    ['0.29', 29],
    ['1,000.00', 100000],
    [' 0.01 ', 1],
  ])('%s is %ip', (text, pence) => {
    expect(parsePounds(text)).toBe(pence);
  });

  test.each([
    ['12,345.67', 1234567],
    ['1,000,000', 100000000],
  ])('%s is %ip: commas between thousands', (text, pence) => {
    expect(parsePounds(text)).toBe(pence);
  });

  // A comma anywhere else is not dropped: "1,50" is not £150.
  test.each([
    '1,50',
    '1,0000',
    ',100',
    '10,00.50',
    '1,000,',
  ])('%s is not an amount: a comma only separates thousands', (text) => {
    expect(parsePounds(text)).toBeNull();
  });

  test.each([
    '',
    '7.505',
    '-1',
    'abc',
    '7.5.0',
    '.50',
  ])('%s is not an amount', (text) => {
    expect(parsePounds(text)).toBeNull();
  });
});

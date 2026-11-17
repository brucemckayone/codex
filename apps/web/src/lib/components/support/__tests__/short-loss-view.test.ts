/**
 * "Paid another way" (owner D61): what each answer does. A notice for the
 * page closes the dialog; a problem keeps it open. The dialog's own test
 * (RefundForm.svelte.test.ts) mounts every answer; this pins the edges.
 */

import { describe, expect, it } from 'vitest';
import { failure } from '../__fixtures__/support-remote.mock.svelte';
import { paidAnotherWayOutcome } from '../short-loss-view';

describe('paidAnotherWayOutcome', () => {
  it('a mark is a success notice naming the amount, the buyer and the day', () => {
    expect(
      paidAnotherWayOutcome(
        {
          outcome: 'done',
          result: {
            chargeId: 'ch_1',
            stripeDisputeId: 'du_1',
            stage: 'short',
            owedCents: 1250,
            paidAnotherWayOn: '2026-11-17T23:30:00.000Z',
            alreadyMarked: false,
          },
        },
        'Ellie Marsh'
      )
    ).toEqual({
      notice: {
        variant: 'success',
        lead: 'Marked as paid another way.',
        text: '£12.50 to Ellie Marsh, on 17 Nov 2026. The hourly alert stops for this payment.',
      },
    });
  });

  it.each([
    [401, 'session_ended'],
    [403, 'session_ended'],
    [500, 'failed'],
    [503, 'failed'],
  ] as const)('a %i with no notice keeps the dialog open: %s', (status, problem) => {
    expect(
      paidAnotherWayOutcome(failure({ status, code: 'X' }), 'Ellie Marsh')
    ).toEqual({ problem });
  });

  it('a NOT_OWED_AFTER_LOSS reason this page does not know is no notice: the dialog says it failed', () => {
    expect(
      paidAnotherWayOutcome(
        failure({ detailsCode: 'NOT_OWED_AFTER_LOSS', reason: 'toString' }),
        'Ellie Marsh'
      )
    ).toEqual({ problem: 'failed' });
  });
});

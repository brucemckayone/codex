/**
 * Words and dates for the support pages (Codex-2hxff.28). Dates are London
 * time; "days left" is display only (the route checks the window itself).
 */

import { describe, expect, test } from 'vitest';
import * as m from '$paraglide/messages';
import { NOW, slice } from '../__fixtures__/support-fixtures';
import {
  chargeTitle,
  daysLeftText,
  formatDayTime,
  matchedBy,
  payeeCell,
  payoutStatus,
  takenHow,
  windowCell,
} from '../support-format';

describe('dates', () => {
  test('a time is London time, summer and winter', () => {
    // 13:32 UTC in October is 14:32 in London (BST); in December, 13:32 (GMT).
    expect(formatDayTime('2026-10-18T13:32:00.000Z')).toBe(
      '18 Oct 2026, 14:32'
    );
    expect(formatDayTime('2026-12-18T13:32:00.000Z')).toBe(
      '18 Dec 2026, 13:32'
    );
  });

  test('days left rounds to the nearest day, as the mockup reads', () => {
    // 1 Nov 14:32 is 8 days 4 hours away; 3 Nov 07:00 is 9 days 21 hours.
    expect(daysLeftText('2026-11-01T14:32:00.000Z', NOW)).toBe(
      m.support_days_left({ count: '8' })
    );
    expect(daysLeftText('2026-11-03T07:00:00.000Z', NOW)).toBe(
      m.support_days_left({ count: '10' })
    );
    expect(daysLeftText('2026-10-25T10:00:00.000Z', NOW)).toBe(
      m.support_days_left_one()
    );
    expect(daysLeftText('2026-10-24T20:00:00.000Z', NOW)).toBe(
      m.support_days_left_less()
    );
  });

  test('the results window cell: open with days left, or closed with its date', () => {
    expect(
      windowCell({ closesAt: '2026-11-01T14:32:00.000Z', isOpen: true }, NOW)
    ).toEqual({
      badge: { label: m.support_window_open(), variant: 'success' },
      detail: m.support_window_closes({
        date: '1 Nov',
        left: m.support_days_left({ count: '8' }),
      }),
    });
    expect(
      windowCell({ closesAt: '2026-10-17T07:15:00.000Z', isOpen: false }, NOW)
    ).toEqual({
      badge: { label: m.support_window_closed(), variant: 'neutral' },
      detail: m.support_window_closed_on({ date: '17 Oct' }),
    });
  });
});

describe('labels', () => {
  test('an invoice title carries its interval; a purchase is its title', () => {
    expect(
      chargeTitle({
        kind: 'subscription_invoice',
        title: 'Inner Circle',
        interval: 'month',
      })
    ).toBe('Inner Circle · monthly');
    expect(
      chargeTitle({
        kind: 'course_plan_invoice',
        title: 'Yoga Foundations',
        interval: 'month',
      })
    ).toBe('Yoga Foundations · monthly plan');
    expect(
      chargeTitle({
        kind: 'purchase',
        title: 'Sleep Reset Programme',
        interval: null,
      })
    ).toBe('Sleep Reset Programme');
  });

  test('"matched by" names what the search box held', () => {
    expect(matchedBy('ellie.marsh@example.com')).toBe(
      m.support_matched_email()
    );
    expect(matchedBy('sub_1PpRwLk2vRb')).toBe(m.support_matched_subscription());
    expect(matchedBy('pi_3QzZ9KQ2eZvKYlo21x')).toBe(
      m.support_matched_payment()
    );
    expect(matchedBy('py_3QzZ9KQ2eZvKYlo21x')).toBe(m.support_matched_charge());
    expect(matchedBy('11111111-1111-4111-8111-111111111111')).toBe(
      m.support_matched_uuid()
    );
    expect(matchedBy('ellie')).toBeNull();
  });

  test('the platform fee is "kept by the platform" whatever its row status', () => {
    const fee = slice({
      payoutType: 'platform_fee',
      payee: null,
      status: 'paid',
    });
    expect(payoutStatus(fee)).toEqual({
      label: m.support_payout_kept(),
      variant: 'neutral',
    });
    expect(payeeCell(fee).title).toBe(m.support_payee_platform_fee());
    expect(takenHow(fee)).toBe(m.support_taken_platform());
  });

  test('an organisation fee names the organisation and who it pays', () => {
    const org = slice({
      payoutType: 'organization_fee',
      payee: { userId: 'u', name: 'Sam Owner', deleted: false },
      status: 'pending',
    });
    expect(payeeCell(org)).toEqual({
      title: 'Studio Alpha',
      detail: m.support_payee_org_fee({ name: 'Sam Owner' }),
    });
    expect(payoutStatus(org).variant).toBe('warning');
    expect(takenHow(org)).toBe(m.support_taken_reduced());
  });
});

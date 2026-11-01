/**
 * The Studio fee note's words (Codex-2hxff.33 F5; batch C1 Part B page 1).
 * Each drawn state is checked against the mockup's own sentence.
 */

import type { UpcomingFeeChange, UpcomingFeeLine } from '@codex/purchase';
import { describe, expect, test } from 'vitest';
import { feeNoteView, formatStartDate, WAS_MARK } from './upcoming-fee-view';

const HOLLOW = '11111111-1111-4111-8111-111111111111';
const NORTH = '22222222-2222-4222-8222-222222222222';

const line = (over: Partial<UpcomingFeeLine> = {}): UpcomingFeeLine => ({
  organizationId: HOLLOW,
  organizationName: 'Hollow Oak Films',
  as: 'owner',
  value: 'platformFeePercent',
  context: 'both',
  from: 1000,
  to: 1200,
  replaced: null,
  ...over,
});

const change = (over: Partial<UpcomingFeeChange> = {}): UpcomingFeeChange => ({
  changeId: 'c1',
  kind: 'announce',
  scope: 'platform',
  // UK midnight in winter is 00:00 UTC.
  effectiveFrom: '2026-12-05T00:00:00.000Z',
  earliestFrom: '2026-12-05T00:00:00.000Z',
  announcedAt: '2026-11-03T08:00:12.000Z',
  lines: [line()],
  ...over,
});

const single = (items: UpcomingFeeChange[]) => {
  const view = feeNoteView(items);
  if (view?.kind !== 'single') throw new Error('expected one note');
  return view;
};

describe('feeNoteView', () => {
  test('N1 Billing, once the date is set', () => {
    const view = single([change()]);
    expect(view.lead).toBe(
      "From 5 December 2026, Codex's fee rises from 10% to 12% of each sale."
    );
    expect(view.meta).toEqual({
      text: "Sales before then keep today's fee, and a subscription payment follows the date its invoice was raised. We emailed you about this on 3 November.",
      was: null,
    });
  });

  test('N2 before everyone is told: the earliest date, which can only move later', () => {
    const view = single([
      change({ effectiveFrom: null, earliestFrom: '2026-12-04T00:00:00.000Z' }),
    ]);
    expect(view.lead).toBe(
      "Codex's fee rises from 10% to 12% of each sale, from 4 December 2026 at the earliest."
    );
    expect(view.meta.text).toBe(
      "The date is set once everyone the rise affects has been told, so it can move later but never earlier. Sales before it keep today's fee. We emailed you about this on 3 November."
    );
  });

  test('N4 a creator in two organisations: one line covers both', () => {
    const view = single([
      change({
        lines: [
          line({ as: 'creator' }),
          line({
            as: 'creator',
            organizationId: NORTH,
            organizationName: 'Northlight Collective',
          }),
        ],
      }),
    ]);
    expect(view.lead).toBe(
      "From 5 December 2026, Codex's fee on your sales rises from 10% to 12%."
    );
  });

  test('N5 a mixed change: both parts, one date', () => {
    const view = single([
      change({
        lines: [
          line(),
          line({ value: 'minPlatformFeeCents', from: 25, to: 20 }),
        ],
      }),
    ]);
    expect(view.lead).toBe(
      "From 5 December 2026, Codex's fee rises from 10% to 12% of each sale, and the minimum fee falls from 25p to 20p."
    );
    expect(view.meta.text).toBe(
      "Both parts start on the same day. Sales before then keep today's fees. We emailed you about this on 3 November."
    );
  });

  test('N6 two changes: one line each, each with its own date', () => {
    const view = feeNoteView([
      change({ lines: [line({ as: 'creator' })] }),
      change({
        changeId: 'c2',
        scope: 'org',
        effectiveFrom: '2026-12-12T00:00:00.000Z',
        earliestFrom: '2026-12-12T00:00:00.000Z',
        lines: [
          line({
            as: 'creator',
            organizationId: NORTH,
            organizationName: 'Northlight Collective',
            value: 'orgFeePercent',
            from: 1000,
            to: 1500,
          }),
        ],
      }),
    ]);
    expect(view).toEqual({
      kind: 'list',
      items: [
        {
          changeId: 'c1',
          when: 'From 5 December 2026,',
          text: "Codex's fee on your sales rises from 10% to 12%.",
        },
        {
          changeId: 'c2',
          when: 'From 12 December 2026,',
          text: "Northlight Collective's share of your sales there rises from 10% to 15% of what's left after Codex's fee, on sales not covered by a revenue-share agreement.",
        },
      ],
      meta: "Sales before each date keep today's fees. We emailed you about each change.",
    });
  });

  test('N7 a smaller rise keeps the date and names the figure first told', () => {
    const view = single([
      change({ kind: 'smaller', lines: [line({ to: 1100, replaced: 1200 })] }),
    ]);
    expect(view.lead).toBe(
      "From 5 December 2026, Codex's fee rises from 10% to 11% of each sale."
    );
    expect(view.meta.was).toBe('12%');
    expect(view.meta.text.split(WAS_MARK)).toEqual([
      "That's less than the ",
      " we first told you about, and the date hasn't changed. We emailed you about this on 3 November.",
    ]);
  });

  test('N8 a bigger rise is a new announcement, at the earliest', () => {
    const view = single([
      change({
        effectiveFrom: null,
        earliestFrom: '2026-12-07T00:00:00.000Z',
        announcedAt: '2026-11-06T08:00:00.000Z',
        lines: [line({ to: 1400 })],
      }),
    ]);
    expect(view.lead).toBe(
      "Codex's fee rises from 10% to 14% of each sale, from 7 December 2026 at the earliest."
    );
  });

  test('N9 a minimum transfer switched on', () => {
    const view = single([
      change({
        lines: [
          line({ as: 'creator', value: 'minTransferCents', from: 0, to: 500 }),
        ],
      }),
    ]);
    expect(view.lead).toBe(
      "From 5 December 2026, an amount under £5.00 waits until you're owed at least £5.00 before it's sent."
    );
    expect(view.meta.text).toBe(
      'Today every amount is sent, however small. Nothing is lost: it all goes once the total reaches £5.00. We emailed you about this on 3 November.'
    );
  });

  test('N12 nothing coming: no note', () => {
    expect(feeNoteView([])).toBeNull();
  });

  test('an email that failed: the note shows, without "We emailed you"', () => {
    const view = single([change({ announcedAt: null })]);
    expect(view.meta.text).toBe(
      "Sales before then keep today's fee, and a subscription payment follows the date its invoice was raised."
    );
  });

  test('a creator whose two organisations move differently is told where', () => {
    const view = single([
      change({
        lines: [
          line({ as: 'creator' }),
          line({
            as: 'creator',
            organizationId: NORTH,
            organizationName: 'Northlight Collective',
            from: 800,
          }),
        ],
      }),
    ]);
    expect(view.lead).toBe(
      "From 5 December 2026, Codex's fee on your sales in Hollow Oak Films rises from 10% to 12%, and Codex's fee on your sales in Northlight Collective rises from 8% to 12%."
    );
  });
});

describe('formatStartDate', () => {
  test('a summer start is the London day, not the UTC one', () => {
    // UK midnight in June is 23:00 UTC the day before.
    expect(formatStartDate('2027-06-04T23:00:00.000Z')).toBe('5 June 2027');
  });
});

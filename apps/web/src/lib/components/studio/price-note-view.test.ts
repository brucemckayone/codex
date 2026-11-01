/**
 * The price-change note's words (Codex-2hxff.85 M3, .86; batch C1 Part B
 * page 4), checked against the mockup's own cases: Hollow Oak Films raises
 * Pro from £12/£120 to £14/£140 at 14:12 on Fri 30 Oct 2026 (19 monthly and
 * 4 annual subscribers); Northlight Collective raises Members monthly from
 * £8 to £9 at 13:20 (6,240). BST ended on 25 Oct, so London is UTC here.
 */

import type { PriceChangeProgress } from '@codex/subscription';
import { PRICE_MOVES_PER_RUN } from '@codex/subscription';
import { describe, expect, test } from 'vitest';
import {
  PRICE_EMAILS_PER_RUN,
  priceChangeNotes,
  stillGoingOutHint,
} from './price-note-view';

const PRO_SAVED = '2026-10-30T14:12:00.000Z';
const MEMBERS_SAVED = '2026-10-30T13:20:00.000Z';

function change(
  over: Omit<Partial<PriceChangeProgress>, 'counts'> & {
    counts?: Partial<PriceChangeProgress['counts']>;
  } = {}
): PriceChangeProgress {
  const { counts, ...rest } = over;
  return {
    id: 'pro-month',
    tierId: 'pro',
    courseSubscriptionPlanId: null,
    interval: 'month',
    fromAmountCents: 1200,
    newAmountCents: 1400,
    state: 'running',
    createdAt: PRO_SAVED,
    counts: {
      total: 19,
      emailed: 0,
      scheduled: 0,
      held: 0,
      due: 19,
      retrying: 0,
      ...counts,
    },
    lastRunAt: null,
    nextRunAt: '2026-10-30T15:00:00.000Z',
    estimatedDoneAt: '2026-10-30T15:00:00.000Z',
    doneAt: null,
    supersededById: null,
    stoppedAt: null,
    ...rest,
  };
}

const proYear = (over: Parameters<typeof change>[0] = {}) =>
  change({
    id: 'pro-year',
    interval: 'year',
    fromAmountCents: 12000,
    newAmountCents: 14000,
    ...over,
    counts: { total: 4, due: 4, ...over.counts },
  });

const members = (over: Parameters<typeof change>[0] = {}) =>
  change({
    id: 'members-9',
    tierId: 'members',
    fromAmountCents: 800,
    newAmountCents: 900,
    createdAt: MEMBERS_SAVED,
    ...over,
    counts: { total: 6240, due: 6240, ...over.counts },
  });

const PRO = { kind: 'tier' as const, name: 'Pro' };
const MEMBERS = { kind: 'tier' as const, name: 'Members' };

function notes(
  changes: PriceChangeProgress[],
  now: string,
  extra: Partial<Parameters<typeof priceChangeNotes>[0]> = {}
) {
  return priceChangeNotes({
    all: changes,
    changes,
    subject: PRO,
    now: new Date(now),
    ...extra,
  });
}

describe('the note after saving (P2 to P9)', () => {
  test('P2 saved, before the first run: one note for both prices', () => {
    const [note, ...rest] = notes(
      [change(), proYear()],
      '2026-10-30T14:12:30.000Z'
    );
    expect(rest).toEqual([]);
    expect(note).toMatchObject({
      icon: 'clock',
      tone: 'info',
      lead: 'New prices saved.',
      text: "We'll start emailing your 23 Pro subscribers about them at 15:00. Each moves to £14.00/mo or £140.00/yr at their first renewal at least 30 days after their own email, and keeps paying £12.00/mo or £120.00/yr until then.",
      bar: null,
      counts: [],
      action: null,
    });
    expect(note?.ids).toEqual(['pro-month', 'pro-year']);
  });

  test('P3 all done: the counts, the finish time, Dismiss', () => {
    const done = {
      state: 'done' as const,
      doneAt: '2026-10-30T15:01:00.000Z',
      lastRunAt: '2026-10-30T15:00:00.000Z',
      nextRunAt: null,
      estimatedDoneAt: null,
    };
    const [note] = notes(
      [
        change({ ...done, counts: { emailed: 19, scheduled: 19, due: 0 } }),
        proYear({ ...done, counts: { emailed: 4, scheduled: 4, due: 0 } }),
      ],
      '2026-10-30T15:05:00.000Z'
    );
    expect(note).toMatchObject({
      icon: 'mail',
      lead: 'All 23 Pro subscribers have been emailed about the new prices.',
      text: 'Each moves at their first renewal at least 30 days after their own email.',
      counts: [
        { value: '23', label: 'emailed' },
        { value: '23', label: 'moves scheduled' },
      ],
      meta: 'Finished at 15:01.',
      action: 'dismiss',
    });
  });

  test('P4 done, one held: a count only, and what they pay meanwhile', () => {
    const done = {
      state: 'done' as const,
      doneAt: '2026-10-30T17:01:00.000Z',
      lastRunAt: '2026-10-30T17:00:00.000Z',
      nextRunAt: null,
    };
    const [note] = notes(
      [
        change({
          ...done,
          counts: { emailed: 18, scheduled: 18, held: 1, due: 0 },
        }),
        proYear({ ...done, counts: { emailed: 4, scheduled: 4, due: 0 } }),
      ],
      '2026-10-30T17:05:00.000Z'
    );
    expect(note).toMatchObject({
      lead: '22 of 23 Pro subscribers have been emailed about the new prices.',
      counts: [
        { value: '22', label: 'emailed' },
        { value: '22', label: 'moves scheduled' },
        { value: '1', label: "couldn't be emailed" },
      ],
      meta: "Our support team is handling the 1 we couldn't email; they keep paying £12.00/mo until then. Finished at 17:01.",
    });
  });

  test('P4 between runs: a retry is not a failure yet', () => {
    const [note] = notes(
      [
        change({
          lastRunAt: '2026-10-30T15:00:00.000Z',
          nextRunAt: '2026-10-30T16:00:00.000Z',
          counts: { emailed: 18, scheduled: 18, due: 1, retrying: 1 },
        }),
        proYear({
          state: 'done',
          doneAt: '2026-10-30T15:01:00.000Z',
          counts: { emailed: 4, scheduled: 4, due: 0 },
        }),
      ],
      '2026-10-30T15:05:00.000Z'
    );
    expect(note?.counts).toEqual([
      { value: '22', label: 'emailed' },
      { value: '22', label: 'moves scheduled' },
      { value: '1', label: 'to try again at 16:00' },
    ]);
  });

  const midRun = () =>
    members({
      lastRunAt: '2026-10-30T16:00:00.000Z',
      nextRunAt: '2026-10-30T17:00:00.000Z',
      estimatedDoneAt: '2026-10-30T18:00:00.000Z',
      counts: { emailed: 4500, scheduled: 4493, held: 7, due: 1740 },
    });

  test('P5 a big plan mid-run: the bar, four counts, the finish estimate', () => {
    const [note] = notes([midRun()], '2026-10-30T16:04:00.000Z', {
      subject: MEMBERS,
    });
    expect(note).toMatchObject({
      lead: 'Emailing your 6,240 Members subscribers about £9.00/mo.',
      text: 'Each moves at their first renewal at least 30 days after their own email, and keeps paying £8.00/mo until then.',
      bar: 72,
      counts: [
        { value: '4,500', label: 'emailed' },
        { value: '4,493', label: 'moves scheduled' },
        { value: '1,740', label: 'still to email' },
        { value: '7', label: "couldn't be moved yet" },
      ],
      meta: 'We email about 1,500 an hour, so the rest by about 18:00. Our support team is handling the 7. As of the 16:00 run.',
      action: 'check',
      lastRunAt: '2026-10-30T16:00:00.000Z',
    });
  });

  test('P6 Check again found the same run: it says so, and when the next is', () => {
    const [first] = notes([midRun()], '2026-10-30T16:04:00.000Z', {
      subject: MEMBERS,
    });
    const [note] = notes([midRun()], '2026-10-30T16:30:00.000Z', {
      subject: MEMBERS,
      check: {
        key: first?.key ?? '',
        at: '2026-10-30T16:30:00.000Z',
        lastRunAt: '2026-10-30T16:00:00.000Z',
      },
    });
    expect(note?.meta).toBe(
      'Checked at 16:30: nothing has changed since the 16:00 run. The next 1,500 go at 17:00, and the rest by about 18:00.'
    );
  });

  test('Check again that found a newer run reads as P5', () => {
    const [first] = notes([midRun()], '2026-10-30T16:04:00.000Z', {
      subject: MEMBERS,
    });
    const later = members({
      lastRunAt: '2026-10-30T17:00:00.000Z',
      nextRunAt: '2026-10-30T18:00:00.000Z',
      estimatedDoneAt: '2026-10-30T18:00:00.000Z',
      counts: { emailed: 6000, scheduled: 5993, held: 7, due: 240 },
    });
    const [note] = notes([later], '2026-10-30T17:04:00.000Z', {
      subject: MEMBERS,
      check: {
        key: first?.key ?? '',
        at: '2026-10-30T17:04:00.000Z',
        lastRunAt: '2026-10-30T16:00:00.000Z',
      },
    });
    expect(note?.meta).toBe(
      'We email about 1,500 an hour, so the rest by about 18:00. Our support team is handling the 7. As of the 17:00 run.'
    );
  });

  test('P7 paused: nothing for the creator to do, and nobody moved', () => {
    const [note] = notes(
      [
        members({
          state: 'stopped',
          stoppedAt: '2026-10-30T14:01:00.000Z',
          lastRunAt: '2026-10-30T14:00:00.000Z',
          nextRunAt: null,
        }),
      ],
      '2026-10-30T14:10:00.000Z',
      { subject: MEMBERS }
    );
    expect(note).toMatchObject({
      icon: 'pause',
      tone: 'warning',
      lead: "We've paused emailing your Members subscribers about £9.00/mo.",
      text: "Our first emails couldn't be sent, so nobody has been moved and everyone keeps paying £8.00/mo for now. Our support team has been told and will restart it; you don't need to do anything.",
      counts: [
        { value: '0', label: 'emailed' },
        { value: '6,240', label: 'waiting' },
      ],
      action: null,
    });
  });

  test('P9 the newer price replaces the running one: one note, the new one', () => {
    const replaced = {
      ...midRun(),
      state: 'superseded' as const,
      supersededById: 'members-10',
    };
    const newer = members({
      id: 'members-10',
      fromAmountCents: 900,
      newAmountCents: 1000,
      createdAt: '2026-10-30T16:21:00.000Z',
      nextRunAt: '2026-10-30T17:00:00.000Z',
    });
    const all = [newer, replaced];
    const result = priceChangeNotes({
      all,
      changes: all,
      subject: MEMBERS,
      now: new Date('2026-10-30T16:21:30.000Z'),
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      icon: 'clock',
      lead: 'New price saved: £10.00/mo. It replaces £9.00/mo.',
      text: "We'll start emailing all 6,240 Members subscribers about £10.00 at 17:00, including the 4,500 already told about £9.00. Each moves at their first renewal at least 30 days after their own email.",
    });
  });

  test('P11 a course plan: the people subscribed to this course', () => {
    const plan = (over: Parameters<typeof change>[0]) =>
      change({
        tierId: null,
        courseSubscriptionPlanId: 'plan',
        ...over,
      });
    const all = [
      plan({
        id: 'plan-month',
        newAmountCents: 1500,
        counts: { total: 30, due: 30 },
      }),
      plan({
        id: 'plan-year',
        interval: 'year',
        fromAmountCents: 12000,
        newAmountCents: 15000,
        counts: { total: 8, due: 8 },
      }),
    ];
    const [note] = priceChangeNotes({
      all,
      changes: all,
      subject: { kind: 'course' },
      now: new Date('2026-10-30T14:12:30.000Z'),
    });
    expect(note).toMatchObject({
      lead: 'New course prices saved.',
      text: "We'll start emailing the 38 people subscribed to this course at 15:00. Each moves to £15.00/mo or £150.00/yr at their first renewal at least 30 days after their own email.",
    });
  });
});

describe('when there is no note', () => {
  const doneOn = (doneAt: string) =>
    change({
      state: 'done',
      doneAt,
      nextRunAt: null,
      counts: { emailed: 19, scheduled: 19, due: 0 },
    });

  test('Q8: a finished note goes 14 days after its last email', () => {
    expect(
      notes([doneOn('2026-10-30T15:01:00.000Z')], '2026-11-13T15:00:00.000Z')
    ).toHaveLength(1);
    expect(
      notes([doneOn('2026-10-30T15:01:00.000Z')], '2026-11-13T15:02:00.000Z')
    ).toEqual([]);
  });

  test('a finished note on another day says which', () => {
    const [note] = notes(
      [doneOn('2026-10-30T15:01:00.000Z')],
      '2026-11-02T09:00:00.000Z'
    );
    expect(note?.meta).toBe('Finished on 30 Oct at 15:01.');
  });

  test('dismissed: gone, by any of its changes', () => {
    const dismissed = new Set(['price-change:pro-year']);
    expect(
      notes([change(), proYear()], '2026-10-30T14:13:00.000Z', {
        isDismissed: (key) => dismissed.has(key),
      })
    ).toEqual([]);
  });

  test('nobody to tell on a price: it has no part in the note', () => {
    const [note] = notes(
      [change(), proYear({ state: 'done', counts: { total: 0, due: 0 } })],
      '2026-10-30T14:12:30.000Z'
    );
    expect(note?.lead).toBe('New price saved.');
    expect(note?.text).toContain('your 19 Pro subscribers about it at 15:00');
  });

  test('the run times are London times in summer', () => {
    const [note] = notes(
      [change({ nextRunAt: '2026-07-01T14:00:00.000Z' }), proYear()],
      '2026-07-01T13:12:00.000Z'
    );
    expect(note?.text).toContain('about them at 15:00.');
  });
});

describe('the Edit Tier warning while emails go out (P8)', () => {
  const running = members({
    lastRunAt: '2026-10-30T16:00:00.000Z',
    counts: { emailed: 4500, scheduled: 4493, held: 7, due: 1740 },
  });

  test('a moved price whose emails are still going out', () => {
    expect(
      stillGoingOutHint({
        changes: [running],
        saved: { monthly: 900, annual: 8000 },
        next: { monthly: 1000, annual: 8000 },
      })
    ).toEqual({
      kind: 'going_out',
      lead: 'Emails about £9.00/mo are still going out: 4,500 of 6,240 sent.',
      body: 'If you save a new price, it replaces £9.00, and all 6,240 are emailed about the new price instead, including the 4,500 already told about £9.00.',
    });
  });

  test('nothing while that price is unchanged, or only the other moved', () => {
    expect(
      stillGoingOutHint({
        changes: [running],
        saved: { monthly: 900, annual: 8000 },
        next: { monthly: 900, annual: 9000 },
      })
    ).toBeNull();
  });

  test('nothing once every email has gone, or before the first', () => {
    for (const counts of [
      { emailed: 6240, scheduled: 6240, due: 0 },
      { emailed: 0, due: 6240 },
    ]) {
      expect(
        stillGoingOutHint({
          changes: [members({ counts })],
          saved: { monthly: 900, annual: 8000 },
          next: { monthly: 1000, annual: 8000 },
        })
      ).toBeNull();
    }
  });
});

test("the web's per-run number is the server's", () => {
  expect(PRICE_EMAILS_PER_RUN).toBe(PRICE_MOVES_PER_RUN);
});

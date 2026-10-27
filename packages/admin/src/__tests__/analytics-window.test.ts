/**
 * Studio's analytics windows and calendar days (Codex-2hxff.75): every daily
 * series is one entry per UTC calendar day, oldest first, zero-filled, so a
 * reader takes "today" by date, a sparkline as the last N entries and a week
 * as 7 entries. Pure: no database.
 */

import { describe, expect, it } from 'vitest';
import {
  resolveAnalyticsWindow,
  trailingDaysStart,
  utcDaysIn,
  zeroFillDays,
} from '../services/analytics-window';

const at = (iso: string) => new Date(iso);

describe('analytics windows', () => {
  it('defaults to the trailing 30 calendar days, today included, ending now', () => {
    const now = at('2026-10-26T09:10:00.000Z');
    const window = resolveAnalyticsWindow(undefined, undefined, now);

    expect(window.end).toEqual(now);
    expect(window.start).toEqual(at('2026-09-27T00:00:00.000Z'));
    const days = utcDaysIn(window);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe('2026-09-27');
    expect(days.at(-1)).toBe('2026-10-26');
  });

  it('reads an end date at midnight through the end of that day', () => {
    const window = resolveAnalyticsWindow(
      at('2026-10-20T00:00:00.000Z'),
      at('2026-10-26T00:00:00.000Z')
    );

    expect(window.end).toEqual(at('2026-10-26T23:59:59.999Z'));
    expect(utcDaysIn(window)).toEqual([
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
    ]);
  });

  it('keeps an end that is an instant as that instant', () => {
    const end = at('2026-10-26T14:30:00.000Z');
    expect(resolveAnalyticsWindow(undefined, end).end).toEqual(end);
  });

  it('starts the day list at the UTC day of a start that is an instant', () => {
    const window = resolveAnalyticsWindow(
      at('2026-10-24T22:15:00.000Z'),
      at('2026-10-26T01:00:00.000Z')
    );
    expect(utcDaysIn(window)).toEqual([
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
    ]);
  });

  it('crosses a month and the clock change as calendar days (UTC has none)', () => {
    // UK clocks went back on 25 Oct 2026; UTC days are unaffected.
    expect(trailingDaysStart(7, at('2026-11-01T00:30:00.000Z'))).toEqual(
      at('2026-10-26T00:00:00.000Z')
    );
  });
});

describe('zeroFillDays', () => {
  const window = resolveAnalyticsWindow(
    at('2026-10-20T00:00:00.000Z'),
    at('2026-10-22T00:00:00.000Z')
  );
  const empty = (date: string) => ({ date, cents: 0 });

  it('gives an empty window one zero entry per day', () => {
    expect(zeroFillDays(window, [], empty)).toEqual([
      { date: '2026-10-20', cents: 0 },
      { date: '2026-10-21', cents: 0 },
      { date: '2026-10-22', cents: 0 },
    ]);
  });

  it('puts rows in calendar order whatever order they arrive in', () => {
    const rows = [
      { date: '2026-10-22', cents: 300 },
      { date: '2026-10-20', cents: 100 },
    ];
    expect(zeroFillDays(window, rows, empty)).toEqual([
      { date: '2026-10-20', cents: 100 },
      { date: '2026-10-21', cents: 0 },
      { date: '2026-10-22', cents: 300 },
    ]);
  });

  it('drops a row dated outside the window', () => {
    const rows = [{ date: '2026-10-19', cents: 999 }];
    expect(zeroFillDays(window, rows, empty).map((day) => day.cents)).toEqual([
      0, 0, 0,
    ]);
  });

  it('ends on the window’s last day, not on today, for a past window', () => {
    const past = resolveAnalyticsWindow(
      at('2026-09-01T00:00:00.000Z'),
      at('2026-09-07T00:00:00.000Z'),
      at('2026-10-26T12:00:00.000Z')
    );
    const days = zeroFillDays(past, [], empty);
    expect(days).toHaveLength(7);
    expect(days.at(-1)?.date).toBe('2026-09-07');
  });
});

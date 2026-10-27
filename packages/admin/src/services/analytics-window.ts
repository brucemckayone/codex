/**
 * The windows and calendar days Studio's analytics read (Codex-2hxff.75).
 *
 * Every daily series is one entry per UTC calendar day, oldest first, with
 * days that had nothing filled with zeros. Days are UTC, like every Studio
 * chart (owner decision Q-D, 2026-10-26). The readers no longer sort or
 * guess: "today" is the entry dated today, a sparkline is the last N entries,
 * and a week is 7 entries.
 */

import { ANALYTICS } from '@codex/constants';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AnalyticsWindow {
  start: Date;
  end: Date;
}

/** Midnight UTC at the start of `date`'s UTC day. */
function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

/** `date`'s UTC calendar day, as `YYYY-MM-DD`. */
function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The start of the UTC day `days - 1` days before `now`'s: a trailing window
 * of exactly `days` calendar days, today included.
 */
export function trailingDaysStart(days: number, now: Date = new Date()): Date {
  return new Date(startOfUtcDay(now).getTime() - (days - 1) * DAY_MS);
}

/**
 * The window a block reads.
 *
 * - No end: now.
 * - An end at exactly midnight UTC is a calendar date, read through the end of
 *   that day. The Analytics page sends `YYYY-MM-DD`, and its command bar counts
 *   the end day in (its compare window ends the day before the start). Read as
 *   an instant, the window dropped the whole end day, today included, while
 *   the day list still showed it.
 * - No start: the trailing `ANALYTICS.TREND_DAYS_DEFAULT` calendar days ending
 *   on the end's day, so "last 30 days" is 30 days, not 30 and a part.
 */
export function resolveAnalyticsWindow(
  startDate?: Date,
  endDate?: Date,
  now: Date = new Date()
): AnalyticsWindow {
  const end =
    endDate === undefined
      ? now
      : endDate.getTime() === startOfUtcDay(endDate).getTime()
        ? new Date(endDate.getTime() + DAY_MS - 1)
        : endDate;
  const start =
    startDate ?? trailingDaysStart(ANALYTICS.TREND_DAYS_DEFAULT, end);
  return { start, end };
}

/** Every UTC calendar day from the window's start to its end, oldest first. */
export function utcDaysIn(window: AnalyticsWindow): string[] {
  const days: string[] = [];
  for (
    let t = startOfUtcDay(window.start).getTime();
    t <= window.end.getTime();
    t += DAY_MS
  ) {
    days.push(utcDay(new Date(t)));
  }
  return days;
}

/**
 * One entry per day of the window, oldest first: the row for that day, or
 * `empty(day)` when there is none. A row dated outside the window is dropped.
 */
export function zeroFillDays<T extends { date: string }>(
  window: AnalyticsWindow,
  rows: readonly T[],
  empty: (day: string) => T
): T[] {
  const byDay = new Map(rows.map((row) => [row.date, row]));
  return utcDaysIn(window).map((day) => byDay.get(day) ?? empty(day));
}

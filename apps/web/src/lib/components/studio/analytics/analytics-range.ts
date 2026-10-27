/**
 * The Studio Analytics page's date ranges, as `YYYY-MM-DD` UTC calendar days
 * (Codex-2hxff.75; owner decision Q-D: days are UTC).
 *
 * The admin API reads an end date as the whole of that day, so a range is
 * inclusive at both ends. "Last 30 days" is therefore today and the 29 days
 * before it: the same 30 calendar days Billing and the dashboard read
 * (`trailingDaysStart` in @codex/admin). It used to start 30 days back, which
 * read 31.
 *
 * All arithmetic is UTC. The command bar used to subtract days in local time
 * and format in UTC, so a range could gain or lose a day across a clock change.
 */

const DAY_MS = 86_400_000;

export type AnalyticsPreset = '7d' | '30d' | '90d' | 'year';

/** Each preset's length in calendar days. */
export const PRESET_DAYS: Record<AnalyticsPreset, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  year: 365,
};

/** `now`'s UTC calendar day. */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

function shiftDay(day: string, delta: number): string {
  return new Date(dayStart(day) + delta * DAY_MS).toISOString().slice(0, 10);
}

/** How many calendar days `[startDate, endDate]` covers, both ends included. */
export function inclusiveDays(startDate: string, endDate: string): number {
  return Math.round((dayStart(endDate) - dayStart(startDate)) / DAY_MS) + 1;
}

/** The trailing `days` calendar days, today included. */
export function trailingRange(
  days: number,
  now: Date = new Date()
): { startDate: string; endDate: string } {
  const endDate = utcToday(now);
  return { startDate: shiftDay(endDate, -(days - 1)), endDate };
}

/** The range just before `[startDate, endDate]`, of the same length. */
export function previousRange(
  startDate: string,
  endDate: string
): { compareFrom: string; compareTo: string } {
  const length = Math.max(1, inclusiveDays(startDate, endDate));
  const compareTo = shiftDay(startDate, -1);
  return { compareFrom: shiftDay(compareTo, -(length - 1)), compareTo };
}

/**
 * The preset a range is, if any: it ends today and covers exactly the
 * preset's days. A range that does not (a custom one, an old 31-day link, a
 * tab left open past midnight) is labelled by its dates instead, so the chip
 * never says "Last 30 days" over a different window.
 */
export function presetOf(
  startDate: string,
  endDate: string,
  now: Date = new Date()
): AnalyticsPreset | null {
  if (endDate !== utcToday(now)) return null;
  const length = inclusiveDays(startDate, endDate);
  for (const preset of Object.keys(PRESET_DAYS) as AnalyticsPreset[]) {
    if (PRESET_DAYS[preset] === length) return preset;
  }
  return null;
}

/**
 * The Studio dashboard's revenue and customer figures (Codex-2hxff.75,
 * .20 WEB-02).
 *
 * The admin API's `revenueByDay` is one entry per UTC calendar day of the
 * window, oldest first, zero-filled (owner decision Q-D: UTC). Every figure
 * here is read by DATE or by calendar position, never by "the last sale day":
 * the old reads took `.slice(-1)` of a newest-first list of sale days, so
 * "earned today" showed the oldest sale of the month.
 */

import type { CustomerStats, DailyRevenue } from '@codex/admin';

/** `date`'s UTC calendar day, as the API dates its entries. */
export function utcDay(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** What came in on `day` (`YYYY-MM-DD`); 0 when the list has no such day. */
export function revenueOnDay(
  days: readonly DailyRevenue[],
  day: string
): number {
  return days.find((entry) => entry.date === day)?.revenueCents ?? 0;
}

/** The sparkline: the last `count` calendar days, oldest first. */
export function revenueSparkline(
  days: readonly DailyRevenue[],
  count = 14
): number[] {
  return days.slice(-count).map((entry) => entry.revenueCents);
}

/**
 * This calendar week against last: the last 7 days (today and the 6 before)
 * against the 7 before those, as a whole-number percentage. `null` when the
 * earlier week had nothing, or the list is shorter than two weeks: there is
 * nothing to compare with, so no badge, never "0%".
 */
export function weekOverWeekChange(
  days: readonly DailyRevenue[]
): number | null {
  if (days.length < 14) return null;
  const sum = (entries: readonly DailyRevenue[]) =>
    entries.reduce((total, entry) => total + entry.revenueCents, 0);
  const thisWeek = sum(days.slice(-7));
  const lastWeek = sum(days.slice(-14, -7));
  if (lastWeek === 0) return null;
  return Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
}

/**
 * How much the customer base grew this week: the customers whose first
 * purchase was in the last 7 days, over the customers there were before
 * them. `null` when there were none before (every customer is new).
 */
export function customerGrowth(
  customers: Pick<CustomerStats, 'totalCustomers' | 'newCustomersLast7Days'>
): number | null {
  const before = customers.totalCustomers - customers.newCustomersLast7Days;
  if (before <= 0) return null;
  return Math.round((customers.newCustomersLast7Days / before) * 100);
}

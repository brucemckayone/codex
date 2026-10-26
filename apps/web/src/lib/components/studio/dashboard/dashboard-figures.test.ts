/**
 * The Studio dashboard's figures read the API's day list by date and by
 * calendar position (Codex-2hxff.75). Pure: no render, no remote.
 */

import type { DailyRevenue } from '@codex/admin';
import { describe, expect, it } from 'vitest';
import {
  customerGrowth,
  revenueOnDay,
  revenueSparkline,
  utcDay,
  weekOverWeekChange,
} from './dashboard-figures';

/** `count` calendar days ending on `lastDay`, oldest first, as the API sends. */
function days(
  lastDay: string,
  count: number,
  cents: (index: number) => number = () => 0
): DailyRevenue[] {
  const end = new Date(`${lastDay}T00:00:00.000Z`).getTime();
  return Array.from({ length: count }, (_, index) => ({
    date: utcDay(new Date(end - (count - 1 - index) * 86_400_000)),
    revenueCents: cents(index),
    purchaseCount: 0,
  }));
}

describe('revenueOnDay', () => {
  it("reads today's entry by its date, not the list's end or start", () => {
    // The oldest entry has the most money: the old `.slice(-1)` of a
    // newest-first list of sale days picked exactly this one.
    const list = days('2026-10-26', 30, (i) =>
      i === 0 ? 9630 : i === 29 ? 4250 : 100
    );

    expect(revenueOnDay(list, '2026-10-26')).toBe(4250);
  });

  it('is 0 for a day with no entry (a window that does not reach today)', () => {
    const list = days('2026-10-20', 30, () => 500);

    expect(revenueOnDay(list, '2026-10-26')).toBe(0);
  });
});

describe('revenueSparkline', () => {
  it('is the last 14 calendar days, oldest first, with zero days in place', () => {
    const list = days('2026-10-26', 30, (i) => (i % 3 === 0 ? 0 : i));

    const series = revenueSparkline(list);

    expect(series).toHaveLength(14);
    expect(series).toEqual(list.slice(16).map((day) => day.revenueCents));
    expect(series.at(-1)).toBe(list[29]?.revenueCents);
  });
});

describe('weekOverWeekChange', () => {
  it('compares this calendar week with the one before', () => {
    // Days 16-22 (last week) £10 each; days 23-29 (this week) £12.20 each.
    const list = days('2026-10-26', 30, (i) =>
      i >= 23 ? 1220 : i >= 16 ? 1000 : 99_999
    );

    expect(weekOverWeekChange(list)).toBe(22);
  });

  it('counts quiet days as days: a sale every other day is not two weeks of sales', () => {
    const list = days('2026-10-26', 30, (i) =>
      i === 29 ? 700 : i === 15 ? 700 : 0
    );

    // This week £7, last week (days 16-22) nothing: no comparison, no badge.
    expect(weekOverWeekChange(list)).toBeNull();
  });

  it('is null, never 0%, when last week had nothing', () => {
    expect(weekOverWeekChange(days('2026-10-26', 30))).toBeNull();
  });

  it('is null for a list shorter than two weeks', () => {
    expect(weekOverWeekChange(days('2026-10-26', 13, () => 100))).toBeNull();
  });

  it('can fall', () => {
    const list = days('2026-10-26', 14, (i) => (i >= 7 ? 500 : 1000));
    expect(weekOverWeekChange(list)).toBe(-50);
  });
});

describe('customerGrowth', () => {
  it('is the week’s new customers over those there were before them', () => {
    expect(
      customerGrowth({ totalCustomers: 128, newCustomersLast7Days: 8 })
    ).toBe(7);
  });

  it('is null when every customer is new', () => {
    expect(
      customerGrowth({ totalCustomers: 3, newCustomersLast7Days: 3 })
    ).toBeNull();
    expect(
      customerGrowth({ totalCustomers: 0, newCustomersLast7Days: 0 })
    ).toBeNull();
  });

  it('is 0 for a week with no new customers', () => {
    expect(
      customerGrowth({ totalCustomers: 40, newCustomersLast7Days: 0 })
    ).toBe(0);
  });
});

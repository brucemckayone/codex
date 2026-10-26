// @vitest-environment node

/**
 * `getDashboardStats` (Codex-2hxff.75, .20 WEB-02, .74's pattern).
 *
 * - A failed read REJECTS. It used to resolve to zeros, which the dashboard
 *   showed as "£0.00" in silence; the page now shows "We couldn't load your
 *   revenue." with Retry, and that needs the query to fail.
 * - The figures read the API's day list (one entry per UTC calendar day,
 *   oldest first, zero-filled) by date and calendar position.
 *
 * Mocked like `admin-grant-forwarding.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

const dashboardMock = vi.hoisted(() => vi.fn());
const loggerError = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    analytics: { getDashboardStats: dashboardMock },
  })),
  serverApiUrl: vi.fn(() => 'http://localhost:42073'),
}));

vi.mock('$lib/observability', () => ({
  logger: { error: loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// The global `$app/server` mock is one-arg; these remotes are (schema, fn).
// Kit's remote-module check wants every export tagged with `__`.
const makeRemote = (type: string, fn: (...args: unknown[]) => unknown) =>
  Object.assign((...args: unknown[]) => fn(...args), {
    __: { type, id: '', name: '' },
  });
const lastArg = (args: unknown[]) =>
  args[args.length - 1] as (...args: unknown[]) => unknown;
vi.mock('$app/server', () => ({
  command: vi.fn((...args: unknown[]) => makeRemote('command', lastArg(args))),
  form: vi.fn((...args: unknown[]) => makeRemote('form', lastArg(args))),
  query: vi.fn((...args: unknown[]) => makeRemote('query', lastArg(args))),
  getRequestEvent: vi.fn(() => ({
    platform: { env: {} },
    cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  })),
}));

interface DashboardFigures {
  revenue: {
    value: number;
    byKind: Record<string, number>;
    change: number | null;
    todayCents: number;
    revenueByDay: Array<{ date: string; revenueCents: number }>;
  };
  customers: { value: number; change: number | null; newThisWeek: number };
}

const { getDashboardStats } = (await import('./admin.remote')) as unknown as {
  getDashboardStats: (orgId: string) => Promise<DashboardFigures>;
};

const ORG_ID = '33333333-3333-4333-8333-333333333333';
const TODAY = '2026-10-26';

/** 30 calendar days ending today, oldest first, as the admin API sends. */
function revenueByDay(cents: (index: number) => number) {
  const end = new Date(`${TODAY}T00:00:00.000Z`).getTime();
  return Array.from({ length: 30 }, (_, index) => ({
    date: new Date(end - (29 - index) * 86_400_000).toISOString().slice(0, 10),
    revenueCents: cents(index),
    purchaseCount: 0,
  }));
}

function apiStats(days: ReturnType<typeof revenueByDay>) {
  return {
    revenue: {
      totalRevenueCents: days.reduce((sum, d) => sum + d.revenueCents, 0),
      revenueByKind: {
        one_off: 31245,
        course: 8997,
        subscription: 78860,
        course_plan: 4998,
      },
      totalPurchases: 34,
      averageOrderValueCents: 1184,
      platformFeeCents: 12635,
      organizationFeeCents: 66624,
      creatorPayoutCents: 44841,
      revenueByDay: days,
    },
    customers: {
      totalCustomers: 128,
      newCustomersLast30Days: 20,
      newCustomersLast7Days: 8,
    },
    topContent: {
      items: [],
      pagination: { page: 1, limit: 5, total: 24, totalPages: 1 },
    },
  };
}

beforeEach(() => {
  dashboardMock.mockReset();
  loggerError.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T14:30:00.000Z`));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getDashboardStats', () => {
  it('rejects a failed read (logged) instead of resolving to £0', async () => {
    dashboardMock.mockRejectedValue(
      new ApiError(503, 'Service unavailable', 'SERVICE_UNAVAILABLE')
    );

    await expect(getDashboardStats(ORG_ID)).rejects.toBeDefined();
    expect(loggerError).toHaveBeenCalledWith(
      '[Dashboard] Failed to fetch dashboard stats',
      expect.objectContaining({ reason: expect.any(String) })
    );
  });

  it('reads "today" by date and the change by calendar weeks', async () => {
    // The oldest day has the most money: the old read took it as today.
    const days = revenueByDay((i) =>
      i === 0 ? 9630 : i === 29 ? 4250 : i >= 23 ? 1000 : i >= 16 ? 1000 : 0
    );
    dashboardMock.mockResolvedValue(apiStats(days));

    const figures = await getDashboardStats(ORG_ID);

    expect(figures.revenue.todayCents).toBe(4250);
    // This week: 6 × £10 + £42.50 = £102.50; last week 7 × £10 = £70.
    expect(figures.revenue.change).toBe(46);
    expect(figures.revenue.byKind).toEqual({
      one_off: 31245,
      course: 8997,
      subscription: 78860,
      course_plan: 4998,
    });
  });

  it('gives no change (null, not 0%) when last week had nothing', async () => {
    dashboardMock.mockResolvedValue(
      apiStats(revenueByDay((i) => (i === 29 ? 500 : 0)))
    );

    const figures = await getDashboardStats(ORG_ID);

    expect(figures.revenue.change).toBeNull();
  });

  it('computes the customer change it used to hard-code to 0', async () => {
    dashboardMock.mockResolvedValue(apiStats(revenueByDay(() => 0)));

    const figures = await getDashboardStats(ORG_ID);

    // 8 new this week over the 120 there were before them.
    expect(figures.customers).toEqual({
      value: 128,
      change: 7,
      newThisWeek: 8,
    });
  });
});

/**
 * Studio → Analytics: a revenue read that FAILED is not £0 (review N-3,
 * Codex-2hxff.74's pattern).
 *
 * A rejected `getAnalyticsRevenue` has `current: undefined`, which the page
 * covered with `?? 0`: the Revenue KPI read "£0" and Purchases "0" for an
 * organisation whose read had simply failed. Both KPIs now give way to "We
 * couldn't load your revenue." with Retry; the other KPIs still render.
 *
 * The chart and the summary read the same `?? EMPTY_REVENUE` fallback: the
 * chart opened on a Revenue tab with nothing to plot, and the summary told an
 * organisation with nothing else yet that it was "Still early days". The
 * chart now has no Revenue tab and the summary makes no revenue claim.
 *
 * Mounts the real `+page.svelte`; `$app/*` and the admin remote module are
 * mocked. Each read is a plain `{ current, error, loading, refresh }` object.
 */

import type {
  FollowerStats,
  RevenueStats,
  SubscriberStats,
} from '@codex/admin';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

type Read = {
  current: unknown;
  error: unknown;
  loading: boolean;
  refresh: () => Promise<void>;
};

const reads = vi.hoisted(() => ({
  revenue: null as unknown,
  subscribers: null as unknown,
  followers: null as unknown,
}));

const ok = (current: unknown): Read => ({
  current,
  error: undefined,
  loading: false,
  refresh: async () => {},
});

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock(
  '$app/state',
  () => import('$lib/components/support/__fixtures__/app-state.mock.svelte')
);
vi.mock('$lib/remote/admin.remote', () => ({
  getAnalyticsRevenue: () => reads.revenue,
  getAnalyticsSubscribers: () => reads.subscribers,
  getAnalyticsFollowers: () => reads.followers,
  getAnalyticsTopContent: () => ok({ items: [] }),
  getAnalyticsContentPerformance: () => ok({ items: [] }),
  getAnalyticsRevenueByCreator: () => ok({ items: [] }),
}));

import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import AnalyticsPage from '../+page.svelte';

const SUBSCRIBERS: SubscriberStats = {
  activeSubscribers: 12,
  newSubscribers: 3,
  churnedSubscribers: 1,
  subscribersByDay: [],
};

const FOLLOWERS: FollowerStats = {
  totalFollowers: 40,
  newFollowers: 5,
  followersByDay: [],
};

const NO_SUBSCRIBERS: SubscriberStats = {
  activeSubscribers: 0,
  newSubscribers: 0,
  churnedSubscribers: 0,
  subscribersByDay: [],
};

const NO_FOLLOWERS: FollowerStats = {
  totalFollowers: 0,
  newFollowers: 0,
  followersByDay: [],
};

const FAILED: Read = {
  current: undefined,
  error: { status: 500, body: { message: 'Internal Error' } },
  loading: false,
  refresh: async () => {},
};

const REVENUE: RevenueStats = {
  totalRevenueCents: 12_500,
  revenueByKind: {
    one_off: 2_500,
    course: 0,
    subscription: 10_000,
    course_plan: 0,
  },
  totalPurchases: 4,
  averageOrderValueCents: 3_125,
  platformFeeCents: 1_250,
  organizationFeeCents: 0,
  creatorPayoutCents: 11_250,
  revenueByDay: [],
};

const DATA = {
  org: { id: 'org-1', name: 'Studio Alpha', slug: 'studio-alpha' },
  userRole: 'owner',
};

let component: ReturnType<typeof mount> | null = null;

function mountPage() {
  component = mount(AnalyticsPage, {
    target: document.body,
    // The page reads only `org` and `userRole` from its layout data.
    props: { data: DATA as never },
  });
  flushSync();
}

const alert = () =>
  document.querySelector('[data-testid="analytics-revenue-load-error"]');
const kpiLabels = () =>
  Array.from(document.querySelectorAll('.kpi-row .kpi-card__label')).map((el) =>
    el.textContent?.trim()
  );
const chartTabs = () =>
  Array.from(document.querySelectorAll('.hero-chart [role="tab"]')).map(
    (el) => ({
      label: el.textContent?.trim(),
      selected: el.getAttribute('aria-selected') === 'true',
    })
  );
const summary = () =>
  document.querySelector('.narrative-summary')?.textContent ?? '';

beforeEach(() => {
  setPage('http://studio-alpha.lvh.me:3000/studio/analytics');
  reads.subscribers = ok(SUBSCRIBERS);
  reads.followers = ok(FOLLOWERS);
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe('Analytics: a failed revenue read', () => {
  test('says it could not load, and shows no £0 Revenue or 0 Purchases', () => {
    reads.revenue = FAILED;
    mountPage();

    expect(alert()?.textContent).toContain(m.analytics_revenue_load_failed());
    expect(kpiLabels()).not.toContain(m.analytics_kpi_revenue_label());
    expect(kpiLabels()).not.toContain(m.analytics_kpi_purchases_label());
    expect(document.querySelector('.kpi-row')?.textContent).not.toContain('£0');
  });

  test('keeps the KPIs it did load', () => {
    reads.revenue = FAILED;
    mountPage();

    expect(kpiLabels()).toEqual([
      m.analytics_kpi_subscribers_label(),
      m.analytics_kpi_followers_label(),
    ]);
  });

  test('the chart has no Revenue tab, and opens on Subscribers', () => {
    reads.revenue = FAILED;
    mountPage();

    expect(chartTabs()).toEqual([
      { label: m.analytics_chart_tab_subscribers(), selected: true },
      { label: m.analytics_chart_tab_followers(), selected: false },
    ]);
  });

  test('the summary makes no revenue claim: no £0, no "Still early days"', () => {
    // Nothing else to report either, so only revenue could be read as "early".
    reads.revenue = FAILED;
    reads.subscribers = ok(NO_SUBSCRIBERS);
    reads.followers = ok(NO_FOLLOWERS);
    mountPage();

    expect(summary()).not.toContain(m.analytics_narrative_no_data());
    expect(summary()).not.toContain('£');
    // What it does say: compare is off.
    expect(summary()).toContain(m.analytics_narrative_no_compare());
  });

  test('with compare on, the summary still quotes no revenue', () => {
    setPage(
      'http://studio-alpha.lvh.me:3000/studio/analytics?startDate=2026-09-27&endDate=2026-10-26&compareFrom=2026-08-28&compareTo=2026-09-26'
    );
    reads.revenue = FAILED;
    mountPage();

    // EMPTY_REVENUE carries no `previous`, so this holds by construction
    // too; the prop keeps it from resting on the fallback's shape.
    expect(summary()).not.toBe('');
    expect(summary()).not.toContain('£');
    expect(summary()).not.toMatch(/revenue/i);
  });

  test('a loaded read shows Revenue and Purchases, with no alert', () => {
    reads.revenue = ok(REVENUE);
    mountPage();

    expect(alert()).toBeNull();
    expect(kpiLabels()).toEqual([
      m.analytics_kpi_revenue_label(),
      m.analytics_kpi_subscribers_label(),
      m.analytics_kpi_followers_label(),
      m.analytics_kpi_purchases_label(),
    ]);
    expect(document.querySelector('.kpi-row')?.textContent).toContain('£125');
    expect(chartTabs()).toEqual([
      { label: m.analytics_chart_tab_revenue(), selected: true },
      { label: m.analytics_chart_tab_subscribers(), selected: false },
      { label: m.analytics_chart_tab_followers(), selected: false },
    ]);
  });

  test('a loaded read with compare on is quoted in the summary', () => {
    // The control for "quotes no revenue": the same window, read.
    setPage(
      'http://studio-alpha.lvh.me:3000/studio/analytics?startDate=2026-09-27&endDate=2026-10-26&compareFrom=2026-08-28&compareTo=2026-09-26'
    );
    reads.revenue = ok({
      ...REVENUE,
      previous: { ...REVENUE, totalRevenueCents: 10_000 },
    });
    mountPage();

    expect(summary()).toContain(
      m.analytics_narrative_revenue_big_win({ percent: '25', amount: '£125' })
    );
  });
});

/**
 * Studio → Analytics: the other reads that can FAIL, and what they no longer
 * say (review H1, M4; Codex-2hxff.74's pattern). The revenue read has its
 * own file, revenue-load-failed.svelte.test.ts.
 *
 * - Revenue by creator (H1): a rejected read fell back to `[]`, and the
 *   section hid as a one-creator org's does, so Earned and Pending vanished
 *   with no word. It now says "We couldn't load revenue by creator."
 * - Subscribers and Followers (M4): a rejected read showed a KPI of 0 and an
 *   empty chart tab. That KPI and tab give way to "We couldn't load your …".
 * - Top content (M4): a rejected read said "No content in this period yet."
 *   The leaderboard gives way to "We couldn't load your top content."
 *
 * Mounts the real `+page.svelte`; `$app/*` and the admin remote module are
 * mocked. Each read is a plain `{ current, error, loading, refresh }` object.
 */

import type {
  CreatorRevenueSplitItem,
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
  topContent: null as unknown,
  byCreator: null as unknown,
}));

const ok = (current: unknown): Read => ({
  current,
  error: undefined,
  loading: false,
  refresh: async () => {},
});

const FAILED: Read = {
  current: undefined,
  error: { status: 500, body: { message: 'Internal Error' } },
  loading: false,
  refresh: async () => {},
};

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock(
  '$app/state',
  () => import('$lib/components/support/__fixtures__/app-state.mock.svelte')
);
vi.mock('$lib/remote/admin.remote', () => ({
  getAnalyticsRevenue: () => reads.revenue,
  getAnalyticsSubscribers: () => reads.subscribers,
  getAnalyticsFollowers: () => reads.followers,
  getAnalyticsTopContent: () => reads.topContent,
  getAnalyticsContentPerformance: () => ok({ items: [] }),
  getAnalyticsRevenueByCreator: () => reads.byCreator,
}));

import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import AnalyticsPage from '../+page.svelte';

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

function creator(id: string, name: string): CreatorRevenueSplitItem {
  return {
    creatorId: id,
    name,
    avatarUrl: null,
    earnedCents: 5_000,
    subscriptionShare: { kind: 'share', percent: 30 },
    salesShare: { kind: 'none' },
    lastPayoutAt: null,
    pendingPayoutCents: 1_000,
  };
}

const TWO_CREATORS = {
  items: [creator('c-1', 'Maya Lin'), creator('c-2', 'Sam Okafor')],
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

const byTestId = (id: string) =>
  document.querySelector(`[data-testid="${id}"]`);
const kpiLabels = () =>
  Array.from(document.querySelectorAll('.kpi-row .kpi-card__label')).map((el) =>
    el.textContent?.trim()
  );
const chartTabs = () =>
  Array.from(document.querySelectorAll('.hero-chart [role="tab"]')).map((el) =>
    el.textContent?.trim()
  );
const leaderboardText = () =>
  document.querySelector('.leaderboard-section')?.textContent ?? '';
const byCreatorSection = () =>
  document.querySelector('[data-test="revenue-by-creator-section"]');

beforeEach(() => {
  setPage('http://studio-alpha.lvh.me:3000/studio/analytics');
  reads.revenue = ok(REVENUE);
  reads.subscribers = ok(SUBSCRIBERS);
  reads.followers = ok(FOLLOWERS);
  reads.topContent = ok({ items: [] });
  reads.byCreator = ok(TWO_CREATORS);
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe('Analytics: a failed Revenue by creator read (H1)', () => {
  test('says it could not load, in place of the section', () => {
    reads.byCreator = FAILED;
    mountPage();

    expect(
      byTestId('analytics-creator-revenue-load-error')?.textContent
    ).toContain(m.analytics_creator_revenue_load_failed());
    expect(byCreatorSection()).toBeNull();
  });

  test('a loaded read with two creators shows the section, with no alert', () => {
    mountPage();

    expect(byTestId('analytics-creator-revenue-load-error')).toBeNull();
    expect(byCreatorSection()?.textContent).toContain('Maya Lin');
  });
});

describe('Analytics: a failed Subscribers or Followers read (M4)', () => {
  test('subscribers: an alert, no 0 KPI and no Subscribers tab', () => {
    reads.subscribers = FAILED;
    mountPage();

    expect(byTestId('analytics-subscribers-load-error')?.textContent).toContain(
      m.analytics_subscribers_load_failed()
    );
    expect(kpiLabels()).toEqual([
      m.analytics_kpi_revenue_label(),
      m.analytics_kpi_followers_label(),
      m.analytics_kpi_purchases_label(),
    ]);
    expect(chartTabs()).toEqual([
      m.analytics_chart_tab_revenue(),
      m.analytics_chart_tab_followers(),
    ]);
  });

  test('followers: an alert, no 0 KPI and no Followers tab', () => {
    reads.followers = FAILED;
    mountPage();

    expect(byTestId('analytics-followers-load-error')?.textContent).toContain(
      m.analytics_followers_load_failed()
    );
    expect(kpiLabels()).toEqual([
      m.analytics_kpi_revenue_label(),
      m.analytics_kpi_subscribers_label(),
      m.analytics_kpi_purchases_label(),
    ]);
    expect(chartTabs()).toEqual([
      m.analytics_chart_tab_revenue(),
      m.analytics_chart_tab_subscribers(),
    ]);
  });

  test('revenue and subscribers failed: the chart opens on Followers', () => {
    reads.revenue = FAILED;
    reads.subscribers = FAILED;
    mountPage();

    const selected = document.querySelector(
      '.hero-chart [role="tab"][aria-selected="true"]'
    );
    expect(chartTabs()).toEqual([m.analytics_chart_tab_followers()]);
    expect(selected?.textContent?.trim()).toBe(
      m.analytics_chart_tab_followers()
    );
  });

  test('all three failed: no chart, and the three alerts', () => {
    reads.revenue = FAILED;
    reads.subscribers = FAILED;
    reads.followers = FAILED;
    mountPage();

    expect(document.querySelector('.hero-chart')).toBeNull();
    expect(kpiLabels()).toEqual([]);
    for (const id of [
      'analytics-revenue-load-error',
      'analytics-subscribers-load-error',
      'analytics-followers-load-error',
    ]) {
      expect(byTestId(id)).not.toBeNull();
    }
  });

  test('a failed read with nothing else is not "Still early days"', () => {
    reads.revenue = ok({ ...REVENUE, totalRevenueCents: 0, totalPurchases: 0 });
    reads.subscribers = FAILED;
    reads.followers = ok({ ...FOLLOWERS, totalFollowers: 0, newFollowers: 0 });
    mountPage();

    const summary =
      document.querySelector('.narrative-summary')?.textContent ?? '';
    expect(summary).not.toContain(m.analytics_narrative_no_data());
    expect(summary).toContain(m.analytics_narrative_no_compare());
  });
});

describe('Analytics: a failed Top content read (M4)', () => {
  test('says it could not load, not "No content in this period yet."', () => {
    reads.topContent = FAILED;
    mountPage();

    expect(byTestId('analytics-top-content-load-error')?.textContent).toContain(
      m.analytics_top_content_load_failed()
    );
    expect(leaderboardText()).not.toContain(m.analytics_leaderboard_empty());
  });

  test('a loaded empty list is still "No content in this period yet."', () => {
    mountPage();

    expect(byTestId('analytics-top-content-load-error')).toBeNull();
    expect(leaderboardText()).toContain(m.analytics_leaderboard_empty());
  });
});

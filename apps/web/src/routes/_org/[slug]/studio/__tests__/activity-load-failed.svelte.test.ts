/**
 * Studio → Dashboard: an activity read that FAILED is not an empty feed
 * (review N-3, Codex-2hxff.74's pattern).
 *
 * A rejected `getActivityFeed` has `current: undefined`, which the page read
 * as `items ?? []`: the stream said "No activity yet. When people purchase or
 * join, you'll see them here first." to an organisation whose read had simply
 * failed. It now says "We couldn't load your recent activity." with Retry.
 *
 * The feed is the org's activity, owners' and admins' only (its route
 * requires org management), so other roles get no stream and no request.
 *
 * Also here, on the same harness: a revenue series with no entry for today
 * is unknown, not £0, so the header never says "Quiet so far" on it
 * (review L7).
 *
 * Mounts the real `+page.svelte`; `$app/*`, the remote modules and the
 * dismissals collection are mocked. Each read is a plain
 * `{ current, error, loading, refresh }` object.
 */

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

const reads = vi.hoisted(() => {
  const state = { activity: null as unknown, todayCents: 0 as number | null };
  return { state, getActivityFeed: vi.fn(() => state.activity) };
});

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
vi.mock('$lib/collections/dismissals', () => ({
  dismiss: vi.fn(),
  isDismissed: () => false,
}));
vi.mock('$lib/remote/admin.remote', () => ({
  getDashboardStats: () =>
    ok({
      ...STATS,
      revenue: { ...STATS.revenue, todayCents: reads.state.todayCents },
    }),
  getActivityFeed: reads.getActivityFeed,
}));
vi.mock('$lib/remote/agreements.remote', () => ({
  listActiveAgreements: () => ok({ items: [] }),
  listPendingProposals: () => ok({ items: [] }),
}));
vi.mock('$lib/remote/org.remote', () => ({
  getOrgMembers: () => ok({ items: [] }),
}));

import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import DashboardPage from '../+page.svelte';

const STATS = {
  revenue: {
    value: 12_500,
    byKind: { one_off: 2_500, course: 0, subscription: 10_000, course_plan: 0 },
    change: undefined,
    todayCents: 0,
    revenueByDay: [],
  },
  customers: { value: 4, change: undefined, newThisWeek: 0 },
  contentCount: { value: 3, change: 0 },
  views: { value: 0, change: 0 },
};

const FAILED: Read = {
  current: undefined,
  error: { status: 500, body: { message: 'Internal Error' } },
  loading: false,
  refresh: async () => {},
};

let component: ReturnType<typeof mount> | null = null;

function mountPage(userRole: string) {
  component = mount(DashboardPage, {
    target: document.body,
    // The page reads only these from its layout data.
    props: {
      data: {
        org: {
          id: 'org-1',
          name: 'Studio Alpha',
          slug: 'studio-alpha',
          logoUrl: null,
        },
        studioUser: { name: 'Sam' },
        userRole,
        badgeCounts: { draftContent: 0 },
      } as never,
    },
  });
  flushSync();
}

const alert = () =>
  document.querySelector('[data-testid="dashboard-activity-load-error"]');
const emptyStream = () => document.querySelector('.stream-empty');

beforeEach(() => {
  setPage('http://studio-alpha.lvh.me:3000/studio');
  reads.getActivityFeed.mockClear();
  reads.state.todayCents = 0;
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe('Dashboard: a failed activity read', () => {
  test('says it could not load, not "No activity yet"', () => {
    reads.state.activity = FAILED;
    mountPage('admin');

    expect(alert()?.textContent).toContain(m.dashboard_activity_load_failed());
    expect(emptyStream()).toBeNull();
    expect(document.body.textContent).not.toContain('No activity yet');
  });

  test('an empty feed that loaded is still "No activity yet", with no alert', () => {
    reads.state.activity = ok({ items: [] });
    mountPage('admin');

    expect(alert()).toBeNull();
    expect(emptyStream()?.textContent).toContain('No activity yet');
  });
});

describe('Dashboard: the activity stream is owners’ and admins’ only', () => {
  test('a creator gets no stream, no alert and no request; the rail takes the row', () => {
    reads.state.activity = FAILED;
    mountPage('creator');

    expect(reads.getActivityFeed).not.toHaveBeenCalled();
    expect(alert()).toBeNull();
    expect(emptyStream()).toBeNull();
    expect(document.querySelector('.activity-column')).toBeNull();
    expect(
      document.querySelector('.below-fold')?.hasAttribute('data-single')
    ).toBe(true);
  });
});

describe('Dashboard: no figure for today (L7)', () => {
  const QUIET = 'Quiet so far. A good time to publish something new.';

  test('a series with no entry for today is not "Quiet so far"', () => {
    reads.state.activity = ok({ items: [] });
    reads.state.todayCents = null;
    mountPage('admin');

    expect(document.body.textContent).not.toContain(QUIET);
    expect(document.body.textContent).not.toContain('earned today');
  });

  test('a quiet today (an entry of £0) is still "Quiet so far"', () => {
    reads.state.activity = ok({ items: [] });
    mountPage('admin');

    expect(document.body.textContent).toContain(QUIET);
  });
});

/**
 * Subscriptions Page Server Load Tests
 *
 * Covers:
 * 1. `load()` registers `depends('account:subscriptions')` exactly once.
 * 2. `load()` returns both lists, memberships and course subscriptions
 *    (Codex-2hxff.52, C1), with `loadError: false` and
 *    `courseLoadError: false`.
 * 3. Each list fails on its own: a thrown read gives that list `[]` and its
 *    own error flag, so the page renders a retry alert for it (never an empty
 *    list) instead of the +error boundary, and the other list still shows.
 *
 * Auth gating lives on the parent layout, so this load function does not
 * redirect on its own.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks for `createServerApi` — the load fn depends on it.
const getMineMock = vi.hoisted(() => vi.fn());
const listMyCourseSubscriptionsMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    subscription: {
      getMine: getMineMock,
      listMyCourseSubscriptions: listMyCourseSubscriptionsMock,
    },
  })),
}));

const MEMBERSHIPS = [
  { id: 'sub-1', organizationId: 'org-1', status: 'active' },
];
const COURSES = [
  {
    id: 'csub-1',
    status: 'active',
    course: { id: 'course-1', title: 'Field Recording Basics' },
  },
];

function courseList(items: unknown[]) {
  return {
    items,
    pagination: { page: 1, limit: 50, total: items.length, totalPages: 1 },
  };
}

describe('Account Subscriptions Page Load', () => {
  type LoadInput = Parameters<typeof import('../+page.server').load>[0];

  let mockPlatform: App.Platform;
  let mockCookies: LoadInput['cookies'];
  let depends: ReturnType<typeof vi.fn>;

  async function runLoad() {
    const { load } = await import('../+page.server');
    return load({
      platform: mockPlatform,
      cookies: mockCookies,
      depends,
    } as unknown as LoadInput);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getMineMock.mockReset();
    listMyCourseSubscriptionsMock.mockReset();

    mockPlatform = { env: {} } as App.Platform;
    mockCookies = {
      get: vi.fn(() => 'session-cookie'),
      set: vi.fn(),
      delete: vi.fn(),
      serialize: vi.fn(),
      getAll: vi.fn(),
    } as unknown as LoadInput['cookies'];
    depends = vi.fn();
  });

  it("registers depends('account:subscriptions') exactly once", async () => {
    getMineMock.mockResolvedValueOnce([]);
    listMyCourseSubscriptionsMock.mockResolvedValueOnce(courseList([]));

    await runLoad();

    expect(depends).toHaveBeenCalledTimes(1);
    expect(depends).toHaveBeenCalledWith('account:subscriptions');
  });

  it('returns both lists, the course list asked for 50', async () => {
    getMineMock.mockResolvedValueOnce(MEMBERSHIPS);
    listMyCourseSubscriptionsMock.mockResolvedValueOnce(courseList(COURSES));

    const result = await runLoad();

    expect(result).toEqual({
      subscriptions: MEMBERSHIPS,
      loadError: false,
      courseSubscriptions: COURSES,
      courseLoadError: false,
    });
    expect(getMineMock).toHaveBeenCalledTimes(1);
    expect(listMyCourseSubscriptionsMock).toHaveBeenCalledTimes(1);
    const params = listMyCourseSubscriptionsMock.mock
      .calls[0][0] as URLSearchParams;
    expect(params.get('limit')).toBe('50');
  });

  it('memberships failing: loadError only, the courses still show (no full-page 500)', async () => {
    // Previously the load function let errors propagate, which would render
    // the global +error.svelte and obscure the fact that only this one API
    // call failed. The discriminator lets the page render a retry alert
    // inline while keeping the rest of the account layout intact.
    getMineMock.mockRejectedValueOnce(new Error('ecom worker unreachable'));
    listMyCourseSubscriptionsMock.mockResolvedValueOnce(courseList(COURSES));

    const result = await runLoad();

    expect(result).toEqual({
      subscriptions: [],
      loadError: true,
      courseSubscriptions: COURSES,
      courseLoadError: false,
    });
  });

  it('the course list failing: courseLoadError only, the memberships still show', async () => {
    getMineMock.mockResolvedValueOnce(MEMBERSHIPS);
    listMyCourseSubscriptionsMock.mockRejectedValueOnce(
      new Error('ecom worker 503')
    );

    const result = await runLoad();

    expect(result).toEqual({
      subscriptions: MEMBERSHIPS,
      loadError: false,
      courseSubscriptions: [],
      courseLoadError: true,
    });
  });
});

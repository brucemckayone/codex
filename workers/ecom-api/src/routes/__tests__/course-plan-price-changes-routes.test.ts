/**
 * GET /studio/courses/:courseId/subscription-plan/price-changes
 * (Codex-2hxff.86, batch C1 Part B data design §2.6): the Offer panel's
 * progress read for a course plan's price change.
 *
 * Through the REAL `procedure()` resolver, as connect-organization-routes
 * .test.ts: a middleware injects the session user (or none, for the real
 * 401), the caller's membership is seeded in the pool's KV under the key the
 * reader builds, and `CourseSubscriptionService` is a spy object. A
 * membership missing from KV falls through to a DB read that this pool
 * cannot make: "not a member".
 *
 * Pins: owner/admin of the org in `?organizationId=` only; the service gets
 * the RESOLVED org and the path's course, which it scopes by both; the list
 * envelope; private cache; uuids only.
 */
import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { membershipCacheKey } from '@codex/worker-utils';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const courseSpies = {
  listPlanPriceChangeProgress: vi.fn(),
};

vi.mock('@codex/subscription', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/subscription')>();
  return {
    ...actual,
    CourseSubscriptionService: vi.fn(() => courseSpies),
  };
});

// Import AFTER the mock so the real service registry resolves the mocked class.
import courseMonetisation from '../course-monetisation';

const OWNER = {
  id: '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d',
  email: 'course-owner@test.com',
  role: 'creator',
};
const ORG = '7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e';
const OTHER_ORG = '8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f';
const COURSE = '9d0e1f2a-3b4c-4d5e-9f6a-7b8c9d0e1f2a';
const PROGRESS = {
  id: '0e1f2a3b-4c5d-4e6f-8a7b-8c9d0e1f2a3b',
  tierId: null,
  courseSubscriptionPlanId: '1f2a3b4c-5d6e-4f7a-9b8c-9d0e1f2a3b4c',
  interval: 'month',
  fromAmountCents: 1500,
  newAmountCents: 1800,
  state: 'running',
  createdAt: '2026-11-03T13:20:00.000Z',
  total: 40,
  emailed: 0,
  scheduled: 0,
  held: 0,
  due: 40,
  retrying: 0,
  lastRunAt: null,
  nextRunAt: '2026-11-03T14:00:00.000Z',
  estimatedDoneAt: '2026-11-03T14:00:00.000Z',
  doneAt: null,
  supersededById: null,
  stoppedAt: null,
};

function cacheKv() {
  const kv = env.CACHE_KV;
  if (!kv) throw new Error('CACHE_KV is not bound in the ecom-api test pool');
  return kv;
}

async function member(orgId: string, role: string) {
  await cacheKv().put(
    membershipCacheKey(orgId, OWNER.id),
    JSON.stringify({
      role,
      status: 'active',
      joinedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    })
  );
}

async function get(path: string, signedIn = true) {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    if (signedIn) {
      c.set('user', OWNER);
      c.set('session', { id: 'sess_course_price_changes', userId: OWNER.id });
    }
    await next();
  });
  app.route('/studio/courses', courseMonetisation);
  const ec = createExecutionContext();
  const res = await app.fetch(
    new Request(`http://ecom-api.test${path}`, { method: 'GET' }),
    env,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

const PATH = `/studio/courses/${COURSE}/subscription-plan/price-changes`;

beforeEach(async () => {
  vi.clearAllMocks();
  courseSpies.listPlanPriceChangeProgress.mockResolvedValue([PROGRESS]);
  for (const orgId of [ORG, OTHER_ORG]) {
    await cacheKv().delete(membershipCacheKey(orgId, OWNER.id));
  }
});

describe('GET /studio/courses/:courseId/subscription-plan/price-changes', () => {
  it.each([
    'owner',
    'admin',
  ])('an %s reads the plan’s progress for the resolved org and the path’s course, privately cached', async (role) => {
    await member(ORG, role);

    const res = await get(`${PATH}?organizationId=${ORG}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [PROGRESS],
      pagination: { page: 1, limit: 1, total: 1, totalPages: 1 },
    });
    expect(
      courseSpies.listPlanPriceChangeProgress
    ).toHaveBeenCalledExactlyOnceWith(ORG, COURSE);
    expect(res.headers.get('cache-control')).toMatch(/private/);
  });

  it('a plain member, an owner of another org and anyone signed out are refused before the read', async () => {
    await member(ORG, 'member');
    expect((await get(`${PATH}?organizationId=${ORG}`)).status).toBe(403);

    await cacheKv().delete(membershipCacheKey(ORG, OWNER.id));
    await member(OTHER_ORG, 'owner');
    expect((await get(`${PATH}?organizationId=${ORG}`)).status).toBe(403);

    expect((await get(`${PATH}?organizationId=${ORG}`, false)).status).toBe(
      401
    );
    expect(courseSpies.listPlanPriceChangeProgress).not.toHaveBeenCalled();
  });

  it('refuses a course id or organisation id that is not a uuid', async () => {
    await member(ORG, 'owner');
    expect(
      (
        await get(
          `/studio/courses/not-a-course/subscription-plan/price-changes?organizationId=${ORG}`
        )
      ).status
    ).toBe(400);
    expect((await get(`${PATH}?organizationId=nope`)).status).toBe(400);
    expect(courseSpies.listPlanPriceChangeProgress).not.toHaveBeenCalled();
  });
});

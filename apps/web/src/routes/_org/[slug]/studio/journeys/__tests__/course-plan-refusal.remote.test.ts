// @vitest-environment node

/**
 * `updateCourseMonetisation` forwards the course plan's typed Stripe refusals
 * (Codex-2hxff.66, owner decision 2026-10-26 "Quote the time").
 *
 * The plan's Stripe keys carry the UTC hour. A 503 STRIPE_UNAVAILABLE is
 * replayed by Stripe for the rest of that hour, and a 409
 * COURSE_PLAN_KEY_REUSED holds until it turns, so the worker sends
 * `details.retryAfter`, the start of the next hour. The 503 used to hit the
 * "5xx propagates" rule and reach the creator as SvelteKit's sanitised 500,
 * with nothing saying when a retry could work.
 *
 * Pinned here:
 *  - those refusals arrive with their own status, the worker's message, its
 *    `details.code` as `code`, and `retryAfter` when the worker set one;
 *  - only those two fields of `details` go on, never the rest (ids);
 *  - a 5xx WITHOUT one of the plan's codes still propagates untouched.
 *
 * Harness as in `journey-write-org-scope.remote.test.ts`: `@sveltejs/kit` is
 * NOT mocked, because the real `error()` is the subject (its body lives at
 * `body`, not at `message`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

const ORG_ID = '33333333-3333-4333-8333-333333333333';
const COURSE_ID = '22222222-2222-4222-8222-222222222222';
const RETRY_AFTER = '2026-10-26T15:00:00.000Z';
const PLAN_MESSAGE =
  "Stripe couldn't save this subscription plan, and nothing was saved. You can try again after the top of the hour.";

const courses = vi.hoisted(() => ({
  offer: vi.fn(),
  upsertSubscriptionPlan: vi.fn(),
  withdrawSubscriptionPlan: vi.fn(),
  setTierAccess: vi.fn(),
}));
const tiers = vi.hoisted(() => ({ list: vi.fn() }));
const getPublicInfoMock = vi.hoisted(() => vi.fn());

const getRequestEventMock = vi.hoisted(() =>
  vi.fn(() => ({
    platform: { env: {} },
    cookies: {
      get: vi.fn(() => ({ value: 'session-cookie' })),
      set: vi.fn(),
      delete: vi.fn(),
    },
    locals: { user: { id: 'user-1' } },
    // An org subdomain: `resolveStudioOrg` reads the org from the host.
    url: new URL('http://of-blood-and-bones.lvh.me:3010/studio/journeys'),
    request: new Request(
      'http://of-blood-and-bones.lvh.me:3010/studio/journeys'
    ),
  }))
);

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    org: { getPublicInfo: getPublicInfoMock },
    access: {},
    courses,
    tiers,
    content: { list: vi.fn(async () => ({ items: [] })) },
  })),
  serverApiUrl: vi.fn(() => 'http://localhost:4001'),
}));

/** The global `$app/server` mock is one-arg; this one returns the HANDLER. */
const makeRemote = <T extends (...args: never[]) => unknown>(
  type: 'form' | 'command' | 'query',
  fn: T
) => {
  const wrapped = ((...args: unknown[]) =>
    fn(...(args as Parameters<T>))) as T & {
    __: { type: string; id: string; name: string };
  };
  wrapped.__ = { type, id: '', name: '' };
  return wrapped;
};
const lastArg = (args: unknown[]) => args[args.length - 1] as never;

vi.mock('$app/server', () => ({
  command: vi.fn((...args: unknown[]) => makeRemote('command', lastArg(args))),
  form: vi.fn((...args: unknown[]) => makeRemote('form', lastArg(args))),
  query: vi.fn((...args: unknown[]) => makeRemote('query', lastArg(args))),
  getRequestEvent: getRequestEventMock,
}));

async function save(): Promise<unknown> {
  const mod = (await import('$lib/remote/journeys.remote')) as unknown as {
    updateCourseMonetisation: (input: unknown) => Promise<unknown>;
  };
  return mod.updateCourseMonetisation({
    courseId: COURSE_ID,
    subscriptionEnabled: true,
    subscriptionPriceMonthly: 1200,
    subscriptionPriceAnnual: 12000,
    tierIds: [],
  });
}

beforeEach(() => {
  getPublicInfoMock.mockReset().mockResolvedValue({ id: ORG_ID });
  for (const fn of Object.values(courses)) fn.mockReset();
  courses.setTierAccess.mockResolvedValue(null);
  tiers.list.mockReset().mockResolvedValue([]);
});

describe('the course plan refusals reach the builder', () => {
  it.each([
    [503, 'SERVICE_UNAVAILABLE', 'STRIPE_UNAVAILABLE'],
    [409, 'CONFLICT', 'COURSE_PLAN_KEY_REUSED'],
  ] as const)('a %i %s / %s arrives with its code and retryAfter', async (status, code, detailsCode) => {
    courses.upsertSubscriptionPlan.mockRejectedValueOnce(
      new ApiError(status, PLAN_MESSAGE, code, {
        code: detailsCode,
        retryAfter: RETRY_AFTER,
        courseId: COURSE_ID,
        organizationId: ORG_ID,
      })
    );

    const err = (await save().catch((e: unknown) => e)) as {
      status: number;
      body: Record<string, unknown>;
    };

    expect(err.status).toBe(status);
    // Exactly these fields: the ids in `details` stay on the server.
    expect(err.body).toEqual({
      message: PLAN_MESSAGE,
      code: detailsCode,
      retryAfter: RETRY_AFTER,
    });
    // Nothing after the refused plan leg runs.
    expect(courses.setTierAccess).not.toHaveBeenCalled();
  });

  it('a 409 COURSE_PLAN_IN_PROGRESS arrives with its code and no retryAfter', async () => {
    const message =
      'This subscription plan is still being created. Try again in a moment.';
    courses.upsertSubscriptionPlan.mockRejectedValueOnce(
      new ApiError(409, message, 'CONFLICT', {
        code: 'COURSE_PLAN_IN_PROGRESS',
        courseId: COURSE_ID,
      })
    );

    const err = (await save().catch((e: unknown) => e)) as {
      status: number;
      body: Record<string, unknown>;
    };

    expect(err.status).toBe(409);
    expect(err.body).toEqual({ message, code: 'COURSE_PLAN_IN_PROGRESS' });
  });

  it('a 5xx without one of the plan codes still propagates untouched', async () => {
    const raw = new ApiError(
      500,
      'relation "course_subscription_plans" does not exist'
    );
    courses.upsertSubscriptionPlan.mockRejectedValueOnce(raw);

    await expect(save()).rejects.toBe(raw);
  });
});

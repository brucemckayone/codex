// @vitest-environment node

/**
 * The two price-change progress reads (Codex-2hxff.86): the tier page's
 * `getTierPriceChanges` and the Offer panel's `getCoursePlanPriceChanges`.
 * Each hands back the list's items; the course read resolves the org from
 * the host, and off an org host it throws rather than answering `[]`, which
 * would read as "nothing is going out".
 *
 * `$app/server` is stubbed so a query is just its handler.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  tiers: { priceChanges: vi.fn() },
  courses: { planPriceChanges: vi.fn() },
  org: { getPublicInfo: vi.fn() },
}));
const host = vi.hoisted(() => ({
  url: 'https://northlight.revelations.studio/studio',
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => api),
}));
vi.mock('$app/server', () => {
  const remote =
    (type: string) =>
    (...args: unknown[]) => {
      const fn = args[args.length - 1] as (input: unknown) => unknown;
      const schema = args.length > 1 ? args[0] : undefined;
      const wrapped = (input: unknown) =>
        fn(
          schema
            ? (schema as { parse: (v: unknown) => unknown }).parse(input)
            : input
        );
      return Object.assign(wrapped, { __: { type } });
    };
  return {
    command: vi.fn(remote('command')),
    form: vi.fn(remote('form')),
    query: vi.fn(remote('query')),
    getRequestEvent: vi.fn(() => ({
      platform: { env: {} },
      cookies: {},
      url: new URL(host.url),
    })),
  };
});

const { getTierPriceChanges } = await import('./subscription.remote');
const { getCoursePlanPriceChanges } = await import('./journeys.remote');

const ORG_ID = '1a000000-0000-4000-8000-000000000001';
const COURSE_ID = '2b000000-0000-4000-8000-000000000002';
const page = (items: unknown[]) => ({
  items,
  pagination: {
    page: 1,
    limit: items.length,
    total: items.length,
    totalPages: 1,
  },
});

beforeEach(() => {
  api.tiers.priceChanges.mockReset();
  api.courses.planPriceChanges.mockReset();
  api.org.getPublicInfo.mockReset();
  host.url = 'https://northlight.revelations.studio/studio';
});

describe('getTierPriceChanges', () => {
  it("reads the org's tier price changes and hands back the items", async () => {
    api.tiers.priceChanges.mockResolvedValue(page([{ id: 'c1' }]));

    const result = await (
      getTierPriceChanges as unknown as (orgId: string) => Promise<unknown>
    )(ORG_ID);

    expect(api.tiers.priceChanges).toHaveBeenCalledWith(ORG_ID);
    expect(result).toEqual([{ id: 'c1' }]);
  });
});

describe('getCoursePlanPriceChanges', () => {
  const run = (input: unknown) =>
    (getCoursePlanPriceChanges as unknown as (i: unknown) => Promise<unknown>)(
      input
    );

  it("reads the course plan's changes for the host's org", async () => {
    api.org.getPublicInfo.mockResolvedValue({ id: ORG_ID });
    api.courses.planPriceChanges.mockResolvedValue(page([{ id: 'p1' }]));

    const result = await run({ courseId: COURSE_ID });

    expect(api.org.getPublicInfo).toHaveBeenCalledWith('northlight');
    expect(api.courses.planPriceChanges).toHaveBeenCalledWith(
      ORG_ID,
      COURSE_ID
    );
    expect(result).toEqual([{ id: 'p1' }]);
  });

  it('throws off an org host: never an empty list', async () => {
    host.url = 'https://revelations.studio/studio';

    await expect(run({ courseId: COURSE_ID })).rejects.toMatchObject({
      status: 400,
    });
    expect(api.courses.planPriceChanges).not.toHaveBeenCalled();
  });
});

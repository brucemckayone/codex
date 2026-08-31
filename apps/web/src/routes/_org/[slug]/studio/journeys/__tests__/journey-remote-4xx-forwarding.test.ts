// @vitest-environment node

/**
 * 4xx FORWARDING, for every journey remote whose refusal a creator has to read.
 *
 * WHY THIS FILE EXISTS, AND WHY THE BUG WAS INVISIBLE. A remote that lets an
 * `ApiError` propagate is not throwing an `HttpError`, so SvelteKit treats it as
 * an UNEXPECTED SERVER ERROR: it runs `handleError` (`hooks.server.ts:170`) and
 * sends whatever that returns. `handleError` branches on `dev`:
 *
 *     if (dev) return { message: error.message, code: 'INTERNAL_ERROR' }
 *     return { message: 'An unexpected error occurred', code: 'INTERNAL_ERROR' }
 *
 * So in local dev a bare throw looks correct — the real sentence arrives — and in
 * production the same refusal reads "An unexpected error occurred", with a 500
 * status that also files a creator's typo as a server fault. Seven of these
 * remotes already carried the forwarding block inline; the rest were written
 * without inheriting the rule, and nothing could have caught it by inspection in
 * dev.
 *
 * MEASURED LIVE (local stack, 2026-08-30, signed in as an org owner), the same
 * denial through both kinds of remote:
 *     setJourneyStatus   (had the block)  -> 403 "You are not a member of this organization"
 *     listJourneyRevenue (had no block)   -> 500 "You are not a member of this organization"
 * and on the builder's PRIMARY WRITE, saving a page with a slug another page in
 * the org already holds:
 *     saveJourneyPage    (had no block)   -> 500 'The slug "bone-deep" is already in use'
 * That last string is a three-second fix a creator can act on, and it is exactly
 * what production replaces with the generic line. `saveBuilderDraft` puts whatever
 * arrives straight into the toast (`stage: 'page'`), so the honest sentence was
 * one forward away.
 *
 * WHAT IS PINNED, AND WHY EACH HALF IS NECESSARY:
 *
 *  1. A 4xx ARRIVES AS THAT STATUS WITH ITS OWN TEXT AT `body.message`. Asserting
 *     the STATUS as well as the text is the half that fails on a bare throw:
 *     `handleError` in dev forwards `error.message`, so a test that checked only
 *     the message would PASS against the unfixed code under vitest and lie. The
 *     status cannot be faked that way — a propagated `ApiError` is a 500.
 *  2. A 5xx IS NOT REWORDED. It may carry internals (a raw SQL string was the
 *     observed case), so it must propagate untouched and let `handleError`
 *     sanitise it. Without this half, "forward everything" would pass — and that
 *     is the change that leaks a database error to a creator's toast.
 *
 * THESE ARE NOT ORG-SCOPE TESTS. `journey-write-org-scope.remote.test.ts` beside
 * this file pins WHICH org each write addresses; this file pins what the creator
 * READS when a write is refused. A remote can be perfectly scoped and still
 * report its refusal as a mystery.
 *
 * Set up exactly like `portals-manage.remote.test.ts`: `@sveltejs/kit` is
 * deliberately NOT mocked, because the real `error()` is the whole subject — it
 * throws a real `HttpError` whose text lives at `body.message` and NOT at
 * `message`, which is the trap (Codex-xo3bl) every one of these assertions is
 * shaped around.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

const accessMocks = vi.hoisted(() => ({
  listJourneys: vi.fn(),
  listJourneyRevenue: vi.fn(),
  getJourneyForBuilder: vi.fn(),
  createJourney: vi.fn(),
  saveJourneyPage: vi.fn(),
  getJourneySellMedia: vi.fn(),
  deleteJourneyCover: vi.fn(),
  deleteJourneyHeroImage: vi.fn(),
  deleteJourneySignatureImage: vi.fn(),
  getCourseCurriculum: vi.fn(),
  saveCourseCurriculum: vi.fn(),
}));
const contentListMock = vi.hoisted(() => vi.fn());
const getPublicInfoMock = vi.hoisted(() => vi.fn());
const hostRef = vi.hoisted(() => ({
  url: 'http://of-blood-and-bones.lvh.me:3010/studio/journeys',
}));
const getRequestEventMock = vi.hoisted(() =>
  vi.fn(() => ({
    platform: { env: {} },
    cookies: {
      get: vi.fn(() => ({ value: 'session-cookie' })),
      set: vi.fn(),
      delete: vi.fn(),
    },
    locals: {},
    url: new URL(hostRef.url),
    request: new Request(hostRef.url),
  }))
);

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    org: { getPublicInfo: getPublicInfoMock },
    access: accessMocks,
    content: { list: contentListMock },
  })),
  serverApiUrl: vi.fn(() => 'http://localhost:4001'),
}));

/** See `portals-lifecycle.remote.test.ts` — the global mock is a one-arg shape. */
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

const ORG_ID = '33333333-3333-4333-8333-333333333333';
const PAGE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '99999999-9999-4999-8999-999999999999';

/**
 * A whole `.strict()` save body. Built here rather than partially, because the
 * schema rejects a partial one BEFORE the handler runs — and a schema rejection
 * would make every assertion below vacuous (it would pass for the wrong reason).
 */
const SAVE_BODY = {
  id: PAGE_ID,
  pageType: 'course',
  slug: 'bone-deep',
  title: 'Bone Deep',
  status: 'draft',
  subjectType: 'course',
  subjectId: '22222222-2222-4222-8222-222222222222',
  brandOverrides: null,
  sections: [],
};

/**
 * One row per remote under test: how to call it, and which api-client mock it
 * reaches through. `mock` is the leg that is made to reject.
 */
const CASES: readonly {
  remote: string;
  mock: () => ReturnType<typeof vi.fn>;
  call: (mod: Record<string, unknown>) => Promise<unknown>;
}[] = [
  {
    remote: 'listJourneys',
    mock: () => accessMocks.listJourneys,
    call: (m) =>
      (m.listJourneys as (i: unknown) => Promise<unknown>)({
        organizationId: OTHER_ORG,
      }),
  },
  {
    remote: 'listJourneyRevenue',
    mock: () => accessMocks.listJourneyRevenue,
    call: (m) =>
      (m.listJourneyRevenue as (i: unknown) => Promise<unknown>)({
        organizationId: OTHER_ORG,
      }),
  },
  {
    remote: 'getJourneyForBuilder',
    mock: () => accessMocks.getJourneyForBuilder,
    call: (m) =>
      (m.getJourneyForBuilder as (i: unknown) => Promise<unknown>)({
        id: PAGE_ID,
      }),
  },
  {
    remote: 'createJourney',
    mock: () => accessMocks.createJourney,
    call: (m) =>
      (m.createJourney as (i: unknown) => Promise<unknown>)({
        title: 'Bone Deep',
        pageType: 'course',
      }),
  },
  {
    remote: 'saveJourneyPage',
    mock: () => accessMocks.saveJourneyPage,
    call: (m) =>
      (m.saveJourneyPage as (i: unknown) => Promise<unknown>)(SAVE_BODY),
  },
  {
    remote: 'getJourneySellMedia',
    mock: () => accessMocks.getJourneySellMedia,
    call: (m) =>
      (m.getJourneySellMedia as (i: unknown) => Promise<unknown>)({
        pageId: PAGE_ID,
      }),
  },
  {
    remote: 'deleteJourneyCover',
    mock: () => accessMocks.deleteJourneyCover,
    call: (m) =>
      (m.deleteJourneyCover as (i: unknown) => Promise<unknown>)({
        pageId: PAGE_ID,
      }),
  },
  {
    remote: 'deleteJourneyHeroImage',
    mock: () => accessMocks.deleteJourneyHeroImage,
    call: (m) =>
      (m.deleteJourneyHeroImage as (i: unknown) => Promise<unknown>)({
        pageId: PAGE_ID,
      }),
  },
  {
    remote: 'deleteJourneySignatureImage',
    mock: () => accessMocks.deleteJourneySignatureImage,
    call: (m) =>
      (m.deleteJourneySignatureImage as (i: unknown) => Promise<unknown>)({
        pageId: PAGE_ID,
      }),
  },
  {
    remote: 'getCourseCurriculum',
    mock: () => accessMocks.getCourseCurriculum,
    call: (m) =>
      (m.getCourseCurriculum as (i: unknown) => Promise<unknown>)({
        pageId: PAGE_ID,
      }),
  },
  {
    remote: 'listCurriculumContentOptions',
    mock: () => contentListMock,
    call: (m) =>
      (m.listCurriculumContentOptions as (i: unknown) => Promise<unknown>)({}),
  },
  {
    remote: 'saveCourseCurriculum',
    mock: () => accessMocks.saveCourseCurriculum,
    call: (m) =>
      (m.saveCourseCurriculum as (i: unknown) => Promise<unknown>)({
        pageId: PAGE_ID,
        stages: [{ id: null, name: 'Arriving', gloss: null, practices: [] }],
      }),
  },
];

beforeEach(() => {
  hostRef.url = 'http://of-blood-and-bones.lvh.me:3010/studio/journeys';
  for (const mock of Object.values(accessMocks)) mock.mockReset();
  contentListMock.mockReset().mockResolvedValue({ items: [] });
  getPublicInfoMock.mockReset().mockResolvedValue({ id: ORG_ID });
  getRequestEventMock.mockClear();
});

describe.each(CASES)('$remote', ({ mock, call }) => {
  it('forwards a 403 refusal as a 403 whose text is at body.message', async () => {
    // The exact refusal measured live against the running stack: a studio remote
    // called on the host of an org the session does not manage.
    mock()
      .mockReset()
      .mockRejectedValueOnce(
        new ApiError(403, 'You are not a member of this organization')
      );
    const mod = await import('$lib/remote/journeys.remote');

    await expect(call(mod)).rejects.toMatchObject({
      status: 403,
      body: { message: 'You are not a member of this organization' },
    });
  });

  it('forwards a 409 conflict with the sentence a creator can act on', async () => {
    mock()
      .mockReset()
      .mockRejectedValueOnce(
        new ApiError(409, 'The slug "bone-deep" is already in use')
      );
    const mod = await import('$lib/remote/journeys.remote');

    await expect(call(mod)).rejects.toMatchObject({
      status: 409,
      body: { message: 'The slug "bone-deep" is already in use' },
    });
  });

  it('does NOT reword a 5xx — it may carry internals', async () => {
    // `toBe`, not `toMatchObject`: the SAME object must come back out, which is
    // the only assertion that proves nothing re-raised it through `error()`.
    const boom = new ApiError(500, 'relation "landing_pages" does not exist');
    mock().mockReset().mockRejectedValueOnce(boom);
    const mod = await import('$lib/remote/journeys.remote');

    await expect(call(mod)).rejects.toBe(boom);
  });
});

/**
 * The COMPLETENESS half. The per-case table above can only test what somebody
 * remembered to add to it, and the whole defect this file exists for is a remote
 * written without inheriting the rule — so a new remote must not be able to join
 * the module silently.
 *
 * Source text rather than behaviour, deliberately: the property is "this handler
 * routes its api call through the forwarding path", and there is no way to
 * observe that for a remote nobody has written a case for yet.
 */
describe('module-wide', () => {
  it('every studio remote that reaches the api forwards its 4xx', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL(
        '../../../../../../lib/remote/journeys.remote.ts',
        import.meta.url
      ),
      'utf-8'
    );

    // Split the module into one chunk per exported remote.
    const chunks = src.split(/\nexport const (\w+) = (?:query|command|form)\(/);
    const bodies = new Map<string, string>();
    for (let i = 1; i < chunks.length; i += 2) {
      bodies.set(chunks[i], chunks[i + 1]);
    }

    /**
     * The remotes that deliberately do NOT forward, each for a stated reason.
     * Adding a name here is a decision, which is the point of an explicit list:
     *
     *  - the four PUBLIC reads are consumed by server loads that already
     *    `.catch()` them, so there is no client-side error branch to feed;
     *  - the three SOFT-FAIL reads answer `null` on any failure BY DESIGN
     *    (documented in each: "a pricing hiccup must cost the author their
     *    prices, never their canvas"), so nothing throws to forward;
     *  - `markPracticeCompleted` reaches the api through the Round-D seam, not
     *    through an `api.access.*` call in this module.
     */
    const EXEMPT = new Set([
      'getCoursePage',
      'resolveSellPreview',
      'listPublishedJourneys',
      'listEnrolledJourneys',
      'getCourseMonetisation',
      'getCourseOffer',
      'getCoursePagePreview',
      'markPracticeCompleted',
    ]);

    const unforwarded: string[] = [];
    for (const [name, body] of bodies) {
      if (EXEMPT.has(name)) continue;
      const forwards =
        body.includes('withServiceErrors(') ||
        body.includes('ApiError.isApiError(');
      if (!forwards) unforwarded.push(name);
    }

    expect(unforwarded).toEqual([]);
    // And the split itself worked — an empty map would make the loop vacuous.
    expect(bodies.size).toBe(30);
  });
});

// @vitest-environment node

/**
 * ORG SCOPE, for every journey WRITE that did not already have a proof.
 *
 * WHY THIS FILE EXISTS. A sweep of all 30 remote functions in
 * `journeys.remote.ts` found the authorisation property in a state nobody could
 * check: the code is correct — every studio route in the content-api is
 * `auth: 'required'` + `requireOrgManagement`, every api-client method carries
 * `?organizationId=`, and every service method re-resolves its row by
 * `(id, organizationId)` — but only THREE of the seventeen mutations had a test
 * that said so (`setJourneyStatus` in `portals-lifecycle.remote.test.ts`,
 * `duplicateJourney` and `deleteJourney` in `portals-manage.remote.test.ts`).
 * "I read the code and it looked right" is not a property; it is a snapshot of
 * one reading. This file makes it a property for the other fourteen.
 *
 * THE FAILURE THESE PIN, and it is silent in production. `resolveStudioOrg()`
 * derives the org from the request HOST (subdomain → slug → `getPublicInfo` id).
 * A refactor that instead forwarded an `organizationId` off the client payload
 * would be a cross-tenant write that NOTHING announces: the worker's
 * `requireOrgManagement` still passes whenever the caller manages the named org,
 * and a creator who manages two spaces manages both. So the wrong org is a
 * successful 200 that writes to the other tenant's page. There is no error to
 * grep for, no log line, and the studio would report success.
 *
 * TWO ASSERTIONS PER MUTATION, and both matter:
 *   1. THE ORG IS THE HOST'S. The api client receives the host-resolved org id,
 *      and (where the input carries one at all) NOT the caller's.
 *   2. OFF A NON-ORG HOST IT WRITES NOTHING. `resolveStudioOrg` answers null on
 *      a platform host; an unguarded `ctx.api` would throw a TypeError the
 *      studio renders as a blank failure, and — worse for a write — a guard
 *      added below the call would send the request first.
 *
 * AND THE TWO READS THAT ACCEPT A CLIENT `organizationId`. `listJourneys` and
 * `listJourneyRevenue` take one in their input for the frozen WP-0 contract and
 * deliberately do not trust it. That is the one place in this layer where a
 * client-supplied org id exists at all, so it is the one place the "host wins"
 * rule can be tested against an ADVERSARIAL value rather than an absent one —
 * and a list read answering another org's portals is a data-exposure bug, not a
 * write bug. Both are pinned with a foreign id in the payload.
 *
 * `@sveltejs/kit` is deliberately NOT mocked, for the reason its two siblings
 * give: the real `error()` throws a real `HttpError`, whose text lives at
 * `body.message` and not at `message`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The org the HOST resolves to. Every assertion below expects this one. */
const ORG_ID = '33333333-3333-4333-8333-333333333333';
/**
 * An org the caller might name in a payload. It is a real-looking uuid on
 * purpose: the point is that a well-formed foreign id gets ignored, not that a
 * malformed one is rejected.
 */
const FOREIGN_ORG_ID = '99999999-9999-4999-8999-999999999999';
const PAGE_ID = '11111111-1111-4111-8111-111111111111';
const COURSE_ID = '22222222-2222-4222-8222-222222222222';
const TIER_ID = '44444444-4444-4444-8444-444444444444';

const ORG_HOST = 'http://of-blood-and-bones.lvh.me:3010/studio/journeys';
const PLATFORM_HOST = 'http://lvh.me:3010/studio/journeys';

const access = vi.hoisted(() => ({
  createJourney: vi.fn(),
  saveJourneyPage: vi.fn(),
  updateJourneyOffer: vi.fn(),
  setJourneyFeatured: vi.fn(),
  updateJourneySellMedia: vi.fn(),
  getJourneySellMedia: vi.fn(),
  deleteJourneyCover: vi.fn(),
  deleteJourneyHeroImage: vi.fn(),
  deleteJourneySignatureImage: vi.fn(),
  uploadJourneyCover: vi.fn(),
  uploadJourneyHeroImage: vi.fn(),
  uploadJourneySignatureImage: vi.fn(),
  saveCourseCurriculum: vi.fn(),
  getCourseCurriculum: vi.fn(),
  listJourneys: vi.fn(),
  listJourneyRevenue: vi.fn(),
  coursePagePreview: vi.fn(),
  getJourneyForBuilder: vi.fn(),
}));

const courses = vi.hoisted(() => ({
  offer: vi.fn(),
  upsertSubscriptionPlan: vi.fn(),
  withdrawSubscriptionPlan: vi.fn(),
  setTierAccess: vi.fn(),
}));

const tiers = vi.hoisted(() => ({ list: vi.fn() }));

const getPublicInfoMock = vi.hoisted(() => vi.fn());
const hostRef = vi.hoisted(() => ({ url: '' }));

const getRequestEventMock = vi.hoisted(() =>
  vi.fn(() => ({
    platform: { env: {} },
    cookies: {
      get: vi.fn(() => ({ value: 'session-cookie' })),
      set: vi.fn(),
      delete: vi.fn(),
    },
    locals: { user: { id: 'user-1' } },
    url: new URL(hostRef.url),
    request: new Request(hostRef.url),
  }))
);

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    org: { getPublicInfo: getPublicInfoMock },
    access,
    courses,
    tiers,
    content: { list: vi.fn(async () => ({ items: [] })) },
  })),
  serverApiUrl: vi.fn(() => 'http://localhost:4001'),
}));

/**
 * The global `$app/server` mock declares a ONE-arg `command`, which for
 * `command(schema, handler)` returns the SCHEMA. Overridden here exactly as the
 * two sibling remote tests do, so the test calls the HANDLER.
 *
 * The schema is therefore NOT applied — which is what makes these tests about
 * scope rather than about validation. Zod's own coverage lives in
 * `@codex/validation`; what cannot be tested there is which org id the handler
 * hands onward.
 */
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

/** Call any remote in the module by name, bypassing its schema (see above). */
async function call<R = unknown>(name: string, input?: unknown): Promise<R> {
  const mod = (await import(
    '$lib/remote/journeys.remote'
  )) as unknown as Record<string, (i?: unknown) => Promise<R>>;
  return mod[name](input);
}

beforeEach(() => {
  hostRef.url = ORG_HOST;
  getPublicInfoMock.mockReset().mockResolvedValue({ id: ORG_ID });
  for (const spy of [
    ...Object.values(access),
    ...Object.values(courses),
    ...Object.values(tiers),
  ]) {
    spy.mockReset();
  }
  access.createJourney.mockResolvedValue({ id: PAGE_ID, slug: 'a-slug' });
  access.saveJourneyPage.mockResolvedValue(null);
  access.updateJourneyOffer.mockResolvedValue(null);
  access.setJourneyFeatured.mockResolvedValue(null);
  access.updateJourneySellMedia.mockResolvedValue({ courseId: COURSE_ID });
  access.deleteJourneyCover.mockResolvedValue(null);
  access.deleteJourneyHeroImage.mockResolvedValue(null);
  access.deleteJourneySignatureImage.mockResolvedValue(null);
  access.uploadJourneyCover.mockResolvedValue({ coverImageUrl: '/c.webp' });
  access.uploadJourneyHeroImage.mockResolvedValue({ heroImageUrl: '/h.webp' });
  access.uploadJourneySignatureImage.mockResolvedValue({
    signatureImageUrl: '/s.webp',
  });
  access.saveCourseCurriculum.mockResolvedValue({
    courseId: COURSE_ID,
    stages: [],
  });
  access.listJourneys.mockResolvedValue([]);
  access.listJourneyRevenue.mockResolvedValue({});
  courses.offer.mockResolvedValue({
    courseId: COURSE_ID,
    subscription: null,
    tiers: [],
  });
  courses.upsertSubscriptionPlan.mockResolvedValue(null);
  courses.withdrawSubscriptionPlan.mockResolvedValue(null);
  courses.setTierAccess.mockResolvedValue(null);
  tiers.list.mockResolvedValue([]);
  getRequestEventMock.mockClear();
});

/**
 * One row per mutation: the remote's name, an input, and the api-client spy that
 * must receive the host-resolved org as its FIRST argument.
 *
 * A TABLE rather than fourteen hand-written blocks, because the property is
 * identical for all of them and the interesting risk is an OMISSION — a
 * fifteenth mutation landing with no row. The completeness of this table is
 * asserted separately at the bottom of the file, against the module's own
 * exports, so a new command cannot join the module without joining this list.
 */
const COMMAND_CASES: ReadonlyArray<{
  remote: string;
  input: unknown;
  spy: () => ReturnType<typeof vi.fn>;
  /** Extra args the client must receive after the org id. */
  rest?: unknown[];
}> = [
  {
    remote: 'createJourney',
    input: { title: 'Bone Deep', pageType: 'course' },
    spy: () => access.createJourney,
    rest: [{ title: 'Bone Deep', pageType: 'course' }],
  },
  {
    remote: 'saveJourneyPage',
    input: {
      id: PAGE_ID,
      pageType: 'course',
      slug: 'bone-deep',
      title: 'Bone Deep',
      status: 'draft',
      subjectType: 'course',
      subjectId: COURSE_ID,
      brandOverrides: null,
      sections: [],
    },
    spy: () => access.saveJourneyPage,
  },
  {
    remote: 'updateJourneyOffer',
    input: {
      pageId: PAGE_ID,
      offer: {
        tiersEnabled: false,
        subscriptionEnabled: false,
        subscriptionPriceCents: null,
        oneOffEnabled: true,
        oneOffPriceCents: 3500,
      },
    },
    spy: () => access.updateJourneyOffer,
  },
  {
    remote: 'setJourneyFeatured',
    input: { pageId: PAGE_ID, featured: true },
    spy: () => access.setJourneyFeatured,
    rest: [PAGE_ID, true],
  },
  {
    remote: 'updateJourneySellMedia',
    input: { pageId: PAGE_ID, media: {} },
    spy: () => access.updateJourneySellMedia,
  },
  {
    remote: 'deleteJourneyCover',
    input: { pageId: PAGE_ID },
    spy: () => access.deleteJourneyCover,
    rest: [PAGE_ID],
  },
  {
    remote: 'deleteJourneyHeroImage',
    input: { pageId: PAGE_ID },
    spy: () => access.deleteJourneyHeroImage,
    rest: [PAGE_ID],
  },
  {
    remote: 'deleteJourneySignatureImage',
    input: { pageId: PAGE_ID },
    spy: () => access.deleteJourneySignatureImage,
    rest: [PAGE_ID],
  },
  {
    remote: 'saveCourseCurriculum',
    input: { pageId: PAGE_ID, stages: [] },
    spy: () => access.saveCourseCurriculum,
  },
];

describe('journey write commands — the org comes from the HOST', () => {
  for (const c of COMMAND_CASES) {
    it(`${c.remote} scopes its api call to the host-resolved org`, async () => {
      await call(c.remote, c.input);

      const spy = c.spy();
      expect(spy).toHaveBeenCalledTimes(1);
      // FIRST argument, always — every `access.*` studio method takes the org id
      // there and appends it to the URL as `?organizationId=`.
      expect(spy.mock.calls[0][0]).toBe(ORG_ID);
      if (c.rest) expect(spy).toHaveBeenCalledWith(ORG_ID, ...c.rest);
    });

    it(`${c.remote} 400s off a non-org host and calls NOTHING`, async () => {
      hostRef.url = PLATFORM_HOST;

      await expect(call(c.remote, c.input)).rejects.toMatchObject({
        status: 400,
      });
      expect(c.spy()).not.toHaveBeenCalled();
    });
  }

  it('resolves the org from the host on every call — never from a cached value', async () => {
    // `getPublicInfo` is KV-cached server-side, but the RESOLUTION must still
    // happen per request: a module-level memo would pin the first org a worker
    // isolate ever saw and serve it to every other tenant on that isolate. This
    // is the cheapest observable proxy — one lookup per invocation.
    await call('deleteJourneyCover', { pageId: PAGE_ID });
    await call('deleteJourneyCover', { pageId: PAGE_ID });

    expect(getPublicInfoMock).toHaveBeenCalledTimes(2);
    expect(getPublicInfoMock).toHaveBeenCalledWith('of-blood-and-bones');
  });
});

/**
 * The three uploads are `form()`s, so a refusal is a RETURNED VALUE rather than a
 * throw (their own doc comments explain why: the panel renders the server's
 * message in place). That difference is the reason they need their own block —
 * `.rejects` would pass vacuously against a resolved failure object.
 */
const FORM_CASES: ReadonlyArray<{
  remote: string;
  field: 'cover' | 'image';
  spy: () => ReturnType<typeof vi.fn>;
}> = [
  {
    remote: 'uploadJourneyCoverForm',
    field: 'cover',
    spy: () => access.uploadJourneyCover,
  },
  {
    remote: 'uploadJourneyHeroImageForm',
    field: 'image',
    spy: () => access.uploadJourneyHeroImage,
  },
  {
    remote: 'uploadJourneySignatureImageForm',
    field: 'image',
    spy: () => access.uploadJourneySignatureImage,
  },
];

describe('journey upload forms — the org comes from the HOST', () => {
  const file = () =>
    new File([new Uint8Array([1, 2, 3])], 'still.webp', {
      type: 'image/webp',
    });

  for (const f of FORM_CASES) {
    it(`${f.remote} scopes its upload to the host-resolved org`, async () => {
      await call(f.remote, { pageId: PAGE_ID, [f.field]: file() });

      const spy = f.spy();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe(ORG_ID);
      expect(spy.mock.calls[0][1]).toBe(PAGE_ID);
      expect(spy.mock.calls[0][2]).toBeInstanceOf(File);
    });

    it(`${f.remote} returns outcome 'failed' off a non-org host and uploads NOTHING`, async () => {
      hostRef.url = PLATFORM_HOST;

      await expect(
        call(f.remote, { pageId: PAGE_ID, [f.field]: file() })
      ).resolves.toMatchObject({ outcome: 'failed' });
      expect(f.spy()).not.toHaveBeenCalled();
    });
  }
});

describe('updateCourseMonetisation — the org comes from the HOST on all three legs', () => {
  const base = {
    courseId: COURSE_ID,
    subscriptionEnabled: false,
    subscriptionPriceMonthly: null,
    subscriptionPriceAnnual: null,
    tierIds: [TIER_ID],
  };

  it('passes the host org to the plan withdrawal, the tier write AND the read-back', async () => {
    await call('updateCourseMonetisation', base);

    expect(courses.withdrawSubscriptionPlan).toHaveBeenCalledWith(
      ORG_ID,
      COURSE_ID
    );
    expect(courses.setTierAccess).toHaveBeenCalledWith(ORG_ID, COURSE_ID, [
      TIER_ID,
    ]);
    // The read-back's tier list is org-scoped too: it feeds the panel's PICKER,
    // so a wrong org here would offer another tenant's tier names for selection.
    expect(tiers.list).toHaveBeenCalledWith(ORG_ID);
  });

  it('passes the host org to the plan upsert when a subscription is enabled', async () => {
    await call('updateCourseMonetisation', {
      ...base,
      subscriptionEnabled: true,
      subscriptionPriceMonthly: 1200,
      subscriptionPriceAnnual: 12000,
    });

    expect(courses.upsertSubscriptionPlan).toHaveBeenCalledWith(
      ORG_ID,
      COURSE_ID,
      { priceMonthly: 1200, priceAnnual: 12000 }
    );
    expect(courses.withdrawSubscriptionPlan).not.toHaveBeenCalled();
  });

  it('400s off a non-org host and writes NOTHING to Stripe or the tier table', async () => {
    hostRef.url = PLATFORM_HOST;

    await expect(call('updateCourseMonetisation', base)).rejects.toMatchObject({
      status: 400,
    });
    expect(courses.upsertSubscriptionPlan).not.toHaveBeenCalled();
    expect(courses.withdrawSubscriptionPlan).not.toHaveBeenCalled();
    expect(courses.setTierAccess).not.toHaveBeenCalled();
  });

  it('refuses an enabled subscription with a missing price BEFORE touching Stripe', async () => {
    // Not a scope assertion, but it belongs beside them: the order matters. A
    // 400 raised after the plan upsert would leave a Stripe Product behind for a
    // save the creator was told had failed.
    await expect(
      call('updateCourseMonetisation', {
        ...base,
        subscriptionEnabled: true,
        subscriptionPriceMonthly: null,
        subscriptionPriceAnnual: 12000,
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(courses.upsertSubscriptionPlan).not.toHaveBeenCalled();
    expect(courses.setTierAccess).not.toHaveBeenCalled();
  });
});

describe('the two reads that ACCEPT a client organizationId ignore it', () => {
  it('listJourneys reads the HOST org even when the payload names another', async () => {
    await call('listJourneys', {
      organizationId: FOREIGN_ORG_ID,
      status: 'published',
    });

    expect(access.listJourneys).toHaveBeenCalledWith(ORG_ID, 'published');
    expect(access.listJourneys).not.toHaveBeenCalledWith(
      FOREIGN_ORG_ID,
      expect.anything()
    );
  });

  it('listJourneyRevenue reads the HOST org even when the payload names another', async () => {
    await call('listJourneyRevenue', { organizationId: FOREIGN_ORG_ID });

    expect(access.listJourneyRevenue).toHaveBeenCalledWith(ORG_ID, '30d');
    expect(access.listJourneyRevenue).not.toHaveBeenCalledWith(
      FOREIGN_ORG_ID,
      expect.anything()
    );
  });

  it('both answer EMPTY off a non-org host rather than reading unscoped', async () => {
    hostRef.url = PLATFORM_HOST;

    await expect(
      call('listJourneys', { organizationId: FOREIGN_ORG_ID })
    ).resolves.toEqual([]);
    await expect(
      call('listJourneyRevenue', { organizationId: FOREIGN_ORG_ID })
    ).resolves.toEqual({});
    expect(access.listJourneys).not.toHaveBeenCalled();
    expect(access.listJourneyRevenue).not.toHaveBeenCalled();
  });
});

/**
 * THE COMPLETENESS GUARD, and it is the reason the cases above are a table.
 *
 * Every assertion in this file is about a mutation that is LISTED. A fifteenth
 * command landing in `journeys.remote.ts` with no row here would leave the file
 * fully green while the new write went unchecked — the same shape of false
 * positive as a gate that reports success for a suite it never ran.
 *
 * So the module's own `command`/`form` exports are enumerated at runtime and
 * every one must be either covered here or named in the exemption list, with the
 * reason it needs no org-scope proof. `expect.assertions` is not enough; the
 * list has to be closed.
 */
describe('completeness', () => {
  /**
   * Mutations that legitimately carry no org scope, each with its reason.
   *
   * `markPracticeCompleted` is a MEMBER write, not a studio one: it is scoped to
   * the session `userId` (and 401s without one), writes a row keyed by
   * `(user, content)`, and has no org dimension to get wrong.
   *
   * The three already-proven ones point at the file that proves them, so this
   * list stays a map of where the coverage IS rather than a list of holes.
   */
  const EXEMPT_OR_PROVEN_ELSEWHERE: Record<string, string> = {
    markPracticeCompleted: 'session-scoped member write — no org dimension',
    setJourneyStatus: 'proven in portals-lifecycle.remote.test.ts',
    duplicateJourney: 'proven in portals-manage.remote.test.ts',
    deleteJourney: 'proven in portals-manage.remote.test.ts',
  };

  it('covers every command() and form() the module exports', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    // Read the SOURCE rather than the imported module: the `$app/server` mock
    // above erases the flavour, so an imported value cannot say whether it is a
    // command, a form or a query.
    const src = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../../../lib/remote/journeys.remote.ts'
      ),
      'utf8'
    );
    const mutations = [
      ...src.matchAll(/^export const (\w+) = (command|form)\(/gm),
    ].map((m) => m[1]);

    // Guards the guard: a path or regex that matched nothing would make the
    // assertion below pass over an empty set.
    expect(mutations.length).toBeGreaterThanOrEqual(17);

    const covered = new Set([
      ...COMMAND_CASES.map((c) => c.remote),
      ...FORM_CASES.map((f) => f.remote),
      'updateCourseMonetisation',
      ...Object.keys(EXEMPT_OR_PROVEN_ELSEWHERE),
    ]);

    const unchecked = mutations.filter((name) => !covered.has(name));
    expect(
      unchecked,
      'a new journey mutation must either get an org-scope case in this file or an entry in EXEMPT_OR_PROVEN_ELSEWHERE naming why it needs none'
    ).toEqual([]);
  });
});

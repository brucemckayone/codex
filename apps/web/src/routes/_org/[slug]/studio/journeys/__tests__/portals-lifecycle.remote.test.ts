// @vitest-environment node

/**
 * `setJourneyStatus` — the portals list's publish / unpublish / archive write
 * (Codex-c3lky · WP-H).
 *
 * WHY THESE ASSERTIONS AND NOT OTHERS. The command is a READ-THEN-WRITE over two
 * existing endpoints, because there is no status-only route: `PUT :pageId` is the
 * ONLY writer of `landing_pages.status`, its body is `.strict()`, and
 * `JourneyListItem` carries four of its nine required keys. Every failure mode of
 * that shape is silent from the list's point of view — the button reports success
 * and the row snaps back on refresh — so each one is pinned here:
 *
 *  1. THE CASCADE. The write MUST go through `saveJourneyPage`, because
 *     `cascadeCourseFromPage` (only reachable from there) is what moves
 *     `courses.status`, and `courses.status` is the only gate on /explore, the
 *     public by-slug read, the sell preview and the enrolled shelves. The bead's
 *     own precondition is "do not add an unpublish button on top of a publish
 *     path that ... does not cascade", so a future refactor to a shortcut
 *     endpoint must fail here rather than in production.
 *  2. `offer` MUST NOT be forwarded. It is on the record the read returns, the
 *     save body is `.strict()`, and pricing has its own route — so a spread
 *     instead of a key-by-key build would 400 every publish. Same for the
 *     server-owned `organizationId` / `publishedAt`.
 *  3. EVERY OTHER KEY MUST be forwarded. The save is a FULL-RECORD PUT: a key
 *     dropped here is a key erased from the row. `sections` in particular is the
 *     whole page body.
 *  4. `design` / `seo` absent means "leave alone" to the service, so an absent
 *     key must stay absent rather than becoming an explicit `undefined`.
 *  5. A status that already matches must not write at all — re-issuing a state
 *     should not bump `updated_at` or re-run the cascade.
 *  6. A foreign/missing page (the worker returns `null`, org-scoped) must 404 and
 *     write NOTHING.
 *  7. A 4xx from either hop must reach the caller as readable text; a 5xx must NOT
 *     be reworded, because it may carry internals.
 *
 * `@sveltejs/kit` is deliberately NOT mocked: the real `error()` throws a real
 * `HttpError`, whose text lives at `body.message` and NOT at `message` — the exact
 * asymmetry the list's `queryErrorMessage` exists for.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

const getJourneyForBuilderMock = vi.hoisted(() => vi.fn());
const saveJourneyPageMock = vi.hoisted(() => vi.fn());
const getPublicInfoMock = vi.hoisted(() => vi.fn());
const getRequestEventMock = vi.hoisted(() =>
  vi.fn(() => ({
    platform: { env: {} },
    cookies: {
      get: vi.fn(() => ({ value: 'session-cookie' })),
      set: vi.fn(),
      delete: vi.fn(),
    },
    // An ORG subdomain — `resolveStudioOrg` reads the org off the host, never
    // off the client payload, so a non-org host would short-circuit to a 400.
    url: new URL('http://of-blood-and-bones.lvh.me:3010/studio/journeys'),
    request: new Request(
      'http://of-blood-and-bones.lvh.me:3010/studio/journeys'
    ),
  }))
);

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    org: { getPublicInfo: getPublicInfoMock },
    access: {
      getJourneyForBuilder: getJourneyForBuilderMock,
      saveJourneyPage: saveJourneyPageMock,
    },
  })),
  serverApiUrl: vi.fn(() => 'http://localhost:4001'),
}));

/**
 * The global `$app/server` mock in `src/tests/mocks.ts` declares
 * `command: (fn) => fn` — a ONE-arg shape, which for `command(schema, handler)`
 * returns the SCHEMA. Overridden here (as checkout.remote.test.ts does) so the
 * handler is what the test calls, with the `__` metadata SvelteKit's remote-export
 * validation looks for attached.
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

/** `query`/`command`/`form` are all called as `(schema, handler)` here. */
const lastArg = (args: unknown[]) => args[args.length - 1] as never;

vi.mock('$app/server', () => ({
  command: vi.fn((...args: unknown[]) => makeRemote('command', lastArg(args))),
  form: vi.fn((...args: unknown[]) => makeRemote('form', lastArg(args))),
  query: vi.fn((...args: unknown[]) => makeRemote('query', lastArg(args))),
  getRequestEvent: getRequestEventMock,
}));

const PAGE_ID = '11111111-1111-4111-8111-111111111111';
const COURSE_ID = '22222222-2222-4222-8222-222222222222';

/** A persisted `JourneyPageRecord` as `getJourneyForBuilder` returns it. */
function storedRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: PAGE_ID,
    // Server-owned, and NOT part of the save body.
    organizationId: '33333333-3333-4333-8333-333333333333',
    publishedAt: null,
    pageType: 'course',
    slug: 'return-to-the-shoreline',
    title: 'Return to the Shoreline',
    status: 'published',
    subjectType: 'course',
    subjectId: COURSE_ID,
    brandOverrides: null,
    sections: [
      { id: 's1', type: 'hero', enabled: true, variant: 'stage', props: {} },
      { id: 's2', type: 'invite', enabled: true, variant: 'pool', props: {} },
    ],
    design: { width: 'narrow', density: 'airy' },
    seo: { title: 'Shoreline', description: 'A long walk' },
    // Pricing's own route owns this. The save body is `.strict()` and rejects it.
    offer: { oneOffEnabled: true, oneOffPriceCents: 3500 },
    ...overrides,
  };
}

async function callSetStatus(input: { pageId: string; status: string }) {
  const { setJourneyStatus } = await import('$lib/remote/journeys.remote');
  return (setJourneyStatus as unknown as (i: unknown) => Promise<void>)(input);
}

describe('setJourneyStatus (portals list lifecycle)', () => {
  beforeEach(() => {
    getJourneyForBuilderMock.mockReset();
    saveJourneyPageMock.mockReset().mockResolvedValue(null);
    getPublicInfoMock
      .mockReset()
      .mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333' });
    getRequestEventMock.mockClear();
  });

  it('writes through saveJourneyPage — the ONLY path that cascades to courses.status', async () => {
    getJourneyForBuilderMock.mockResolvedValueOnce(storedRecord());

    await callSetStatus({ pageId: PAGE_ID, status: 'draft' });

    expect(getJourneyForBuilderMock).toHaveBeenCalledTimes(1);
    expect(saveJourneyPageMock).toHaveBeenCalledTimes(1);
    const [orgId, body] = saveJourneyPageMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    // Scoped by the org resolved from the HOST, never from the caller's payload.
    expect(orgId).toBe('33333333-3333-4333-8333-333333333333');
    expect(body.status).toBe('draft');
  });

  it('does NOT forward `offer`, `organizationId` or `publishedAt` — the .strict() 400 trap', async () => {
    getJourneyForBuilderMock.mockResolvedValueOnce(storedRecord());

    await callSetStatus({ pageId: PAGE_ID, status: 'archived' });

    const body = saveJourneyPageMock.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty('offer');
    expect(body).not.toHaveProperty('organizationId');
    expect(body).not.toHaveProperty('publishedAt');
  });

  it('forwards every other key of the record — a full-record PUT must not erase the page', async () => {
    const record = storedRecord();
    getJourneyForBuilderMock.mockResolvedValueOnce(record);

    await callSetStatus({ pageId: PAGE_ID, status: 'draft' });

    const body = saveJourneyPageMock.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(body).toEqual({
      id: record.id,
      pageType: 'course',
      slug: 'return-to-the-shoreline',
      title: 'Return to the Shoreline',
      status: 'draft',
      subjectType: 'course',
      subjectId: COURSE_ID,
      brandOverrides: null,
      sections: record.sections,
      design: record.design,
      seo: record.seo,
    });
  });

  it('omits `design` / `seo` when the record has none — absent means LEAVE ALONE, not clear', async () => {
    const record = storedRecord();
    delete (record as Record<string, unknown>).design;
    delete (record as Record<string, unknown>).seo;
    getJourneyForBuilderMock.mockResolvedValueOnce(record);

    await callSetStatus({ pageId: PAGE_ID, status: 'draft' });

    const body = saveJourneyPageMock.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    // Not merely `undefined` — the KEY must be absent, or the service reads it as
    // an instruction and wipes the stored bundle.
    expect(Object.keys(body)).not.toContain('design');
    expect(Object.keys(body)).not.toContain('seo');
  });

  it('is a no-op when the stored status already matches', async () => {
    getJourneyForBuilderMock.mockResolvedValueOnce(
      storedRecord({ status: 'published' })
    );

    await callSetStatus({ pageId: PAGE_ID, status: 'published' });

    expect(saveJourneyPageMock).not.toHaveBeenCalled();
  });

  it('404s on a foreign or missing page and writes NOTHING', async () => {
    // The worker is org-scoped, so `null` is "not yours / gone".
    getJourneyForBuilderMock.mockResolvedValueOnce(null);

    await expect(
      callSetStatus({ pageId: PAGE_ID, status: 'draft' })
    ).rejects.toMatchObject({ status: 404 });
    expect(saveJourneyPageMock).not.toHaveBeenCalled();
  });

  it('forwards a 4xx from the save as readable text at body.message', async () => {
    getJourneyForBuilderMock.mockResolvedValueOnce(storedRecord());
    // The realistic 4xx on a pure status change: `cascadeCourseFromPage`'s
    // zero-row guard, which fires when the subject course is soft-deleted or
    // foreign, and which ROLLS THE WHOLE SAVE BACK. The creator has to be told
    // that, not shown a generic failure.
    saveJourneyPageMock.mockRejectedValueOnce(
      new ApiError(404, 'Journey course not found')
    );

    // A SvelteKit `HttpError` keeps its text at `body.message` and has NO
    // top-level `message` — which is why the caller reads it through
    // `queryErrorMessage` rather than `err.message`.
    await expect(
      callSetStatus({ pageId: PAGE_ID, status: 'draft' })
    ).rejects.toMatchObject({
      status: 404,
      body: { message: 'Journey course not found' },
    });
  });

  it('does NOT reword a 5xx — it may carry internals', async () => {
    getJourneyForBuilderMock.mockResolvedValueOnce(storedRecord());
    const boom = new ApiError(500, 'relation "landing_pages" does not exist');
    saveJourneyPageMock.mockRejectedValueOnce(boom);

    await expect(
      callSetStatus({ pageId: PAGE_ID, status: 'draft' })
    ).rejects.toBe(boom);
  });
});

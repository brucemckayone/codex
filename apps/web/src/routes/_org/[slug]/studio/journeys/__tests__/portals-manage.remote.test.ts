// @vitest-environment node

/**
 * `duplicateJourney` + `deleteJourney` — the portals list's two EXISTENCE writes
 * (Codex-c3lky · WP-Q). Sibling of `portals-lifecycle.remote.test.ts`, and set up
 * the same way for the same reasons (see its header on why `@sveltejs/kit` is
 * deliberately NOT mocked and why `$app/server` has to be re-mocked here).
 *
 * WHAT IS PINNED, AND WHY EACH ONE IS SILENT WHEN IT BREAKS:
 *
 *  1. THE ORG COMES FROM THE HOST, never the payload. Both commands take only a
 *     `pageId`; the org is resolved from the request hostname by
 *     `resolveStudioOrg`. A refactor that accepted an `organizationId` input and
 *     forwarded it would be a cross-tenant write that no test failure announces
 *     (the worker's `requireOrgManagement` would still 403 — but only if the
 *     caller is not a manager of the named org, and a manager of two orgs is).
 *  2. OFF AN ORG HOST BOTH MUST 400 AND WRITE NOTHING. `resolveStudioOrg`
 *     returns null on a platform host, and an unguarded `ctx.api` would throw a
 *     TypeError the studio renders as a blank failure.
 *  3. 4xx TEXT MUST REACH THE CALLER. For delete this is the whole product:
 *     the 409 "Unpublish this portal before deleting it …" is the one sentence
 *     that tells a creator what to do next. Swallowed, the button just fails.
 *  4. 5xx MUST NOT BE REWORDED — it may carry internals (a raw SQL string was
 *     the observed case), so it propagates untouched rather than through
 *     `error()`.
 *  5. DUPLICATE RETURNS THE SERVER'S RECORD unchanged. The title and slug are
 *     DERIVED server-side (the org slug-space spans `landing_pages` AND
 *     `courses`), so a client that invented either would collide on insert; the
 *     command must pass the server's answer straight through for the toast to
 *     name what was actually made.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

const duplicateJourneyMock = vi.hoisted(() => vi.fn());
const deleteJourneyMock = vi.hoisted(() => vi.fn());
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
    url: new URL(hostRef.url),
    request: new Request(hostRef.url),
  }))
);

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    org: { getPublicInfo: getPublicInfoMock },
    access: {
      duplicateJourney: duplicateJourneyMock,
      deleteJourney: deleteJourneyMock,
    },
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

const PAGE_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '33333333-3333-4333-8333-333333333333';

async function callDuplicate(pageId: string) {
  const { duplicateJourney } = await import('$lib/remote/journeys.remote');
  return (
    duplicateJourney as unknown as (i: unknown) => Promise<{
      id: string;
      slug: string;
      title: string;
    }>
  )({ pageId });
}

async function callDelete(pageId: string) {
  const { deleteJourney } = await import('$lib/remote/journeys.remote');
  return (deleteJourney as unknown as (i: unknown) => Promise<void>)({
    pageId,
  });
}

beforeEach(() => {
  hostRef.url = 'http://of-blood-and-bones.lvh.me:3010/studio/journeys';
  duplicateJourneyMock.mockReset().mockResolvedValue({
    id: '44444444-4444-4444-8444-444444444444',
    slug: 'bone-deep-copy',
    title: 'Bone Deep (copy)',
  });
  deleteJourneyMock.mockReset().mockResolvedValue(null);
  getPublicInfoMock.mockReset().mockResolvedValue({ id: ORG_ID });
  getRequestEventMock.mockClear();
});

describe('duplicateJourney', () => {
  it('scopes to the org resolved from the HOST and passes the page id through', async () => {
    await callDuplicate(PAGE_ID);

    expect(duplicateJourneyMock).toHaveBeenCalledTimes(1);
    expect(duplicateJourneyMock).toHaveBeenCalledWith(ORG_ID, PAGE_ID);
  });

  it('returns the SERVER-derived title and slug untouched', async () => {
    // The client never invents either: the org slug-space spans `landing_pages`
    // AND `courses`, so only the service can pick a free one inside the insert's
    // transaction, and the toast has to name what was actually created.
    duplicateJourneyMock.mockResolvedValueOnce({
      id: '55555555-5555-4555-8555-555555555555',
      slug: 'bone-deep-copy-3',
      title: 'Bone Deep (copy)',
    });

    await expect(callDuplicate(PAGE_ID)).resolves.toEqual({
      id: '55555555-5555-4555-8555-555555555555',
      slug: 'bone-deep-copy-3',
      title: 'Bone Deep (copy)',
    });
  });

  it('400s off a non-org host and writes NOTHING', async () => {
    hostRef.url = 'http://lvh.me:3010/studio/journeys';

    await expect(callDuplicate(PAGE_ID)).rejects.toMatchObject({ status: 400 });
    expect(duplicateJourneyMock).not.toHaveBeenCalled();
  });

  it('forwards a 4xx as readable text at body.message', async () => {
    // The realistic 4xx: the service's slug-exhaustion `ConflictError`, whose
    // text tells the creator to try a different title.
    duplicateJourneyMock.mockRejectedValueOnce(
      new ApiError(
        409,
        'Could not find an available slug for this title — try a different title'
      )
    );

    await expect(callDuplicate(PAGE_ID)).rejects.toMatchObject({
      status: 409,
      body: {
        message:
          'Could not find an available slug for this title — try a different title',
      },
    });
  });

  it('does NOT reword a 5xx — it may carry internals', async () => {
    const boom = new ApiError(500, 'relation "landing_pages" does not exist');
    duplicateJourneyMock.mockRejectedValueOnce(boom);

    await expect(callDuplicate(PAGE_ID)).rejects.toBe(boom);
  });
});

describe('deleteJourney', () => {
  it('scopes to the org resolved from the HOST and passes the page id through', async () => {
    await callDelete(PAGE_ID);

    expect(deleteJourneyMock).toHaveBeenCalledTimes(1);
    expect(deleteJourneyMock).toHaveBeenCalledWith(ORG_ID, PAGE_ID);
  });

  it('400s off a non-org host and writes NOTHING', async () => {
    hostRef.url = 'http://lvh.me:3010/studio/journeys';

    await expect(callDelete(PAGE_ID)).rejects.toMatchObject({ status: 400 });
    expect(deleteJourneyMock).not.toHaveBeenCalled();
  });

  it("forwards the published-page 409 verbatim — it is the creator's next step", async () => {
    deleteJourneyMock.mockRejectedValueOnce(
      new ApiError(
        409,
        'Unpublish this portal before deleting it — while it is published its course stays live everywhere else'
      )
    );

    await expect(callDelete(PAGE_ID)).rejects.toMatchObject({
      status: 409,
      body: {
        message:
          'Unpublish this portal before deleting it — while it is published its course stays live everywhere else',
      },
    });
  });

  it('forwards a 404 for a foreign or already-deleted page', async () => {
    deleteJourneyMock.mockRejectedValueOnce(
      new ApiError(404, 'Journey page not found')
    );

    await expect(callDelete(PAGE_ID)).rejects.toMatchObject({
      status: 404,
      body: { message: 'Journey page not found' },
    });
  });

  it('does NOT reword a 5xx', async () => {
    const boom = new ApiError(500, 'deadlock detected');
    deleteJourneyMock.mockRejectedValueOnce(boom);

    await expect(callDelete(PAGE_ID)).rejects.toBe(boom);
  });
});

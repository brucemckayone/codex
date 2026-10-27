// @vitest-environment node

/**
 * `grantContentAccess` forwards a refused grant's 4xx (Codex-2hxff.21).
 *
 * The admin route refuses content a grant cannot open with a 422 whose
 * message is written for the person granting. Let the `ApiError` escape and
 * `handleError` turns it into a 500 "An unexpected error occurred" in
 * production, so the dialog could never say why. Asserting the STATUS as well
 * as the text is the half that fails on a bare throw (a propagated `ApiError`
 * is a 500). A 5xx must still propagate untouched for `handleError` to
 * sanitise.
 *
 * Set up like `journey-remote-4xx-forwarding.test.ts`: `@sveltejs/kit` is NOT
 * mocked, because the real `error()` (an `HttpError` with its text at
 * `body.message`) is the subject.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

const grantMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({ admin: { grantContentAccess: grantMock } })),
  serverApiUrl: vi.fn(() => 'http://localhost:42073'),
}));

// The global `$app/server` mock is one-arg; these remotes are (schema, fn).
// Kit's remote-module check wants every export tagged with `__`.
const makeRemote = (type: string, fn: (...args: unknown[]) => unknown) =>
  Object.assign((...args: unknown[]) => fn(...args), {
    __: { type, id: '', name: '' },
  });
const lastArg = (args: unknown[]) =>
  args[args.length - 1] as (...args: unknown[]) => unknown;
vi.mock('$app/server', () => ({
  command: vi.fn((...args: unknown[]) => makeRemote('command', lastArg(args))),
  form: vi.fn((...args: unknown[]) => makeRemote('form', lastArg(args))),
  query: vi.fn((...args: unknown[]) => makeRemote('query', lastArg(args))),
  getRequestEvent: vi.fn(() => ({
    platform: { env: {} },
    cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  })),
}));

const { grantContentAccess } = (await import('./admin.remote')) as unknown as {
  grantContentAccess: (input: {
    customerId: string;
    contentId: string;
    organizationId: string;
  }) => Promise<unknown>;
};

const INPUT = {
  customerId: 'ellie',
  contentId: '22222222-2222-4222-8222-222222222222',
  organizationId: '33333333-3333-4333-8333-333333333333',
};
const REFUSAL =
  "This item can't be granted: a grant only opens paid or subscriber content.";

beforeEach(() => {
  grantMock.mockReset();
});

describe('grantContentAccess', () => {
  it('forwards the 422 refusal as a 422 whose text and code are at body', async () => {
    grantMock.mockRejectedValue(
      new ApiError(422, REFUSAL, 'BUSINESS_LOGIC_ERROR', {
        contentId: INPUT.contentId,
      })
    );

    await expect(grantContentAccess(INPUT)).rejects.toMatchObject({
      status: 422,
      body: { message: REFUSAL, code: 'BUSINESS_LOGIC_ERROR' },
    });
  });

  it('does NOT reword a 5xx: it propagates for handleError to sanitise', async () => {
    const boom = new ApiError(500, 'relation "entitlements" does not exist');
    grantMock.mockRejectedValue(boom);

    await expect(grantContentAccess(INPUT)).rejects.toBe(boom);
  });

  it('passes the organisation through and returns the worker result', async () => {
    grantMock.mockResolvedValue({ success: true });

    await expect(grantContentAccess(INPUT)).resolves.toEqual({ success: true });
    const [customerId, contentId, params] = grantMock.mock.calls[0];
    expect([customerId, contentId]).toEqual([
      INPUT.customerId,
      INPUT.contentId,
    ]);
    expect((params as URLSearchParams).get('organizationId')).toBe(
      INPUT.organizationId
    );
  });
});

// @vitest-environment node

/**
 * openBillingPortal: the caller sends the browser to the URL it returns, so it
 * is checked as `portalSessionForm` checks it — a Stripe page only
 * (Codex-2hxff.22 WEB-06). Anything else is refused and logged by host.
 *
 * Harness as in `checkout.remote.test.ts`: `$app/server` is mocked so the
 * remote function's inner body runs directly.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createPortalSessionMock, errorMock, loggerErrorMock } = vi.hoisted(
  () => ({
    createPortalSessionMock: vi.fn(),
    errorMock: vi.fn((status: number, message: string) => {
      throw Object.assign(new Error(message), { status });
    }),
    loggerErrorMock: vi.fn(),
  })
);

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    checkout: { createPortalSession: createPortalSessionMock },
  })),
}));

vi.mock('$lib/observability', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn() },
}));

const makeRemote = <T extends (...args: never[]) => unknown>(
  type: 'form' | 'command' | 'query',
  fn: T
) => {
  const wrapped: T & { __: { type: string; id: string; name: string } } = ((
    ...args: unknown[]
  ) => fn(...(args as Parameters<T>))) as T & {
    __: { type: string; id: string; name: string };
  };
  wrapped.__ = { type, id: '', name: '' };
  return wrapped;
};

vi.mock('$app/server', () => ({
  command: vi.fn((_schema, fn) => makeRemote('command', fn)),
  form: vi.fn((_schema, fn) => makeRemote('form', fn)),
  query: vi.fn((...args: unknown[]) =>
    makeRemote('query', args[args.length - 1] as () => unknown)
  ),
  getRequestEvent: vi.fn(() => ({
    platform: { env: {} },
    cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    url: new URL('https://revelations.studio/account/subscriptions'),
  })),
}));

vi.mock('@sveltejs/kit', () => ({
  error: errorMock,
  invalid: vi.fn(),
  isRedirect: vi.fn(() => false),
  redirect: vi.fn(),
}));

type OpenBillingPortal = (input: { returnUrl: string }) => Promise<{
  url: string;
}>;

describe('openBillingPortal (WEB-06)', () => {
  beforeEach(() => {
    createPortalSessionMock.mockReset();
    errorMock.mockClear();
    loggerErrorMock.mockClear();
  });

  it('returns a Stripe portal URL', async () => {
    createPortalSessionMock.mockResolvedValueOnce({
      url: 'https://billing.stripe.com/p/session/test_abc',
    });
    const { openBillingPortal } = await import('./account.remote');

    await expect(
      (openBillingPortal as unknown as OpenBillingPortal)({
        returnUrl: 'https://revelations.studio/account/subscriptions',
      })
    ).resolves.toEqual({
      url: 'https://billing.stripe.com/p/session/test_abc',
    });
    expect(errorMock).not.toHaveBeenCalled();
  });

  it.each([
    'https://evil.example/stripe.com',
    'https://billing.stripe.com.evil.example/p',
    'not a url',
  ])('refuses %s, and logs its host only', async (url) => {
    createPortalSessionMock.mockResolvedValueOnce({ url });
    const { openBillingPortal } = await import('./account.remote');

    await expect(
      (openBillingPortal as unknown as OpenBillingPortal)({
        returnUrl: 'https://revelations.studio/account/subscriptions',
      })
    ).rejects.toMatchObject({ status: 502 });
    expect(errorMock).toHaveBeenCalledWith(502, 'Invalid billing portal URL');
    expect(loggerErrorMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('/p');
  });
});

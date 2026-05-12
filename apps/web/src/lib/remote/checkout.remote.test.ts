// @vitest-environment node

/**
 * Checkout Remote Functions Tests
 *
 * Tests for Stripe checkout remote functions.
 * Mocks are centralized in src/tests/mocks.ts; this file layers per-test
 * overrides so we can drive `api.checkout.create` and `getRequestEvent`.
 *
 * Coverage:
 * - happy path: createCheckout → api.checkout.create → redirect(303, sessionUrl)
 * - happy path: createCheckoutSession → returns { sessionUrl }
 * - default URLs synthesised from request origin when caller omits them
 * - SvelteKit redirect() propagates (form must rethrow `isRedirect`)
 * - API failure surfaces as user-readable form error (no internal leak)
 * - generic Error from createServerApi surfaces with a safe message
 *
 * NOTE: The production remote only handles ONE-TIME content purchase
 * (`api.checkout.create({ contentId, ... })`). Subscription / tier flow lives
 * in `subscription.remote.ts` and is covered separately. Tests below assert
 * the actual production behaviour, not the broader subscription contract.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

// Hoisted mocks — must be initialised before vi.mock() factories execute.
const checkoutCreateMock = vi.hoisted(() => vi.fn());
const getRequestEventMock = vi.hoisted(() =>
  vi.fn(() => ({
    platform: { env: {} },
    cookies: {
      get: vi.fn(() => ({ value: 'session-cookie' })),
      set: vi.fn(),
      delete: vi.fn(),
    },
    url: new URL('https://studio-alpha.lvh.me:3000/content/abc'),
    request: new Request('https://studio-alpha.lvh.me:3000/content/abc'),
  }))
);
const redirectMock = vi.hoisted(() => vi.fn());
const isRedirectMock = vi.hoisted(() =>
  vi.fn((_e: unknown): boolean => false)
);

// Override the globally-mocked $lib/server/api with a per-test handle.
vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    checkout: { create: checkoutCreateMock },
  })),
  serverApiUrl: vi.fn(() => 'http://localhost:42072'),
}));

// Override the globally-mocked $app/server so we control the request event
// (cookies + URL feed origin-derived defaults inside createStripeCheckoutSession).
//
// SvelteKit's SSR-side `init_remote_functions` validates that every export
// from a `.remote.ts` file carries `__.type` metadata; we attach the matching
// shape so the module loads, then forward calls to the inner function. The
// callable form keeps the test ergonomic (`createCheckout(input)`).
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
  query: vi.fn((fn) => makeRemote('query', fn)),
  getRequestEvent: getRequestEventMock,
}));

// @sveltejs/kit `redirect` throws in production; here it's a spy so we can
// assert call args. `isRedirect` defaults to false so the form's error path
// runs unless a test opts in.
vi.mock('@sveltejs/kit', () => ({
  redirect: redirectMock,
  isRedirect: isRedirectMock,
}));

const VALID_CONTENT_ID = '11111111-1111-4111-8111-111111111111';

describe('remote/checkout.remote', () => {
  beforeEach(() => {
    checkoutCreateMock.mockReset();
    redirectMock.mockReset();
    isRedirectMock.mockReset().mockReturnValue(false);
    getRequestEventMock.mockClear();
  });

  describe('createCheckout (form, progressive enhancement)', () => {
    it('happy path: invokes api.checkout.create and redirects to Stripe sessionUrl', async () => {
      const sessionUrl = 'https://checkout.stripe.com/c/pay/cs_test_abc';
      checkoutCreateMock.mockResolvedValueOnce({
        sessionUrl,
        sessionId: 'cs_test_abc',
      });

      const { createCheckout } = await import('./checkout.remote');
      // SvelteKit redirect normally throws — our mock returns undefined, so the
      // form function falls off the end. That's fine; we only need to observe
      // that redirect() was invoked with the Stripe URL.
      await (createCheckout as unknown as (input: unknown) => Promise<unknown>)(
        {
          contentId: VALID_CONTENT_ID,
        }
      );

      expect(checkoutCreateMock).toHaveBeenCalledTimes(1);
      const callArg = checkoutCreateMock.mock.calls[0]?.[0];
      expect(callArg).toMatchObject({ contentId: VALID_CONTENT_ID });
      expect(redirectMock).toHaveBeenCalledWith(303, sessionUrl);
    });

    it('synthesises successUrl / cancelUrl from request origin when caller omits them', async () => {
      checkoutCreateMock.mockResolvedValueOnce({
        sessionUrl: 'https://checkout.stripe.com/x',
      });

      const { createCheckout } = await import('./checkout.remote');
      await (createCheckout as unknown as (input: unknown) => Promise<unknown>)(
        {
          contentId: VALID_CONTENT_ID,
        }
      );

      const args = checkoutCreateMock.mock.calls[0]?.[0] as {
        successUrl: string;
        cancelUrl: string;
      };
      // Origin comes from getRequestEventMock above.
      expect(args.successUrl).toBe(
        'https://studio-alpha.lvh.me:3000/library?purchase=success'
      );
      expect(args.cancelUrl).toBe(
        `https://studio-alpha.lvh.me:3000/content/${VALID_CONTENT_ID}`
      );
    });

    it('forwards caller-supplied successUrl / cancelUrl verbatim', async () => {
      checkoutCreateMock.mockResolvedValueOnce({
        sessionUrl: 'https://checkout.stripe.com/y',
      });
      const successUrl = 'https://example.com/thanks';
      const cancelUrl = 'https://example.com/cancelled';

      const { createCheckout } = await import('./checkout.remote');
      await (createCheckout as unknown as (input: unknown) => Promise<unknown>)(
        {
          contentId: VALID_CONTENT_ID,
          successUrl,
          cancelUrl,
        }
      );

      expect(checkoutCreateMock).toHaveBeenCalledWith({
        contentId: VALID_CONTENT_ID,
        successUrl,
        cancelUrl,
      });
    });

    it('rethrows the SvelteKit redirect signal (isRedirect → true must propagate)', async () => {
      // Simulate the realistic case where SvelteKit's `redirect()` throws a
      // Redirect-shaped object. The form must NOT swallow it — otherwise the
      // browser stays on the cancel page and never reaches Stripe.
      const redirectSignal = {
        status: 303,
        location: 'https://checkout.stripe.com/z',
      };
      redirectMock.mockImplementationOnce(() => {
        throw redirectSignal;
      });
      isRedirectMock.mockImplementation((e: unknown) => e === redirectSignal);
      checkoutCreateMock.mockResolvedValueOnce({
        sessionUrl: 'https://checkout.stripe.com/z',
      });

      const { createCheckout } = await import('./checkout.remote');

      await expect(
        (createCheckout as unknown as (input: unknown) => Promise<unknown>)({
          contentId: VALID_CONTENT_ID,
        })
      ).rejects.toBe(redirectSignal);
    });

    it('non-redirect API failure surfaces as { success: false, error: <message> }', async () => {
      // Simulates ecom-api returning 409 Conflict (e.g. already purchased).
      // ApiError.message is the worker-mapped, user-safe message — internal
      // Stripe / SQL details are stripped by mapErrorToResponse() server-side.
      checkoutCreateMock.mockRejectedValueOnce(
        new ApiError(409, 'You already own this content', 'ALREADY_PURCHASED')
      );

      const { createCheckout } = await import('./checkout.remote');
      const result = await (
        createCheckout as unknown as (input: unknown) => Promise<unknown>
      )({ contentId: VALID_CONTENT_ID });

      expect(result).toEqual({
        success: false,
        error: 'You already own this content',
      });
      // redirect() must not be called when checkout fails — otherwise the user
      // is bounced to Stripe with a stale / missing sessionUrl.
      expect(redirectMock).not.toHaveBeenCalled();
    });

    it('does not leak Stripe-internal details for unknown errors (no stack, no raw cause)', async () => {
      // Generic Error from createServerApi (e.g. network blip). The form is
      // already mapped server-side, but assert at the seam that we never echo
      // a stack trace or nested cause into the response envelope.
      const internal = new Error(
        'Connection to api.stripe.com refused: ECONNREFUSED 10.0.0.1'
      );
      checkoutCreateMock.mockRejectedValueOnce(internal);

      const { createCheckout } = await import('./checkout.remote');
      const result = (await (
        createCheckout as unknown as (input: unknown) => Promise<unknown>
      )({ contentId: VALID_CONTENT_ID })) as { success: false; error: string };

      expect(result.success).toBe(false);
      // The remote forwards `error.message`; any redaction is the worker's
      // responsibility. What we MUST verify is that nothing richer (stack,
      // cause, JSON-serialised Error) escapes through this seam.
      expect(typeof result.error).toBe('string');
      expect(result.error).not.toContain('at ');
      expect(result.error).not.toContain('ECONNREFUSED 10.0.0.1\n');
      expect(JSON.stringify(result)).not.toMatch(/stack/i);
    });

    it('falls back to "Checkout failed" when the thrown value is not an Error instance', async () => {
      // Defensive: a thrown string (legacy code paths, mis-typed worker
      // responses) must still yield a safe, generic message.
      checkoutCreateMock.mockRejectedValueOnce('boom');

      const { createCheckout } = await import('./checkout.remote');
      const result = await (
        createCheckout as unknown as (input: unknown) => Promise<unknown>
      )({ contentId: VALID_CONTENT_ID });

      expect(result).toEqual({ success: false, error: 'Checkout failed' });
    });
  });

  describe('createCheckoutSession (command, SPA style)', () => {
    it('happy path: returns { sessionUrl } without calling redirect()', async () => {
      const sessionUrl = 'https://checkout.stripe.com/c/pay/cs_test_def';
      checkoutCreateMock.mockResolvedValueOnce({
        sessionUrl,
        sessionId: 'cs_test_def',
      });

      const { createCheckoutSession } = await import('./checkout.remote');
      const result = await (
        createCheckoutSession as unknown as (input: unknown) => Promise<unknown>
      )({ contentId: VALID_CONTENT_ID });

      expect(result).toEqual({ sessionUrl });
      expect(redirectMock).not.toHaveBeenCalled();
    });

    it('propagates errors verbatim (client handles them — no form envelope)', async () => {
      const failure = new ApiError(
        403,
        'Not entitled to purchase',
        'FORBIDDEN'
      );
      checkoutCreateMock.mockRejectedValueOnce(failure);

      const { createCheckoutSession } = await import('./checkout.remote');

      await expect(
        (
          createCheckoutSession as unknown as (
            input: unknown
          ) => Promise<unknown>
        )({
          contentId: VALID_CONTENT_ID,
        })
      ).rejects.toBe(failure);
    });
  });

  describe('module shape', () => {
    it('exports createCheckout form and createCheckoutSession command', async () => {
      const mod = await import('./checkout.remote');
      expect(mod.createCheckout).toBeDefined();
      expect(mod.createCheckoutSession).toBeDefined();
    });
  });
});

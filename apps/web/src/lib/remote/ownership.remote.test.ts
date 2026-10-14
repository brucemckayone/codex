// @vitest-environment node

/**
 * Ownership transfer remote functions (Codex-2hxff.2).
 *
 * Unlike the agreements smoke test, these exercise the handlers, because three
 * things here are easy to get silently wrong:
 *
 *   1. DISPATCH — each command reaches its own route with (orgId, offerId), and
 *      the offer sends exactly `{ recipientUserId, confirmName }`.
 *   2. REFRESH — every successful command re-runs BOTH `getOwnership` and
 *      `getMyMembership` (single-flight), a failed one re-runs neither, and a
 *      failed refresh never fails a mutation that already committed.
 *   3. ERROR CODES SURVIVE — a worker 4xx becomes an `HttpError` that keeps its
 *      `code` (the card maps codes to copy); a 5xx is rethrown untouched so
 *      `handleError` sanitises it.
 *
 * `$app/server` is stubbed as in `journey-checkout.remote.test.ts`, plus the
 * schema each remote was declared with, so the local input validation is
 * assertable too. `org.remote` is mocked whole: only its `getMyMembership`
 * refresh matters here.
 */

import { isHttpError } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

const ORG_ID = 'ddea4b84-64d1-451c-a8f5-4c28956e5fb2';
const OFFER_ID = '7c1e2b9a-4f3d-4c8e-9a61-2d5b8e0f1a37';
// A BetterAuth nanoid, deliberately not a UUID.
const RECIPIENT_ID = 'GV762T8n0fCnqy3qxRvoMjJZ7hTTd44b';

const ownershipApi = vi.hoisted(() => ({
  get: vi.fn(),
  offer: vi.fn(),
  withdraw: vi.fn(),
  accept: vi.fn(),
  decline: vi.fn(),
}));
const ownershipRefresh = vi.hoisted(() => vi.fn(async () => {}));
const membershipRefresh = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({ ownership: ownershipApi })),
  serverApiUrl: vi.fn(() => 'http://localhost:42071'),
}));

vi.mock('./org.remote', () => ({
  getMyMembership: vi.fn(() => ({ refresh: membershipRefresh })),
}));

type Schema = { safeParse: (value: unknown) => { success: boolean } };
type Remote = ((arg: unknown) => unknown) & {
  __: { type: string; id: string; name: string };
  schema: Schema;
};

vi.mock('$app/server', () => {
  const meta = (type: string) => ({ type, id: '', name: '' });
  return {
    // A query call is a lazy thenable carrying `.refresh()`, like kit's.
    query: vi.fn((schema: Schema, fn: (arg: unknown) => unknown) => {
      const wrapped = ((arg: unknown) => ({
        // biome-ignore lint/suspicious/noThenProperty: mirrors kit's thenable query object
        then: (
          resolve: (value: unknown) => unknown,
          reject: (reason: unknown) => unknown
        ) =>
          Promise.resolve()
            .then(() => fn(arg))
            .then(resolve, reject),
        refresh: ownershipRefresh,
      })) as Remote;
      wrapped.__ = meta('query');
      wrapped.schema = schema;
      return wrapped;
    }),
    command: vi.fn((schema: Schema, fn: (arg: unknown) => unknown) => {
      const wrapped = ((arg: unknown) => fn(arg)) as Remote;
      wrapped.__ = meta('command');
      wrapped.schema = schema;
      return wrapped;
    }),
    getRequestEvent: vi.fn(() => ({
      platform: { env: {} },
      cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    })),
  };
});

async function load() {
  const mod = await import('./ownership.remote');
  return mod as unknown as Record<
    | 'getOwnership'
    | 'offerOwnership'
    | 'withdrawOwnershipOffer'
    | 'acceptOwnershipOffer'
    | 'declineOwnershipOffer',
    Remote
  >;
}

/** What a remote call rejected with. Fails the test if it resolves instead. */
async function rejectionOf(call: unknown): Promise<unknown> {
  try {
    await call;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to reject');
}

/** Narrow to kit's `HttpError`, failing the test if it is anything else. */
function asHttpError(error: unknown) {
  if (!isHttpError(error)) {
    throw new Error(`expected an HttpError, got ${String(error)}`);
  }
  return error;
}

describe('remote/ownership.remote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ownershipRefresh.mockImplementation(async () => {});
    membershipRefresh.mockImplementation(async () => {});
  });

  describe('getOwnership', () => {
    it('reads the view for the organisation', async () => {
      const { getOwnership } = await load();
      const view = { viewerRole: 'owner' };
      ownershipApi.get.mockResolvedValue(view);

      await expect(getOwnership(ORG_ID)).resolves.toBe(view);
      expect(ownershipApi.get).toHaveBeenCalledWith(ORG_ID);
    });

    it('forwards a 403 with its code, so the card can render a real error', async () => {
      const { getOwnership } = await load();
      ownershipApi.get.mockRejectedValue(
        new ApiError(403, 'Not allowed', 'FORBIDDEN')
      );

      const error = asHttpError(await rejectionOf(getOwnership(ORG_ID)));
      expect(error.status).toBe(403);
      expect(error.body).toEqual({ message: 'Not allowed', code: 'FORBIDDEN' });
    });

    it('rethrows a 5xx untouched (handleError sanitises it)', async () => {
      const { getOwnership } = await load();
      const boom = new ApiError(500, 'relation "x" does not exist', 'INTERNAL');
      ownershipApi.get.mockRejectedValue(boom);

      const error = await rejectionOf(getOwnership(ORG_ID));
      expect(error).toBe(boom);
      expect(isHttpError(error)).toBe(false);
    });
  });

  describe('offerOwnership', () => {
    it('sends exactly the recipient and the typed name', async () => {
      const { offerOwnership } = await load();
      ownershipApi.offer.mockResolvedValue({ id: OFFER_ID, status: 'open' });

      await offerOwnership({
        organizationId: ORG_ID,
        recipientUserId: RECIPIENT_ID,
        confirmName: 'studio alpha',
      });

      expect(ownershipApi.offer).toHaveBeenCalledWith(ORG_ID, {
        recipientUserId: RECIPIENT_ID,
        confirmName: 'studio alpha',
      });
    });

    it('validates input locally: a nanoid recipient passes, an empty name does not', async () => {
      const { offerOwnership } = await load();
      const valid = {
        organizationId: ORG_ID,
        recipientUserId: RECIPIENT_ID,
        confirmName: 'Studio Alpha',
      };
      expect(offerOwnership.schema.safeParse(valid).success).toBe(true);
      expect(
        offerOwnership.schema.safeParse({ ...valid, confirmName: '   ' })
          .success
      ).toBe(false);
      expect(
        offerOwnership.schema.safeParse({ ...valid, recipientUserId: '' })
          .success
      ).toBe(false);
      expect(
        offerOwnership.schema.safeParse({
          ...valid,
          organizationId: 'studio-alpha',
        }).success
      ).toBe(false);
    });

    it('forwards a 409 CONFLICT (an offer is already open) and refreshes nothing', async () => {
      const { offerOwnership } = await load();
      ownershipApi.offer.mockRejectedValue(
        new ApiError(409, 'An offer is already open', 'CONFLICT')
      );

      const error = asHttpError(
        await rejectionOf(
          offerOwnership({
            organizationId: ORG_ID,
            recipientUserId: RECIPIENT_ID,
            confirmName: 'Studio Alpha',
          })
        )
      );

      expect(error.body.code).toBe('CONFLICT');
      expect(ownershipRefresh).not.toHaveBeenCalled();
      expect(membershipRefresh).not.toHaveBeenCalled();
    });
  });

  describe.each([
    ['withdrawOwnershipOffer', 'withdraw'],
    ['acceptOwnershipOffer', 'accept'],
    ['declineOwnershipOffer', 'decline'],
  ] as const)('%s', (exportName, method) => {
    it(`calls ownership.${method}(orgId, offerId) and refreshes both reads`, async () => {
      const remotes = await load();
      const result = { ok: method };
      ownershipApi[method].mockResolvedValue(result);

      await expect(
        remotes[exportName]({ organizationId: ORG_ID, offerId: OFFER_ID })
      ).resolves.toBe(result);

      expect(ownershipApi[method]).toHaveBeenCalledWith(ORG_ID, OFFER_ID);
      expect(ownershipRefresh).toHaveBeenCalledTimes(1);
      expect(membershipRefresh).toHaveBeenCalledTimes(1);
    });

    it('forwards OWNERSHIP_OFFER_NOT_OPEN with its code and refreshes nothing', async () => {
      const remotes = await load();
      ownershipApi[method].mockRejectedValue(
        new ApiError(409, 'Offer is not open', 'OWNERSHIP_OFFER_NOT_OPEN')
      );

      const error = asHttpError(
        await rejectionOf(
          remotes[exportName]({ organizationId: ORG_ID, offerId: OFFER_ID })
        )
      );

      expect(error.status).toBe(409);
      expect(error.body.code).toBe('OWNERSHIP_OFFER_NOT_OPEN');
      expect(ownershipRefresh).not.toHaveBeenCalled();
      expect(membershipRefresh).not.toHaveBeenCalled();
    });

    it('requires a UUID offer id', async () => {
      const remotes = await load();
      expect(
        remotes[exportName].schema.safeParse({
          organizationId: ORG_ID,
          offerId: 'not-a-uuid',
        }).success
      ).toBe(false);
    });
  });

  it('a failed refresh does not fail an accept that already committed', async () => {
    const { acceptOwnershipOffer } = await load();
    const accepted = {
      ownerUserId: RECIPIENT_ID,
      ownerSince: '2026-10-14T10:00:00.000Z',
      previousOwnerUserId: 'oldOwner123',
    };
    ownershipApi.accept.mockResolvedValue(accepted);
    membershipRefresh.mockRejectedValue(new Error('KV down'));

    await expect(
      acceptOwnershipOffer({ organizationId: ORG_ID, offerId: OFFER_ID })
    ).resolves.toBe(accepted);
    expect(ownershipRefresh).toHaveBeenCalledTimes(1);
  });
});

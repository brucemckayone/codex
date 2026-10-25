// @vitest-environment node

/**
 * Support remote functions (Codex-2hxff.28).
 *
 * - Commands ANSWER a refusal, and carry the support error's own code from
 *   `details.code` beside the class code: `CHARGE_CHANGED` under
 *   `PRECONDITION_FAILED`, `STRIPE_REFUSED` under `BUSINESS_LOGIC_ERROR`.
 *   Switching on the top-level code alone could not tell them apart.
 * - Queries forward a 4xx with its status and code (a 404 is "no record of
 *   this charge"); a 5xx propagates for `handleError` to sanitise.
 * - The preview's `refundCount` keys the query only; it is never sent.
 *
 * Set up like `admin-grant-forwarding.test.ts`: `@sveltejs/kit` is real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

const api = vi.hoisted(() => ({
  searchCharges: vi.fn(),
  getCharge: vi.fn(),
  previewRefund: vi.fn(),
  issueRefund: vi.fn(),
  getQueueCounts: vi.fn(),
  listFailedRefunds: vi.fn(),
  listCreatorDebts: vi.fn(),
  resolveFailedRefund: vi.fn(),
  resolveCreatorDebt: vi.fn(),
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({ support: api })),
  serverApiUrl: vi.fn(() => 'http://localhost:42073'),
}));

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

type Fn = (input?: unknown) => Promise<unknown>;
const remote = (await import('./support.remote')) as unknown as Record<
  string,
  Fn
>;

const CHARGE = 'ch_3QeT8xLk2vRb09aZ';
const REFUND_INPUT = {
  chargeId: CHARGE,
  amountCents: 750,
  reason: 'requested_by_customer',
  expectedRefundCount: 1,
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('issueSupportRefund', () => {
  it('answers a made refund, sending the body without the charge id', async () => {
    const result = {
      refund: {
        id: 're_1',
        amountCents: 750,
        status: 'succeeded',
        createdAt: 'x',
      },
      replayed: false,
    };
    api.issueRefund.mockResolvedValue(result);
    await expect(remote.issueSupportRefund(REFUND_INPUT)).resolves.toEqual({
      outcome: 'done',
      result,
    });
    expect(api.issueRefund).toHaveBeenCalledWith(CHARGE, {
      amountCents: 750,
      reason: 'requested_by_customer',
      expectedRefundCount: 1,
    });
  });

  it('answers CHARGE_CHANGED from details.code, under the class code', async () => {
    api.issueRefund.mockRejectedValue(
      new ApiError(
        412,
        'This payment changed since it was loaded.',
        'PRECONDITION_FAILED',
        {
          code: 'CHARGE_CHANGED',
          refundCount: 2,
        }
      )
    );
    await expect(
      remote.issueSupportRefund(REFUND_INPUT)
    ).resolves.toMatchObject({
      outcome: 'failed',
      status: 412,
      code: 'PRECONDITION_FAILED',
      detailsCode: 'CHARGE_CHANGED',
      refundCount: 2,
    });
  });

  it('answers STRIPE_REFUSED with Stripe’s code', async () => {
    api.issueRefund.mockRejectedValue(
      new ApiError(422, 'Stripe refused the refund.', 'BUSINESS_LOGIC_ERROR', {
        code: 'STRIPE_REFUSED',
        stripeCode: 'charge_disputed',
      })
    );
    await expect(
      remote.issueSupportRefund(REFUND_INPUT)
    ).resolves.toMatchObject({
      detailsCode: 'STRIPE_REFUSED',
      stripeCode: 'charge_disputed',
    });
  });

  it('keeps a 5xx’s text out of the answer', async () => {
    api.issueRefund.mockRejectedValue(
      new ApiError(500, 'connect ECONNREFUSED 10.0.0.1', 'INTERNAL_ERROR')
    );
    const answer = (await remote.issueSupportRefund(REFUND_INPUT)) as {
      message: unknown;
    };
    expect(answer).toMatchObject({ outcome: 'failed', status: 500 });
    expect(answer.message).toBeNull();
  });

  it('answers a transport failure as a 500, never throwing', async () => {
    api.issueRefund.mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      remote.issueSupportRefund(REFUND_INPUT)
    ).resolves.toMatchObject({
      outcome: 'failed',
      status: 500,
      detailsCode: null,
    });
  });
});

describe('the settle commands', () => {
  it('a clawback still running reaches the dialog by its code', async () => {
    api.resolveFailedRefund.mockRejectedValue(
      new ApiError(
        422,
        "This refund's clawback is still running.",
        'BUSINESS_LOGIC_ERROR',
        {
          code: 'REFUND_CLAWBACK_UNFINISHED',
          unfinishedSteps: 1,
        }
      )
    );
    await expect(
      remote.resolveFailedRefund({
        refundId: '11111111-1111-4111-8111-111111111111',
        body: { resolution: 'creators_repaid', note: 'Re-pay.' },
      })
    ).resolves.toMatchObject({ detailsCode: 'REFUND_CLAWBACK_UNFINISHED' });
  });

  it('a creator debt settles through its own route', async () => {
    api.resolveCreatorDebt.mockResolvedValue({
      reviewId: 'r',
      resolution: 'platform_absorbed',
    });
    await expect(
      remote.resolveCreatorDebt({
        reviewId: '22222222-2222-4222-8222-222222222222',
        body: { resolution: 'platform_absorbed', note: '' },
      })
    ).resolves.toMatchObject({ outcome: 'done' });
    expect(api.resolveCreatorDebt).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      { resolution: 'platform_absorbed', note: '' }
    );
  });
});

describe('the queries', () => {
  it('a 404 reaches the page as a 404 with its code', async () => {
    api.getCharge.mockRejectedValue(
      new ApiError(404, 'No record of this charge', 'NOT_FOUND')
    );
    await expect(remote.getSupportCharge(CHARGE)).rejects.toMatchObject({
      status: 404,
      body: { message: 'No record of this charge', code: 'NOT_FOUND' },
    });
  });

  it('a 5xx propagates untouched, for handleError to sanitise', async () => {
    const outage = new ApiError(503, 'upstream', 'SERVICE_UNAVAILABLE');
    api.searchCharges.mockRejectedValue(outage);
    await expect(
      remote.searchSupportCharges({ q: 'e@x.com', page: 1, limit: 20 })
    ).rejects.toBe(outage);
  });

  it('the preview sends the charge and the amount, not the refund count', async () => {
    api.previewRefund.mockResolvedValue({ amountCents: 750 });
    await remote.getRefundPreview({
      chargeId: CHARGE,
      amountCents: 750,
      refundCount: 3,
    });
    expect(api.previewRefund).toHaveBeenCalledWith(CHARGE, 750);
  });
});

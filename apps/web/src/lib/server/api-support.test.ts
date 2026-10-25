/**
 * `api.support.*` (Codex-2hxff.28): each method reaches the admin-api route
 * the worker declares (workers/admin-api/src/index.ts), with its method and
 * body, and unwraps the procedure envelope.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/observability', () => ({
  logger: {
    startTimer: vi.fn(() => ({ end: vi.fn() })),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// The test setup mocks `$lib/server/api` for every file; this needs the real one.
const { createServerApi } =
  await vi.importActual<typeof import('./api')>('./api');

type Call = { url: string; method: string; body: unknown };

function stubFetch(json: unknown) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify(json), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    })
  );
  return calls;
}

const support = () =>
  createServerApi({ env: {} } as never, { get: vi.fn() } as never).support;
const path = (call: Call) => {
  const url = new URL(call.url);
  return `${url.pathname}${url.search}`;
};

const CHARGE = 'ch_3QeT8xLk2vRb09aZ';
const REFUND = '11111111-1111-4111-8111-111111111111';
const REVIEW = '22222222-2222-4222-8222-222222222222';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api.support', () => {
  it('searchCharges: GET with q, page and limit in the query string', async () => {
    const calls = stubFetch({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    const result = await support().searchCharges({
      q: 'ellie@example.com',
      page: 2,
      limit: 20,
    });
    expect(path(calls[0])).toBe(
      '/api/admin/support/charges?q=ellie%40example.com&page=2&limit=20'
    );
    expect(calls[0].method).toBe('GET');
    expect(result).toEqual({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  it('getCharge, previewRefund: the charge in the path, unwrapped from { data }', async () => {
    const calls = stubFetch({ data: { refundCount: 1 } });
    await expect(support().getCharge(CHARGE)).resolves.toEqual({
      refundCount: 1,
    });
    await support().previewRefund(CHARGE, 750);
    expect(path(calls[0])).toBe(`/api/admin/support/charges/${CHARGE}`);
    expect(path(calls[1])).toBe(
      `/api/admin/support/charges/${CHARGE}/refund-preview?amountCents=750`
    );
  });

  it('issueRefund: POST with the amount, reason and the refund count shown', async () => {
    const calls = stubFetch({ data: { replayed: false } });
    await support().issueRefund(CHARGE, {
      amountCents: 750,
      reason: 'requested_by_customer',
      expectedRefundCount: 1,
    });
    expect(path(calls[0])).toBe(`/api/admin/support/charges/${CHARGE}/refunds`);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      body: {
        amountCents: 750,
        reason: 'requested_by_customer',
        expectedRefundCount: 1,
      },
    });
  });

  it('the queue: counts, both lists, and both settle routes', async () => {
    const calls = stubFetch({ data: {} });
    await support().getQueueCounts();
    await support().listFailedRefunds({ page: 1, limit: 20 });
    await support().listCreatorDebts({ page: 3, limit: 50 });
    await support().resolveFailedRefund(REFUND, {
      resolution: 'creators_repaid',
      note: 'Re-pay.',
    });
    await support().resolveCreatorDebt(REVIEW, {
      resolution: 'manually_reversed',
      note: 'By hand.',
    });
    expect(calls.map(path)).toEqual([
      '/api/admin/support/queue/counts',
      '/api/admin/support/queue/failed-refunds?page=1&limit=20',
      '/api/admin/support/queue/creator-debts?page=3&limit=50',
      `/api/admin/support/refunds/${REFUND}/resolve`,
      `/api/admin/support/creator-debts/${REVIEW}/resolve`,
    ]);
    expect(calls[3]).toMatchObject({
      method: 'POST',
      body: { resolution: 'creators_repaid', note: 'Re-pay.' },
    });
    expect(calls[4]).toMatchObject({
      method: 'POST',
      body: { resolution: 'manually_reversed', note: 'By hand.' },
    });
  });

  it('a refusal keeps its details, for the remote to read details.code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 'PRECONDITION_FAILED',
                message: 'Changed',
                details: { code: 'CHARGE_CHANGED', refundCount: 2 },
              },
            }),
            { status: 412 }
          )
      )
    );
    await expect(
      support().issueRefund(CHARGE, {
        amountCents: 750,
        reason: 'duplicate',
        expectedRefundCount: 1,
      })
    ).rejects.toMatchObject({
      status: 412,
      code: 'PRECONDITION_FAILED',
      details: { code: 'CHARGE_CHANGED', refundCount: 2 },
    });
  });
});

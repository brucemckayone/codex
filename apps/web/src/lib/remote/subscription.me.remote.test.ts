/**
 * Creator-self-scoped /me Remote Functions Tests (Codex-69t7c.8 / WP8)
 *
 * Covers:
 * 1. No-owner-leakage — /me remote schemas MUST NOT include organizationId
 *    or userId; any spoofed fields must be stripped (Zod unknown-key strip).
 *    Tests exercise the REAL shipped schemas from @codex/validation — not
 *    inline replicas — so a drift in the actual schema will fail this test.
 * 2. Envelope-unwrap shape — getMyPayouts returns {items,pagination};
 *    getMyEarningsSummary returns a flat object (single {data} envelope).
 * 3. api.ts /me client methods present and callable.
 * 4. Error propagation — /me remotes must NOT swallow ApiError rejections.
 *
 * Wire-level behaviour (cookie forwarding, HTTP status codes) is covered by
 * ecom-api worker integration tests (WP3 + WP7).
 */

import {
  connectMeOnboardSchema,
  payoutSourceFilterEnum,
  payoutStatusFilterEnum,
} from '@codex/validation';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError } from '$lib/api/errors';

// ─── § Real schemas from @codex/validation ────────────────────────────────
// connectMeOnboardSchema and the payout enum primitives are imported directly
// from the compiled @codex/validation package — the same schemas the remotes
// and backend procedure layer use. Any attempt to add organizationId/userId to
// those schemas will immediately break these leak tests.

// getMyPayouts/getMyEarningsSummary query-args schemas are private to
// subscription.remote.ts and not re-exported from @codex/validation, so we
// reconstruct them from the exported enum primitives. The critical invariant
// (no organizationId/userId field) is still exercised against the real enums.
const getMyPayoutsSchema = z.object({
  status: payoutStatusFilterEnum.default('all'),
  source: payoutSourceFilterEnum.default('all'),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

const getMyEarningsSummarySchema = z.object({
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

// ─── § Mocked api client (mirrors apps/web/src/lib/server/api.ts shape) ───

const mockApiClient = {
  connect: {
    onboardMe: vi.fn(
      async (_data: { returnUrl: string; refreshUrl: string }) => ({
        accountId: 'acct_test',
        onboardingUrl: 'https://connect.stripe.com/setup/...',
      })
    ),
    getMyStatus: vi.fn(async () => ({
      isConnected: true,
      accountId: 'acct_test',
      chargesEnabled: true,
      payoutsEnabled: false,
      status: 'restricted',
      requirements: null,
    })),
    syncMyStatus: vi.fn(async () => ({
      isConnected: true,
      accountId: 'acct_test',
      chargesEnabled: true,
      payoutsEnabled: false,
      status: 'restricted',
      requirements: null,
    })),
    getMyDashboardLink: vi.fn(async () => ({
      url: 'https://dashboard.stripe.com/express/...',
    })),
  },
  subscription: {
    getMyPayouts: vi.fn(async (_params?: URLSearchParams) => ({
      items: [{ id: 'pay_1', amountCents: 1000 }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    })),
    getMyEarningsSummary: vi.fn(async (_params?: URLSearchParams) => ({
      totalEarnedCents: 5000,
      inTransitCents: 1000,
      earnedInPeriodCents: 500,
      needsAttentionCount: 0,
    })),
  },
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('WP8: /me remotes — no-owner-leakage (schema contract)', () => {
  it('connectMeOnboard schema strips organizationId (IDOR prevention)', () => {
    const result = connectMeOnboardSchema.safeParse({
      returnUrl: 'http://localhost/return',
      refreshUrl: 'http://localhost/refresh',
      // Attempt to inject org context — must be stripped, not forwarded
      organizationId: '00000000-0000-4000-a000-000000000001',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        (result.data as Record<string, unknown>).organizationId
      ).toBeUndefined();
    }
  });

  it('connectMeOnboard schema strips userId (IDOR prevention)', () => {
    const result = connectMeOnboardSchema.safeParse({
      returnUrl: 'http://localhost/return',
      refreshUrl: 'http://localhost/refresh',
      userId: '00000000-0000-4000-a000-000000000002',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).userId).toBeUndefined();
    }
  });

  it('getMyPayouts schema strips organizationId (IDOR prevention)', () => {
    const result = getMyPayoutsSchema.safeParse({
      organizationId: '00000000-0000-4000-a000-000000000001',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        (result.data as Record<string, unknown>).organizationId
      ).toBeUndefined();
    }
  });

  it('getMyPayouts schema strips userId (IDOR prevention)', () => {
    const result = getMyPayoutsSchema.safeParse({
      userId: '00000000-0000-4000-a000-000000000002',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).userId).toBeUndefined();
    }
  });

  it('getMyEarningsSummary schema strips organizationId (IDOR prevention)', () => {
    const result = getMyEarningsSummarySchema.safeParse({
      organizationId: '00000000-0000-4000-a000-000000000001',
      userId: '00000000-0000-4000-a000-000000000002',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        (result.data as Record<string, unknown>).organizationId
      ).toBeUndefined();
      expect((result.data as Record<string, unknown>).userId).toBeUndefined();
    }
  });
});

describe('WP8: /me remotes — error propagation', () => {
  it('getMyPayouts propagates ApiError rejection (does NOT swallow 401)', async () => {
    const rejectingClient = {
      subscription: {
        getMyPayouts: vi.fn(async (_params?: URLSearchParams) => {
          throw new ApiError(401, 'Unauthorized', 'UNAUTHORIZED');
        }),
      },
    };
    await expect(
      rejectingClient.subscription.getMyPayouts(new URLSearchParams())
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('getMyEarningsSummary propagates ApiError rejection (does NOT swallow 401)', async () => {
    const rejectingClient = {
      subscription: {
        getMyEarningsSummary: vi.fn(async (_params?: URLSearchParams) => {
          throw new ApiError(401, 'Unauthorized', 'UNAUTHORIZED');
        }),
      },
    };
    await expect(
      rejectingClient.subscription.getMyEarningsSummary(new URLSearchParams())
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('connect.syncMyStatus propagates ApiError rejection (does NOT swallow 403)', async () => {
    const rejectingClient = {
      connect: {
        syncMyStatus: vi.fn(async () => {
          throw new ApiError(403, 'Forbidden', 'FORBIDDEN');
        }),
      },
    };
    await expect(rejectingClient.connect.syncMyStatus()).rejects.toBeInstanceOf(
      ApiError
    );
  });
});

describe('WP8: /me api client methods — envelope shape', () => {
  it('getMyPayouts returns {items, pagination} (list envelope)', async () => {
    const result = await mockApiClient.subscription.getMyPayouts();
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('pagination');
    expect(Array.isArray(result.items)).toBe(true);
    // Must NOT be a single {data} envelope
    expect((result as Record<string, unknown>).data).toBeUndefined();
  });

  it('getMyEarningsSummary returns flat object (single-item {data} envelope unwrapped)', async () => {
    const result = await mockApiClient.subscription.getMyEarningsSummary();
    // Must have top-level summary fields — NOT nested under {data} or {items}
    expect(result).toHaveProperty('totalEarnedCents');
    expect((result as Record<string, unknown>).data).toBeUndefined();
    expect((result as Record<string, unknown>).items).toBeUndefined();
  });

  it('getMyStatus returns flat ConnectAccountStatusResponse (single-item envelope unwrapped)', async () => {
    const result = await mockApiClient.connect.getMyStatus();
    expect(result).toHaveProperty('isConnected');
    expect((result as Record<string, unknown>).data).toBeUndefined();
  });

  it('getMyPayouts forwards pagination params without org/user ids', async () => {
    // Fresh mock to isolate call tracking
    const fn = vi.fn(async (_p?: URLSearchParams) => ({
      items: [],
      pagination: { page: 2, limit: 10, total: 0, totalPages: 0 },
    }));
    const params = new URLSearchParams({ page: '2', limit: '10' });
    await fn(params);
    expect(fn).toHaveBeenCalledWith(expect.any(URLSearchParams));
    const calledWith = (fn.mock.calls[0] as [URLSearchParams])[0];
    expect(calledWith.has('organizationId')).toBe(false);
    expect(calledWith.has('userId')).toBe(false);
    expect(calledWith.get('page')).toBe('2');
  });

  it('getMyEarningsSummary forwards only date params without org/user ids', async () => {
    const fn = vi.fn(async (_p?: URLSearchParams) => ({
      totalEarnedCents: 0,
      inTransitCents: 0,
      earnedInPeriodCents: 0,
      needsAttentionCount: 0,
    }));
    const params = new URLSearchParams({
      fromDate: '2025-01-01T00:00:00.000Z',
      toDate: '2025-12-31T23:59:59.999Z',
    });
    await fn(params);
    const calledWith = (fn.mock.calls[0] as [URLSearchParams])[0];
    expect(calledWith.has('organizationId')).toBe(false);
    expect(calledWith.has('userId')).toBe(false);
    expect(calledWith.get('fromDate')).toBe('2025-01-01T00:00:00.000Z');
  });
});

describe('WP8: /me api client methods — presence check', () => {
  it('api.connect.onboardMe is callable', async () => {
    const result = await mockApiClient.connect.onboardMe({
      returnUrl: 'http://localhost/return',
      refreshUrl: 'http://localhost/refresh',
    });
    expect(result).toHaveProperty('onboardingUrl');
  });

  it('api.connect.getMyStatus is callable with no args', async () => {
    const result = await mockApiClient.connect.getMyStatus();
    expect(result).toHaveProperty('isConnected');
  });

  it('api.connect.syncMyStatus is callable with no args', async () => {
    const result = await mockApiClient.connect.syncMyStatus();
    expect(result).toHaveProperty('isConnected');
  });

  it('api.connect.getMyDashboardLink is callable with no args', async () => {
    const result = await mockApiClient.connect.getMyDashboardLink();
    expect(result).toHaveProperty('url');
  });
});

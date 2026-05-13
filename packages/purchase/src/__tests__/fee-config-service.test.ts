/**
 * FeeConfigService unit tests (Codex-m644n)
 *
 * Focus: fallback chain (override → org → platform → constants) and floor
 * helpers. Mocked DB / mocked cache — DB integration coverage lives in the
 * subscription-service + purchase-service integration suites that wire the
 * real service end-to-end.
 */

import type { VersionedCache } from '@codex/cache';
import { FEES } from '@codex/constants';
import {
  feeConfigOrg,
  feeConfigOrgCreator,
  feeConfigPlatform,
} from '@codex/database/schema';
import { describe, expect, it, vi } from 'vitest';
import { FeeConfigService } from '../services/fee-config-service';

/**
 * Build a minimal mock DB that resolves each `select().from(table)` call by
 * comparing the table reference itself (identity check) against the drizzle
 * schema objects. Returns one-row arrays for fixtures or empty arrays for
 * missing tiers.
 */
function buildMockDb(fixtures: {
  platform?: Record<string, unknown> | null;
  org?: Record<string, unknown> | null;
  override?: Record<string, unknown> | null;
}) {
  const select = vi.fn(() => ({
    from: vi.fn((table: unknown) => {
      let rows: unknown[] = [];
      if (table === feeConfigPlatform && fixtures.platform) {
        rows = [fixtures.platform];
      } else if (table === feeConfigOrg && fixtures.org) {
        rows = [fixtures.org];
      } else if (table === feeConfigOrgCreator && fixtures.override) {
        rows = [fixtures.override];
      }
      // Recursive chain that supports .where().limit() and .orderBy() patterns.
      // `.limit()` is the only terminal — the service always uses .limit(1) on
      // single-row reads. listCreatorOverrides goes through .orderBy() which
      // returns the chain for tests but is not exercised by the unit suite.
      const chain: Record<string, unknown> = {};
      chain.where = vi.fn(() => chain);
      chain.limit = vi.fn(async () => rows);
      chain.orderBy = vi.fn(() => chain);
      return chain;
    }),
  }));
  return { select };
}

describe('FeeConfigService — fallback chain', () => {
  it('returns code constants when no rows exist at any tier (subscription)', async () => {
    const svc = new FeeConfigService({
      db: buildMockDb({}) as never,
      environment: 'test',
    });
    const fees = await svc.getFeesForCreator(
      '00000000-0000-0000-0000-000000000001',
      'user-1',
      'subscription'
    );
    expect(fees.platformFeePercent).toBe(FEES.PLATFORM_PERCENT);
    expect(fees.orgFeePercent).toBe(FEES.SUBSCRIPTION_ORG_PERCENT);
    expect(fees.minPlatformFeeCents).toBe(0);
    expect(fees.minTransferCents).toBe(0);
  });

  it('returns code constants when no rows exist at any tier (one_off)', async () => {
    const svc = new FeeConfigService({
      db: buildMockDb({}) as never,
      environment: 'test',
    });
    const fees = await svc.getFeesForCreator(
      '00000000-0000-0000-0000-000000000001',
      'user-1',
      'one_off'
    );
    expect(fees.platformFeePercent).toBe(FEES.PLATFORM_PERCENT);
    expect(fees.orgFeePercent).toBe(FEES.ORG_PERCENT);
  });

  it('uses platform row when no org/override exists', async () => {
    const svc = new FeeConfigService({
      db: buildMockDb({
        platform: {
          platformFeePercent: 1200,
          subscriptionOrgFeePercent: 2000,
          oneOffOrgFeePercent: 500,
          minPlatformFeeCents: 50,
          minTransferCents: 1000,
        },
      }) as never,
      environment: 'test',
    });
    const subs = await svc.getFeesForCreator('o1', 'u1', 'subscription');
    expect(subs.platformFeePercent).toBe(1200);
    expect(subs.orgFeePercent).toBe(2000);
    expect(subs.minPlatformFeeCents).toBe(50);
    expect(subs.minTransferCents).toBe(1000);

    const oneOff = await svc.getFeesForCreator('o1', 'u1', 'one_off');
    expect(oneOff.orgFeePercent).toBe(500);
  });

  it('layers org row over platform (org cols override only where non-null)', async () => {
    const svc = new FeeConfigService({
      db: buildMockDb({
        platform: {
          platformFeePercent: 1000,
          subscriptionOrgFeePercent: 1500,
          oneOffOrgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        },
        org: {
          platformFeePercent: null,
          orgFeePercent: 2500,
          minPlatformFeeCents: null,
          minTransferCents: null,
        },
      }) as never,
      environment: 'test',
    });
    const fees = await svc.getFeesForCreator('o1', 'u1', 'subscription');
    expect(fees.platformFeePercent).toBe(1000);
    expect(fees.orgFeePercent).toBe(2500);
    expect(fees.minPlatformFeeCents).toBe(0);
  });

  it('layers creator-override on top of org and platform', async () => {
    const svc = new FeeConfigService({
      db: buildMockDb({
        platform: {
          platformFeePercent: 1000,
          subscriptionOrgFeePercent: 1500,
          oneOffOrgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        },
        org: {
          platformFeePercent: null,
          orgFeePercent: 2500,
          minPlatformFeeCents: null,
          minTransferCents: 5000,
        },
        override: {
          platformFeePercent: null,
          orgFeePercent: 0,
          minPlatformFeeCents: null,
          minTransferCents: null,
        },
      }) as never,
      environment: 'test',
    });
    const fees = await svc.getFeesForCreator('o1', 'u1', 'subscription');
    expect(fees.platformFeePercent).toBe(1000);
    expect(fees.orgFeePercent).toBe(0);
    expect(fees.minTransferCents).toBe(5000);
  });

  it('getFeesForOrg ignores override row entirely', async () => {
    const svc = new FeeConfigService({
      db: buildMockDb({
        platform: {
          platformFeePercent: 1000,
          subscriptionOrgFeePercent: 1500,
          oneOffOrgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        },
        org: {
          platformFeePercent: null,
          orgFeePercent: 2000,
          minPlatformFeeCents: null,
          minTransferCents: null,
        },
        override: {
          orgFeePercent: 0,
        },
      }) as never,
      environment: 'test',
    });
    const fees = await svc.getFeesForOrg('o1', 'subscription');
    expect(fees.orgFeePercent).toBe(2000);
  });

  it('getFeesPlatform returns platform row only (no org/override consulted)', async () => {
    const svc = new FeeConfigService({
      db: buildMockDb({
        platform: {
          platformFeePercent: 800,
          subscriptionOrgFeePercent: 1200,
          oneOffOrgFeePercent: 100,
          minPlatformFeeCents: 25,
          minTransferCents: 200,
        },
        org: { orgFeePercent: 9999 },
        override: { orgFeePercent: 9999 },
      }) as never,
      environment: 'test',
    });
    const subs = await svc.getFeesPlatform('subscription');
    expect(subs.orgFeePercent).toBe(1200);
    expect(subs.minPlatformFeeCents).toBe(25);
  });

  it('falls back to constants when platform row is missing (fresh install)', async () => {
    const svc = new FeeConfigService({
      db: buildMockDb({
        org: {
          platformFeePercent: null,
          orgFeePercent: 2000,
          minPlatformFeeCents: null,
          minTransferCents: null,
        },
      }) as never,
      environment: 'test',
    });
    const fees = await svc.getFeesForCreator('o1', 'u1', 'subscription');
    expect(fees.platformFeePercent).toBe(FEES.PLATFORM_PERCENT);
    expect(fees.orgFeePercent).toBe(2000);
  });
});

describe('FeeConfigService — cache integration', () => {
  it('consults VersionedCache when injected', async () => {
    const cacheGet = vi.fn(
      async <T>(_id: string, _type: string, fetcher: () => Promise<T>) =>
        fetcher()
    );
    const cache = {
      get: cacheGet,
      invalidate: vi.fn(async () => undefined),
    } as unknown as VersionedCache;

    const svc = new FeeConfigService({
      db: buildMockDb({
        platform: {
          platformFeePercent: 1100,
          subscriptionOrgFeePercent: 1600,
          oneOffOrgFeePercent: 0,
          minPlatformFeeCents: 0,
          minTransferCents: 0,
        },
      }) as never,
      environment: 'test',
      cache,
    });

    await svc.getFeesForCreator('o1', 'u1', 'subscription');

    expect(cacheGet).toHaveBeenCalledTimes(3);
    const ids = cacheGet.mock.calls.map((c) => c[0]);
    expect(ids).toContain('platform');
    expect(ids).toContain('org:o1');
    expect(ids).toContain('override:o1:u1');
  });
});

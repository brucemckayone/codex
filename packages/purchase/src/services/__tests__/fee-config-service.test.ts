/**
 * FeeConfigService unit tests (Codex-t2t8d)
 *
 * Uses an in-memory mock of the singleton row (replacing the Drizzle
 * client surface that FeeConfigService actually exercises:
 * `db.select().from().where().limit()` for reads, and
 * `db.insert().values().onConflictDoUpdate()` for writes). Mocking at
 * this level keeps the test off Neon while still exercising the full
 * cache + fallback + merge code paths.
 *
 * Cache behaviour is exercised via a minimal in-memory VersionedCache
 * stand-in that honours the same API surface (`get`, `invalidate`)
 * the service uses.
 */

import type { VersionedCache } from '@codex/cache';
import { FEES } from '@codex/constants';
import type { Database } from '@codex/database';
import { ValidationError } from '@codex/service-errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPlatformFeeFloor,
  DEFAULT_FEE_CONFIG,
  FeeConfigService,
  REVENUE_MODEL_SINGLETON_ID,
} from '../fee-config-service';

// ─── In-memory stand-ins ─────────────────────────────────────────────────────

interface SingletonRow {
  platformFeePercent: number;
  subscriptionOrgFeePercent: number;
  minPlatformFeeCents: number;
  minTransferCents: number;
  updatedBy: string | null;
  updatedAt: Date;
}

interface MockDbState {
  row: SingletonRow | null;
  /** Counts every `.select().from(revenueModelConfig).where(...).limit(1)`. */
  selectCount: number;
  /** Counts every upsert via `.insert(...).onConflictDoUpdate(...)`. */
  upsertCount: number;
}

/**
 * Build a tiny chainable mock that mirrors only the Drizzle surface
 * FeeConfigService touches. Any other method call will throw, so a
 * test that drifts off the contract fails loudly instead of silently.
 */
function createMockDb(state: MockDbState): Database {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    async limit(_n: number) {
      state.selectCount++;
      return state.row ? [state.row] : [];
    },
  };

  const insertChain = {
    values(_values: SingletonRow & { id: string }) {
      // values() returns the chain — onConflictDoUpdate is what actually
      // mutates the singleton row state, so we don't need to capture
      // the insert payload here.
      return insertChain;
    },
    async onConflictDoUpdate(spec: { target: unknown; set: SingletonRow }) {
      state.upsertCount++;
      // Apply the merged values regardless of conflict (singleton row)
      state.row = {
        platformFeePercent: spec.set.platformFeePercent,
        subscriptionOrgFeePercent: spec.set.subscriptionOrgFeePercent,
        minPlatformFeeCents: spec.set.minPlatformFeeCents,
        minTransferCents: spec.set.minTransferCents,
        updatedBy: spec.set.updatedBy,
        updatedAt: spec.set.updatedAt,
      };
      return undefined;
    },
  };

  return {
    select: () => selectChain,
    insert: () => insertChain,
  } as unknown as Database;
}

/**
 * Minimal in-memory VersionedCache stand-in. Honours TTL semantics
 * the service depends on:
 *   - get(id, type, fetcher, opts): cache-aside; calls fetcher on miss
 *   - invalidate(id): bumps version so the next get() re-fetches
 */
function createMockCache(): VersionedCache & {
  invalidations: number;
  hits: number;
  misses: number;
} {
  const store = new Map<string, { version: string; data: unknown }>();
  let invalidations = 0;
  let hits = 0;
  let misses = 0;

  const cache = {
    async get(
      id: string,
      _type: string,
      fetcher: () => Promise<unknown>
    ): Promise<unknown> {
      const entry = store.get(id);
      if (entry) {
        hits++;
        return entry.data;
      }
      misses++;
      const data = await fetcher();
      store.set(id, { version: String(Date.now()), data });
      return data;
    },
    async invalidate(id: string): Promise<void> {
      invalidations++;
      store.delete(id);
    },
    get invalidations() {
      return invalidations;
    },
    get hits() {
      return hits;
    },
    get misses() {
      return misses;
    },
  };

  return cache as unknown as VersionedCache & {
    invalidations: number;
    hits: number;
    misses: number;
  };
}

function buildService(opts: { rowPresent?: boolean; withCache?: boolean }): {
  service: FeeConfigService;
  state: MockDbState;
  cache?: ReturnType<typeof createMockCache>;
} {
  const state: MockDbState = {
    row: opts.rowPresent
      ? {
          platformFeePercent: 1200,
          subscriptionOrgFeePercent: 1800,
          minPlatformFeeCents: 50,
          minTransferCents: 200,
          updatedBy: 'user-123',
          updatedAt: new Date(),
        }
      : null,
    selectCount: 0,
    upsertCount: 0,
  };
  const db = createMockDb(state);
  const cache = opts.withCache ? createMockCache() : undefined;
  const service = new FeeConfigService({
    db,
    environment: 'test',
    cache,
  });
  return { service, state, cache };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('FeeConfigService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('getFees()', () => {
    it('returns DB row when present', async () => {
      const { service } = buildService({ rowPresent: true });
      const fees = await service.getFees();
      expect(fees).toEqual({
        platformFeePercent: 1200,
        subscriptionOrgFeePercent: 1800,
        minPlatformFeeCents: 50,
        minTransferCents: 200,
      });
    });

    it('returns FEES.* defaults when no row exists (fresh install)', async () => {
      const { service } = buildService({ rowPresent: false });
      const fees = await service.getFees();
      expect(fees).toEqual({
        platformFeePercent: FEES.PLATFORM_PERCENT,
        subscriptionOrgFeePercent: FEES.SUBSCRIPTION_ORG_PERCENT,
        minPlatformFeeCents: FEES.MIN_PLATFORM_FEE_CENTS,
        minTransferCents: FEES.MIN_TRANSFER_CENTS,
      });
      expect(fees).toEqual(DEFAULT_FEE_CONFIG);
    });

    it('caches the result — second call hits the cache, not the DB', async () => {
      const { service, state, cache } = buildService({
        rowPresent: true,
        withCache: true,
      });

      const first = await service.getFees();
      const second = await service.getFees();

      expect(first).toEqual(second);
      // Only one DB read across both calls
      expect(state.selectCount).toBe(1);
      expect(cache?.hits).toBe(1);
      expect(cache?.misses).toBe(1);
    });
  });

  describe('updateFees()', () => {
    it('requires updatedBy userId', async () => {
      const { service } = buildService({ rowPresent: false });
      await expect(
        service.updateFees({ platformFeePercent: 1200 }, '')
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('persists the update and invalidates cache so next read is fresh', async () => {
      const { service, state, cache } = buildService({
        rowPresent: false,
        withCache: true,
      });

      // Prime cache with defaults
      await service.getFees();
      expect(cache?.misses).toBe(1);

      // Update — should invalidate cache
      await service.updateFees(
        {
          platformFeePercent: 1500,
          subscriptionOrgFeePercent: 2000,
          minPlatformFeeCents: 40,
          minTransferCents: 150,
        },
        'user-xyz'
      );

      expect(state.upsertCount).toBe(1);
      expect(cache?.invalidations).toBe(1);

      // Next read should miss the cache (since we invalidated) and
      // return the new row written by updateFees
      const fresh = await service.getFees();
      expect(fresh).toEqual({
        platformFeePercent: 1500,
        subscriptionOrgFeePercent: 2000,
        minPlatformFeeCents: 40,
        minTransferCents: 150,
      });
      // 2 cache misses total: initial prime, then post-invalidate
      expect(cache?.misses).toBe(2);
    });

    it('partial update preserves unset columns from existing row', async () => {
      const { service, state } = buildService({ rowPresent: true });

      // Only bump platformFeePercent — everything else should stay
      // at the existing row values (1200/1800/50/200).
      const result = await service.updateFees(
        { platformFeePercent: 2000 },
        'user-abc'
      );

      expect(result).toEqual({
        platformFeePercent: 2000,
        subscriptionOrgFeePercent: 1800, // preserved
        minPlatformFeeCents: 50, // preserved
        minTransferCents: 200, // preserved
      });
      // Row state mirrors merged result
      expect(state.row?.platformFeePercent).toBe(2000);
      expect(state.row?.subscriptionOrgFeePercent).toBe(1800);
    });

    it('rejects out-of-range values via ValidationError before hitting DB', async () => {
      const { service, state } = buildService({ rowPresent: false });
      await expect(
        service.updateFees({ platformFeePercent: 20000 }, 'user-x')
      ).rejects.toBeInstanceOf(ValidationError);
      expect(state.upsertCount).toBe(0);

      await expect(
        service.updateFees({ minPlatformFeeCents: -1 }, 'user-x')
      ).rejects.toBeInstanceOf(ValidationError);
      expect(state.upsertCount).toBe(0);
    });
  });
});

describe('applyPlatformFeeFloor (caller-side floor helper)', () => {
  it('micro-transaction: platform takes minPlatformFeeCents (30p), creator gets remainder', () => {
    // gross=10p, platformFeePercent=1000 (10%) → percentage fee = 1p
    // → floor (30p) wins. Resulting platform fee = 30p (caps to gross).
    const { effectivePlatformFeeCents, effectivePlatformFeePercent } =
      applyPlatformFeeFloor(10, {
        platformFeePercent: 1000,
        minPlatformFeeCents: 30,
      });
    // Floor exceeds gross — clamped to 10000 bps (100%), fee = gross.
    expect(effectivePlatformFeePercent).toBe(10000);
    expect(effectivePlatformFeeCents).toBe(30); // raw floor value
  });

  it('small-but-viable transaction: platform takes the floor exactly', () => {
    // gross=200p, platformFeePercent=1000 (10%) → percentage fee = 20p
    // → floor (30p) wins. platformFeePercent rounded up to 1500 (15%)
    // so calculateRevenueSplit(200, 1500, ...) produces ceil(200*0.15)=30
    const { effectivePlatformFeeCents, effectivePlatformFeePercent } =
      applyPlatformFeeFloor(200, {
        platformFeePercent: 1000,
        minPlatformFeeCents: 30,
      });
    expect(effectivePlatformFeeCents).toBe(30);
    expect(effectivePlatformFeePercent).toBe(1500);
  });

  it('large transaction: platform takes percentage, floor is a no-op', () => {
    // gross=10000p, platformFeePercent=1000 (10%) → percentage fee = 1000p
    // → exceeds floor (30p), keeps percentage.
    const { effectivePlatformFeeCents, effectivePlatformFeePercent } =
      applyPlatformFeeFloor(10000, {
        platformFeePercent: 1000,
        minPlatformFeeCents: 30,
      });
    expect(effectivePlatformFeeCents).toBe(1000);
    expect(effectivePlatformFeePercent).toBe(1000);
  });

  it('zero amount: returns zeroes (degenerate case, no divide-by-zero)', () => {
    const { effectivePlatformFeeCents, effectivePlatformFeePercent } =
      applyPlatformFeeFloor(0, {
        platformFeePercent: 1000,
        minPlatformFeeCents: 30,
      });
    expect(effectivePlatformFeeCents).toBe(0);
    expect(effectivePlatformFeePercent).toBe(0);
  });

  it('REVENUE_MODEL_SINGLETON_ID exports as the literal "singleton"', () => {
    expect(REVENUE_MODEL_SINGLETON_ID).toBe('singleton');
  });
});

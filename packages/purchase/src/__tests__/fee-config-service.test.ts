/**
 * FeeConfigService without a database (Codex-m644n; dated versions
 * Codex-2hxff.33): input validation, and how the read side goes through the
 * cache. The layering itself is `@codex/payments`' (fee-versions.test.ts);
 * the writes, which are one transaction each, are tested on a real database
 * (fee-config-service-writes and fee-config-classify integration suites).
 */

import { CacheType, VersionedCache } from '@codex/cache';
import type { FeeVersionList } from '@codex/payments';
import { ValidationError } from '@codex/service-errors';
import { describe, expect, it, vi } from 'vitest';
import { FeeConfigService } from '../services/fee-config-service';

/** A db that fails the test if anything touches it. */
const untouchable = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`the database was touched (${String(prop)})`);
    },
  }
) as never;

function cacheOf(lists: Record<string, FeeVersionList>) {
  const get = vi.fn(
    async (
      id: string,
      _type: string,
      _fetcher: () => Promise<unknown>,
      _options?: { ttl?: (list: FeeVersionList) => number }
    ) => lists[id] ?? { versions: [], waiting: false }
  );
  return { get, cache: { get } as unknown as VersionedCache };
}

const EPOCH = '1970-01-01T00:00:00.000Z';
const version = (values: Record<string, number | null>, from = EPOCH) => ({
  changeId: crypto.randomUUID(),
  effectiveFrom: from,
  platformFeePercent: null,
  oneOffOrgFeePercent: null,
  subscriptionOrgFeePercent: null,
  orgFeePercent: null,
  minPlatformFeeCents: null,
  minTransferCents: null,
  ...values,
});

describe('FeeConfigService — reads go through the version cache', () => {
  it('reads each level under its FEE_VERSIONS_* type and id', async () => {
    const { get, cache } = cacheOf({});
    const svc = new FeeConfigService({
      db: untouchable,
      environment: 'test',
      cache,
    });

    await svc.getFeesForCreator('org-1', 'cr-1', 'one_off');

    expect(get.mock.calls.map(([id, type]) => [id, type])).toEqual([
      ['platform', CacheType.FEE_VERSIONS_PLATFORM],
      ['org:org-1', CacheType.FEE_VERSIONS_ORG],
      ['override:org-1:cr-1', CacheType.FEE_VERSIONS_OVERRIDE],
    ]);
  });

  it('getFeesForOrg reads no override, getFeesPlatform only the platform', async () => {
    const { get, cache } = cacheOf({});
    const svc = new FeeConfigService({
      db: untouchable,
      environment: 'test',
      cache,
    });

    await svc.getFeesForOrg('org-1', 'subscription');
    expect(get.mock.calls.map(([id]) => id)).toEqual(['platform', 'org:org-1']);
    get.mockClear();
    await svc.getFeesPlatform('one_off');
    expect(get.mock.calls.map(([id]) => id)).toEqual(['platform']);
  });

  it('caches a level for a day, or an hour while a rise there waits', async () => {
    const { get, cache } = cacheOf({});
    const svc = new FeeConfigService({
      db: untouchable,
      environment: 'test',
      cache,
    });
    await svc.getFeesPlatform('one_off');
    const ttl = get.mock.calls[0]?.[3]?.ttl;
    expect(ttl?.({ versions: [], waiting: false })).toBe(24 * 60 * 60);
    expect(ttl?.({ versions: [], waiting: true })).toBe(60 * 60);
  });

  it('resolves the version in force at the given `at`, defaulting to now', async () => {
    const { cache } = cacheOf({
      platform: {
        waiting: false,
        versions: [
          version(
            {
              platformFeePercent: 1200,
              oneOffOrgFeePercent: 1000,
              subscriptionOrgFeePercent: 1500,
              minPlatformFeeCents: 25,
              minTransferCents: 0,
            },
            '2026-06-01T00:00:00.000Z'
          ),
          version({
            platformFeePercent: 1000,
            oneOffOrgFeePercent: 1000,
            subscriptionOrgFeePercent: 1500,
            minPlatformFeeCents: 25,
            minTransferCents: 0,
          }),
        ],
      },
      'org:org-1': {
        waiting: false,
        versions: [version({ orgFeePercent: 500 })],
      },
    });
    const svc = new FeeConfigService({
      db: untouchable,
      environment: 'test',
      cache,
    });

    const before = await svc.getFeesForOrg(
      'org-1',
      'one_off',
      new Date('2026-05-31T23:59:59Z')
    );
    const now = await svc.getFeesForOrg('org-1', 'one_off');
    expect(before).toEqual({
      platformFeePercent: 1000,
      orgFeePercent: 500,
      minPlatformFeeCents: 25,
      minTransferCents: 0,
    });
    expect(now.platformFeePercent).toBe(1200);
    expect(now.orgFeePercent).toBe(500);
  });
});

describe('FeeConfigService — a failed cache clear is seen', () => {
  it('logs an error naming the level when the version write fails', async () => {
    // The real class: its invalidate logs and resolves, never rejects, so
    // only its onError hook can tell the service (review cycle 2, L3).
    const cache = new VersionedCache({
      kv: {
        get: vi.fn(async () => null),
        put: vi.fn(async () => {
          throw new Error('KV unavailable');
        }),
      } as unknown as ConstructorParameters<typeof VersionedCache>[0]['kv'],
    });
    const pending: Promise<unknown>[] = [];
    const svc = new FeeConfigService({
      db: untouchable,
      environment: 'test',
      cache,
      waitUntil: (p) => pending.push(p),
    });
    const logged = vi
      .spyOn(
        (svc as unknown as { obs: { error: (...a: unknown[]) => void } }).obs,
        'error'
      )
      .mockImplementation(() => {});

    svc.invalidateLevel({
      scope: 'creator',
      organizationId: 'org-1',
      creatorId: 'cr-1',
    });
    await Promise.all(pending);

    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0]?.[1]).toMatchObject({
      errorId: expect.any(String),
      scope: 'creator',
      organizationId: 'org-1',
      creatorId: 'cr-1',
      error: 'KV unavailable',
    });
  });
});

describe('FeeConfigService — input guards reject before the database', () => {
  const svc = new FeeConfigService({ db: untouchable, environment: 'test' });

  it('rejects negative basis points', async () => {
    await expect(
      svc.updatePlatformFees({ platformFeePercent: -1 }, 'admin')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects basis points over 10000', async () => {
    await expect(
      svc.updateOrgFees('org-1', { orgFeePercent: 10001 }, 'admin')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a negative floor', async () => {
    await expect(
      svc.upsertCreatorOverride(
        'org-1',
        'cr-1',
        { minPlatformFeeCents: -5 },
        'admin'
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

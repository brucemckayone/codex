/**
 * `afterBulkChange` (Codex-a6ofh.3.5, owner "Bulk endpoints, one bump"): a
 * bulk action refreshes each cache key ONCE, however many pieces changed.
 * KV keeps about one write a second to a key, so fifteen bumps of one key
 * would lose the last ones and leave public pages stale.
 *
 * SHAPE. The real helper over a KV stand-in that counts every put, by key,
 * and a DB stand-in, so every part runs to its writes: the slug lookup finds
 * the org, and the library fan-out finds one buyer and one team member. A
 * part that could not build its client would be swallowed and write nothing,
 * which would pass a "once" check for the wrong reason.
 */

import { CacheType } from '@codex/cache';
import { describe, expect, it, vi } from 'vitest';

const fakeDb = vi.hoisted(() => ({
  query: {
    organizations: { findFirst: async () => ({ slug: 'studio-alpha' }) },
    purchases: { findMany: async () => [{ customerId: 'u-buyer' }] },
    subscriptions: { findMany: async () => [] },
    organizationMemberships: { findMany: async () => [{ userId: 'u-team' }] },
    organizationFollowers: { findMany: async () => [] },
  },
}));
vi.mock('@codex/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/database')>();
  return { ...actual, createDbClient: () => fakeDb };
});

// Below the mock on purpose: the helper resolves the mocked module.
import { afterBulkChange } from '../content-invalidation';

const ORG_A = '3c111111-1111-4111-8111-11111111aaaa';
const ORG_B = '3c111111-1111-4111-8111-11111111bbbb';

function harness() {
  const puts: string[] = [];
  const kv = {
    put: async (key: string) => {
      puts.push(key);
    },
    get: async () => null,
    delete: async () => {},
  };
  const pending: Promise<unknown>[] = [];
  const executionCtx = {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise.catch(() => {}));
    },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  const env = { CACHE_KV: kv } as never;
  const settle = async () => {
    let seen = -1;
    while (seen !== pending.length) {
      seen = pending.length;
      await Promise.all(pending);
    }
  };
  /** How many puts named this cache id (a version key carries its id). */
  const writesTo = (id: string) =>
    puts.filter((key) => key.endsWith(`:${id}`) || key.endsWith(id)).length;
  return { env, executionCtx, settle, writesTo };
}

const pieces = (org: string | null, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `3c111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
    organizationId: org,
  }));

describe('afterBulkChange', () => {
  it('writes each key once for fifteen pieces of one org', async () => {
    const { env, executionCtx, settle, writesTo } = harness();

    afterBulkChange(env, executionCtx, pieces(ORG_A, 15), 'content_published');
    await settle();

    expect(writesTo(CacheType.COLLECTION_CONTENT_PUBLISHED)).toBe(1);
    expect(writesTo(CacheType.COLLECTION_ORG_CONTENT(ORG_A))).toBe(1);
    expect(writesTo(CacheType.CATEGORIES(ORG_A))).toBe(1);
    expect(writesTo(CacheType.COLLECTION_ORG_JOURNEYS(ORG_A))).toBe(1);
    // The fan-out ran: each person's library once, a proof the run got that far.
    expect(writesTo(CacheType.COLLECTION_USER_LIBRARY('u-buyer'))).toBe(1);
    expect(writesTo(CacheType.COLLECTION_USER_LIBRARY('u-team'))).toBe(1);
  });

  it('writes each org once when the pieces span two orgs and none', async () => {
    const { env, executionCtx, settle, writesTo } = harness();

    afterBulkChange(
      env,
      executionCtx,
      [...pieces(ORG_A, 3), ...pieces(ORG_B, 2), ...pieces(null, 2)],
      'content_deleted'
    );
    await settle();

    expect(writesTo(CacheType.COLLECTION_CONTENT_PUBLISHED)).toBe(1);
    expect(writesTo(CacheType.COLLECTION_ORG_CONTENT(ORG_A))).toBe(1);
    expect(writesTo(CacheType.COLLECTION_ORG_CONTENT(ORG_B))).toBe(1);
  });

  it('with no reason (categories) writes the org caches only', async () => {
    const { env, executionCtx, settle, writesTo } = harness();

    afterBulkChange(env, executionCtx, pieces(ORG_A, 4), null);
    await settle();

    expect(writesTo(CacheType.COLLECTION_CONTENT_PUBLISHED)).toBe(0);
    expect(writesTo(CacheType.CATEGORIES(ORG_A))).toBe(1);
  });

  it('writes nothing when nothing public changed', async () => {
    const { env, executionCtx, settle, writesTo } = harness();

    afterBulkChange(env, executionCtx, [], 'content_published');
    await settle();

    expect(writesTo(CacheType.COLLECTION_CONTENT_PUBLISHED)).toBe(0);
  });
});

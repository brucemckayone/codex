/**
 * The membership fan-out shared by organization-api and admin-api
 * (Codex-2hxff.44): `invalidateMembershipCache`, `invalidateMemberCaches`.
 *
 * What this file pins:
 *   - the delete hits the key the policy reader reads (`membershipCacheKey`);
 *   - a failed delete is LOGGED with the org and user ids and never thrown
 *     (it was an empty catch: an ex-owner kept their cached role for up to
 *     the 60s TTL with no trace), even when the caller's `obs` is undefined;
 *   - `invalidateMemberCaches` busts all three: the membership entry, the
 *     org's slug-keyed public caches, and the user's library; for two users
 *     (an ownership change), each key exactly once.
 *
 * Assertions are on the KV keys written or deleted, never on "a helper was
 * called": the members-cache test records how a call-count assertion passed
 * while the invalidation itself was dead.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import { ObservabilityClient } from '@codex/observability';
import type { Bindings } from '@codex/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `dispatchOrgSlugInvalidation` builds a Drizzle client eagerly; the stub
// resolves the org's slug the way the real `organizations` read does.
const dbStub = vi.hoisted(() => ({
  query: { organizations: { findFirst: vi.fn() } },
}));

vi.mock('@codex/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/database')>();
  return { ...actual, createDbClient: vi.fn(() => dbStub) };
});

import { createDbClient } from '@codex/database';
import {
  invalidateMemberCaches,
  invalidateMembershipCache,
  type MemberCacheCtx,
} from '../cache-fanout';
import { membershipCacheKey } from '../procedure/org-helpers';

const ORG_ID = 'org-fanout-1';
const USER_ID = 'user-fanout-1';

function makeKv(deleteError?: Error) {
  const deletes: string[] = [];
  const puts: string[] = [];
  const kv = {
    get: vi.fn(async () => null),
    put: vi.fn(async (key: string) => {
      puts.push(key);
    }),
    delete: vi.fn(async (key: string) => {
      if (deleteError) throw deleteError;
      deletes.push(key);
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
  return { kv, deletes, puts };
}

function makeCtx(kv: KVNamespace | undefined) {
  const pending: Promise<unknown>[] = [];
  const ctx: MemberCacheCtx = {
    env: { CACHE_KV: kv } as unknown as Bindings,
    executionCtx: {
      waitUntil: (promise) => {
        pending.push(promise);
      },
    },
  };
  /** Settle every waitUntil task, including ones scheduled by other tasks. */
  async function drain() {
    while (pending.length > 0) {
      await Promise.all(pending.splice(0));
    }
  }
  return { ctx, pending, drain };
}

/** The obs is also handed to `VersionedCache`, which logs at every level. */
function makeObs() {
  const warn = vi.fn();
  const error = vi.fn();
  const obs = { warn, error, info: vi.fn(), debug: vi.fn() };
  return { obs: obs as unknown as ObservabilityClient, warn, error };
}

beforeEach(() => {
  vi.mocked(createDbClient).mockClear();
  dbStub.query.organizations.findFirst.mockReset();
  dbStub.query.organizations.findFirst.mockResolvedValue({ slug: 'acme' });
});

describe('invalidateMembershipCache', () => {
  it('deletes the key the policy reader reads, through waitUntil', async () => {
    const { kv, deletes } = makeKv();
    const { ctx, pending, drain } = makeCtx(kv);
    const { obs, warn } = makeObs();

    invalidateMembershipCache(ctx, ORG_ID, USER_ID, obs);

    expect(pending).toHaveLength(1);
    await drain();
    expect(deletes).toEqual([membershipCacheKey(ORG_ID, USER_ID)]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a failed delete is logged with the org and user ids, and never thrown', async () => {
    const { kv } = makeKv(new Error('KV unavailable'));
    const { ctx, drain } = makeCtx(kv);
    const { obs, warn } = makeObs();

    expect(() =>
      invalidateMembershipCache(ctx, ORG_ID, USER_ID, obs)
    ).not.toThrow();
    await expect(drain()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('cache: membership delete failed', {
      orgId: ORG_ID,
      userId: USER_ID,
      error: 'KV unavailable',
    });
  });

  // `ctx.obs` is typed `ObservabilityClient | undefined`: an undefined one
  // must not bring the empty catch back.
  it('a failed delete with no obs is still logged, through a client of its own', async () => {
    const { kv } = makeKv(new Error('KV unavailable'));
    const { ctx, drain } = makeCtx(kv);
    const ownWarn = vi
      .spyOn(ObservabilityClient.prototype, 'warn')
      .mockImplementation(() => {});

    try {
      invalidateMembershipCache(ctx, ORG_ID, USER_ID, undefined);
      await drain();

      expect(ownWarn).toHaveBeenCalledTimes(1);
      expect(ownWarn).toHaveBeenCalledWith('cache: membership delete failed', {
        orgId: ORG_ID,
        userId: USER_ID,
        error: 'KV unavailable',
      });
    } finally {
      ownWarn.mockRestore();
    }
  });

  it('does nothing without a CACHE_KV binding', () => {
    const { ctx, pending } = makeCtx(undefined);
    const { obs } = makeObs();

    invalidateMembershipCache(ctx, ORG_ID, USER_ID, obs);

    expect(pending).toHaveLength(0);
  });
});

describe('invalidateMemberCaches', () => {
  it('busts the membership entry, the org-slug caches and the user library', async () => {
    const { kv, deletes, puts } = makeKv();
    const { ctx, drain } = makeCtx(kv);
    const { obs, warn, error } = makeObs();

    invalidateMemberCaches(ctx, ORG_ID, [USER_ID], obs);
    await drain();

    expect(deletes).toEqual([membershipCacheKey(ORG_ID, USER_ID)]);
    expect(dbStub.query.organizations.findFirst).toHaveBeenCalledTimes(1);
    expect([...puts].sort()).toEqual([
      'cache:version:acme',
      'cache:version:org:acme:creators',
      `cache:version:user:${USER_ID}:library`,
    ]);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  // Codex-2hxff.46 (e): an ownership change busts both owners. Each user's
  // keys go once, and the org-slug pass, with its DB client, goes once.
  describe('an ownership change: every key exactly once', () => {
    const OTHER_ID = 'user-fanout-2';

    async function fanOut(userIds: readonly (string | null)[]) {
      const { kv, deletes, puts } = makeKv();
      const { ctx, drain } = makeCtx(kv);
      const { obs } = makeObs();
      invalidateMemberCaches(ctx, ORG_ID, userIds, obs);
      await drain();
      return { deletes: [...deletes].sort(), puts: [...puts].sort() };
    }

    it("two users: each one's keys, and the org's once", async () => {
      expect(await fanOut([USER_ID, OTHER_ID])).toEqual({
        deletes: [
          membershipCacheKey(ORG_ID, USER_ID),
          membershipCacheKey(ORG_ID, OTHER_ID),
        ].sort(),
        puts: [
          'cache:version:acme',
          'cache:version:org:acme:creators',
          `cache:version:user:${USER_ID}:library`,
          `cache:version:user:${OTHER_ID}:library`,
        ].sort(),
      });
      expect(vi.mocked(createDbClient)).toHaveBeenCalledTimes(1);
      expect(dbStub.query.organizations.findFirst).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['the same user twice', [USER_ID, USER_ID]],
      ['a null previous owner', [USER_ID, null]],
    ])("%s: one user's keys, and the org's once", async (_case, userIds) => {
      expect(await fanOut(userIds)).toEqual({
        deletes: [membershipCacheKey(ORG_ID, USER_ID)],
        puts: [
          'cache:version:acme',
          'cache:version:org:acme:creators',
          `cache:version:user:${USER_ID}:library`,
        ],
      });
      expect(vi.mocked(createDbClient)).toHaveBeenCalledTimes(1);
      expect(dbStub.query.organizations.findFirst).toHaveBeenCalledTimes(1);
    });
  });
});

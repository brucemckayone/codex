/**
 * The membership fan-out shared by organization-api and admin-api
 * (Codex-2hxff.44): `invalidateMembershipCache`, `invalidateMemberCaches`.
 *
 * What this file pins:
 *   - the delete hits the key the policy reader reads (`membershipCacheKey`);
 *   - a failed delete is LOGGED with the org and user ids and never thrown
 *     (it was an empty catch: an ex-owner kept their cached role for up to
 *     the 60s TTL with no trace);
 *   - `invalidateMemberCaches` busts all three: the membership entry, the
 *     org's slug-keyed public caches, and the user's library.
 *
 * Assertions are on the KV keys written or deleted, never on "a helper was
 * called": the members-cache test records how a call-count assertion passed
 * while the invalidation itself was dead.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import type { ObservabilityClient } from '@codex/observability';
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

  it('does nothing without a CACHE_KV binding', () => {
    const { ctx, pending } = makeCtx(undefined);

    invalidateMembershipCache(ctx, ORG_ID, USER_ID);

    expect(pending).toHaveLength(0);
  });
});

describe('invalidateMemberCaches', () => {
  it('busts the membership entry, the org-slug caches and the user library', async () => {
    const { kv, deletes, puts } = makeKv();
    const { ctx, drain } = makeCtx(kv);
    const { obs, warn, error } = makeObs();

    invalidateMemberCaches(ctx, ORG_ID, USER_ID, obs);
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
});

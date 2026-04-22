/**
 * Unit tests for the shared content-mutation cache invalidation helper
 * (Codex-c01do).
 *
 * Pure unit tests — no DB, no KV, no Hono. Both `VersionedCache` and the
 * Drizzle `db.query.*.findMany` surface are mocked so we can assert exactly
 * which keys would be invalidated, and exercise the fanout cap + error
 * swallowing paths without spinning up Neon.
 *
 * Coverage mirrors the subscription-invalidation test matrix:
 *   - Catalogue bumps fire unconditionally
 *   - Per-user fanout query union of purchases + subscribers + management
 *   - `includeFollowers` opt-in adds followers to the fanout
 *   - Deduplication across sources (a user who is both purchaser + subscriber
 *     is bumped once)
 *   - Fanout cap — above the cap, we log + skip per-user bumps
 *   - KV rejection is swallowed via `.catch`, never surfaces
 *   - waitUntil is called synchronously per bump (fire-and-forget semantics)
 *   - ValidationError on missing/empty contentId for the content helper
 *   - ValidationError on missing/empty userId for the membership helper
 */

import { CacheType, type VersionedCache } from '@codex/cache';
import type { Database } from '@codex/database';
import { ValidationError } from '@codex/service-errors';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MAX_LIBRARY_FANOUT,
  type InvalidationLogger,
  invalidateContentAccess,
  invalidateOrgMembership,
  type WaitUntilFn,
} from '../content-invalidation';

// ============================================================================
// Harness
// ============================================================================

interface QueryFixture {
  purchases: Array<{ customerId: string }>;
  subscriptions: Array<{ userId: string }>;
  organizationMemberships: Array<{ userId: string }>;
  organizationFollowers: Array<{ userId: string }>;
}

function makeDb(fixture: Partial<QueryFixture> = {}): Database {
  const defaults: QueryFixture = {
    purchases: [],
    subscriptions: [],
    organizationMemberships: [],
    organizationFollowers: [],
  };
  const rows = { ...defaults, ...fixture };

  // Only .findMany is exercised by the helper.
  const mock = {
    query: {
      purchases: {
        findMany: vi.fn().mockResolvedValue(rows.purchases),
      },
      subscriptions: {
        findMany: vi.fn().mockResolvedValue(rows.subscriptions),
      },
      organizationMemberships: {
        findMany: vi.fn().mockResolvedValue(rows.organizationMemberships),
      },
      organizationFollowers: {
        findMany: vi.fn().mockResolvedValue(rows.organizationFollowers),
      },
    },
  };
  // Drizzle has a much larger surface; we narrow it here because the helper
  // only uses `db.query.*.findMany`. Casting via unknown is the standard
  // pattern (see subscription-invalidation.test.ts) — not `as any`.
  return mock as unknown as Database;
}

function makeCache(
  invalidate: (id: string) => Promise<void> = () => Promise.resolve()
): { cache: VersionedCache; invalidate: ReturnType<typeof vi.fn> } {
  const fn = vi.fn(invalidate);
  const cache = { invalidate: fn } as unknown as VersionedCache;
  return { cache, invalidate: fn };
}

function makeWaitUntil(): {
  waitUntil: WaitUntilFn;
  promises: Array<Promise<unknown>>;
  spy: ReturnType<typeof vi.fn>;
} {
  const promises: Array<Promise<unknown>> = [];
  const spy = vi.fn((promise: Promise<unknown>) => {
    promises.push(promise);
  });
  return { waitUntil: spy, promises, spy };
}

const CONTENT_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '22222222-2222-2222-2222-222222222222';

// ============================================================================
// Tests — invalidateContentAccess
// ============================================================================

describe('invalidateContentAccess', () => {
  it('bumps the catalogue keys even when no users are affected', async () => {
    const db = makeDb();
    const { cache, invalidate } = makeCache();
    const { waitUntil, promises } = makeWaitUntil();

    await invalidateContentAccess({
      db,
      cache,
      waitUntil,
      contentId: CONTENT_ID,
      organizationId: ORG_ID,
      reason: 'content_updated',
    });

    await Promise.all(promises);

    // COLLECTION_CONTENT_PUBLISHED + COLLECTION_ORG_CONTENT
    expect(invalidate).toHaveBeenCalledWith(
      CacheType.COLLECTION_CONTENT_PUBLISHED
    );
    expect(invalidate).toHaveBeenCalledWith(
      CacheType.COLLECTION_ORG_CONTENT(ORG_ID)
    );
    // No per-user bumps — user set is empty
    const userLibraryCalls = invalidate.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].startsWith('user:')
    );
    expect(userLibraryCalls).toHaveLength(0);
  });

  it('skips the org collection bump when organizationId is null (personal content)', async () => {
    const db = makeDb();
    const { cache, invalidate } = makeCache();
    const { waitUntil, promises } = makeWaitUntil();

    await invalidateContentAccess({
      db,
      cache,
      waitUntil,
      contentId: CONTENT_ID,
      organizationId: null,
      reason: 'content_deleted',
    });

    await Promise.all(promises);

    expect(invalidate).toHaveBeenCalledWith(
      CacheType.COLLECTION_CONTENT_PUBLISHED
    );
    expect(invalidate).not.toHaveBeenCalledWith(
      expect.stringMatching(/^org:.*:content$/)
    );
  });

  it('unions purchasers, subscribers, and management members and fans per-user bumps', async () => {
    const db = makeDb({
      purchases: [{ customerId: 'u-purchase' }],
      subscriptions: [{ userId: 'u-subscriber' }],
      organizationMemberships: [{ userId: 'u-management' }],
    });
    const { cache, invalidate } = makeCache();
    const { waitUntil, promises } = makeWaitUntil();

    await invalidateContentAccess({
      db,
      cache,
      waitUntil,
      contentId: CONTENT_ID,
      organizationId: ORG_ID,
      reason: 'content_updated',
    });

    await Promise.all(promises);

    expect(invalidate).toHaveBeenCalledWith(
      CacheType.COLLECTION_USER_LIBRARY('u-purchase')
    );
    expect(invalidate).toHaveBeenCalledWith(
      CacheType.COLLECTION_USER_LIBRARY('u-subscriber')
    );
    expect(invalidate).toHaveBeenCalledWith(
      CacheType.COLLECTION_USER_LIBRARY('u-management')
    );
  });

  it('deduplicates when a user appears in multiple sources', async () => {
    const db = makeDb({
      purchases: [{ customerId: 'u-overlap' }],
      subscriptions: [{ userId: 'u-overlap' }],
      organizationMemberships: [{ userId: 'u-overlap' }],
    });
    const { cache, invalidate } = makeCache();
    const { waitUntil, promises } = makeWaitUntil();

    await invalidateContentAccess({
      db,
      cache,
      waitUntil,
      contentId: CONTENT_ID,
      organizationId: ORG_ID,
      reason: 'content_updated',
    });

    await Promise.all(promises);

    const overlapKey = CacheType.COLLECTION_USER_LIBRARY('u-overlap');
    const overlapCalls = invalidate.mock.calls.filter(
      (args) => args[0] === overlapKey
    );
    expect(overlapCalls).toHaveLength(1);
  });

  it('excludes followers from fanout by default', async () => {
    const db = makeDb({
      organizationFollowers: [{ userId: 'u-follower' }],
    });
    const { cache, invalidate } = makeCache();
    const { waitUntil, promises } = makeWaitUntil();

    await invalidateContentAccess({
      db,
      cache,
      waitUntil,
      contentId: CONTENT_ID,
      organizationId: ORG_ID,
      reason: 'content_updated',
      // includeFollowers defaults to false
    });

    await Promise.all(promises);

    expect(invalidate).not.toHaveBeenCalledWith(
      CacheType.COLLECTION_USER_LIBRARY('u-follower')
    );
  });

  it('includes followers when includeFollowers=true', async () => {
    const db = makeDb({
      organizationFollowers: [{ userId: 'u-follower' }],
    });
    const { cache, invalidate } = makeCache();
    const { waitUntil, promises } = makeWaitUntil();

    await invalidateContentAccess({
      db,
      cache,
      waitUntil,
      contentId: CONTENT_ID,
      organizationId: ORG_ID,
      reason: 'content_updated',
      includeFollowers: true,
    });

    await Promise.all(promises);

    expect(invalidate).toHaveBeenCalledWith(
      CacheType.COLLECTION_USER_LIBRARY('u-follower')
    );
  });

  it('skips per-user fanout and logs a warning when the cap is exceeded', async () => {
    // 3 users, cap=2 → skip fanout
    const db = makeDb({
      organizationMemberships: [
        { userId: 'u1' },
        { userId: 'u2' },
        { userId: 'u3' },
      ],
    });
    const { cache, invalidate } = makeCache();
    const { waitUntil, promises } = makeWaitUntil();
    const warn = vi.fn();
    const logger: InvalidationLogger = { warn };

    await invalidateContentAccess({
      db,
      cache,
      waitUntil,
      contentId: CONTENT_ID,
      organizationId: ORG_ID,
      reason: 'content_updated',
      logger,
      maxFanout: 2,
    });

    await Promise.all(promises);

    // Catalogue bumps still happen
    expect(invalidate).toHaveBeenCalledWith(
      CacheType.COLLECTION_CONTENT_PUBLISHED
    );
    // But no per-user bumps
    expect(invalidate).not.toHaveBeenCalledWith(
      CacheType.COLLECTION_USER_LIBRARY('u1')
    );
    expect(invalidate).not.toHaveBeenCalledWith(
      CacheType.COLLECTION_USER_LIBRARY('u2')
    );
    expect(invalidate).not.toHaveBeenCalledWith(
      CacheType.COLLECTION_USER_LIBRARY('u3')
    );
    // And the cap warning fires
    expect(warn).toHaveBeenCalledWith(
      'content-invalidation: fanout skipped (cap exceeded)',
      expect.objectContaining({
        contentId: CONTENT_ID,
        organizationId: ORG_ID,
        reason: 'content_updated',
        userCount: 3,
        maxFanout: 2,
      })
    );
  });

  it('swallows cache.invalidate rejections and routes them through the logger', async () => {
    const boom = new Error('KV unavailable');
    const db = makeDb({ purchases: [{ customerId: 'u-1' }] });
    const { cache } = makeCache(() => Promise.reject(boom));
    const { waitUntil, promises } = makeWaitUntil();
    const warn = vi.fn();
    const logger: InvalidationLogger = { warn };

    await expect(
      invalidateContentAccess({
        db,
        cache,
        waitUntil,
        contentId: CONTENT_ID,
        organizationId: ORG_ID,
        reason: 'content_updated',
        logger,
      })
    ).resolves.toBeUndefined();

    await expect(Promise.all(promises)).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ]);

    // One warn per failed bump (content:published, org:content, user:library)
    expect(warn).toHaveBeenCalledWith(
      'content-invalidation: bump failed',
      expect.objectContaining({
        reason: 'content_updated',
        error: 'KV unavailable',
      })
    );
  });

  it('hands each bump to waitUntil synchronously (fire-and-forget)', async () => {
    // Each cache.invalidate returns a pending promise we control manually.
    const resolvers: Array<() => void> = [];
    const { cache } = makeCache(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        })
    );
    const db = makeDb({ purchases: [{ customerId: 'u-1' }] });
    const { waitUntil, promises, spy } = makeWaitUntil();

    await invalidateContentAccess({
      db,
      cache,
      waitUntil,
      contentId: CONTENT_ID,
      organizationId: ORG_ID,
      reason: 'content_updated',
    });

    // Three bumps: content:published, org:content, user:library(u-1).
    // All three should be queued to waitUntil even though the underlying
    // KV writes are still pending.
    expect(spy).toHaveBeenCalledTimes(3);
    expect(resolvers).toHaveLength(3);

    // Now resolve them all and flush.
    for (const r of resolvers) r();
    await Promise.all(promises);
  });

  it('throws ValidationError when contentId is missing', async () => {
    const db = makeDb();
    const { cache } = makeCache();
    const { waitUntil } = makeWaitUntil();

    await expect(
      invalidateContentAccess({
        db,
        cache,
        waitUntil,
        // Simulate a caller that lost the content id somewhere — this is
        // the runtime guard, distinct from the compile-time type.
        contentId: '' as string,
        organizationId: ORG_ID,
        reason: 'content_updated',
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('respects the default cap constant', () => {
    // Sanity check that the export is stable — route code relies on the
    // documented default (500) to set its own overrides.
    expect(DEFAULT_MAX_LIBRARY_FANOUT).toBe(500);
  });
});

// ============================================================================
// Tests — invalidateOrgMembership
// ============================================================================

describe('invalidateOrgMembership', () => {
  it('bumps the COLLECTION_USER_LIBRARY key for the target user', async () => {
    const { cache, invalidate } = makeCache();
    const { waitUntil, promises } = makeWaitUntil();

    invalidateOrgMembership({
      cache,
      waitUntil,
      userId: 'u-123',
      organizationId: ORG_ID,
      reason: 'membership_role_changed',
    });

    await Promise.all(promises);

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith(
      CacheType.COLLECTION_USER_LIBRARY('u-123')
    );
  });

  it('calls waitUntil synchronously before any KV work completes', async () => {
    const resolvers: Array<() => void> = [];
    const { cache } = makeCache(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        })
    );
    const { waitUntil, promises, spy } = makeWaitUntil();

    invalidateOrgMembership({
      cache,
      waitUntil,
      userId: 'u-123',
      organizationId: ORG_ID,
      reason: 'membership_removed',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(resolvers).toHaveLength(1);
    for (const r of resolvers) r();
    await Promise.all(promises);
  });

  it('swallows KV rejections via the logger', async () => {
    const boom = new Error('KV unavailable');
    const { cache } = makeCache(() => Promise.reject(boom));
    const { waitUntil, promises } = makeWaitUntil();
    const warn = vi.fn();

    invalidateOrgMembership({
      cache,
      waitUntil,
      userId: 'u-123',
      organizationId: ORG_ID,
      reason: 'follower_added',
      logger: { warn },
    });

    await expect(Promise.all(promises)).resolves.toEqual([undefined]);
    expect(warn).toHaveBeenCalledWith(
      'content-invalidation: bump failed',
      expect.objectContaining({
        userId: 'u-123',
        organizationId: ORG_ID,
        reason: 'follower_added',
        error: 'KV unavailable',
      })
    );
  });

  it('throws ValidationError when userId is missing', () => {
    const { cache } = makeCache();
    const { waitUntil } = makeWaitUntil();

    expect(() =>
      invalidateOrgMembership({
        cache,
        waitUntil,
        userId: '',
        organizationId: ORG_ID,
        reason: 'membership_role_changed',
      })
    ).toThrow(ValidationError);
  });
});

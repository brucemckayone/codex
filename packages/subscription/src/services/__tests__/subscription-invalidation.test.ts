/**
 * Unit tests for the shared subscription cache invalidation helper.
 *
 * These are pure unit tests — no DB, no KV, no Hono. `VersionedCache` is
 * mocked so we can assert exactly which keys would be invalidated and that
 * `waitUntil` is wired up for fire-and-forget semantics.
 *
 * Coverage (see docs/subscription-cache-audit/testing-matrix.md — PR 1 Unit):
 * - Library-only path when no orgId
 * - Library + subscription path when orgId present
 * - waitUntil called synchronously (does not block return)
 * - KV failure is swallowed, never surfaces out of the helper
 * - userId validation (missing / empty)
 * - reason tag is preserved on the observability warn output
 */

import { CacheType, type VersionedCache } from '@codex/cache';
import { ValidationError } from '@codex/service-errors';
import { describe, expect, it, vi } from 'vitest';
import {
  type InvalidationLogger,
  invalidateForUser,
  type WaitUntilFn,
} from '../subscription-invalidation';

/**
 * Build a minimal mock VersionedCache. Only `invalidate` is needed — the
 * helper never touches get/getWithResult/etc.
 */
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

describe('invalidateForUser', () => {
  it('bumps only the library cache when no orgId is provided', async () => {
    const { cache, invalidate } = makeCache();
    const { waitUntil, promises } = makeWaitUntil();

    invalidateForUser(cache, waitUntil, {
      userId: 'user-123',
      reason: 'refund',
    });

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith(
      CacheType.COLLECTION_USER_LIBRARY('user-123')
    );
    await Promise.all(promises);
  });

  it('bumps both library and subscription caches when orgId is provided', async () => {
    const { cache, invalidate } = makeCache();
    const { waitUntil, promises } = makeWaitUntil();

    invalidateForUser(cache, waitUntil, {
      userId: 'user-123',
      orgId: 'org-456',
      reason: 'cancel',
    });

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenNthCalledWith(
      1,
      CacheType.COLLECTION_USER_LIBRARY('user-123')
    );
    expect(invalidate).toHaveBeenNthCalledWith(
      2,
      CacheType.COLLECTION_USER_SUBSCRIPTION('user-123', 'org-456')
    );
    await Promise.all(promises);
  });

  it('invokes waitUntil synchronously for each bump and returns before the promise resolves', async () => {
    // Each call to invalidate returns a pending promise. We capture all
    // resolvers so we can flush them after asserting the synchronous behaviour.
    const resolvers: Array<() => void> = [];
    const { cache, invalidate } = makeCache(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        })
    );
    const { waitUntil, promises, spy } = makeWaitUntil();

    invalidateForUser(cache, waitUntil, {
      userId: 'user-123',
      orgId: 'org-456',
      reason: 'change_tier',
    });

    // waitUntil should have been called twice already — synchronously.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(2);

    // Both underlying KV promises are still pending when the helper returned.
    expect(resolvers).toHaveLength(2);
    for (const resolve of resolvers) {
      resolve();
    }
    await Promise.all(promises);
  });

  it('swallows cache.invalidate rejections so the waitUntil promise always resolves', async () => {
    const boom = new Error('KV unavailable');
    const { cache } = makeCache(() => Promise.reject(boom));
    const { waitUntil, promises } = makeWaitUntil();

    expect(() =>
      invalidateForUser(cache, waitUntil, {
        userId: 'user-123',
        orgId: 'org-456',
        reason: 'payment_failed',
      })
    ).not.toThrow();

    // Both promises should resolve (never reject) because of the `.catch` guard.
    await expect(Promise.all(promises)).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it('throws ValidationError when userId is missing at runtime', () => {
    const { cache, invalidate } = makeCache();
    const { waitUntil, spy } = makeWaitUntil();

    expect(() =>
      invalidateForUser(
        cache,
        waitUntil,
        // Runtime guard — mimic a webhook handler that extracted undefined
        // from Stripe metadata. We cast through `unknown` to bypass the
        // compile-time guard without using `as any`.
        {
          reason: 'subscription_updated',
        } as unknown as Parameters<typeof invalidateForUser>[2]
      )
    ).toThrow(ValidationError);

    expect(invalidate).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws ValidationError when userId is an empty string', () => {
    const { cache, invalidate } = makeCache();
    const { waitUntil, spy } = makeWaitUntil();

    expect(() =>
      invalidateForUser(cache, waitUntil, {
        userId: '',
        reason: 'subscription_deleted',
      })
    ).toThrow(ValidationError);

    expect(invalidate).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it('forwards reason to the logger when a bump fails', async () => {
    const boom = new Error('KV unavailable');
    const { cache } = makeCache(() => Promise.reject(boom));
    const { waitUntil, promises } = makeWaitUntil();
    const warn = vi.fn();
    const logger: InvalidationLogger = { warn };

    invalidateForUser(
      cache,
      waitUntil,
      {
        userId: 'user-123',
        orgId: 'org-456',
        reason: 'payment_succeeded',
      },
      { logger }
    );

    await Promise.all(promises);

    expect(warn).toHaveBeenCalledTimes(2);
    // Library bump failure
    expect(warn).toHaveBeenNthCalledWith(
      1,
      'subscription-invalidation: library bump failed',
      expect.objectContaining({
        userId: 'user-123',
        orgId: 'org-456',
        reason: 'payment_succeeded',
        error: 'KV unavailable',
      })
    );
    // Subscription bump failure
    expect(warn).toHaveBeenNthCalledWith(
      2,
      'subscription-invalidation: subscription bump failed',
      expect.objectContaining({
        userId: 'user-123',
        orgId: 'org-456',
        reason: 'payment_succeeded',
        error: 'KV unavailable',
      })
    );
  });

  it('skips the subscription bump when orgId is an empty string', async () => {
    const { cache, invalidate } = makeCache();
    const { waitUntil, promises } = makeWaitUntil();

    invalidateForUser(cache, waitUntil, {
      userId: 'user-123',
      orgId: '',
      reason: 'reactivate',
    });

    // Empty orgId is treated as "no org" — only the library cache is bumped.
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith(
      CacheType.COLLECTION_USER_LIBRARY('user-123')
    );
    await Promise.all(promises);
  });
});

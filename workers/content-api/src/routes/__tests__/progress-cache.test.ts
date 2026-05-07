/**
 * Progress Cache Wiring — Unit Tests
 *
 * Verifies the conditional that gates `invalidateUserLibrary` on first
 * engagement. The helper exists so this contract is testable without a full
 * Hono + workerd test app — see `progress-cache.ts` for rationale.
 *
 * Contract under test:
 *   1. firstEngagement === true  → KV version key is bumped (one PUT to KV).
 *   2. firstEngagement === false → no KV interaction (heartbeat case).
 *   3. KV binding undefined      → no-op, no throw, no waitUntil dispatch.
 *   4. Empty userId              → no-op (defensive — invalidateUserLibrary
 *                                   guards on this anyway).
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import { CacheType } from '@codex/cache';
import { describe, expect, it, vi } from 'vitest';
import { bumpUserLibraryOnFirstEngagement } from '../progress-cache';

function createMockKV(): KVNamespace & {
  _data: Map<string, string>;
} {
  const data = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      data.delete(key);
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
    _data: data,
  } as unknown as KVNamespace & { _data: Map<string, string> };
}

/**
 * Mirror the route handler's waitUntil pattern: capture the promise so the
 * test can await its completion before asserting on KV state.
 */
function createWaitUntilCapture() {
  const promises: Array<Promise<unknown>> = [];
  const waitUntil = vi.fn((p: Promise<unknown>) => {
    promises.push(p);
  });
  const settle = () => Promise.allSettled(promises);
  return { waitUntil, settle };
}

describe('bumpUserLibraryOnFirstEngagement', () => {
  it('bumps user library KV version when firstEngagement is true', async () => {
    const kv = createMockKV();
    const { waitUntil, settle } = createWaitUntilCapture();

    bumpUserLibraryOnFirstEngagement({
      firstEngagement: true,
      kv,
      waitUntil,
      userId: 'user-abc',
    });

    await settle();

    // Helper dispatches via waitUntil — fire-and-forget contract.
    expect(waitUntil).toHaveBeenCalledTimes(1);

    // VersionedCache.invalidate writes the new version timestamp under
    // `cache:version:{id}` where id is COLLECTION_USER_LIBRARY('user-abc').
    // KV.put accepts optional metadata/expiration as a 3rd arg, so assert by
    // inspecting captured calls rather than fixing the arity.
    const expectedVersionKey = `cache:version:${CacheType.COLLECTION_USER_LIBRARY('user-abc')}`;
    const putCalls = (kv.put as ReturnType<typeof vi.fn>).mock.calls;
    const versionPut = putCalls.find((call) => call[0] === expectedVersionKey);
    expect(versionPut).toBeDefined();
    expect(typeof versionPut?.[1]).toBe('string');
    expect(kv._data.has(expectedVersionKey)).toBe(true);
  });

  it('does NOT bump KV when firstEngagement is false (heartbeat case)', async () => {
    const kv = createMockKV();
    const { waitUntil, settle } = createWaitUntilCapture();

    bumpUserLibraryOnFirstEngagement({
      firstEngagement: false,
      kv,
      waitUntil,
      userId: 'user-abc',
    });

    await settle();

    expect(waitUntil).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
    expect(kv._data.size).toBe(0);
  });

  it('is a no-op when CACHE_KV is undefined (env not bound)', async () => {
    const { waitUntil, settle } = createWaitUntilCapture();

    bumpUserLibraryOnFirstEngagement({
      firstEngagement: true,
      kv: undefined,
      waitUntil,
      userId: 'user-abc',
    });

    await settle();

    // Underlying invalidateUserLibrary short-circuits when kv is missing —
    // no waitUntil dispatch should occur.
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('is a no-op for empty userId', async () => {
    const kv = createMockKV();
    const { waitUntil, settle } = createWaitUntilCapture();

    bumpUserLibraryOnFirstEngagement({
      firstEngagement: true,
      kv,
      waitUntil,
      userId: '',
    });

    await settle();

    expect(waitUntil).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
  });
});

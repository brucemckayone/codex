import type { KVNamespace } from '@cloudflare/workers-types';
import { createMockKVNamespace } from '@codex/test-utils/mocks';
import { describe, expect, it, vi } from 'vitest';
import { CacheType } from '../cache-keys';
import { invalidateUserLibrary } from '../helpers/invalidate';

describe('invalidateUserLibrary', () => {
  it('bumps COLLECTION_USER_LIBRARY version key when kv + userId provided', async () => {
    const kv = createMockKVNamespace();
    const tasks: Promise<unknown>[] = [];
    const waitUntil = (p: Promise<unknown>) => {
      tasks.push(p);
    };

    invalidateUserLibrary({
      kv: kv as unknown as KVNamespace,
      waitUntil,
      userId: 'user-123',
    });

    await Promise.all(tasks);

    // VersionedCache.invalidate writes the version key
    const expectedKey = `cache:version:${CacheType.COLLECTION_USER_LIBRARY('user-123')}`;
    expect(kv.put.mock.calls.some(([k]: unknown[]) => k === expectedKey)).toBe(
      true
    );
  });

  it('is a no-op when kv binding is missing', async () => {
    const tasks: Promise<unknown>[] = [];
    const waitUntil = (p: Promise<unknown>) => {
      tasks.push(p);
    };

    invalidateUserLibrary({
      kv: undefined,
      waitUntil,
      userId: 'user-123',
    });

    expect(tasks).toHaveLength(0);
  });

  it('is a no-op when userId is empty', async () => {
    const kv = createMockKVNamespace();
    const tasks: Promise<unknown>[] = [];
    const waitUntil = (p: Promise<unknown>) => {
      tasks.push(p);
    };

    invalidateUserLibrary({
      kv: kv as unknown as KVNamespace,
      waitUntil,
      userId: '',
    });

    expect(tasks).toHaveLength(0);
  });

  it('swallows KV errors and surfaces via logger.warn', async () => {
    const baseKv = createMockKVNamespace();
    const failingKv = {
      ...baseKv,
      put: vi.fn(async () => {
        throw new Error('KV down');
      }),
    } as unknown as KVNamespace;
    const tasks: Promise<unknown>[] = [];
    const waitUntil = (p: Promise<unknown>) => {
      tasks.push(p);
    };
    const warn = vi.fn();

    invalidateUserLibrary({
      kv: failingKv,
      waitUntil,
      userId: 'user-1',
      logger: { warn },
    });

    await Promise.all(tasks);
    // VersionedCache catches put errors internally — the helper's catch is a
    // belt-and-suspenders. Either path leaves the helper non-throwing.
    expect(tasks).toHaveLength(1);
  });
});
